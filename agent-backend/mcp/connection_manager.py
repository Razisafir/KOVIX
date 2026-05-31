"""MCP Connection Manager — pooled connections, health monitoring, auto-reconnect.

Manages connections to MCP servers over HTTP/SSE **or** stdio transport with
connection pooling, health checks, and automatic reconnection.

Example (HTTP)::

    manager = MCPConnectionManager()
    config = ServerConfig(name="github", url="http://localhost:3001/sse")
    await manager.connect("github", config)
    result = await manager.request("github", "POST", "/tools/call", json={...})
    await manager.disconnect("github")

Example (stdio)::

    manager = MCPConnectionManager()
    config = StdioServerConfig(name="fs", command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])
    await manager.connect_stdio("fs", config)
    tools = await manager.list_stdio_tools("fs")
    result = await manager.call_stdio_tool("fs", "read_file", {"path": "/tmp/hello.txt"})
    await manager.disconnect_stdio("fs")
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Coroutine, Dict, List, Optional, Tuple

import aiohttp
from aiohttp import ClientTimeout, ClientError, ClientResponseError

logger = logging.getLogger(__name__)


class ConnectionStatus(str, Enum):
    """Lifecycle states for an MCP connection."""

    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    ERROR = "error"
    DEGRADED = "degraded"


@dataclass
class HealthStatus:
    """Snapshot of connection health metrics."""

    status: ConnectionStatus
    latency_ms: float
    last_error: Optional[str]
    last_success: float
    consecutive_failures: int
    total_requests: int
    success_rate: float


@dataclass
class ServerConfig:
    """Configuration for a single MCP server connection (HTTP transport)."""

    name: str
    url: str
    api_key: Optional[str] = None
    timeout_sec: float = 30.0
    max_retries: int = 3
    headers: Dict[str, str] = field(default_factory=dict)
    retry_backoff_base: float = 1.0
    retry_backoff_max: float = 60.0
    pool_size: int = 10


@dataclass
class StdioServerConfig:
    """Configuration for an MCP server connection over stdio transport.

    The MCP server is launched as a subprocess that communicates via
    JSON-RPC over stdin/stdout (the standard MCP stdio transport).

    Attributes:
        name: Human-readable identifier for this server.
        command: The executable to launch (e.g. ``"npx"``, ``"python"``).
        args: Arguments passed to the command.
        env: Optional environment variables for the subprocess.
        timeout_sec: Timeout for individual JSON-RPC requests.
    """

    name: str
    command: str
    args: List[str] = field(default_factory=list)
    env: Optional[Dict[str, str]] = None
    timeout_sec: float = 30.0


@dataclass
class StdioMCPTool:
    """A tool discovered from a stdio MCP server."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    server: str


