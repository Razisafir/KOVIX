"""
Agent modes — each mode configures the agent's behavior, available tools,
planning strategy, and verification approach.

The 6 modes are:
    CODE      — General software development: write, refactor, modify code
    ARCHITECT — System design: APIs, schemas, architecture decisions
    DEBUG     — Find and fix bugs: trace errors, root cause analysis
    REVIEW    — Code review: style, best practices, performance
    SECURITY  — Security audit: vulnerabilities, hardening, dependency scanning
    DEVOPS    — CI/CD, deployment, infrastructure: Docker, K8s, pipelines

Each mode defines:
    - A distinct system prompt that shapes the agent's reasoning style
    - A curated set of available tools (subset of the full tool registry)
    - A verification strategy appropriate for the mode's focus
    - A max_iterations limit tuned to the mode's typical complexity
    - A list of tools that require human approval before execution

Usage::

    from core.modes import get_mode_config, AgentMode, list_modes

    config = get_mode_config("code")
    print(config.system_prompt)
    print(config.available_tools)
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum


class AgentMode(Enum):
    """All available agent modes."""

    CODE = "code"
    ARCHITECT = "architect"
    DEBUG = "debug"
    REVIEW = "review"
    SECURITY = "security"
    DEVOPS = "devops"


@dataclass
class ModeConfig:
    """Configuration for an agent mode.

    Attributes
    ----------
    name:
        Machine-readable mode identifier (matches :class:`AgentMode` value).
    description:
        One-line human-readable description for UI display.
    system_prompt:
        The system prompt injected when this mode is active. It shapes how
        the agent reasons, plans, and prioritises work.
    available_tools:
        List of tool names (matching the ToolRegistry keys) that this mode
        is allowed to use. Tools not in this list are hidden from the LLM.
    verification_strategy:
        Strategy name for the verify phase. One of:
        ``test_and_lint``, ``design_review``, ``regression_test``,
        ``checklist``, ``security_scan``, ``dry_run``, ``default``.
    max_iterations:
        Maximum number of tool-call iterations the agent may perform per task
        before being forced to stop. Higher values allow more exploration
        (e.g. debugging), lower values prevent runaway operations.
    require_human_approval:
        List of tool names that require explicit human approval before the
        agent is allowed to execute them in this mode.
    """

    name: str
    description: str
    system_prompt: str
    available_tools: List[str] = field(default_factory=list)
    verification_strategy: str = "default"
    max_iterations: int = 10
    require_human_approval: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dictionary (for API responses)."""
        return {
            "name": self.name,
            "description": self.description,
            "available_tools": self.available_tools,
            "verification_strategy": self.verification_strategy,
            "max_iterations": self.max_iterations,
            "require_human_approval": self.require_human_approval,
        }


# ---------------------------------------------------------------------------
# Mode configurations
# ---------------------------------------------------------------------------

