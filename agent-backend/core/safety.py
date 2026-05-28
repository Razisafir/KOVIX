"""
Safety System — Human checkpoint triggers and resume conditions.

When the agent encounters a safety-critical situation, it pauses and asks
for human approval before continuing.  This prevents destructive operations,
unauthorised architecture changes, and runaway error loops.

Trigger categories:
- Destructive operations (file deletion, ``git reset --hard``)
- Architecture decisions (changing core structure, adding new dependencies)
- Authentication / payment code changes
- Repeated failures (3+ consecutive task failures)
- First-time service usage (new API key, new external service)

Resume conditions:
- USER_APPROVAL — human explicitly approves
- RESUME_TIMEOUT — auto-resume after 30 minutes
- SCHEDULED_RESUME — resume at a specific time

Usage::

    from core.safety import SafetyMonitor, SafetySettings

    settings = SafetySettings(
        require_approval_for=["destructive", "auth_code", "architecture"],
    )
    monitor = SafetyMonitor(settings=settings)
    result = await monitor.check(session)
    if result.should_pause:
        ... ask human for approval ...
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RESUME_TIMEOUT: int = 30 * 60  # 30 minutes auto-resume
MAX_CONSECUTIVE_FAILURES: int = 3

# Patterns that indicate destructive operations
DESTRUCTIVE_TOOL_PATTERNS: List[str] = [
    r"delete_file",
    r"delete_directory",
    r"remove_",
    r"git\s+reset\s+--hard",
    r"git\s+clean\s+-f",
    r"rm\s+-rf",
    r"rm\s+-fr",
    r"drop\s+database",
    r"truncate\s+table",
]

# Patterns for architecture-level changes
ARCHITECTURE_PATTERNS: List[str] = [
    r"add\s+(new\s+)?(micro)?service",
    r"create\s+(new\s+)?database",
    r"migrate\s+(to\s+)?",
    r"change\s+(the\s+)?architecture",
    r"refactor\s+core",
    r"replace\s+.*framework",
    r"upgrade\s+.*major",
    r"downgrade\s+.*major",
    r"add\s+(new\s+)?dependency",
    r"remove\s+.*dependency",
    r"modify\s+.*config",
]

# Patterns for auth/payment code
AUTH_CODE_PATTERNS: List[str] = [
    r"auth",
    r"authenticat",
    r"password",
    r"secret",
    r"api[_\s]?key",
    r"token",
    r"credential",
    r"oauth",
    r"jwt",
    r"stripe",
    r"payment",
    r"billing",
    r"credit[_\s]?card",
    r"encrypt",
    r"decrypt",
    r"hash\s*\(",
    r"bcrypt",
    r"ssl",
    r"tls",
    r"certificate",
]

# Known safe providers that don't need approval
KNOWN_PROVIDERS: Set[str] = {
    "openai", "anthropic", "google", "ollama", "local",
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class SafetyCheckResult:
    """Result of a safety check."""

    should_pause: bool
    reason: str
    severity: str = "low"       # low | medium | high | critical
    category: str = "general"   # destructive | architecture | auth_code | test_failure | api_key | general

    def to_dict(self) -> Dict[str, Any]:
        return {
            "should_pause": self.should_pause,
            "reason": self.reason,
            "severity": self.severity,
            "category": self.category,
        }


@dataclass
class SafetySettings:
    """Configure which safety categories require human approval."""

    require_approval_for: List[str] = field(default_factory=lambda: [
        "destructive", "architecture", "auth_code", "test_failure", "api_key",
    ])
    max_consecutive_failures: int = MAX_CONSECUTIVE_FAILURES
    auto_resume_timeout: int = RESUME_TIMEOUT
    # File paths that, if touched, always trigger a safety pause
    protected_paths: List[str] = field(default_factory=lambda: [
        ".env", ".env.local", ".env.production", "secrets.json", "config/secrets",
        "id_rsa", ".ssh/", "keystore", "credentials.json", "service_account.json",
    ])
    # Maximum file deletion count before triggering safety
    max_file_deletions_per_session: int = 5


# ---------------------------------------------------------------------------
# Safety Monitor
# ---------------------------------------------------------------------------


class SafetyMonitor:
    """Central safety coordinator that runs all safety checks.

    Parameters
    ----------
    settings:
        ``SafetySettings`` instance controlling which checks are active.
    """

    def __init__(self, settings: Optional[SafetySettings] = None) -> None:
        self.settings = settings or SafetySettings()
        self._failure_counts: Dict[str, int] = field_dict()
        self._used_providers: Set[str] = set()
        self._deletion_count: int = 0
        self._session_deletions: Dict[str, int] = field_dict()

    # -- Main entry point ------------------------------------------------------

    async def check(self, session: Any) -> SafetyCheckResult:
        """Run all enabled safety checks against *session*.

        Returns a ``SafetyCheckResult``; if ``should_pause`` is *True* the
        agent must halt and wait for human approval.
        """
        # Run all sub-checks concurrently
        results = await asyncio.gather(
            self.check_architecture(session),
            self.check_test_failure(session),
            self.check_protected_paths(session),
            return_exceptions=True,
        )

        # Check the most recent tool calls for destructive patterns
        tool_result = self.check_destructive_in_session(session)
        if tool_result.should_pause:
            return tool_result

        # Process gathered results
        for r in results:
            if isinstance(r, Exception):
                logger.warning("Safety sub-check raised an exception: %s", r)
                continue
            if r.should_pause:
                return r

        return SafetyCheckResult(should_pause=False, reason="All checks passed")

    # -- Individual checks -----------------------------------------------------

    def check_destructive(self, tool_call: Dict[str, Any]) -> SafetyCheckResult:
        """Check whether a single tool call is destructive.

        Parameters
        ----------
        tool_call:
            Dict with at least ``tool`` (name) and ``arguments`` keys.
        """
        if "destructive" not in self.settings.require_approval_for:
            return SafetyCheckResult(should_pause=False, reason="destructive check disabled")

        tool_name = tool_call.get("tool", "")
        arguments = tool_call.get("arguments", {})
        cmd = arguments.get("command", "")
        combined = f"{tool_name} {cmd}".lower()

        for pattern in DESTRUCTIVE_TOOL_PATTERNS:
            if re.search(pattern, combined, re.IGNORECASE):
                self._deletion_count += 1
                severity = "critical" if self._deletion_count > self.settings.max_file_deletions_per_session else "high"
                return SafetyCheckResult(
                    should_pause=True,
                    reason=f"Destructive operation detected: {pattern!r} in '{combined}'",
                    severity=severity,
                    category="destructive",
                )

        return SafetyCheckResult(should_pause=False, reason="No destructive pattern matched")

    def check_destructive_in_session(self, session: Any) -> SafetyCheckResult:
        """Scan the most recent tool calls in *session* for destructive patterns."""
        if "destructive" not in self.settings.require_approval_for:
            return SafetyCheckResult(should_pause=False, reason="destructive check disabled")

        if not hasattr(session, "tasks"):
            return SafetyCheckResult(should_pause=False, reason="no tasks")

        # Scan the last few tool calls from all tasks
        recent_tool_calls: List[Dict[str, Any]] = []
        for task in session.tasks:
            if hasattr(task, "tool_calls") and task.tool_calls:
                recent_tool_calls.extend(task.tool_calls[-3:])

        for tc in recent_tool_calls:
            result = self.check_destructive(tc)
            if result.should_pause:
                return result

        return SafetyCheckResult(should_pause=False, reason="No destructive tool calls found")

    async def check_architecture(self, session: Any) -> SafetyCheckResult:
        """Detect whether the agent is making architecture-level decisions.

        Scans task descriptions and LLM output for keywords indicating
        structural changes (new services, migrations, framework swaps, etc.).
        """
        if "architecture" not in self.settings.require_approval_for:
            return SafetyCheckResult(should_pause=False, reason="architecture check disabled")

        text_to_scan = ""

        # Scan goal
        if hasattr(session, "goal"):
            text_to_scan += f" {session.goal}"

        # Scan task descriptions
        if hasattr(session, "tasks"):
            for task in session.tasks:
                if hasattr(task, "description"):
                    text_to_scan += f" {task.description}"
                if hasattr(task, "result") and task.result:
                    text_to_scan += f" {task.result}"

        text_lower = text_to_scan.lower()

        for pattern in ARCHITECTURE_PATTERNS:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return SafetyCheckResult(
                    should_pause=True,
                    reason=f"Architecture decision detected: pattern '{pattern!r}' matched in session context",
                    severity="medium",
                    category="architecture",
                )

        return SafetyCheckResult(should_pause=False, reason="No architecture patterns matched")

    def check_auth_code(self, file_path: str, diff: str) -> SafetyCheckResult:
        """Check whether a file change touches authentication or payment code.

        Parameters
        ----------
        file_path:
            Path of the file being modified.
        diff:
            The diff / patch text of the change.
        """
        if "auth_code" not in self.settings.require_approval_for:
            return SafetyCheckResult(should_pause=False, reason="auth_code check disabled")

        combined = f"{file_path} {diff}".lower()

        for pattern in AUTH_CODE_PATTERNS:
            if re.search(pattern, combined, re.IGNORECASE):
                return SafetyCheckResult(
                    should_pause=True,
                    reason=f"Auth/payment code change detected: pattern '{pattern!r}' in '{file_path}'",
                    severity="high",
                    category="auth_code",
                )

        return SafetyCheckResult(should_pause=False, reason="No auth/payment patterns matched")

    async def check_test_failure(self, session: Any) -> SafetyCheckResult:
        """Trigger a safety pause after 3+ consecutive task failures."""
        if "test_failure" not in self.settings.require_approval_for:
            return SafetyCheckResult(should_pause=False, reason="test_failure check disabled")

        if not hasattr(session, "tasks") or not hasattr(session, "id"):
            return SafetyCheckResult(should_pause=False, reason="no tasks or session ID")

        session_id = session.id
        consecutive_failures = 0

        for task in session.tasks:
            status = getattr(task, "status", None)
            if status is not None:
                status_val = status.value if hasattr(status, "value") else str(status)
                if status_val == "failed":
                    consecutive_failures += 1
                elif status_val == "completed":
                    consecutive_failures = 0

        if consecutive_failures >= self.settings.max_consecutive_failures:
            return SafetyCheckResult(
                should_pause=True,
                reason=(
                    f"{consecutive_failures} consecutive task failures "
                    f"(max allowed: {self.settings.max_consecutive_failures})"
                ),
                severity="high",
                category="test_failure",
            )

        return SafetyCheckResult(should_pause=False, reason="Failure count within limits")

    async def check_protected_paths(self, session: Any) -> SafetyCheckResult:
        """Check whether any task has touched a protected file path."""
        if not self.settings.protected_paths:
            return SafetyCheckResult(should_pause=False, reason="no protected paths configured")

        if not hasattr(session, "tasks"):
            return SafetyCheckResult(should_pause=False, reason="no tasks")

        for task in session.tasks:
            tool_calls = getattr(task, "tool_calls", [])
            for tc in tool_calls:
                args = tc.get("arguments", {})
                for key in ("file_path", "path", "dir_path", "target", "source"):
                    path_val = args.get(key, "")
                    if path_val:
                        for protected in self.settings.protected_paths:
                            if protected in str(path_val):
                                return SafetyCheckResult(
                                    should_pause=True,
                                    reason=f"Protected path access: '{protected}' in '{path_val}'",
                                    severity="critical",
                                    category="destructive",
                                )

        return SafetyCheckResult(should_pause=False, reason="No protected paths accessed")

    def check_api_key_needed(self, provider: str) -> SafetyCheckResult:
        """Check whether this is the first time we're using a given service.

        Triggers a pause so the user can confirm API keys are configured.
        """
        if "api_key" not in self.settings.require_approval_for:
            return SafetyCheckResult(should_pause=False, reason="api_key check disabled")

        provider_lower = provider.lower()

        if provider_lower in self._used_providers:
            return SafetyCheckResult(should_pause=False, reason=f"Provider '{provider}' already used")

        self._used_providers.add(provider_lower)

        if provider_lower in KNOWN_PROVIDERS:
            return SafetyCheckResult(should_pause=False, reason=f"Known provider '{provider}' — no approval needed")

        return SafetyCheckResult(
            should_pause=True,
            reason=f"First-time use of external service: '{provider}'. Please confirm API key is configured.",
            severity="medium",
            category="api_key",
        )

    # -- State management ------------------------------------------------------

    def reset_failure_count(self, session_id: str) -> None:
        """Reset the failure counter for a session (e.g. after human intervention)."""
        self._failure_counts.pop(session_id, None)
        logger.debug("Failure count reset for session %s", session_id)

    def reset_deletion_count(self) -> None:
        """Reset the global deletion counter."""
        self._deletion_count = 0
        logger.debug("Deletion count reset")

    def mark_provider_used(self, provider: str) -> None:
        """Pre-register a provider so it doesn't trigger a first-use pause."""
        self._used_providers.add(provider.lower())

    def get_stats(self) -> Dict[str, Any]:
        """Return current safety monitor statistics."""
        return {
            "used_providers": sorted(self._used_providers),
            "deletion_count": self._deletion_count,
            "settings": {
                "require_approval_for": self.settings.require_approval_for,
                "max_consecutive_failures": self.settings.max_consecutive_failures,
                "auto_resume_timeout": self.settings.auto_resume_timeout,
                "protected_paths_count": len(self.settings.protected_paths),
            },
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def field_dict() -> Dict[str, int]:
    """Factory for dict-based counters."""
    return {}