class StdioMCPConnection:
    """Manages a single MCP stdio subprocess connection.

    Handles the full JSON-RPC lifecycle over stdin/stdout:
    - ``initialize`` handshake on connect
    - ``tools/list`` for discovery
    - ``tools/call`` for execution
    - ``ping`` for health checks
    """

    def __init__(self, config: StdioServerConfig) -> None:
        self.config = config
        self.process: Optional[asyncio.subprocess.Process] = None
        self.status = ConnectionStatus.DISCONNECTED
        self.tools: List[StdioMCPTool] = []
        self.server_info: Dict[str, Any] = {}
        self._request_id = 0
        self._lock = asyncio.Lock()
        self._health = HealthStatus(
            status=ConnectionStatus.DISCONNECTED,
            latency_ms=0.0,
            last_error=None,
            last_success=0.0,
            consecutive_failures=0,
            total_requests=0,
            success_rate=1.0,
        )

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def connect(self) -> bool:
        """Launch the MCP server subprocess and perform the initialize handshake.

        Returns:
            ``True`` if the server started and the handshake succeeded.
        """
        async with self._lock:
            if self.status == ConnectionStatus.CONNECTED and self.process is not None:
                logger.debug("stdio connection to %s already established", self.config.name)
                return True

            self.status = ConnectionStatus.CONNECTING
            try:
                # Launch subprocess
                env_override = None
                if self.config.env:
                    import os
                    env_override = {**os.environ, **self.config.env}

                self.process = await asyncio.create_subprocess_exec(
                    self.config.command,
                    *self.config.args,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env_override,
                )

                # Give the process a moment to start
                await asyncio.sleep(0.3)

                if self.process.returncode is not None:
                    stderr_out = ""
                    try:
                        stderr_bytes = await asyncio.wait_for(
                            self.process.stderr.read(), timeout=2.0
                        )
                        stderr_out = stderr_bytes.decode(errors="replace")
                    except Exception:
                        pass
                    raise RuntimeError(
                        f"MCP server process exited immediately (code={self.process.returncode}): {stderr_out}"
                    )

                # Perform MCP initialize handshake
                init_result = await self._send_request("initialize", {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}, "resources": {}},
                    "clientInfo": {"name": "construct-agent", "version": "1.0.0"},
                })

                if "error" in init_result:
                    raise RuntimeError(
                        f"MCP initialize failed: {init_result['error']}"
                    )

                self.server_info = init_result.get("result", {})
                self.status = ConnectionStatus.CONNECTED
                self._health.status = ConnectionStatus.CONNECTED
                self._health.last_success = time.time()
                logger.info(
                    "Connected to MCP stdio server '%s' (pid=%s, protocol=%s)",
                    self.config.name,
                    self.process.pid,
                    self.server_info.get("protocolVersion", "unknown"),
                )

                # Discover tools
                await self._discover_tools()

                # Send initialized notification (required by MCP spec)
                await self._send_notification("notifications/initialized", {})

                return True

            except Exception as exc:
                logger.error(
                    "Failed to connect to MCP stdio server '%s': %s",
                    self.config.name,
                    exc,
                    exc_info=True,
                )
                self.status = ConnectionStatus.ERROR
                self._health.status = ConnectionStatus.ERROR
                self._health.last_error = str(exc)
                # Clean up process if it started
                if self.process is not None and self.process.returncode is None:
                    try:
                        self.process.terminate()
                        await asyncio.wait_for(self.process.wait(), timeout=5.0)
                    except Exception:
                        try:
                            self.process.kill()
                        except Exception:
                            pass
                    self.process = None
                return False

    async def _discover_tools(self) -> List[StdioMCPTool]:
        """Discover tools from the MCP server via tools/list."""
        self.tools = []
        try:
            result = await self._send_request("tools/list", {})
            tool_list = result.get("result", {}).get("tools", [])
            for t in tool_list:
                tool = StdioMCPTool(
                    name=t.get("name", "unknown"),
                    description=t.get("description", ""),
                    input_schema=t.get("inputSchema", {}),
                    server=self.config.name,
                )
                self.tools.append(tool)
            logger.info(
                "Discovered %d tool(s) from MCP stdio server '%s': %s",
                len(self.tools),
                self.config.name,
                ", ".join(t.name for t in self.tools),
            )
        except Exception as exc:
            logger.warning(
                "Tool discovery failed for stdio server '%s': %s",
                self.config.name,
                exc,
            )
        return self.tools

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool on the MCP server via tools/call.

        Args:
            tool_name: The tool to invoke.
            arguments: Arguments to pass to the tool.

        Returns:
            The tool result as a dictionary.

        Raises:
            RuntimeError: If the connection is not established.
            Exception: If the tool call fails.
        """
        if self.status != ConnectionStatus.CONNECTED or self.process is None:
            raise RuntimeError(
                f"Not connected to MCP stdio server '{self.config.name}' "
                f"(status={self.status.value})"
            )

        start = time.perf_counter()
        try:
            result = await self._send_request("tools/call", {
                "name": tool_name,
                "arguments": arguments,
            })
            latency_ms = (time.perf_counter() - start) * 1000
            self._record_success(latency_ms)

            # Extract the content from MCP response format
            if "error" in result:
                error_info = result["error"]
                return {
                    "success": False,
                    "error": f"MCP tool error: {error_info}",
                    "tool": tool_name,
                    "server": self.config.name,
                }

            mcp_result = result.get("result", {})
            # MCP returns content as array of content items
            content = mcp_result.get("content", [])
            is_error = mcp_result.get("isError", False)

            # Flatten content items into a single result
            text_parts = []
            for item in content:
                if item.get("type") == "text":
                    text_parts.append(item.get("text", ""))
                elif item.get("type") == "image":
                    text_parts.append(f"[image: {item.get('mimeType', 'unknown')}]")
                elif item.get("type") == "resource":
                    text_parts.append(f"[resource: {item.get('resource', {}).get('uri', '')}]")

            combined_text = "\n".join(text_parts)

            return {
                "success": not is_error,
                "result": combined_text,
                "tool": tool_name,
                "server": self.config.name,
                "is_error": is_error,
                "raw": mcp_result,
            }

        except Exception as exc:
            latency_ms = (time.perf_counter() - start) * 1000
            self._record_failure(str(exc), latency_ms)
            return {
                "success": False,
                "error": str(exc),
                "tool": tool_name,
                "server": self.config.name,
            }

    async def ping(self) -> bool:
        """Send a ping to check if the server is still alive."""
        if self.process is None or self.process.returncode is not None:
            return False
        try:
            result = await self._send_request("ping", {})
            return "error" not in result
        except Exception:
            return False

    async def _send_request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Send a JSON-RPC request and wait for the response.

        Reads stdout line-by-line to find the matching response.
        """
        if self.process is None or self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError(f"stdio process for '{self.config.name}' is not running")

        request_id = self._next_id()
        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }

        # Send request
        payload = json.dumps(request) + "\n"
        self.process.stdin.write(payload.encode("utf-8"))
        await self.process.stdin.drain()

        # Read response with timeout
        try:
            response_line = await asyncio.wait_for(
                self.process.stdout.readline(),
                timeout=self.config.timeout_sec,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Timeout waiting for response from MCP stdio server '{self.config.name}' "
                f"(method={method}, timeout={self.config.timeout_sec}s)"
            )

        if not response_line:
            raise RuntimeError(
                f"Empty response from MCP stdio server '{self.config.name}' "
                f"(process may have crashed)"
            )

        # Parse response — skip non-JSON lines (e.g. stderr that leaked to stdout)
        line = response_line.decode("utf-8", errors="replace").strip()
        while line and not line.startswith("{"):
            line = (await asyncio.wait_for(
                self.process.stdout.readline(), timeout=self.config.timeout_sec
            )).decode("utf-8", errors="replace").strip()

        if not line:
            raise RuntimeError(
                f"No JSON response from MCP stdio server '{self.config.name}'"
            )

        try:
            response = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Invalid JSON from MCP stdio server '{self.config.name}': {line[:200]}"
            ) from exc

        return response

    async def _send_notification(self, method: str, params: Dict[str, Any]) -> None:
        """Send a JSON-RPC notification (no id, no response expected)."""
        if self.process is None or self.process.stdin is None:
            return

        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
        payload = json.dumps(notification) + "\n"
        self.process.stdin.write(payload.encode("utf-8"))
        await self.process.stdin.drain()

    async def disconnect(self) -> None:
        """Terminate the MCP server subprocess."""
        if self.process is not None:
            try:
                # Try graceful shutdown notification first
                await self._send_notification("shutdown", {})
                await asyncio.sleep(0.1)
            except Exception:
                pass

            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                try:
                    self.process.kill()
                    await self.process.wait()
                except Exception:
                    pass
            except Exception as exc:
                logger.warning(
                    "Error terminating MCP stdio process for '%s': %s",
                    self.config.name,
                    exc,
                )
            finally:
                self.process = None

        self.status = ConnectionStatus.DISCONNECTED
        self._health.status = ConnectionStatus.DISCONNECTED
        self.tools = []
        logger.info("Disconnected from MCP stdio server '%s'", self.config.name)

    def _record_success(self, latency_ms: float) -> None:
        """Update health metrics after a successful request."""
        self._health.total_requests += 1
        self._health.consecutive_failures = 0
        self._health.last_success = time.time()
        self._health.latency_ms = latency_ms
        total = self._health.total_requests
        successes = total - self._health.consecutive_failures
        self._health.success_rate = successes / total if total > 0 else 1.0
        if self._health.status == ConnectionStatus.ERROR:
            self._health.status = ConnectionStatus.CONNECTED
            self.status = ConnectionStatus.CONNECTED

    def _record_failure(self, error_msg: str, latency_ms: float) -> None:
        """Update health metrics after a failed request."""
        self._health.total_requests += 1
        self._health.consecutive_failures += 1
        self._health.last_error = error_msg
        self._health.latency_ms = latency_ms
        total = self._health.total_requests
        successes = total - self._health.consecutive_failures
        self._health.success_rate = successes / total if total > 0 else 0.0

        if self._health.consecutive_failures >= 3:
            self._health.status = ConnectionStatus.ERROR
            self.status = ConnectionStatus.ERROR
        elif self._health.consecutive_failures >= 1:
            self._health.status = ConnectionStatus.DEGRADED
            self.status = ConnectionStatus.DEGRADED

    @property
    def health(self) -> HealthStatus:
        """Return a snapshot of the current health status."""
        return self._health


