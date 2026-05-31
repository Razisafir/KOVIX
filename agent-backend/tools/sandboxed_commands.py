"""
Sandboxed Command Execution — tool wrappers that route shell commands through
the SandboxManager for safe, isolated execution.

When a sandbox is active for the current session, ``execute_command`` and
``run_test`` are intercepted and executed inside the sandbox container
(or process sandbox) instead of directly on the host.

Usage::

    from tools.sandboxed_commands import SandboxedCommandTools
    from core.sandbox import SandboxManager

    mgr = SandboxManager()
    sandbox = mgr.create_for_session("sess-1", "/path/to/project")
    tools = SandboxedCommandTools(mgr, session_id="sess-1")

    result = tools.execute_command("python -m pytest")
    print(result["exit_code"], result["stdout"])
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from core.sandbox import SandboxManager

logger = logging.getLogger(__name__)


class SandboxedCommandTools:
    """Wraps shell command tools to route execution through a sandbox.

    When a sandbox is active for the session, commands are executed inside
    the sandbox (Docker container or process sandbox).  When no sandbox
    is available, execution falls back to direct subprocess calls via the
    original ``shell_tools`` module.

    Parameters
    ----------
    manager:
        The :class:`SandboxManager` instance that tracks active sandboxes.
    session_id:
        The current agent session identifier.
    """

    def __init__(self, manager: SandboxManager, session_id: str) -> None:
        self.manager = manager
        self.session_id = session_id

    def _has_sandbox(self) -> bool:
        """Check whether a sandbox exists for this session."""
        return self.manager.get(self.session_id) is not None

    # ── execute_command ──────────────────────────────────────────────

    def execute_command(
        self,
        command: str,
        cwd: str = ".",
        timeout: int = 60,
    ) -> Dict[str, Any]:
        """Execute a shell command, routing through the sandbox if available.

        When the sandbox is active, the command is executed inside the
        isolated container with read-only project mount, no network, and
        strict resource limits.  Otherwise, falls back to direct execution.

        Parameters
        ----------
        command:
            The shell command string to execute.
        cwd:
            Working directory (used by the fallback path; the sandbox
            always uses ``/project``).
        timeout:
            Maximum execution time in seconds (used by fallback).

        Returns
        -------
        dict
            Keys: ``exit_code``, ``stdout``, ``stderr``, ``command``,
            ``sandboxed`` (bool), ``mode`` (str).
        """
        if self._has_sandbox():
            logger.info("Sandboxed execute: %s", command[:120])
            result = self.manager.execute_in_session(self.session_id, command)
            result["mode"] = "sandbox"
            return result

        # Fallback: direct execution via shell_tools
        logger.info("Direct execute (no sandbox): %s", command[:120])
        try:
            from tools.shell_tools import execute_command as _direct_exec
            direct_result = _direct_exec(command=command, cwd=cwd, timeout=timeout)
            if isinstance(direct_result, dict):
                direct_result["sandboxed"] = False
                direct_result["mode"] = "direct"
                return direct_result
            return {
                "exit_code": 0,
                "stdout": str(direct_result),
                "stderr": "",
                "command": command,
                "sandboxed": False,
                "mode": "direct",
            }
        except Exception as exc:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Direct execution failed: {exc}",
                "command": command,
                "sandboxed": False,
                "mode": "direct",
            }

    # ── run_test ─────────────────────────────────────────────────────

    def run_test(
        self,
        test_command: str = "npm test",
        cwd: str = ".",
    ) -> Dict[str, Any]:
        """Execute a test command, routing through the sandbox if available.

        Parameters
        ----------
        test_command:
            The test command to run.
        cwd:
            Working directory for fallback execution.

        Returns
        -------
        dict
            Same shape as :meth:`execute_command`.
        """
        if self._has_sandbox():
            logger.info("Sandboxed test: %s", test_command[:120])
            result = self.manager.execute_in_session(self.session_id, test_command)
            result["mode"] = "sandbox"
            return result

        # Fallback
        try:
            from tools.shell_tools import run_test as _direct_test
            direct_result = _direct_test(test_command=test_command, cwd=cwd)
            if isinstance(direct_result, dict):
                direct_result["sandboxed"] = False
                direct_result["mode"] = "direct"
                return direct_result
            return {
                "exit_code": 0,
                "stdout": str(direct_result),
                "stderr": "",
                "command": test_command,
                "sandboxed": False,
                "mode": "direct",
            }
        except Exception as exc:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Direct test execution failed: {exc}",
                "command": test_command,
                "sandboxed": False,
                "mode": "direct",
            }

    # ── install_dependency ───────────────────────────────────────────

    def install_dependency(
        self,
        package: str,
        cwd: str = ".",
    ) -> Dict[str, Any]:
        """Install a dependency — always runs directly (not sandboxed).

        Package installation requires network access and write permissions
        which the sandbox does not provide.  This method always falls back
        to direct execution.

        Parameters
        ----------
        package:
            Package name to install.
        cwd:
            Working directory for auto-detection of package manager.

        Returns
        -------
        dict
            Result from the direct ``install_dependency`` tool.
        """
        logger.info("Install dependency (direct, not sandboxed): %s", package)
        try:
            from tools.shell_tools import install_dependency as _direct_install
            result = _direct_install(package=package, cwd=cwd)
            if isinstance(result, dict):
                result["sandboxed"] = False
                result["mode"] = "direct"
                return result
            return {
                "success": True,
                "output": str(result),
                "sandboxed": False,
                "mode": "direct",
            }
        except Exception as exc:
            return {
                "success": False,
                "error": f"Dependency install failed: {exc}",
                "sandboxed": False,
                "mode": "direct",
            }

    # ── Session management helpers ───────────────────────────────────

    def ensure_sandbox(self, project_path: str) -> Dict[str, Any]:
        """Create a sandbox for the session if one doesn't exist.

        Parameters
        ----------
        project_path:
            Absolute path to the project directory.

        Returns
        -------
        dict
            Keys: ``created``, ``mode`` (docker / process), ``session_id``.
        """
        if self._has_sandbox():
            sandbox = self.manager.get(self.session_id)
            mode = "docker" if type(sandbox).__name__ == "DockerSandbox" else "process"
            return {"created": False, "mode": mode, "session_id": self.session_id}

        sandbox = self.manager.create_for_session(self.session_id, project_path)
        mode = "docker" if type(sandbox).__name__ == "DockerSandbox" else "process"
        logger.info("Created %s sandbox for session %s", mode, self.session_id)
        return {"created": True, "mode": mode, "session_id": self.session_id}

    def destroy_sandbox(self) -> Dict[str, Any]:
        """Destroy the sandbox for this session.

        Returns
        -------
        dict
            Keys: ``destroyed``, ``session_id``.
        """
        self.manager.destroy_session(self.session_id)
        return {"destroyed": True, "session_id": self.session_id}

    def get_sandbox_status(self) -> Dict[str, Any]:
        """Get the current sandbox status for this session.

        Returns
        -------
        dict
            Keys: ``active``, ``mode``, ``manager_status``.
        """
        sandbox = self.manager.get(self.session_id)
        active = sandbox is not None
        mode = ""
        if active:
            mode = "docker" if type(sandbox).__name__ == "DockerSandbox" else "process"
        return {
            "active": active,
            "mode": mode,
            "manager_status": self.manager.get_status(),
            "session_id": self.session_id,
        }