MODE_CONFIGS: Dict[AgentMode, ModeConfig] = {
    AgentMode.CODE: ModeConfig(
        name="code",
        description="General software development — write, refactor, and modify code",
        system_prompt=(
            "You are a senior software engineer. Your task is to write clean, "
            "maintainable, well-documented code. Follow the project's existing "
            "conventions and coding style. Write tests when appropriate. Prefer "
            "simple, readable solutions over clever ones. When modifying existing "
            "code, preserve backward compatibility unless explicitly told otherwise. "
            "Always read a file before editing it so you understand the current state."
        ),
        available_tools=[
            # File tools
            "read_file",
            "write_file",
            "list_directory",
            "search_files",
            # Shell tools
            "execute_command",
            "run_test",
            "install_dependency",
            # Git tools
            "git_status",
            "git_diff",
            "git_commit",
            "git_log",
            # Code tools
            "parse_ast",
            "find_references",
            "refactor_rename",
            "extract_function",
            # Code search
            "code_search",
            "code_find_definition",
            "code_find_usages",
            "code_file_structure",
        ],
        verification_strategy="test_and_lint",
        max_iterations=15,
    ),
    AgentMode.ARCHITECT: ModeConfig(
        name="architect",
        description="System design and architecture — design APIs, schemas, and structures",
        system_prompt=(
            "You are a principal software architect. Design systems that are "
            "scalable, maintainable, and aligned with business requirements. "
            "Consider trade-offs explicitly and document your reasoning. Produce "
            "design documents, API specs, and implementation plans. When writing "
            "code, focus on interface definitions, type declarations, and skeleton "
            "implementations rather than full logic. Prefer composition over "
            "inheritance. Always consider error handling, observability, and "
            "extensibility in your designs."
        ),
        available_tools=[
            # File tools (read-heavy, write requires approval)
            "read_file",
            "write_file",
            "list_directory",
            "search_files",
            # Shell tools
            "execute_command",
            # Code tools
            "parse_ast",
            "find_references",
            # Code search
            "code_search",
            "code_find_definition",
            "code_find_usages",
            "code_file_structure",
            # Database tools (for schema design)
            "db_connect_sqlite",
            "db_list_tables",
            "db_get_schema",
            "db_disconnect",
            # Document conversion
            "convert_document",
            "extract_document_structure",
        ],
        verification_strategy="design_review",
        max_iterations=8,
        require_human_approval=["write_file"],
    ),
    AgentMode.DEBUG: ModeConfig(
        name="debug",
        description="Find and fix bugs — trace errors, analyze logs, root cause analysis",
        system_prompt=(
            "You are a debugging specialist. Methodically trace issues from "
            "symptom to root cause. Use logs, stack traces, and code analysis. "
            "Fix the minimal change needed — do not refactor while debugging. "
            "Write regression tests for every bug you fix. Never mask symptoms — "
            "always fix the root cause. Start by reading error messages carefully, "
            "then narrow down the scope with targeted searches before making changes."
        ),
        available_tools=[
            # File tools
            "read_file",
            "write_file",
            "list_directory",
            "search_files",
            # Shell tools
            "execute_command",
            "run_test",
            # Git tools
            "git_status",
            "git_diff",
            "git_log",
            "git_blame",
            # Code tools
            "parse_ast",
            "find_references",
            # Code search
            "code_search",
            "code_find_definition",
            "code_find_usages",
        ],
        verification_strategy="regression_test",
        max_iterations=20,  # Debugging may need more iterations
    ),
    AgentMode.REVIEW: ModeConfig(
        name="review",
        description="Code review — style, best practices, performance, maintainability",
        system_prompt=(
            "You are a meticulous code reviewer. Check for: correctness, security, "
            "performance, readability, test coverage, and adherence to project "
            "conventions. Be constructive but critical. Suggest specific improvements "
            "with concrete examples. Prioritise findings by severity: critical issues "
            "that could cause bugs or security vulnerabilities first, then style and "
            "maintainability. Never make changes directly — only suggest them. Use "
            "read-only tools to understand the code and provide feedback."
        ),
        available_tools=[
            # File tools (read-only focus)
            "read_file",
            "list_directory",
            "search_files",
            # Shell tools
            "execute_command",
            "run_test",
            # Git tools
            "git_status",
            "git_diff",
            "git_log",
            # Code tools
            "parse_ast",
            "find_references",
            # Code search
            "code_search",
            "code_find_definition",
            "code_find_usages",
            "code_file_structure",
        ],
        verification_strategy="checklist",
        max_iterations=5,  # Reviews should be quick and focused
    ),
    AgentMode.SECURITY: ModeConfig(
        name="security",
        description="Security audit — find vulnerabilities, check dependencies, harden",
        system_prompt=(
            "You are a security engineer. Audit for: injection flaws, authentication "
            "issues, sensitive data exposure, dependency vulnerabilities, insecure "
            "configurations, and misused cryptography. Use OWASP Top 10 as your "
            "baseline. Provide CVE references where applicable and give concrete "
            "remediation steps with code examples. Classify findings by severity "
            "(critical/high/medium/low). When scanning, start with the most "
            "attack-surface-exposed code paths."
        ),
        available_tools=[
            # File tools
            "read_file",
            "write_file",
            "list_directory",
            "search_files",
            # Shell tools (restricted — requires approval)
            "execute_command",
            "run_test",
            # Git tools
            "git_status",
            "git_diff",
            "git_log",
            # Binary analysis
            "find_vulnerabilities",
            # Code search
            "code_search",
            "code_find_definition",
            "code_find_usages",
            "code_file_structure",
            # Database tools (for checking SQL injection vectors)
            "db_connect_sqlite",
            "db_query",
            "db_disconnect",
        ],
        verification_strategy="security_scan",
        max_iterations=10,
        require_human_approval=["execute_command"],
    ),
    AgentMode.DEVOPS: ModeConfig(
        name="devops",
        description="CI/CD, deployment, infrastructure — Docker, K8s, pipelines",
        system_prompt=(
            "You are a DevOps engineer. Manage infrastructure as code. Create "
            "Dockerfiles, CI/CD pipelines, deployment configs, and monitoring "
            "setups. Follow best practices for observability, security, and cost "
            "optimization. Always test configs before applying them. Prefer "
            "idempotent operations. Document every infrastructure change. When "
            "working with containers, minimise image size and use multi-stage "
            "builds. When writing CI/CD, ensure pipelines fail fast and cache "
            "aggressively."
        ),
        available_tools=[
            # File tools
            "read_file",
            "write_file",
            "list_directory",
            "search_files",
            # Shell tools (restricted — requires approval)
            "execute_command",
            "run_test",
            "install_dependency",
            # Git tools
            "git_status",
            "git_diff",
            "git_commit",
            "git_log",
            "git_branch",
            "git_checkout",
            # Code search
            "code_search",
            "code_file_structure",
        ],
        verification_strategy="dry_run",
        max_iterations=12,
        require_human_approval=["execute_command"],
    ),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_mode_config(mode: str) -> ModeConfig:
    """Get configuration for an agent mode.

    Parameters
    ----------
    mode:
        Mode identifier string (e.g. ``"code"``, ``"debug"``).  Case-insensitive.
        If the mode is not recognised, defaults to CODE mode.

    Returns
    -------
    ModeConfig
        The configuration for the requested mode.
    """
    try:
        mode_enum = AgentMode(mode.lower())
    except ValueError:
        mode_enum = AgentMode.CODE  # Safe default

    return MODE_CONFIGS[mode_enum]


def list_modes() -> List[Dict[str, Any]]:
    """List all available modes for UI display.

    Returns
    -------
    list[dict]
        Each dict has ``id``, ``name``, ``description``, and ``icon`` keys.
    """
    return [
        {
            "id": mode.value,
            "name": mode.value.title(),
            "description": config.description,
            "icon": _get_mode_icon(mode),
            "color": _get_mode_color(mode),
        }
        for mode, config in MODE_CONFIGS.items()
    ]


def _get_mode_icon(mode: AgentMode) -> str:
    """Get Lucide icon name for a mode (used by the frontend)."""
    icons = {
        AgentMode.CODE: "code-2",
        AgentMode.ARCHITECT: "layout",
        AgentMode.DEBUG: "bug",
        AgentMode.REVIEW: "eye",
        AgentMode.SECURITY: "shield",
        AgentMode.DEVOPS: "server",
    }
    return icons.get(mode, "circle")


def _get_mode_color(mode: AgentMode) -> str:
    """Get the brand color hex for a mode (used by the frontend)."""
    colors = {
        AgentMode.CODE: "#6366f1",      # Indigo — primary accent
        AgentMode.ARCHITECT: "#a78bfa", # Purple — design thinking
        AgentMode.DEBUG: "#f59e0b",     # Amber — caution/alert
        AgentMode.REVIEW: "#06b6d4",    # Cyan — observant
        AgentMode.SECURITY: "#10b981",  # Emerald — safety
        AgentMode.DEVOPS: "#f97316",    # Orange — infrastructure
    }
    return colors.get(mode, "#6366f1")