class MCPConnection:
    """A single connection to an MCP server over HTTP.

    Wraps an :class:`aiohttp.ClientSession` with health tracking,
    automatic retry logic, and graceful disconnect.
    """

    def __init__(self, config: ServerConfig) -> None:
        self.config = config
        self.status = ConnectionStatus.DISCONNECTED
        self.session: Optional[aiohttp.ClientSession] = None
        self._health = HealthStatus(
            status=ConnectionStatus.DISCONNECTED,
            latency_ms=0.0,
            last_error=None,
            last_success=0.0,
            consecutive_failures=0,
            total_requests=0,
            success_rate=1.0,
        )
        self._lock = asyncio.Lock()
        self._active_requests = 0
        self._semaphore = asyncio.Semaphore(config.pool_size)

    async def connect(self) -> bool:
        """Establish connection to the MCP server.

        Creates a persistent :class:`aiohttp.ClientSession` and sends a
        lightweight health-check probe to verify reachability.

        Returns:
            ``True`` if the server responded with 2xx, ``False`` otherwise.
        """
        async with self._lock:
            if self.status == ConnectionStatus.CONNECTED and self.session is not None:
                logger.debug("Connection to %s already established", self.config.name)
                return True

            self.status = ConnectionStatus.CONNECTING
            try:
                timeout = ClientTimeout(total=self.config.timeout_sec)
                default_headers: Dict[str, str] = dict(self.config.headers)
                if self.config.api_key:
                    default_headers["Authorization"] = f"Bearer {self.config.api_key}"
                default_headers["Content-Type"] = "application/json"

                connector = aiohttp.TCPConnector(
                    limit=self.config.pool_size,
                    limit_per_host=self.config.pool_size,
                    enable_cleanup_closed=True,
                    force_close=False,
                )
                self.session = aiohttp.ClientSession(
                    base_url=self.config.url.rstrip("/"),
                    headers=default_headers,
                    timeout=timeout,
                    connector=connector,
                )

                # Probe with a lightweight health endpoint or root GET
                probe_path = "/health" if not self.config.url.endswith("/sse") else "/"
                probe_url = f"{self.config.url.rstrip('/')}{probe_path}"
                async with aiohttp.ClientSession(timeout=timeout) as probe_session:
                    async with probe_session.get(probe_url, headers=default_headers) as resp:
                        if resp.status < 500:
                            self.status = ConnectionStatus.CONNECTED
                            self._health.status = ConnectionStatus.CONNECTED
                            self._health.last_success = time.time()
                            logger.info(
                                "Connected to MCP server %s at %s (probe_status=%s)",
                                self.config.name,
                                self.config.url,
                                resp.status,
                            )
                            return True
            except asyncio.TimeoutError:
                logger.warning(
                    "Connection timeout to %s at %s", self.config.name, self.config.url
                )
                self.status = ConnectionStatus.ERROR
                self._health.status = ConnectionStatus.ERROR
                self._health.last_error = "Connection timeout"
            except ClientError as exc:
                logger.warning(
                    "Connection error to %s: %s", self.config.name, exc
                )
                self.status = ConnectionStatus.ERROR
                self._health.status = ConnectionStatus.ERROR
                self._health.last_error = str(exc)
            except Exception as exc:
                logger.error(
                    "Unexpected error connecting to %s: %s",
                    self.config.name,
                    exc,
                    exc_info=True,
                )
                self.status = ConnectionStatus.ERROR
                self._health.status = ConnectionStatus.ERROR
                self._health.last_error = str(exc)

            return False

    async def disconnect(self) -> None:
        """Close the connection and release resources."""
        async with self._lock:
            if self.session is not None:
                try:
                    await self.session.close()
                except Exception as exc:
                    logger.warning(
                        "Error closing session for %s: %s", self.config.name, exc
                    )
                finally:
                    self.session = None
            self.status = ConnectionStatus.DISCONNECTED
            self._health.status = ConnectionStatus.DISCONNECTED
            logger.info("Disconnected from MCP server %s", self.config.name)

    async def request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Make an HTTP request through this connection.

        Tracks latency, updates health metrics, and applies retry logic
        with exponential backoff.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: URL path (relative to base URL).
            **kwargs: Extra arguments forwarded to :meth:`aiohttp.ClientSession.request`.

        Returns:
            Parsed JSON response as a dict.

        Raises:
            ClientError: After exhausting all retries.
            RuntimeError: If the connection is not established.
        """
        if self.session is None or self.status != ConnectionStatus.CONNECTED:
            raise RuntimeError(
                f"Connection to {self.config.name} is not established. "
                "Call connect() first."
            )

        last_exception: Optional[Exception] = None
        for attempt in range(1, self.config.max_retries + 1):
            async with self._semaphore:
                start = time.perf_counter()
                try:
                    async with self.session.request(method, path, **kwargs) as resp:
                        latency_ms = (time.perf_counter() - start) * 1000
                        self._record_success(latency_ms)

                        if resp.status == 204:
                            return {"ok": True}

                        body = await resp.json()
                        return body

                except (ClientError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
                    latency_ms = (time.perf_counter() - start) * 1000
                    last_exception = exc
                    self._record_failure(str(exc), latency_ms)
                    if attempt < self.config.max_retries:
                        backoff = min(
                            self.config.retry_backoff_base * (2 ** (attempt - 1)),
                            self.config.retry_backoff_max,
                        )
                        jitter = backoff * 0.1 * (asyncio.get_event_loop().time() % 1)
                        logger.warning(
                            "Request to %s %s failed (attempt %d/%d): %s. "
                            "Retrying in %.2fs",
                            self.config.name,
                            path,
                            attempt,
                            self.config.max_retries,
                            exc,
                            backoff + jitter,
                        )
                        await asyncio.sleep(backoff + jitter)
                except Exception as exc:
                    self._record_failure(str(exc), 0.0)
                    logger.error(
                        "Unexpected error on %s %s: %s",
                        self.config.name,
                        path,
                        exc,
                        exc_info=True,
                    )
                    raise

        raise last_exception or ClientError(
            f"All {self.config.max_retries} retries exhausted for {self.config.name}"
        )

    def _record_success(self, latency_ms: float) -> None:
        """Update health metrics after a successful request."""
        self._health.total_requests += 1
        self._health.consecutive_failures = 0
        self._health.last_success = time.time()
        self._health.latency_ms = latency_ms
        total = self._health.total_requests
        successes = total - self._health.consecutive_failures
        self._health.success_rate = successes / total if total > 0 else 1.0
        if self._health.status == ConnectionStatus.ERROR:
            self._health.status = ConnectionStatus.CONNECTED
            self.status = ConnectionStatus.CONNECTED

    def _record_failure(self, error_msg: str, latency_ms: float) -> None:
        """Update health metrics after a failed request."""
        self._health.total_requests += 1
        self._health.consecutive_failures += 1
        self._health.last_error = error_msg
        self._health.latency_ms = latency_ms
        total = self._health.total_requests
        successes = total - self._health.consecutive_failures
        self._health.success_rate = successes / total if total > 0 else 0.0

        if self._health.consecutive_failures >= 3:
            self._health.status = ConnectionStatus.ERROR
            self.status = ConnectionStatus.ERROR
        elif self._health.consecutive_failures >= 1:
            self._health.status = ConnectionStatus.DEGRADED
            self.status = ConnectionStatus.DEGRADED

    @property
    def health(self) -> HealthStatus:
        """Return a snapshot of the current health status."""
        return self._health


class MCPConnectionManager:
    """Manages pooled connections to multiple MCP servers.

    Supports both HTTP and stdio transports.  Features:
    * Persistent connection pool keyed by server name.
    * Automatic health monitoring with a background task.
    * Auto-reconnect with exponential backoff for failed servers.
    * Thread-safe concurrent access.

    Example (HTTP)::

        manager = MCPConnectionManager(health_check_interval=30)
        await manager.connect("github", ServerConfig(name="github", url="..."))
        await manager.start_health_monitor()
        result = await manager.request("github", "POST", "/tools/call", json={...})

    Example (stdio)::

        await manager.connect_stdio("fs", StdioServerConfig(
            name="fs", command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
        ))
        tools = await manager.list_stdio_tools("fs")
        result = await manager.call_stdio_tool("fs", "read_file", {"path": "/tmp/test.txt"})
    """

    def __init__(
        self,
        health_check_interval: int = 60,
        auto_reconnect: bool = True,
    ) -> None:
        self._connections: Dict[str, MCPConnection] = {}
        self._configs: Dict[str, ServerConfig] = {}
        self._health_check_interval = health_check_interval
        self._auto_reconnect = auto_reconnect
        self._running = False
        self._health_task: Optional[asyncio.Task[None]] = None
        self._lock = asyncio.Lock()

        # Stdio connections — separate pool
        self._stdio_connections: Dict[str, StdioMCPConnection] = {}
        self._stdio_configs: Dict[str, StdioServerConfig] = {}

    # -- HTTP connection management ------------------------------------------

    async def connect(self, server_name: str, config: ServerConfig) -> bool:
        """Connect to an MCP server and add it to the pool.

        Args:
            server_name: Unique identifier for this server.
            config: Connection configuration.

        Returns:
            ``True`` if the connection was established successfully.
        """
        async with self._lock:
            if server_name in self._connections:
                logger.debug("Connection %s already exists, disconnecting first", server_name)
                old = self._connections.pop(server_name)
                await old.disconnect()

            conn = MCPConnection(config)
            self._configs[server_name] = config
            self._connections[server_name] = conn

        success = await conn.connect()
        if not success and self._auto_reconnect:
            logger.info("Initial connection to %s failed, will retry in background", server_name)
        return success

    async def test_connection(self, server_name: str) -> bool:
        """Test if a server connection is healthy.

        Sends a lightweight probe request and updates the health status.

        Args:
            server_name: The server to test.

        Returns:
            ``True`` if the server responded successfully.
        """
        conn = await self._get_connection(server_name)
        if conn is None:
            return False

        try:
            start = time.perf_counter()
            await conn.request("GET", "/health")
            latency_ms = (time.perf_counter() - start) * 1000
            conn._health.latency_ms = latency_ms
            conn._health.last_success = time.time()
            conn._health.consecutive_failures = 0
            conn._health.status = ConnectionStatus.CONNECTED
            conn.status = ConnectionStatus.CONNECTED
            return True
        except Exception as exc:
            conn._record_failure(str(exc), 0.0)
            logger.debug("Health check failed for %s: %s", server_name, exc)
            return False

    def get_health(self, server_name: str) -> Optional[HealthStatus]:
        """Get the health status of a server.

        Args:
            server_name: The server to query.

        Returns:
            :class:`HealthStatus` if the server is known, ``None`` otherwise.
        """
        # Check HTTP pool first
        conn = self._connections.get(server_name)
        if conn:
            return conn.health
        # Check stdio pool
        stdio_conn = self._stdio_connections.get(server_name)
        if stdio_conn:
            return stdio_conn.health
        return None

    def get_all_health(self) -> Dict[str, HealthStatus]:
        """Return health status for every known server.

        Returns:
            Mapping of server name -> :class:`HealthStatus`.
        """
        result = {name: conn.health for name, conn in self._connections.items()}
        result.update({name: conn.health for name, conn in self._stdio_connections.items()})
        return result

    async def auto_reconnect(self, server_name: str) -> bool:
        """Attempt to reconnect to a failed server.

        Disconnects the old session (if any) and creates a fresh one.

        Args:
            server_name: The server to reconnect.

        Returns:
            ``True`` if reconnection succeeded.
        """
        async with self._lock:
            conn = self._connections.get(server_name)
            if conn is None:
                logger.warning("Cannot reconnect unknown server %s", server_name)
                return False

        logger.info("Attempting auto-reconnect to %s", server_name)
        await conn.disconnect()
        success = await conn.connect()
        if success:
            logger.info("Auto-reconnect to %s succeeded", server_name)
        else:
            logger.warning("Auto-reconnect to %s failed", server_name)
        return success

    async def disconnect(self, server_name: str) -> None:
        """Disconnect from a server and remove it from the pool.

        Works for both HTTP and stdio connections.

        Args:
            server_name: The server to disconnect.
        """
        # Try HTTP pool
        async with self._lock:
            conn = self._connections.pop(server_name, None)
            self._configs.pop(server_name, None)
            stdio_conn = self._stdio_connections.pop(server_name, None)
            self._stdio_configs.pop(server_name, None)
        if conn is not None:
            await conn.disconnect()
        if stdio_conn is not None:
            await stdio_conn.disconnect()

    async def disconnect_all(self) -> None:
        """Disconnect from every server in the pool (HTTP + stdio)."""
        async with self._lock:
            http_names = list(self._connections.keys())
            stdio_names = list(self._stdio_connections.keys())
        await asyncio.gather(
            *[self.disconnect(name) for name in http_names + stdio_names],
            return_exceptions=True,
        )
        logger.info(
            "All MCP connections closed (%d HTTP, %d stdio)",
            len(http_names),
            len(stdio_names),
        )

    async def request(
        self,
        server_name: str,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Make a request to a specific HTTP server.

        Args:
            server_name: The target server.
            method: HTTP method.
            path: URL path.
            **kwargs: Forwarded to :meth:`MCPConnection.request`.

        Returns:
            Parsed JSON response.

        Raises:
            KeyError: If the server is not in the pool.
        """
        conn = await self._get_connection(server_name)
        if conn is None:
            raise KeyError(f"Server '{server_name}' is not in the connection pool")

        if conn.status != ConnectionStatus.CONNECTED:
            if self._auto_reconnect:
                success = await self.auto_reconnect(server_name)
                if not success:
                    raise RuntimeError(
                        f"Server '{server_name}' is unreachable and auto-reconnect failed"
                    )
            else:
                raise RuntimeError(
                    f"Server '{server_name}' is not connected (status={conn.status.value})"
                )

        return await conn.request(method, path, **kwargs)

    # -- Stdio connection management -----------------------------------------

    async def connect_stdio(self, server_name: str, config: StdioServerConfig) -> bool:
        """Connect to an MCP server via stdio transport.

        Launches the server as a subprocess, performs the MCP initialize
        handshake, and discovers available tools.

        Args:
            server_name: Unique identifier for this server.
            config: Stdio connection configuration.

        Returns:
            ``True`` if the connection was established successfully.
        """
        # Disconnect existing connection with same name
        if server_name in self._stdio_connections:
            await self._stdio_connections[server_name].disconnect()

        # Also remove from HTTP pool if present
        async with self._lock:
            old_http = self._connections.pop(server_name, None)
            self._configs.pop(server_name, None)
        if old_http is not None:
            await old_http.disconnect()

        conn = StdioMCPConnection(config)
        self._stdio_configs[server_name] = config
        self._stdio_connections[server_name] = conn

        success = await conn.connect()
        if not success:
            logger.warning("Failed to connect to MCP stdio server '%s'", server_name)
        return success

    async def disconnect_stdio(self, server_name: str) -> None:
        """Disconnect from a stdio MCP server.

        Args:
            server_name: The server to disconnect.
        """
        conn = self._stdio_connections.pop(server_name, None)
        self._stdio_configs.pop(server_name, None)
        if conn is not None:
            await conn.disconnect()

    async def list_stdio_tools(self, server_name: str) -> List[StdioMCPTool]:
        """List tools from a connected stdio MCP server.

        Args:
            server_name: The server to query.

        Returns:
            List of :class:`StdioMCPTool` objects, or empty list if not connected.
        """
        conn = self._stdio_connections.get(server_name)
        if conn is None:
            return []
        return conn.tools

    async def call_stdio_tool(
        self, server_name: str, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call a tool on a connected stdio MCP server.

        Args:
            server_name: The server identifier.
            tool_name: The tool to invoke.
            arguments: Tool arguments.

        Returns:
            Tool result as a dictionary.

        Raises:
            KeyError: If the server is not connected.
        """
        conn = self._stdio_connections.get(server_name)
        if conn is None:
            raise KeyError(f"stdio server '{server_name}' is not connected")
        return await conn.call_tool(tool_name, arguments)

    async def ping_stdio(self, server_name: str) -> bool:
        """Ping a stdio MCP server to check if it's still alive.

        Args:
            server_name: The server to ping.

        Returns:
            ``True`` if the server responded.
        """
        conn = self._stdio_connections.get(server_name)
        if conn is None:
            return False
        return await conn.ping()

    def list_stdio_servers(self) -> List[str]:
        """List all connected stdio server names.

        Returns:
            List of server identifiers.
        """
        return list(self._stdio_connections.keys())

    def get_stdio_server_info(self, server_name: str) -> Dict[str, Any]:
        """Get info about a stdio MCP server connection.

        Returns:
            Dictionary with server info, tools, and health status.
        """
        conn = self._stdio_connections.get(server_name)
        if conn is None:
            return {}
        return {
            "name": server_name,
            "status": conn.status.value,
            "server_info": conn.server_info,
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                }
                for t in conn.tools
            ],
            "health": {
                "status": conn.health.status.value,
                "latency_ms": conn.health.latency_ms,
                "total_requests": conn.health.total_requests,
                "success_rate": conn.health.success_rate,
                "last_error": conn.health.last_error,
            },
            "config": {
                "command": conn.config.command,
                "args": conn.config.args,
            },
        }

    def get_all_stdio_server_info(self) -> List[Dict[str, Any]]:
        """Get info about all connected stdio MCP servers."""
        return [
            self.get_stdio_server_info(name)
            for name in self._stdio_connections
        ]

    # -- Health monitoring ---------------------------------------------------

    async def start_health_monitor(self) -> None:
        """Start a background task that runs periodic health checks.

        The task checks every ``health_check_interval`` seconds and
        attempts auto-reconnect for failed connections.
        """
        if self._running:
            logger.debug("Health monitor already running")
            return
        self._running = True
        self._health_task = asyncio.create_task(self._health_monitor_loop())
        logger.info("Health monitor started (interval=%ds)", self._health_check_interval)

    async def stop_health_monitor(self) -> None:
        """Stop the background health-monitor task."""
        self._running = False
        if self._health_task is not None:
            self._health_task.cancel()
            try:
                await self._health_task
            except asyncio.CancelledError:
                pass
            self._health_task = None
        logger.info("Health monitor stopped")

    async def _health_monitor_loop(self) -> None:
        """Internal loop for periodic health checks."""
        while self._running:
            try:
                await asyncio.sleep(self._health_check_interval)
                if not self._running:
                    break
                await self._run_health_checks()
            except asyncio.CancelledError:
                logger.debug("Health monitor loop cancelled")
                break
            except Exception as exc:
                logger.error("Health monitor loop error: %s", exc, exc_info=True)
                await asyncio.sleep(5)

    async def _run_health_checks(self) -> None:
        """Check every connection and trigger auto-reconnect where needed."""
        tasks: List[Coroutine[Any, Any, bool]] = []
        targets: List[str] = []

        for name, conn in self._connections.items():
            if conn.health.status in (ConnectionStatus.ERROR, ConnectionStatus.DISCONNECTED):
                if self._auto_reconnect:
                    tasks.append(self.auto_reconnect(name))
                    targets.append(name)
            else:
                tasks.append(self.test_connection(name))
                targets.append(name)

        # Also ping stdio servers
        for name, conn in self._stdio_connections.items():
            tasks.append(conn.ping())
            targets.append(name)

        if not tasks:
            return

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for name, result in zip(targets, results):
            if isinstance(result, Exception):
                logger.debug("Health check error for %s: %s", name, result)
            elif result is True:
                logger.debug("Health check OK for %s", name)
            else:
                logger.debug("Health check FAILED for %s", name)

    def list_servers(self) -> List[str]:
        """List all connected server names (HTTP + stdio).

        Returns:
            List of server identifiers currently in the pool.
        """
        return list(self._connections.keys()) + list(self._stdio_connections.keys())

    def get_server_count(self) -> int:
        """Return the number of servers in the pool.

        Returns:
            Count of registered servers (HTTP + stdio).
        """
        return len(self._connections) + len(self._stdio_connections)

    async def _get_connection(self, server_name: str) -> Optional[MCPConnection]:
        """Safely retrieve an HTTP connection by name.

        Args:
            server_name: The server identifier.

        Returns:
            The :class:`MCPConnection` if present, ``None`` otherwise.
        """
        async with self._lock:
            return self._connections.get(server_name)

    async def __aenter__(self) -> MCPConnectionManager:
        """Async context manager entry — start health monitor."""
        await self.start_health_monitor()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        """Async context manager exit — stop monitor and disconnect all."""
        await self.stop_health_monitor()
        await self.disconnect_all()
