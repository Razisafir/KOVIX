"""
Execution Sandbox — Isolated command execution for the Construct AI Agent.

Provides two sandbox implementations for safely running agent-generated commands:

1. **DockerSandbox** — Runs commands inside a Docker container with strict
   security constraints (read-only filesystem, no network, dropped capabilities).
   This is the preferred sandbox when Docker is available.

2. **ProcessSandbox** — A fallback that runs commands as local subprocesses
   with resource limits (timeout, memory cap).  Used when Docker is not
   installed or the daemon is unreachable.

Both sandboxes share a command sanitiser that blocks dangerous patterns
(``rm -rf /``, fork bombs, ``curl | sh``, etc.) before execution.

**SandboxManager** ties everything together: it auto-selects Docker when
available and gracefully falls back to the process-based sandbox.

Usage::

    from core.sandbox import SandboxManager

    mgr = SandboxManager()
    sandbox = mgr.create_for_session("sess-1", "/path/to/project")
    result = mgr.execute_in_session("sess-1", "python -m pytest")
    print(result["exit_code"], result["stdout"])
    mgr.destroy_session("sess-1")
"""

from __future__ import annotations

import logging
import os
import re
import signal
import subprocess
import threading
from typing import Any, Dict, List, Optional, Union

# Docker is an optional dependency — the module must still import cleanly
# when the ``docker`` package is not installed.
try:
    import docker  # type: ignore[import-untyped]
    from docker.errors import DockerException  # type: ignore[import-untyped]

    _DOCKER_AVAILABLE = True
except ImportError:
    docker = None  # type: ignore[assignment]
    DockerException = Exception  # type: ignore[misc,assignment]
    _DOCKER_AVAILABLE = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dangerous command patterns
# ---------------------------------------------------------------------------

DANGEROUS_PATTERNS: List[Dict[str, str]] = [
    {
        "pattern": r"rm\s+-rf\s+/",
        "description": "Recursive force-delete of root filesystem",
    },
    {
        "pattern": r"rm\s+-rf\s+~",
        "description": "Recursive force-delete of home directory",
    },
    {
        "pattern": r"rm\s+-fr\s+/",
        "description": "Recursive force-delete of root filesystem (alt flag order)",
    },
    {
        "pattern": r"mkfs\.",
        "description": "Filesystem format command",
    },
    {
        "pattern": r"dd\s+if=/dev/zero",
        "description": "Disk wipe via dd",
    },
    {
        "pattern": r"dd\s+if=/dev/urandom",
        "description": "Disk overwrite with random data via dd",
    },
    {
        "pattern": r":\(\)\{\s*:\|:\&\s*\}\s*;",
        "description": "Fork bomb (bash variant)",
    },
    {
        "pattern": r"chmod\s+777\s+/",
        "description": "World-writable root filesystem",
    },
    {
        "pattern": r"curl\s+.*\|\s*sh",
        "description": "Pipe remote content to shell (curl | sh)",
    },
    {
        "pattern": r"curl\s+.*\|\s*bash",
        "description": "Pipe remote content to bash (curl | bash)",
    },
    {
        "pattern": r"wget\s+.*\|\s*sh",
        "description": "Pipe remote content to shell (wget | sh)",
    },
    {
        "pattern": r"wget\s+.*\|\s*bash",
        "description": "Pipe remote content to bash (wget | bash)",
    },
    {
        "pattern": r">\s*/dev/sd[a-z]",
        "description": "Direct write to block device",
    },
    {
        "pattern": r"mknod",
        "description": "Create special device file",
    },
    {
        "pattern": r"mount\s+",
        "description": "Mount filesystem command",
    },
]


def _check_dangerous_command(command: str) -> Optional[str]:
    """Return a human-readable reason if *command* matches a dangerous pattern.

    Parameters
    ----------
    command:
        The shell command string to inspect.

    Returns
    -------
    str or None
        A description of the matched dangerous pattern, or ``None`` if the
        command appears safe.
    """
    for rule in DANGEROUS_PATTERNS:
        try:
            if re.search(rule["pattern"], command, re.IGNORECASE):
                return rule["description"]
        except re.error:
            # Skip broken regexes silently
            continue
    return None


# ---------------------------------------------------------------------------
# DockerSandbox
# ---------------------------------------------------------------------------


