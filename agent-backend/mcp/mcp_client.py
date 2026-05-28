"""
MCP Client — Full Model Context Protocol implementation.

Connects to MCP servers (GitHub, Supabase, Vercel, Stripe, etc.)
and exposes their tools/resources to the agent.

Supported MCP servers:
- GitHub: repo operations, PRs, issues, commits
- Supabase: database, auth, storage
- Vercel: deployments, domains
- Stripe: payments, subscriptions
- Context7: documentation search
- Exa: neural web search
- Brave Search: web search
- FileSystem: local file operations
- SQLite: database queries
- Slack/Discord: messaging
- Notion: pages, databases
- Linear: issues, projects
- Figma: files, components
- GitLab: repos, MRs, CI/CD
- AWS: S3, EC2, Lambda
- Docker: containers, images
- Kubernetes: pods, services
- Pinecone: vector search
- Redis: cache, queues
- PostgreSQL: SQL queries
- Twilio: SMS, voice
- SendGrid: email delivery
- OpenAI: LLM completions
- Anthropic: Claude API
- Perplexity: AI search
- Tavily: web search
- Wolfram Alpha: computations
- Google Maps: geolocation
- Cloudflare: DNS, workers
- Datadog: monitoring, logs
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any, Awaitable
from enum import Enum
import json
import logging
import os
import asyncio
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Try to import aiohttp for async HTTP; fall back to urllib as a synchronous
# stand-in so the module always loads even without third-party packages.
# ---------------------------------------------------------------------------
try:
    import aiohttp

    _HAS_AIOHTTP = True
except ImportError:
    _HAS_AIOHTTP = False
    logger.warning("aiohttp not installed — MCP client will run in sync fallback mode")


@dataclass
class MCPTool:
    """Represents a tool exposed by an MCP server."""

    name: str
    description: str
    parameters: dict
    server: str


@dataclass
class MCPResource:
    """Represents a resource exposed by an MCP server."""

    uri: str
    name: str
    mime_type: str
    server: str


@dataclass
class MCPConnection:
    """Active connection to an MCP server."""

    server_name: str
    server_url: str
    auth_token: Optional[str]
    tools: List[MCPTool] = field(default_factory=list)
    resources: List[MCPResource] = field(default_factory=list)
    connected: bool = False
    health_check_interval: int = 60
    last_health_check: Optional[datetime] = field(default=None)
    capabilities: Dict[str, Any] = field(default_factory=dict)
    protocol_version: str = "2024-11-05"
    headers: Dict[str, str] = field(default_factory=dict)


class MCPClient:
    """Client for connecting to and using MCP servers.

    Usage (async):
        client = MCPClient()
        conn = await client.connect("github", "https://api.github.com", os.getenv("GITHUB_TOKEN"))
        tools = client.list_tools("github")
        result = await client.call_tool("github", "list_repos", {"org": "myorg"})
    """

    # ------------------------------------------------------------------ #
    # 20+ server presets — configuration shortcuts for well-known MCPs
    # ------------------------------------------------------------------ #
    _PRESETS: Dict[str, Dict[str, Any]] = {
        "github": {
            "url": "https://api.github.com",
            "auth_env": "GITHUB_TOKEN",
            "description": "GitHub repository operations, PRs, issues, commits",
            "scopes": ["repo", "read:org", "read:user"],
        },
        "supabase": {
            "url": "https://api.supabase.com",
            "auth_env": "SUPABASE_KEY",
            "description": "Supabase database, auth, and storage",
            "scopes": ["db", "auth", "storage"],
        },
        "vercel": {
            "url": "https://api.vercel.com",
            "auth_env": "VERCEL_TOKEN",
            "description": "Vercel deployments and domains",
            "scopes": ["deployments", "domains", "projects"],
        },
        "stripe": {
            "url": "https://api.stripe.com",
            "auth_env": "STRIPE_SECRET_KEY",
            "description": "Stripe payments and subscriptions",
            "scopes": ["read_write"],
        },
        "context7": {
            "url": "https://api.context7.com",
            "auth_env": "CONTEXT7_API_KEY",
            "description": "Context7 documentation search",
            "scopes": ["search", "read"],
        },
        "exa": {
            "url": "https://api.exa.ai",
            "auth_env": "EXA_API_KEY",
            "description": "Exa neural web search",
            "scopes": ["search", "read"],
        },
        "brave_search": {
            "url": "https://api.search.brave.com",
            "auth_env": "BRAVE_API_KEY",
            "description": "Brave Search web search",
            "scopes": ["search"],
        },
        "filesystem": {
            "url": "http://localhost:8090",
            "auth_env": None,
            "description": "Local file system operations",
            "scopes": ["read", "write"],
        },
        "sqlite": {
            "url": "http://localhost:8091",
            "auth_env": "SQLITE_AUTH_TOKEN",
            "description": "SQLite database queries",
            "scopes": ["query"],
        },
        "slack": {
            "url": "https://slack.com/api",
            "auth_env": "SLACK_BOT_TOKEN",
            "description": "Slack messaging and channels",
            "scopes": ["chat:write", "channels:read", "users:read"],
        },
        "discord": {
            "url": "https://discord.com/api/v10",
            "auth_env": "DISCORD_BOT_TOKEN",
            "description": "Discord messaging and guild management",
            "scopes": ["bot", "messages.read", "applications.commands"],
        },
        "notion": {
            "url": "https://api.notion.com",
            "auth_env": "NOTION_TOKEN",
            "description": "Notion pages and databases",
            "scopes": ["read_content", "write_content"],
        },
        "linear": {
            "url": "https://api.linear.app",
            "auth_env": "LINEAR_API_KEY",
            "description": "Linear issues and projects",
            "scopes": ["read", "write"],
        },
        "figma": {
            "url": "https://api.figma.com",
            "auth_env": "FIGMA_TOKEN",
            "description": "Figma files and components",
            "scopes": ["files:read", "file_variables:read"],
        },
        "gitlab": {
            "url": "https://gitlab.com/api/v4",
            "auth_env": "GITLAB_TOKEN",
            "description": "GitLab repos, MRs, and CI/CD",
            "scopes": ["api", "read_repository"],
        },
        "aws": {
            "url": "https://sts.amazonaws.com",
            "auth_env": "AWS_ACCESS_KEY_ID",
            "description": "AWS S3, EC2, Lambda operations",
            "scopes": ["s3:*", "ec2:*", "lambda:*"],
        },
        "docker": {
            "url": "http://localhost:2375",
            "auth_env": None,
            "description": "Docker containers and images",
            "scopes": ["containers", "images", "volumes"],
        },
        "kubernetes": {
            "url": "https://localhost:6443",
            "auth_env": "K8S_TOKEN",
            "description": "Kubernetes pods, services, deployments",
            "scopes": ["pods", "services", "deployments"],
        },
        "pinecone": {
            "url": "https://api.pinecone.io",
            "auth_env": "PINECONE_API_KEY",
            "description": "Pinecone vector search and indexes",
            "scopes": ["index:read", "index:write", "query"],
        },
        "redis": {
            "url": "redis://localhost:6379",
            "auth_env": "REDIS_PASSWORD",
            "description": "Redis cache and queues",
            "scopes": ["read", "write", "admin"],
        },
        "postgres": {
            "url": "postgresql://localhost:5432",
            "auth_env": "PGPASSWORD",
            "description": "PostgreSQL SQL queries",
            "scopes": ["read", "write"],
        },
        "twilio": {
            "url": "https://api.twilio.com",
            "auth_env": "TWILIO_AUTH_TOKEN",
            "description": "Twilio SMS and voice calls",
            "scopes": ["sms", "voice", "verify"],
        },
        "sendgrid": {
            "url": "https://api.sendgrid.com",
            "auth_env": "SENDGRID_API_KEY",
            "description": "SendGrid email delivery",
            "scopes": ["mail.send", "mail.read"],
        },
        "openai": {
            "url": "https://api.openai.com",
            "auth_env": "OPENAI_API_KEY",
            "description": "OpenAI LLM completions and embeddings",
            "scopes": ["chat", "embeddings", "fine-tuning"],
        },
        "anthropic": {
            "url": "https://api.anthropic.com",
            "auth_env": "ANTHROPIC_API_KEY",
            "description": "Anthropic Claude API",
            "scopes": ["messages", "completions"],
        },
        "perplexity": {
            "url": "https://api.perplexity.ai",
            "auth_env": "PERPLEXITY_API_KEY",
            "description": "Perplexity AI search",
            "scopes": ["search"],
        },
        "tavily": {
            "url": "https://api.tavily.com",
            "auth_env": "TAVILY_API_KEY",
            "description": "Tavily web search",
            "scopes": ["search"],
        },
        "wolfram": {
            "url": "https://api.wolframalpha.com",
            "auth_env": "WOLFRAM_APP_ID",
            "description": "Wolfram Alpha computations",
            "scopes": ["shortanswers", "fullresults"],
        },
        "google_maps": {
            "url": "https://maps.googleapis.com",
            "auth_env": "GOOGLE_MAPS_API_KEY",
            "description": "Google Maps geolocation and routing",
            "scopes": ["geocoding", "directions", "places"],
        },
        "cloudflare": {
            "url": "https://api.cloudflare.com",
            "auth_env": "CLOUDFLARE_API_TOKEN",
            "description": "Cloudflare DNS and workers",
            "scopes": ["zone:read", "dns:edit", "workers:write"],
        },
        "datadog": {
            "url": "https://api.datadoghq.com",
            "auth_env": "DD_API_KEY",
            "description": "Datadog monitoring and logs",
            "scopes": ["logs_read", "metrics_read", "monitors_read"],
        },
    }

    def __init__(self) -> None:
        self._connections: Dict[str, MCPConnection] = {}
        self._callbacks: Dict[str, List[Callable[..., Any]]] = {}
        self._health_check_tasks: Dict[str, asyncio.Task[None]] = {}

    # ------------------------------------------------------------------ #
    # Connection lifecycle
    # ------------------------------------------------------------------ #

    async def connect(
        self,
        server_name: str,
        server_url: str,
        auth_token: Optional[str] = None,
        **kwargs: Any,
    ) -> MCPConnection:
        """Connect to an MCP server and discover tools/resources.

        Args:
            server_name: Human-readable identifier (e.g. "github").
            server_url: Base URL of the MCP server.
            auth_token: Optional Bearer token or API key.
            **kwargs: Extra connection parameters.

        Returns:
            The established :class:`MCPConnection`.
        """
        if server_name in self._connections and self._connections[server_name].connected:
            logger.info("Already connected to MCP server '%s'", server_name)
            return self._connections[server_name]

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        conn = MCPConnection(
            server_name=server_name,
            server_url=server_url.rstrip("/"),
            auth_token=auth_token,
            headers=headers,
        )

        try:
            logger.info("Initializing MCP connection to '%s' at %s", server_name, server_url)

            # --- MCP Initialize handshake ---
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": conn.protocol_version,
                    "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
                    "clientInfo": {"name": "construct-agent", "version": "1.0.0"},
                },
            }

            init_response = await self._http_post(
                conn.server_url, "/initialize", init_payload, headers
            )

            if isinstance(init_response, dict):
                conn.capabilities = init_response.get("result", {}).get("capabilities", {})
                conn.connected = True
                logger.info(
                    "MCP server '%s' initialized — protocol %s",
                    server_name,
                    init_response.get("result", {}).get("protocolVersion", "unknown"),
                )
            else:
                # Fallback: treat as plain REST if JSON-RPC fails
                logger.warning(
                    "Non-JSON-RPC response from '%s'; treating as REST fallback", server_name
                )
                conn.connected = True
                conn.capabilities = {"tools": {}, "resources": {}}

            # --- Discover tools ---
            conn.tools = await self._discover_tools(conn)

            # --- Discover resources ---
            conn.resources = await self._discover_resources(conn)

            self._connections[server_name] = conn

            # --- Start background health-check loop ---
            if _HAS_AIOHTTP:
                task = asyncio.create_task(
                    self._health_check_loop(server_name), name=f"mcp-health-{server_name}"
                )
                self._health_check_tasks[server_name] = task

            logger.info(
                "Connected to '%s' — %d tools, %d resources",
                server_name,
                len(conn.tools),
                len(conn.resources),
            )
            return conn

        except Exception as exc:
            logger.error("Failed to connect to MCP server '%s': %s", server_name, exc)
            conn.connected = False
            raise MCPConnectionError(f"Connection to {server_name} failed: {exc}") from exc

    async def disconnect(self, server_name: str) -> None:
        """Disconnect from an MCP server and clean up background tasks."""
        conn = self._connections.pop(server_name, None)
        if conn is None:
            logger.debug("No active connection for '%s' to disconnect", server_name)
            return

        conn.connected = False

        # Cancel health-check task
        task = self._health_check_tasks.pop(server_name, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # Send MCP shutdown notification (best-effort)
        try:
            await self._http_post(
                conn.server_url,
                "/shutdown",
                {"jsonrpc": "2.0", "method": "shutdown"},
                conn.headers,
            )
        except Exception:
            pass  # Best-effort; server may not support it

        logger.info("Disconnected from MCP server '%s'", server_name)

    async def _discover_tools(self, conn: MCPConnection) -> List[MCPTool]:
        """Discover tools exposed by *conn* via MCP protocol."""
        tools: List[MCPTool] = []
        try:
            response = await self._http_post(
                conn.server_url,
                "/tools/list",
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                conn.headers,
            )
            if isinstance(response, dict):
                raw_tools = response.get("result", {}).get("tools", [])
                for t in raw_tools:
                    tools.append(
                        MCPTool(
                            name=t.get("name", "unknown"),
                            description=t.get("description", ""),
                            parameters=t.get("inputSchema", {}),
                            server=conn.server_name,
                        )
                    )
        except Exception as exc:
            logger.debug("Tool discovery failed for '%s': %s", conn.server_name, exc)
        return tools

    async def _discover_resources(self, conn: MCPConnection) -> List[MCPResource]:
        """Discover resources exposed by *conn* via MCP protocol."""
        resources: List[MCPResource] = []
        try:
            response = await self._http_post(
                conn.server_url,
                "/resources/list",
                {"jsonrpc": "2.0", "id": 3, "method": "resources/list"},
                conn.headers,
            )
            if isinstance(response, dict):
                raw_resources = response.get("result", {}).get("resources", [])
                for r in raw_resources:
                    resources.append(
                        MCPResource(
                            uri=r.get("uri", ""),
                            name=r.get("name", "unknown"),
                            mime_type=r.get("mimeType", "application/octet-stream"),
                            server=conn.server_name,
                        )
                    )
        except Exception as exc:
            logger.debug("Resource discovery failed for '%s': %s", conn.server_name, exc)
        return resources

    # ------------------------------------------------------------------ #
    # Tool / Resource usage
    # ------------------------------------------------------------------ #

    def list_tools(self, server_name: Optional[str] = None) -> List[MCPTool]:
        """List all tools from all connected MCPs, or a specific one.

        Args:
            server_name: If given, only return tools from that server.

        Returns:
            List of :class:`MCPTool` objects.
        """
        if server_name:
            conn = self._connections.get(server_name)
            return conn.tools if conn else []
        return [t for conn in self._connections.values() for t in conn.tools]

    async def call_tool(
        self, server_name: str, tool_name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call a tool on an MCP server.

        Args:
            server_name: Registered server name.
            tool_name: Tool to invoke.
            arguments: JSON-serialisable argument dictionary.

        Returns:
            Parsed JSON response from the server.
        """
        conn = self._connections.get(server_name)
        if not conn or not conn.connected:
            raise MCPConnectionError(f"Not connected to MCP server '{server_name}'")

        # Validate tool exists
        tool = next((t for t in conn.tools if t.name == tool_name), None)
        if not tool:
            raise MCPError(f"Tool '{tool_name}' not found on server '{server_name}'")

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }

        logger.debug(
            "Calling tool '%s' on '%s' with args %s", tool_name, server_name, arguments
        )
        response = await self._http_post(
            conn.server_url, "/tools/call", payload, conn.headers
        )

        if isinstance(response, dict) and "error" in response:
            error = response["error"]
            raise MCPError(f"Tool call failed: {error}")

        return response if isinstance(response, dict) else {"result": response}

    def list_resources(self, server_name: Optional[str] = None) -> List[MCPResource]:
        """List available resources from all or a specific connected MCP.

        Args:
            server_name: If given, filter to that server.

        Returns:
            List of :class:`MCPResource` objects.
        """
        if server_name:
            conn = self._connections.get(server_name)
            return conn.resources if conn else []
        return [r for conn in self._connections.values() for r in conn.resources]

    async def read_resource(self, server_name: str, uri: str) -> Any:
        """Read a resource from an MCP server.

        Args:
            server_name: Registered server name.
            uri: Resource URI.

        Returns:
            Resource contents (parsed JSON or raw bytes).
        """
        conn = self._connections.get(server_name)
        if not conn or not conn.connected:
            raise MCPConnectionError(f"Not connected to MCP server '{server_name}'")

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "resources/read",
            "params": {"uri": uri},
        }

        response = await self._http_post(
            conn.server_url, "/resources/read", payload, conn.headers
        )
        return response

    async def subscribe_to_resource(
        self, server_name: str, uri: str, callback: Callable[..., Any]
    ) -> None:
        """Subscribe to resource change notifications.

        Args:
            server_name: Registered server name.
            uri: Resource URI to watch.
            callback: Async or sync callable invoked on change.
        """
        key = f"{server_name}:{uri}"
        if key not in self._callbacks:
            self._callbacks[key] = []
        self._callbacks[key].append(callback)

        conn = self._connections.get(server_name)
        if conn and conn.connected:
            payload = {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "resources/subscribe",
                "params": {"uri": uri},
            }
            try:
                await self._http_post(
                    conn.server_url, "/resources/subscribe", payload, conn.headers
                )
                logger.info("Subscribed to resource '%s' on '%s'", uri, server_name)
            except Exception as exc:
                logger.warning("Subscribe request failed: %s", exc)

    # ------------------------------------------------------------------ #
    # Server presets
    # ------------------------------------------------------------------ #

    def get_server_preset(self, preset_name: str) -> Optional[Dict[str, Any]]:
        """Get preset configuration for a known MCP server.

        Args:
            preset_name: Short name (e.g. ``"github"``, ``"stripe"``).

        Returns:
            Preset dictionary or *None* if unknown.
        """
        return self._PRESETS.get(preset_name)

    def list_presets(self) -> Dict[str, Dict[str, Any]]:
        """Return all available server presets."""
        return dict(self._PRESETS)

    def auto_connect_preset(self, preset_name: str) -> Awaitable[MCPConnection]:
        """Connect using a named preset, resolving auth from environment.

        Args:
            preset_name: Short name of the preset.

        Returns:
            Awaitable that resolves to the :class:`MCPConnection`.
        """
        preset = self.get_server_preset(preset_name)
        if not preset:
            raise MCPError(f"Unknown preset '{preset_name}'")

        auth_env = preset.get("auth_env")
        auth_token = os.getenv(auth_env) if auth_env else None
        return self.connect(preset_name, preset["url"], auth_token)

    # ------------------------------------------------------------------ #
    # Health checks
    # ------------------------------------------------------------------ #

    async def health_check(self, server_name: str) -> bool:
        """Check whether an MCP server is reachable.

        Returns:
            ``True`` if the server responded successfully.
        """
        conn = self._connections.get(server_name)
        if not conn:
            return False

        try:
            payload = {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": "ping",
            }
            response = await self._http_post(
                conn.server_url, "/ping", payload, conn.headers, timeout=10
            )
            healthy = isinstance(response, dict) and "error" not in response
            conn.last_health_check = datetime.utcnow()
            return healthy
        except Exception as exc:
            logger.debug("Health check failed for '%s': %s", server_name, exc)
            return False

    async def auto_reconnect(self) -> Dict[str, bool]:
        """Attempt to reconnect all disconnected servers.

        Returns:
            Mapping of server name → success bool.
        """
        results: Dict[str, bool] = {}
        for name, conn in list(self._connections.items()):
            if not conn.connected:
                try:
                    await self.connect(name, conn.server_url, conn.auth_token)
                    results[name] = True
                except Exception as exc:
                    logger.error("Auto-reconnect failed for '%s': %s", name, exc)
                    results[name] = False
            else:
                results[name] = True
        return results

    async def _health_check_loop(self, server_name: str) -> None:
        """Background task that pings an MCP server periodically."""
        conn = self._connections.get(server_name)
        if not conn:
            return

        while conn.connected:
            await asyncio.sleep(conn.health_check_interval)
            if not conn.connected:
                break
            healthy = await self.health_check(server_name)
            if not healthy:
                logger.warning("MCP server '%s' health check failed", server_name)
                conn.connected = False
                # Notify subscribers
                await self._notify_callbacks(server_name, "health_check_failed", {})

    # ------------------------------------------------------------------ #
    # HTTP helper
    # ------------------------------------------------------------------ #

    async def _http_post(
        self,
        base_url: str,
        path: str,
        payload: Dict[str, Any],
        headers: Dict[str, str],
        timeout: int = 30,
    ) -> Any:
        """Send a JSON-RPC POST request.

        Falls back to synchronous ``urllib`` when *aiohttp* is unavailable.
        """
        url = f"{base_url}{path}"

        if _HAS_AIOHTTP:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)
                ) as response:
                    if response.status == 204:
                        return {}
                    text = await response.text()
                    if not text:
                        return {}
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        return {"raw": text}
        else:
            # Synchronous fallback (for bootstrapping without aiohttp)
            import urllib.request
            import urllib.error

            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={**headers, "Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    text = resp.read().decode("utf-8")
                    return json.loads(text) if text else {}
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                return {"error": {"code": exc.code, "message": body}}

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    _counter = 0

    @classmethod
    def _next_id(cls) -> int:
        cls._counter += 1
        return cls._counter

    async def _notify_callbacks(self, server_name: str, event: str, data: Dict[str, Any]) -> None:
        """Fire all registered callbacks for a given server event."""
        for key, cbs in list(self._callbacks.items()):
            if key.startswith(f"{server_name}:"):
                for cb in cbs:
                    try:
                        if asyncio.iscoroutinefunction(cb):
                            await cb(event, data)
                        else:
                            cb(event, data)
                    except Exception as exc:
                        logger.error("Callback error for '%s': %s", key, exc)

    async def close(self) -> None:
        """Close all connections and cancel background tasks."""
        names = list(self._connections.keys())
        for name in names:
            await self.disconnect(name)
        self._callbacks.clear()

    def __repr__(self) -> str:
        connected = [n for n, c in self._connections.items() if c.connected]
        return f"<MCPClient connections={len(connected)} connected_to={connected}>"


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class MCPError(Exception):
    """Base exception for MCP client errors."""


class MCPConnectionError(MCPError):
    """Raised when an MCP connection cannot be established or is lost."""
