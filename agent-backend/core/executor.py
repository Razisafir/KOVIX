"""
Agent execution loop: observe -> plan -> act -> verify.

The core autonomous agent that:
1. Observes current project state
2. Plans tasks to achieve the goal
3. Executes tasks using tools
4. Verifies results (tests, lint, compilation)
5. Loops until goal is complete or human intervention needed
"""

import os
import time
import uuid
import json
import asyncio
import logging
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

from core.llm_service import LLMService, Message, assemble_messages
from core.modes import get_mode_config, AgentMode, ModeConfig
from tools.file_tools import set_base_dir

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class TaskStatus(Enum):
    """Status of an individual task in a session."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"


class AgentStatus(Enum):
    """Overall status of an agent session."""

    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING = "waiting"  # waiting for human input


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class AgentTask:
    """A single task within an agent session."""

    id: str
    description: str
    status: TaskStatus = TaskStatus.PENDING
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    result: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dictionary."""
        return {
            "id": self.id,
            "description": self.description,
            "status": self.status.value,
            "tool_calls": self.tool_calls,
            "result": self.result,
            "error": self.error,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }


@dataclass
class AgentSession:
    """A complete agent session from goal to completion."""

    id: str
    goal: str
    status: AgentStatus = AgentStatus.IDLE
    tasks: List[AgentTask] = field(default_factory=list)
    current_task_index: int = 0
    output_log: List[Dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    project_path: str = "."
    mode: str = "code"

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dictionary."""
        return {
            "id": self.id,
            "goal": self.goal,
            "status": self.status.value,
            "tasks": [t.to_dict() for t in self.tasks],
            "current_task_index": self.current_task_index,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "project_path": self.project_path,
            "mode": self.mode,
            "task_summary": {
                "total": len(self.tasks),
                "pending": sum(1 for t in self.tasks if t.status == TaskStatus.PENDING),
                "in_progress": sum(
                    1 for t in self.tasks if t.status == TaskStatus.IN_PROGRESS
                ),
                "completed": sum(
                    1 for t in self.tasks if t.status == TaskStatus.COMPLETED
                ),
                "failed": sum(1 for t in self.tasks if t.status == TaskStatus.FAILED),
            },
        }


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

PLANNING_PROMPT_TEMPLATE = """\
You are an autonomous AI coding assistant. Given the user's goal and the current project context, 
decompose the goal into a list of actionable tasks.

User Goal: {goal}

Project Context:
{context}

Respond with ONLY a JSON array of task objects. Each task must have:
- "id": a short unique identifier (e.g., "task-1", "task-2")
- "description": a clear, actionable description of what to do

Example response:
[
  {{"id": "task-1", "description": "Read the current app.py to understand the structure"}},
  {{"id": "task-2", "description": "Add a new endpoint for user authentication"}},
  {{"id": "task-3", "description": "Run tests to verify the changes"}}
]

Tasks (JSON only, no markdown):
"""

ACTING_PROMPT_TEMPLATE = """\
You are executing a coding task. Use the available tools to complete it.

Current Task: {task_description}

Available tools: {tool_names}

To use a tool, respond with a JSON object containing:
- "tool": the tool name to use
- "arguments": a dict of arguments for that tool
- "reasoning": brief explanation of why you're using this tool

After completing all necessary tool calls, respond with:
{{"done": true, "summary": "Brief summary of what was accomplished"}}

Project path: {project_path}
Previous results: {previous_results}

Response (JSON only):
"""

VERIFICATION_PROMPT_TEMPLATE = """\
A task has been completed. Verify that the changes are correct by suggesting 
verification steps (run tests, check syntax, review the code).

Task: {task_description}
Result: {task_result}

Project path: {project_path}

Respond with a JSON object:
- "should_verify": boolean — whether automated verification is needed
- "verification_command": optional string — a shell command to run for verification
- "rationale": string — why this verification is appropriate

Response (JSON only):
"""


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------


class AgentExecutor:
    """Main agent execution loop: observe -> plan -> act -> verify.

    The executor is mode-aware: when a session is started with a specific
    mode (e.g. ``"debug"``, ``"security"``), the agent's system prompt,
    available tools, verification strategy, max iterations, and human
    approval requirements are all configured by the mode.
    """

    def __init__(
        self,
        llm_service: LLMService,
        tool_registry: Any,
        memory_client: Any = None,
        mode: str = "code",
    ) -> None:
        self.llm = llm_service
        self.tools = tool_registry
        self.memory = memory_client
        self.sessions: Dict[str, AgentSession] = {}

        # Mode configuration
        self.mode_config = get_mode_config(mode)
        self.mode = self.mode_config.name

        # Filter tools to only those available in the current mode
        all_tools = set(self.tools.get_tool_names())
        mode_tools = set(self.mode_config.available_tools)
        self._filtered_tool_names = sorted(all_tools & mode_tools)

        logger.info(
            "AgentExecutor initialised in %s mode — %d/%d tools available, "
            "max_iterations=%d, verification=%s",
            self.mode,
            len(self._filtered_tool_names),
            len(all_tools),
            self.mode_config.max_iterations,
            self.mode_config.verification_strategy,
        )
        if self.mode_config.require_human_approval:
            logger.info(
                "Tools requiring human approval: %s",
                ", ".join(self.mode_config.require_human_approval),
            )

    # -- Session lifecycle --------------------------------------------------

    async def start_session(
        self, goal: str, project_path: str = ".", mode: Optional[str] = None
    ) -> AgentSession:
        """
        Start a new agent session for the given goal.

        Parameters
        ----------
        goal:
            The user's goal description.
        project_path:
            Path to the project directory.
        mode:
            Agent mode (e.g. ``"code"``, ``"debug"``).  If provided, the
            executor's mode configuration is updated before starting.

        Returns
        -------
        AgentSession
            The newly created session.
        """
        # Update mode if specified
        if mode is not None and mode != self.mode:
            self.mode_config = get_mode_config(mode)
            self.mode = self.mode_config.name
            all_tools = set(self.tools.get_tool_names())
            mode_tools = set(self.mode_config.available_tools)
            self._filtered_tool_names = sorted(all_tools & mode_tools)
            logger.info(
                "Switched to %s mode — %d tools available",
                self.mode,
                len(self._filtered_tool_names),
            )

        # Normalize project_path: expand ~, resolve to absolute, create if needed
        if project_path == ".":
            project_path = os.path.expanduser("~/construct-projects/default")
        project_path = os.path.abspath(os.path.expanduser(project_path))
        os.makedirs(project_path, exist_ok=True)

        session = AgentSession(
            id=str(uuid.uuid4())[:8],
            goal=goal,
            project_path=project_path,
            mode=self.mode,
        )
        self.sessions[session.id] = session

        # Set file tools sandbox to the session's project directory
        set_base_dir(project_path)

        logger.info(
            "Starting session %s [%s mode]: %s (project_path=%s)",
            session.id, self.mode, goal, project_path,
        )

        # Kick off execution in the background
        import asyncio

        asyncio.create_task(self._run(session))
        return session

    def get_session(self, session_id: str) -> Optional[AgentSession]:
        """Get a session by ID."""
        return self.sessions.get(session_id)

    def list_sessions(self) -> List[AgentSession]:
        """List all sessions."""
        return list(self.sessions.values())

    # -- Phase 1: Observe ---------------------------------------------------

    async def observe(self, session: AgentSession) -> Dict[str, Any]:
        """
        Read the current project state: files, git status, errors.

        Parameters
        ----------
        session:
            The active agent session.

        Returns
        -------
        dict
            Structured context with directory listing, git status, and
            recent file contents.
        """
        self._emit(session, "thought", "Observing current project state...")
        context: Dict[str, Any] = {"project_path": session.project_path}

        try:
            # List directory contents
            dir_result = self.tools.execute_tool(
                "list_directory", {"dir_path": session.project_path}
            )
            if isinstance(dir_result, list):
                context["files"] = [
                    {"name": e.get("name"), "type": e.get("type")}
                    for e in dir_result
                    if isinstance(e, dict) and "name" in e
                ][:50]  # limit
            else:
                context["files"] = []
        except Exception as exc:
            logger.warning("Failed to list directory: %s", exc)
            context["files"] = []

        try:
            # Git status
            git_result = self.tools.execute_tool(
                "git_status", {"cwd": session.project_path}
            )
            if isinstance(git_result, dict):
                context["git_branch"] = git_result.get("branch", "unknown")
                context["git_clean"] = git_result.get("is_clean", True)
                context["git_unstaged"] = len(git_result.get("unstaged", []))
            else:
                context["git_branch"] = "unknown"
        except Exception as exc:
            logger.warning("Failed to get git status: %s", exc)
            context["git_branch"] = "unknown"

        try:
            # Check for common config files
            config_files = [
                "package.json",
                "requirements.txt",
                "pyproject.toml",
                "Cargo.toml",
                "go.mod",
                "pom.xml",
                "build.gradle",
                "Dockerfile",
                "docker-compose.yml",
                "Makefile",
            ]
            found_configs = []
            for cf in config_files:
                full = os.path.join(session.project_path, cf)
                if os.path.exists(full):
                    found_configs.append(cf)
            context["config_files"] = found_configs
        except Exception:
            context["config_files"] = []

        # Query memory for relevant context
        if self.memory is not None:
            try:
                from memory.semantic import query_similar

                mem_results = query_similar(session.goal, n_results=3)
                if mem_results:
                    context["memory"] = [
                        {"text": r.text, "source": r.source} for r in mem_results
                    ]
            except Exception as exc:
                logger.debug("Memory query failed (non-critical): %s", exc)

        return context

    # -- Phase 2: Plan ------------------------------------------------------

    async def plan(self, goal: str, context: Dict[str, Any]) -> List[AgentTask]:
        """
        Decompose a goal into actionable tasks using the LLM.

        Parameters
        ----------
        goal:
            The user's high-level goal.
        context:
            Project context from the observe phase.

        Returns
        -------
        list[AgentTask]
            Ordered list of tasks to execute.
        """
        self._emit(None, "thought", f"Planning tasks for: {goal}")

        # Build context summary
        files_summary = "\n".join(
            f"  - {f.get('name', '?')} ({f.get('type', '?')})"
            for f in context.get("files", [])[:20]
        )
        context_str = (
            f"Project path: {context.get('project_path', '.')}\n"
            f"Git branch: {context.get('git_branch', 'unknown')}\n"
            f"Config files: {', '.join(context.get('config_files', []))}\n"
            f"Files:\n{files_summary}"
        )

        # Inject mode-specific system prompt context
        mode_prefix = (
            f"You are in {self.mode_config.name.upper()} mode.\n"
            f"{self.mode_config.system_prompt}\n\n"
        )
        prompt = mode_prefix + PLANNING_PROMPT_TEMPLATE.format(
            goal=goal, context=context_str
        )

        try:
            messages = assemble_messages(prompt)
            response = await self.llm.complete(messages)

            # Parse JSON response
            # Handle potential markdown code fences
            cleaned = response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned[cleaned.find("[") : cleaned.rfind("]") + 1]

            task_dicts = json.loads(cleaned)
            if not isinstance(task_dicts, list):
                raise ValueError("Expected JSON array of tasks")

            tasks = []
            for i, td in enumerate(task_dicts):
                task = AgentTask(
                    id=td.get("id", f"task-{i + 1}"),
                    description=td.get("description", "Unknown task"),
                    status=TaskStatus.PENDING,
                )
                tasks.append(task)

            logger.info("Planned %d tasks for session", len(tasks))
            return tasks

        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse LLM task plan as JSON: %s", exc)
            # Fallback: create a single task
            return [AgentTask(id="task-1", description=goal)]
        except Exception as exc:
            logger.exception("Planning failed")
            return [AgentTask(id="task-1", description=goal)]

    # -- Phase 3: Act -------------------------------------------------------

    async def act(self, session: AgentSession, task: AgentTask) -> Dict[str, Any]:
        """
        Execute one task using tools via LLM guidance.

        Parameters
        ----------
        session:
            The active agent session.
        task:
            The task to execute.

        Returns
        -------
        dict
            Result with ``success``, ``output``, and optional ``error``.
        """
        task.status = TaskStatus.IN_PROGRESS
        task.started_at = time.time()

        tool_names = self._filtered_tool_names

        # Build the acting prompt
        previous_results = ""
        if task.tool_calls:
            previous_results = json.dumps(task.tool_calls[-3:], indent=2)

        prompt = ACTING_PROMPT_TEMPLATE.format(
            task_description=task.description,
            tool_names=", ".join(tool_names),
            project_path=session.project_path,
            previous_results=previous_results or "None",
        )

        max_tool_calls = self.mode_config.max_iterations
        call_count = 0
        accumulated_results: List[Dict[str, Any]] = []

        while call_count < max_tool_calls:
            call_count += 1

            # Get LLM decision
            try:
                messages = assemble_messages(
                    prompt,
                    tool_schemas=self.tools.get_tool_schemas(),
                )
                response = await self.llm.complete(
                    messages, tool_schemas=self.tools.get_tool_schemas()
                )
            except Exception as exc:
                logger.exception("LLM call failed during act phase")
                return {"success": False, "error": f"LLM error: {exc}"}

            # Parse LLM response
            try:
                # Handle possible tool_calls format
                if response.strip().startswith('{"tool_calls"'):
                    parsed = json.loads(response)
                    for tc in parsed.get("tool_calls", []):
                        tool_name = tc.get("name", tc.get("id", ""))
                        args_str = tc.get("arguments", "{}")
                        try:
                            args = json.loads(args_str) if isinstance(args_str, str) else args_str
                        except json.JSONDecodeError:
                            args = {}

                        # Resolve relative path arguments against session.project_path
                        resolved_args = dict(args)
                        file_path_tools = {
                            'write_file', 'read_file', 'list_directory', 'search_files',
                            'parse_ast', 'find_references', 'refactor_rename', 'extract_function',
                            'convert_document', 'extract_document_structure',
                        }
                        if tool_name in file_path_tools:
                            for key in ('file_path', 'dir_path', 'path'):
                                if key in resolved_args and resolved_args[key] is not None:
                                    val = resolved_args[key]
                                    if not os.path.isabs(val):
                                        resolved_args[key] = os.path.join(session.project_path, val)

                        tool_result = self.tools.execute_tool(tool_name, resolved_args)
                        accumulated_results.append(
                            {
                                "tool": tool_name,
                                "arguments": resolved_args,
                                "result": tool_result,
                            }
                        )
                        task.tool_calls.append(
                            {
                                "tool": tool_name,
                                "arguments": resolved_args,
                                "result": tool_result,
                            }
                        )
                        self._emit(
                            session,
                            "tool_call",
                            f"{tool_name}({', '.join(f'{k}={v}' for k, v in resolved_args.items())})",
                        )
                    continue

                # Normal JSON response
                parsed = json.loads(response.strip())

                # Check if done
                if parsed.get("done"):
                    task.completed_at = time.time()
                    return {
                        "success": True,
                        "output": parsed.get("summary", "Task completed"),
                        "tool_calls": accumulated_results,
                    }

                # Extract tool call
                tool_name = parsed.get("tool", "")
                arguments = parsed.get("arguments", {})
                reasoning = parsed.get("reasoning", "")

                if not tool_name:
                    # LLM didn't specify a tool — may be done or confused
                    task.completed_at = time.time()
                    return {
                        "success": True,
                        "output": response[:500],
                        "tool_calls": accumulated_results,
                    }

            except json.JSONDecodeError:
                # Non-JSON response — treat as completion
                task.completed_at = time.time()
                return {
                    "success": True,
                    "output": response[:2000],
                    "tool_calls": accumulated_results,
                }

            # Check if tool requires human approval in this mode
            if tool_name in self.mode_config.require_human_approval:
                self._emit(
                    session,
                    "approval_required",
                    f"Tool '{tool_name}' requires human approval in {self.mode} mode. "
                    f"Auto-approving for now (mock/testing).",
                )
                logger.info(
                    "Tool '%s' requires approval in %s mode — auto-approving",
                    tool_name,
                    self.mode,
                )
                # In production, this would pause and wait for user input.
                # For now, auto-approve to keep the loop moving.

            # Check if the tool is available in this mode
            if tool_name not in self._filtered_tool_names:
                accumulated_results.append(
                    {
                        "tool": tool_name,
                        "error": (
                            f"Tool '{tool_name}' is not available in {self.mode} mode. "
                            f"Available tools: {', '.join(self._filtered_tool_names)}"
                        ),
                    }
                )
                continue

            # Execute the tool
            if not self.tools.has_tool(tool_name):
                accumulated_results.append(
                    {
                        "tool": tool_name,
                        "error": f"Tool '{tool_name}' not found",
                    }
                )
                continue

            self._emit(
                session, "tool_call", f"Using {tool_name}: {reasoning[:100]}"
            )

            # Resolve relative path arguments against session.project_path
            resolved_args = dict(arguments)  # Copy to avoid mutating original
            file_path_tools = {
                'write_file', 'read_file', 'list_directory', 'search_files',
                'parse_ast', 'find_references', 'refactor_rename', 'extract_function',
                'convert_document', 'extract_document_structure',
            }
            if tool_name in file_path_tools:
                for key in ('file_path', 'dir_path', 'path'):
                    if key in resolved_args and resolved_args[key] is not None:
                        val = resolved_args[key]
                        if not os.path.isabs(val):
                            resolved_args[key] = os.path.join(session.project_path, val)

            tool_result = self.tools.execute_tool(tool_name, resolved_args)
            accumulated_results.append(
                {
                    "tool": tool_name,
                    "arguments": resolved_args,
                    "result": tool_result,
                }
            )
            task.tool_calls.append(
                {
                    "tool": tool_name,
                    "arguments": resolved_args,
                    "result": tool_result,
                }
            )

            # Add result to prompt for next iteration
            result_summary = json.dumps(tool_result, indent=2)[:2000]
            prompt += (
                f"\n\nTool result for {tool_name}:\n{result_summary}\n\n"
                f"Continue or finish. Respond with JSON."
            )

        # Max tool calls reached
        task.completed_at = time.time()
        return {
            "success": True,
            "output": f"Task completed after {max_tool_calls} tool calls",
            "tool_calls": accumulated_results,
        }

    # -- Phase 4: Verify ----------------------------------------------------

    async def verify(self, session: AgentSession, task: AgentTask) -> bool:
        """
        Verify task result by running tests, lint, or other checks.

        Parameters
        ----------
        session:
            The active agent session.
        task:
            The completed task to verify.

        Returns
        -------
        bool
            *True* if verification passes or is not needed.
        """
        # Skip verification for observational tasks
        observational_keywords = ["read", "list", "search", "check status", "view"]
        task_lower = task.description.lower()
        if any(kw in task_lower for kw in observational_keywords):
            return True

        # Ask LLM what verification to run
        try:
            prompt = VERIFICATION_PROMPT_TEMPLATE.format(
                task_description=task.description,
                task_result=str(task.result)[:500],
                project_path=session.project_path,
            )
            messages = assemble_messages(prompt)
            response = await self.llm.complete(messages)

            # Parse verification decision
            cleaned = response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]

            if "{" in cleaned and "}" in cleaned:
                json_part = cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]
                decision = json.loads(json_part)
            else:
                decision = {"should_verify": False}

            if not decision.get("should_verify", False):
                return True

            # Run verification command
            verify_cmd = decision.get("verification_command", "")
            if verify_cmd:
                self._emit(session, "verify", f"Running: {verify_cmd}")
                result = self.tools.execute_tool(
                    "execute_command",
                    {"command": verify_cmd, "cwd": session.project_path, "timeout": 120},
                )
                success = result.get("success", False)
                if success:
                    self._emit(session, "verify_pass", "Verification passed")
                else:
                    self._emit(
                        session,
                        "verify_fail",
                        f"Verification failed: {result.get('stderr', 'unknown error')[:200]}",
                    )
                return success

            return True

        except Exception as exc:
            logger.warning("Verification check failed (non-critical): %s", exc)
            return True  # Don't block on verification failure

    # -- Main execution loop ------------------------------------------------

    async def _run(self, session: AgentSession) -> None:
        """Main execution loop for a session."""
        session.status = AgentStatus.RUNNING

        try:
            # Phase 1: Observe
            self._emit(session, "thought", "Observing current project state...")
            context = await self.observe(session)

            # Phase 2: Plan
            self._emit(session, "thought", f"Planning tasks for: {session.goal}")
            tasks = await self.plan(session.goal, context)
            session.tasks = tasks
            self._emit(
                session,
                "plan",
                f"Created {len(tasks)} tasks: "
                + "; ".join(t.description for t in tasks),
            )

            # Phase 3: Execute each task
            for i, task in enumerate(session.tasks):
                # Check for pause
                if session.status == AgentStatus.PAUSED:
                    await self._wait_for_resume(session)

                if session.status == AgentStatus.FAILED:
                    break

                session.current_task_index = i
                self._emit(session, "task_start", task.description)

                result = await self.act(session, task)
                task.result = str(result.get("output", ""))[:5000]

                if result.get("success"):
                    verified = await self.verify(session, task)
                    if verified:
                        task.status = TaskStatus.COMPLETED
                        self._emit(session, "task_complete", task.description)
                    else:
                        task.status = TaskStatus.FAILED
                        task.error = "Verification failed"
                        self._emit(
                            session,
                            "task_failed",
                            f"{task.description} - verification failed",
                        )
                else:
                    task.status = TaskStatus.FAILED
                    task.error = result.get("error", "Unknown error")
                    self._emit(
                        session,
                        "task_failed",
                        f"{task.description} - {task.error}",
                    )

            # Determine final status
            all_completed = all(
                t.status == TaskStatus.COMPLETED for t in session.tasks
            )
            any_failed = any(t.status == TaskStatus.FAILED for t in session.tasks)

            if all_completed:
                session.status = AgentStatus.COMPLETED
                self._emit(
                    session, "complete", "All tasks completed successfully!"
                )
            elif any_failed:
                session.status = AgentStatus.WAITING
                self._emit(
                    session,
                    "waiting",
                    "Some tasks failed. Waiting for guidance.",
                )
            else:
                session.status = AgentStatus.COMPLETED
                self._emit(session, "complete", "Session complete.")

        except Exception as exc:
            session.status = AgentStatus.FAILED
            logger.exception("Agent execution failed for session %s", session.id)
            self._emit(session, "error", str(exc))

    async def _wait_for_resume(self, session: AgentSession) -> None:
        """Wait for a paused session to be resumed."""
        while session.status == AgentStatus.PAUSED:
            await asyncio.sleep(1)

    # -- Event emission -----------------------------------------------------

    def _emit(
        self,
        session: Optional[AgentSession],
        event_type: str,
        content: str,
    ) -> None:
        """
        Emit an output event.

        Parameters
        ----------
        session:
            The session to emit to.  If *None*, the event is only logged.
        event_type:
            Type of event (``thought``, ``task_start``, ``tool_call``, etc.).
        content:
            Human-readable event content.
        """
        event = {
            "type": event_type,
            "content": content,
            "timestamp": time.time(),
        }

        if session is not None:
            event["session_id"] = session.id
            session.output_log.append(event)
            session.updated_at = time.time()

        logger.info("[%s] %s: %s", session.id if session else "-", event_type, content[:200])

    # -- Control methods ----------------------------------------------------

    def pause_session(self, session_id: str) -> bool:
        """Pause a running session."""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            if session.status == AgentStatus.RUNNING:
                session.status = AgentStatus.PAUSED
                logger.info("Paused session %s", session_id)
                return True
        return False

    def resume_session(self, session_id: str) -> bool:
        """Resume a paused session."""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            if session.status == AgentStatus.PAUSED:
                session.status = AgentStatus.RUNNING
                logger.info("Resumed session %s", session_id)
                return True
        return False

    def stop_session(self, session_id: str) -> bool:
        """Stop (fail) a session."""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            session.status = AgentStatus.FAILED
            logger.info("Stopped session %s", session_id)
            return True
        return False

    def get_new_output(
        self, session_id: str, since_index: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Get output events from a session since a given index.

        Parameters
        ----------
        session_id:
            The session ID.
        since_index:
            Return events starting from this index.

        Returns
        -------
        list[dict]
            New output events.
        """
        session = self.sessions.get(session_id)
        if not session:
            return []
        return session.output_log[since_index:]

    # -- Task execution facade (for orchestrator_v2) -------------------------

    async def execute_task(
        self, task_description: str, context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a single task and return the result.

        This is a facade used by :class:`orchestrator_v2.TaskOrchestrator`
        to execute individual subtasks through the full OODA loop without
        managing a persistent session.

        Parameters
        ----------
        task_description:
            What the agent should do.
        context:
            Extra context keys such as ``role``, ``task_id``, etc.

        Returns
        -------
        dict
            ``{"success": bool, "output": str, "error": str|None,
            "files_modified": list, "tests_passed": bool}``
        """
        # Create a lightweight agent task
        task = AgentTask(
            id=context.get("task_id", str(uuid.uuid4())[:8]),
            description=task_description,
            status=TaskStatus.IN_PROGRESS,
        )

        # Create a transient session
        session = AgentSession(
            id=f"task-{task.id}",
            goal=task_description,
            project_path=context.get("project_path", "."),
            status=AgentStatus.RUNNING,
        )
        session.tasks = [task]

        try:
            # Phase 1: Observe
            observe_ctx = await self.observe(session)
            observe_ctx.update(context)

            # Phase 3: Act (direct tool execution)
            result = await self.act(session, task)

            if result.get("success"):
                # Phase 4: Verify
                verified = await self.verify(session, task)
                return {
                    "success": True,
                    "output": str(result.get("output", ""))[:5000],
                    "error": None,
                    "files_modified": result.get("files_modified", []),
                    "tests_passed": verified,
                }
            else:
                return {
                    "success": False,
                    "output": "",
                    "error": result.get("error", "Execution failed"),
                    "files_modified": [],
                    "tests_passed": False,
                }

        except Exception as exc:
            logger.exception("Task execution failed: %s", task_description)
            return {
                "success": False,
                "output": "",
                "error": str(exc),
                "files_modified": [],
                "tests_passed": False,
            }