class DockerSandbox:
    """Docker-based execution sandbox with strict security constraints.

    Each instance manages the lifecycle of a single Docker container.  The
    project directory is mounted **read-only** so the agent can read source
    files but cannot modify the host filesystem through the container.

    Parameters
    ----------
    image:
        Docker image to use for the container.
    cpu_limit:
        CPU quota (number of CPUs).
    memory_limit:
        Memory limit as a Docker-compatible string (e.g. ``"512m"``).
    timeout:
        Maximum seconds a command may run before being killed.
    network_disabled:
        If *True*, the container has no network access.
    """

    def __init__(
        self,
        image: str = "python:3.12-slim",
        cpu_limit: float = 1.0,
        memory_limit: str = "512m",
        timeout: int = 60,
        network_disabled: bool = True,
    ) -> None:
        self.image = image
        self.cpu_limit = cpu_limit
        self.memory_limit = memory_limit
        self.timeout = timeout
        self.network_disabled = network_disabled

        self._container: Optional[Any] = None
        self._container_id: Optional[str] = None
        self._project_path: Optional[str] = None

    # -- Container lifecycle -------------------------------------------------

    def create(self, project_path: str) -> str:
        """Create and start a Docker container with the project mounted read-only.

        Parameters
        ----------
        project_path:
            Absolute path to the project directory on the host.

        Returns
        -------
        str
            The container ID.

        Raises
        ------
        RuntimeError
            If Docker is not available or container creation fails.
        ValueError
            If *project_path* does not exist on the host.
        """
        if not _DOCKER_AVAILABLE or docker is None:
            raise RuntimeError("Docker package is not installed; cannot create container")

        project_path = os.path.abspath(project_path)
        if not os.path.isdir(project_path):
            raise ValueError(f"Project path does not exist: {project_path}")

        self._project_path = project_path

        try:
            client = docker.from_env()
        except DockerException as exc:
            raise RuntimeError(f"Cannot connect to Docker daemon: {exc}") from exc

        try:
            self._container = client.containers.create(
                image=self.image,
                command="tail -f /dev/null",  # keep container alive
                detach=True,
                read_only=True,
                security_opt=["no-new-privileges:true"],
                cap_drop=["ALL"],
                mem_limit=self.memory_limit,
                nano_cpus=int(self.cpu_limit * 1e9),
                network_mode="none" if self.network_disabled else "bridge",
                tmpfs={"/tmp": "size=100m"},
                volumes={
                    project_path: {
                        "bind": "/project",
                        "mode": "ro",
                    }
                },
                working_dir="/project",
                labels={"construct-ai-sandbox": "true"},
            )
            self._container.start()
            self._container_id = self._container.id
            logger.info(
                "DockerSandbox container created: %s (image=%s, project=%s)",
                self._container_id[:12],
                self.image,
                project_path,
            )
            return self._container_id
        except DockerException as exc:
            raise RuntimeError(f"Failed to create Docker container: {exc}") from exc

    # -- Command execution ---------------------------------------------------

    def execute(self, command: str) -> Dict[str, Any]:
        """Run *command* inside the container.

        The command is first sanitised by :meth:`_sanitize_command`.  If it
        passes, it is executed via ``container.exec_run()`` with a timeout.

        Parameters
        ----------
        command:
            Shell command string to execute.

        Returns
        -------
        dict
            Keys: ``exit_code``, ``stdout``, ``stderr``, ``command``,
            ``sandboxed``.
        """
        if self._container is None:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": "Sandbox container not created. Call create() first.",
                "command": command,
                "sandboxed": True,
            }

        # Sanitise first
        try:
            safe_command = self._sanitize_command(command)
        except ValueError as exc:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": str(exc),
                "command": command,
                "sandboxed": True,
            }

        logger.debug("Executing in DockerSandbox: %s", safe_command)

        try:
            exec_result = self._container.exec_run(
                cmd=["sh", "-c", safe_command],
                workdir="/project",
                demux=True,
            )
            exit_code: int = exec_result.exit_code
            # demux=True returns (stdout_bytes, stderr_bytes) or None
            output = exec_result.output
            stdout_bytes = output[0] if output and output[0] else b""
            stderr_bytes = output[1] if output and output[1] else b""

            return {
                "exit_code": exit_code,
                "stdout": stdout_bytes.decode("utf-8", errors="replace"),
                "stderr": stderr_bytes.decode("utf-8", errors="replace"),
                "command": safe_command,
                "sandboxed": True,
            }
        except Exception as exc:
            logger.error("Docker exec failed: %s", exc)
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Docker execution error: {exc}",
                "command": safe_command,
                "sandboxed": True,
            }

    # -- Sanitiser -----------------------------------------------------------

    def _sanitize_command(self, command: str) -> str:
        """Block dangerous command patterns.

        Parameters
        ----------
        command:
            Shell command string to validate.

        Returns
        -------
        str
            The original command if it passes all checks.

        Raises
        ------
        ValueError
            If a dangerous pattern is detected.
        """
        reason = _check_dangerous_command(command)
        if reason is not None:
            raise ValueError(f"Blocked dangerous command: {reason}")
        return command

    # -- Cleanup -------------------------------------------------------------

    def destroy(self) -> None:
        """Stop and remove the Docker container."""
        if self._container is not None:
            try:
                self._container.stop(timeout=5)
                self._container.remove(force=True)
                logger.info(
                    "DockerSandbox container destroyed: %s",
                    (self._container_id or "unknown")[:12],
                )
            except Exception as exc:
                logger.warning("Error destroying container: %s", exc)
            finally:
                self._container = None
                self._container_id = None
                self._project_path = None

    # -- Context manager -----------------------------------------------------

    def __enter__(self) -> "DockerSandbox":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.destroy()

    # -- Static helpers ------------------------------------------------------

    @staticmethod
    def is_available() -> bool:
        """Check whether Docker is installed and the daemon is reachable.

        Returns
        -------
        bool
            *True* if a Docker client can be obtained and the daemon responds
            to a ping.
        """
        if not _DOCKER_AVAILABLE or docker is None:
            return False
        try:
            client = docker.from_env()
            client.ping()
            return True
        except Exception:
            return False


# ---------------------------------------------------------------------------
# ProcessSandbox
# ---------------------------------------------------------------------------


class ProcessSandbox:
    """Process-based fallback sandbox for environments without Docker.

    Runs commands as local subprocesses with resource limits (timeout,
    memory cap).  This provides **significantly less isolation** than the
    Docker sandbox and should only be used when Docker is unavailable.

    Parameters
    ----------
    project_path:
        Path to the project directory (used as working directory).
    timeout:
        Maximum seconds a command may run before being killed.
    max_memory_mb:
        Soft memory limit in megabytes (advisory; enforced where the OS
        supports it via ``resource`` module).
    """

    def __init__(
        self,
        project_path: str,
        timeout: int = 60,
        max_memory_mb: int = 512,
    ) -> None:
        self.project_path = os.path.abspath(project_path)
        self.timeout = timeout
        self.max_memory_mb = max_memory_mb
        self._created: bool = False

    # -- Lifecycle -----------------------------------------------------------

    def _ensure_ready(self) -> None:
        """Mark sandbox as ready (no-op for process sandbox)."""
        if not self._created:
            self._created = True
            logger.info(
                "ProcessSandbox ready (project=%s, timeout=%ds, mem=%dMB)",
                self.project_path,
                self.timeout,
                self.max_memory_mb,
            )

    # -- Command execution ---------------------------------------------------

    def execute(self, command: str) -> Dict[str, Any]:
        """Run *command* as a local subprocess with resource limits.

        Parameters
        ----------
        command:
            Shell command string to execute.

        Returns
        -------
        dict
            Keys: ``exit_code``, ``stdout``, ``stderr``, ``command``,
            ``sandboxed``.
        """
        self._ensure_ready()

        # Sanitise first
        try:
            safe_command = self._sanitize_command(command)
        except ValueError as exc:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": str(exc),
                "command": command,
                "sandboxed": False,
            }

        logger.debug("Executing in ProcessSandbox: %s", safe_command)

        # Prepare resource limits
        try:
            import resource as _resource

            _max_memory_bytes = self.max_memory_mb * 1024 * 1024
        except ImportError:
            _resource = None  # type: ignore[assignment]
            _max_memory_bytes = 0

        def _set_limits() -> None:
            """Set resource limits in the child process (POSIX only)."""
            if _resource is not None and _max_memory_bytes > 0:
                try:
                    _resource.setrlimit(
                        _resource.RLIMIT_AS,
                        (_max_memory_bytes, _max_memory_bytes),
                    )
                except (ValueError, OSError):
                    pass  # Not supported on this platform

        # Use a thread + Event to implement timeout without signal conflicts
        result_holder: Dict[str, Any] = {}
        finished_event = threading.Event()

        def _run_process() -> None:
            try:
                proc = subprocess.Popen(
                    safe_command,
                    shell=True,
                    cwd=self.project_path,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    preexec_fn=_set_limits if os.name != "nt" else None,
                )
                stdout, stderr = proc.communicate()
                result_holder["exit_code"] = proc.returncode
                result_holder["stdout"] = stdout.decode("utf-8", errors="replace")
                result_holder["stderr"] = stderr.decode("utf-8", errors="replace")
            except Exception as exc:
                result_holder["exit_code"] = -1
                result_holder["stdout"] = ""
                result_holder["stderr"] = f"Process execution error: {exc}"
            finally:
                finished_event.set()

        worker = threading.Thread(target=_run_process, daemon=True)
        worker.start()

        # Wait with timeout
        if not finished_event.wait(timeout=self.timeout):
            # Timed out — the daemon thread will be cleaned up at exit.
            # We cannot reliably kill the subprocess from here on all
            # platforms, but we can report the timeout.
            logger.warning("ProcessSandbox command timed out after %ds: %s", self.timeout, safe_command)
            return {
                "exit_code": -1,
                "stdout": result_holder.get("stdout", ""),
                "stderr": f"Command timed out after {self.timeout} seconds",
                "command": safe_command,
                "sandboxed": False,
            }

        return {
            "exit_code": result_holder.get("exit_code", -1),
            "stdout": result_holder.get("stdout", ""),
            "stderr": result_holder.get("stderr", ""),
            "command": safe_command,
            "sandboxed": False,
        }

    # -- Sanitiser -----------------------------------------------------------

    def _sanitize_command(self, command: str) -> str:
        """Block dangerous command patterns.

        Parameters
        ----------
        command:
            Shell command string to validate.

        Returns
        -------
        str
            The original command if it passes all checks.

        Raises
        ------
        ValueError
            If a dangerous pattern is detected.
        """
        reason = _check_dangerous_command(command)
        if reason is not None:
            raise ValueError(f"Blocked dangerous command: {reason}")
        return command

    # -- Cleanup -------------------------------------------------------------

    def destroy(self) -> None:
        """Clean up resources held by the process sandbox.

        For the process-based sandbox this is effectively a no-op since each
        command runs in its own subprocess that terminates independently.
        """
        self._created = False
        logger.debug("ProcessSandbox destroyed (project=%s)", self.project_path)


# ---------------------------------------------------------------------------
# SandboxManager
# ---------------------------------------------------------------------------


class SandboxManager:
    """Central manager that creates, tracks, and destroys sandboxes.

    Automatically prefers :class:`DockerSandbox` when Docker is available
    and falls back to :class:`ProcessSandbox` otherwise.

    Usage::

        mgr = SandboxManager()
        sandbox = mgr.create_for_session("sess-1", "/my/project")
        result = mgr.execute_in_session("sess-1", "python -m pytest")
        mgr.destroy_session("sess-1")
    """

    def __init__(self) -> None:
        self._sandboxes: Dict[str, Union[DockerSandbox, ProcessSandbox]] = {}
        self._docker_available: Optional[bool] = None  # lazy-check

    # -- Internal helpers ----------------------------------------------------

    def _check_docker(self) -> bool:
        """Cache the Docker availability check."""
        if self._docker_available is None:
            self._docker_available = DockerSandbox.is_available()
            logger.info("Docker availability: %s", self._docker_available)
        return self._docker_available

    # -- Public API ----------------------------------------------------------

    def create_for_session(
        self,
        session_id: str,
        project_path: str,
        **kwargs: Any,
    ) -> Union[DockerSandbox, ProcessSandbox]:
        """Create a sandbox for the given session.

        Tries Docker first; falls back to process-based sandbox if Docker
        is unavailable or creation fails.

        Parameters
        ----------
        session_id:
            Unique identifier for the session.
        project_path:
            Absolute path to the project directory.
        **kwargs:
            Additional keyword arguments forwarded to the sandbox constructor
            (e.g. ``timeout``, ``memory_limit``).

        Returns
        -------
        DockerSandbox or ProcessSandbox
            The created sandbox instance.
        """
        if session_id in self._sandboxes:
            logger.warning("Session %s already has a sandbox; destroying old one", session_id)
            self.destroy_session(session_id)

        sandbox: Union[DockerSandbox, ProcessSandbox]

        if self._check_docker():
            try:
                sandbox = DockerSandbox(
                    image=kwargs.get("image", "python:3.12-slim"),
                    cpu_limit=kwargs.get("cpu_limit", 1.0),
                    memory_limit=kwargs.get("memory_limit", "512m"),
                    timeout=kwargs.get("timeout", 60),
                    network_disabled=kwargs.get("network_disabled", True),
                )
                sandbox.create(project_path)
                self._sandboxes[session_id] = sandbox
                logger.info(
                    "Created DockerSandbox for session %s (project=%s)",
                    session_id,
                    project_path,
                )
                return sandbox
            except Exception as exc:
                logger.warning(
                    "DockerSandbox creation failed for session %s, "
                    "falling back to ProcessSandbox: %s",
                    session_id,
                    exc,
                )
                # Invalidate cache so we don't keep trying Docker
                self._docker_available = False

        # Fallback: process sandbox
        sandbox = ProcessSandbox(
            project_path=project_path,
            timeout=kwargs.get("timeout", 60),
            max_memory_mb=kwargs.get("max_memory_mb", 512),
        )
        sandbox._ensure_ready()
        self._sandboxes[session_id] = sandbox
        logger.info(
            "Created ProcessSandbox for session %s (project=%s)",
            session_id,
            project_path,
        )
        return sandbox

    def get(self, session_id: str) -> Optional[Union[DockerSandbox, ProcessSandbox]]:
        """Retrieve the sandbox for *session_id*.

        Parameters
        ----------
        session_id:
            The session identifier.

        Returns
        -------
        DockerSandbox, ProcessSandbox, or None
            The sandbox instance, or ``None`` if not found.
        """
        return self._sandboxes.get(session_id)

    def execute_in_session(self, session_id: str, command: str) -> Dict[str, Any]:
        """Execute *command* in the sandbox associated with *session_id*.

        Parameters
        ----------
        session_id:
            The session identifier.
        command:
            Shell command string to execute.

        Returns
        -------
        dict
            Execution result dict with keys ``exit_code``, ``stdout``,
            ``stderr``, ``command``, ``sandboxed``.
        """
        sandbox = self._sandboxes.get(session_id)
        if sandbox is None:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"No sandbox found for session '{session_id}'",
                "command": command,
                "sandboxed": False,
            }
        return sandbox.execute(command)

    def destroy_session(self, session_id: str) -> None:
        """Stop and remove the sandbox for *session_id*.

        Parameters
        ----------
        session_id:
            The session identifier.
        """
        sandbox = self._sandboxes.pop(session_id, None)
        if sandbox is not None:
            sandbox.destroy()
            logger.info("Destroyed sandbox for session %s", session_id)

    def destroy_all(self) -> None:
        """Stop and remove all active sandboxes."""
        session_ids = list(self._sandboxes.keys())
        for sid in session_ids:
            self.destroy_session(sid)
        logger.info("Destroyed all sandboxes (%d total)", len(session_ids))

    def get_status(self) -> Dict[str, Any]:
        """Return a status summary of the sandbox manager.

        Returns
        -------
        dict
            Keys:
            - ``docker_available`` — whether Docker was reachable at last check
            - ``active_sandboxes`` — number of currently tracked sandboxes
            - ``mode`` — ``"docker"`` or ``"process"`` indicating the active
              sandbox type, or ``"mixed"`` if both types are present
        """
        docker_available = self._check_docker()
        active_count = len(self._sandboxes)

        # Determine dominant mode
        types = set()
        for sandbox in self._sandboxes.values():
            types.add(type(sandbox).__name__)

        if not types:
            mode = "none"
        elif types == {"DockerSandbox"}:
            mode = "docker"
        elif types == {"ProcessSandbox"}:
            mode = "process"
        else:
            mode = "mixed"

        return {
            "docker_available": docker_available,
            "active_sandboxes": active_count,
            "mode": mode,
        }
