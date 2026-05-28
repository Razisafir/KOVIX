"""Task Orchestrator V2 — auto-decomposes goals, assigns agents, tracks dependencies.

Features:
- Auto-decompose goals into subtasks using LLM or rule-based fallback
- Assign subtasks to best agent based on role + current load
- Detect dependencies (Task B can't start until Task A completes)
- Parallel execution where possible
- Retry failed tasks with different agent or strategy
- Critical path analysis for bottleneck detection

Example::

    orch = TaskOrchestrator(llm_service=None, max_parallel=3)
    tasks = orch.decompose_goal("Build a REST API with auth and tests")
    for t in tasks:
        orch.add_task(t)
    results = asyncio.run(orch.execute_parallel(list(orch.tasks.values())))
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    """Lifecycle states for a subtask."""

    PENDING = "pending"
    READY = "ready"  # Dependencies resolved, ready to execute
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class SubTask:
    """A unit of work within a larger goal.

    Attributes:
        id: Unique task identifier (UUID4 hex).
        description: Human-readable description of what to do.
        role_required: Agent role capable of executing this task
            (e.g. ``"code"``, ``"security"``, ``"test"``, ``"docs"``).
        dependencies: List of task IDs that must complete before this
            task can start.
        status: Current lifecycle state.
        assigned_agent: ID of the agent currently assigned, if any.
        result: Output / artefact produced by the task, if completed.
        error: Error message if the task failed.
        attempts: Number of execution attempts so far.
        max_attempts: Maximum retry attempts before permanent failure.
        created_at: Unix timestamp when the task was created.
        started_at: Unix timestamp when execution began, if started.
        completed_at: Unix timestamp when execution finished, if done.
        priority: Priority from 1 (urgent) to 10 (low).
    """

    id: str
    description: str
    role_required: str  # e.g., "code", "security", "test"
    dependencies: List[str] = field(default_factory=list)  # task IDs
    status: TaskStatus = TaskStatus.PENDING
    assigned_agent: Optional[str] = None
    result: Optional[str] = None
    error: Optional[str] = None
    attempts: int = 0
    max_attempts: int = 3
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    priority: int = 5  # 1=urgent, 10=low

    @property
    def duration_ms(self) -> Optional[int]:
        """Return execution duration in milliseconds, if known."""
        if self.started_at is not None and self.completed_at is not None:
            return int((self.completed_at - self.started_at) * 1000)
        return None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a dictionary."""
        return {
            "id": self.id,
            "description": self.description,
            "role_required": self.role_required,
            "dependencies": self.dependencies,
            "status": self.status.value,
            "assigned_agent": self.assigned_agent,
            "result": self.result,
            "error": self.error,
            "attempts": self.attempts,
            "max_attempts": self.max_attempts,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "priority": self.priority,
            "duration_ms": self.duration_ms,
        }


@dataclass
class RecoveryPlan:
    """Describes how to recover from a failed task.

    Attributes:
        strategy: Recovery strategy name.  One of:
            ``"retry_same_agent"``, ``"retry_different_agent"``,
            ``"split_task"``, ``"escalate"``.
        agent_id: Optional agent to assign for the retry.
        reason: Human-readable explanation of the recovery decision.
        delay_seconds: Seconds to wait before retrying.
    """

    strategy: str  # "retry_same_agent", "retry_different_agent", "split_task", "escalate"
    agent_id: Optional[str] = None
    reason: str = ""
    delay_seconds: int = 0


class TaskOrchestrator:
    """Orchestrates complex multi-agent task execution.

    The orchestrator accepts a high-level goal, decomposes it into
    :class:`SubTask` objects, resolves dependencies, assigns each task
    to the most suitable agent, and executes tasks in parallel where
    possible while respecting the dependency graph.

    Attributes:
        llm_service: Optional external LLM client for goal decomposition.
        max_parallel: Maximum number of concurrent task executions.
        tasks: Registry of all known tasks keyed by task ID.
        _lock: Async lock protecting ``tasks`` and internal state.
        _sem: Async semaphore limiting concurrent execution.
    """

    def __init__(
        self,
        llm_service: Optional[Any] = None,
        max_parallel: int = 5,
    ) -> None:
        self.llm_service = llm_service
        self.max_parallel = max_parallel
        self.tasks: Dict[str, SubTask] = {}
        self._lock = asyncio.Lock()
        self._sem = asyncio.Semaphore(max_parallel)
        self._agent_loads: Dict[str, int] = {}
        logger.info(
            "TaskOrchestrator initialized (max_parallel=%d)", max_parallel
        )

    # ------------------------------------------------------------------
    # Task registry helpers
    # ------------------------------------------------------------------

    def add_task(self, task: SubTask) -> None:
        """Register a task with the orchestrator.

        Args:
            task: The :class:`SubTask` to add.

        Raises:
            ValueError: If a task with the same ID already exists.
        """
        if task.id in self.tasks:
            raise ValueError(f"Task with id {task.id} already registered")
        self.tasks[task.id] = task
        logger.debug("Registered task %s: %s", task.id, task.description)

    def remove_task(self, task_id: str) -> Optional[SubTask]:
        """Remove and return a task from the registry.

        Args:
            task_id: ID of the task to remove.

        Returns:
            The removed task, or ``None`` if it did not exist.
        """
        return self.tasks.pop(task_id, None)

    def get_task(self, task_id: str) -> Optional[SubTask]:
        """Look up a task by ID."""
        return self.tasks.get(task_id)

    def reset(self) -> None:
        """Clear all tasks and agent load tracking."""
        self.tasks.clear()
        self._agent_loads.clear()
        logger.info("Orchestrator state reset")

    # ------------------------------------------------------------------
    # Goal decomposition
    # ------------------------------------------------------------------

    def decompose_goal(self, goal: str) -> List[SubTask]:
        """Decompose a goal into subtasks using LLM or rule-based fallback.

        If an *llm_service* was provided at construction time, this method
        will attempt LLM-based decomposition first.  If the LLM call fails
        or no service is configured, a rule-based heuristic is used that
        recognises common software-engineering keywords.

        Args:
            goal: Natural-language description of the high-level goal.

        Returns:
            A list of :class:`SubTask` objects with auto-detected
            dependencies.
        """
        if self.llm_service is not None:
            try:
                return self._decompose_with_llm(goal)
            except Exception:
                logger.exception("LLM decomposition failed; using fallback")

        return self._decompose_rule_based(goal)

    def _decompose_with_llm(self, goal: str) -> List[SubTask]:
        """Decompose a goal into subtasks using the LLM service.

        Falls back to rule-based decomposition if the LLM call fails
        or returns invalid JSON.
        """
        logger.info("Attempting LLM decomposition for goal: %s", goal)

        try:
            from core.llm_service import LLMService

            llm = LLMService()

            prompt = (
                f"Decompose this software development goal into subtasks.\n\n"
                f"Goal: {goal}\n\n"
                f"Return a JSON array of objects with these fields:\n"
                f"- id: unique task ID (task_0, task_1, ...)\n"
                f"- description: specific, actionable description\n"
                f"- role_required: one of [code, security, test, ui, devops, research, docs]\n"
                f"- dependencies: list of task IDs that must complete first\n\n"
                f"Rules:\n"
                f"- Order matters — earlier tasks run first\n"
                f"- Be specific, not generic\n"
                f"- Include testing and code review as separate subtasks\n"
                f"- Maximum 15 subtasks\n"
                f"- Return ONLY valid JSON, no markdown, no explanation"
            )

            response = asyncio.get_event_loop().run_until_complete(
                llm.complete(prompt, model="claude-sonnet-4-20250514")
            )

            # Extract JSON from response (handle markdown fences)
            raw = response.strip()
            if raw.startswith("```"):
                raw = raw.strip("`").strip()
                if raw.lower().startswith("json"):
                    raw = raw[4:].strip()

            tasks_data = json.loads(raw)
            subtasks: List[SubTask] = []

            for task_data in tasks_data:
                subtask = SubTask(
                    id=task_data["id"],
                    description=task_data["description"],
                    role_required=task_data.get("role_required", "code"),
                    dependencies=task_data.get("dependencies", []),
                )
                subtasks.append(subtask)

            # Validate: all dependency IDs must exist
            task_ids = {t.id for t in subtasks}
            for task in subtasks:
                for dep in task.dependencies:
                    if dep not in task_ids:
                        logger.warning(
                            "Removing dangling dependency %s from task %s",
                            dep, task.id,
                        )
                        task.dependencies = [d for d in task.dependencies if d in task_ids]

            self._detect_cycles(subtasks)
            logger.info("LLM decomposition produced %d subtasks", len(subtasks))
            return subtasks

        except Exception:
            logger.exception("LLM decomposition failed; using fallback")
            raise  # Let caller fall through to rule-based

    def _decompose_rule_based(self, goal: str) -> List[SubTask]:
        """Heuristic decomposition based on keyword matching.

        Recognises common software development phases and creates
        appropriately-typed subtasks with sensible dependencies.
        """
        goal_lower = goal.lower()
        tasks: List[SubTask] = []
        task_map: Dict[str, SubTask] = {}

        def _make(name: str, role: str, deps: List[str] = ()) -> SubTask:
            t = SubTask(
                id=f"task-{uuid.uuid4().hex[:8]}",
                description=name,
                role_required=role,
                dependencies=list(deps),
            )
            task_map[name] = t
            tasks.append(t)
            return t

        # Design phase
        if any(k in goal_lower for k in ("api", "architecture", "design", "system")):
            _make("Design API architecture", "architecture")

        # Database
        if any(k in goal_lower for k in ("database", "db", "model", "schema", "orm")):
            deps = [task_map["Design API architecture"].id] if "Design API architecture" in task_map else []
            _make("Define database schema and models", "code", deps)

        # Auth / security
        if any(k in goal_lower for k in ("auth", "login", "security", "token", "jwt")):
            deps = [task_map["Design API architecture"].id] if "Design API architecture" in task_map else []
            _make("Implement authentication and authorization", "security", deps)

        # Core implementation
        impl_deps: List[str] = []
        if "Define database schema and models" in task_map:
            impl_deps.append(task_map["Define database schema and models"].id)
        if "Implement authentication and authorization" in task_map:
            impl_deps.append(task_map["Implement authentication and authorization"].id)
        if "Design API architecture" in task_map and not impl_deps:
            impl_deps.append(task_map["Design API architecture"].id)

        _make("Implement core business logic and endpoints", "code", impl_deps)

        # Tests
        test_deps = [task_map["Implement core business logic and endpoints"].id]
        if "Implement authentication and authorization" in task_map:
            test_deps.append(task_map["Implement authentication and authorization"].id)
        _make("Write unit and integration tests", "test", test_deps)

        # Review
        review_deps = [task_map["Implement core business logic and endpoints"].id]
        if "Write unit and integration tests" in task_map:
            review_deps.append(task_map["Write unit and integration tests"].id)
        _make("Code review and quality audit", "security", review_deps)

        # Documentation
        docs_deps: List[str] = []
        if "Implement core business logic and endpoints" in task_map:
            docs_deps.append(task_map["Implement core business logic and endpoints"].id)
        _make("Write documentation and README", "docs", docs_deps)

        logger.info(
            "Rule-based decomposition produced %d tasks for goal: %s",
            len(tasks),
            goal,
        )
        return tasks

    # ------------------------------------------------------------------
    # Task assignment
    # ------------------------------------------------------------------

    def assign_task(
        self,
        task: SubTask,
        available_agents: List[Dict[str, Any]],
    ) -> str:
        """Assign *task* to the best agent based on role match and load.

        Each agent dict should contain at minimum:

        - ``"id"`` (*str*): unique agent identifier
        - ``"roles"`` (*List[str]*): roles the agent can fulfil
        - ``"current_load"`` (*int*, optional): number of tasks currently
          assigned (defaults to 0)

        The scoring function prefers:

        1. Exact role match.
        2. Lowest current load (tie-breaker).
        3. First available agent (final tie-breaker).

        Args:
            task: The task to assign.
            available_agents: Candidate agents for the assignment.

        Returns:
            The ID of the selected agent.

        Raises:
            ValueError: If no agents are available.
        """
        if not available_agents:
            raise ValueError("No available agents for task assignment")

        best_agent: Optional[str] = None
        best_score = (-1, 0, float("inf"))  # (role_match, neg_load, index)

        for idx, agent in enumerate(available_agents):
            agent_id = agent["id"]
            roles: List[str] = agent.get("roles", [])
            load: int = agent.get("current_load", self._agent_loads.get(agent_id, 0))

            role_match = 1 if task.role_required in roles else 0
            score = (role_match, -load, idx)

            if score > best_score:
                best_score = score
                best_agent = agent_id

        if best_agent is None:
            # Fallback: assign to first agent regardless of role
            best_agent = available_agents[0]["id"]
            logger.warning(
                "No role match for task %s (required: %s); assigning to %s",
                task.id,
                task.role_required,
                best_agent,
            )

        task.assigned_agent = best_agent
        self._agent_loads[best_agent] = self._agent_loads.get(best_agent, 0) + 1
        logger.info(
            "Assigned task %s (%s) to agent %s",
            task.id,
            task.description,
            best_agent,
        )
        return best_agent

    # ------------------------------------------------------------------
    # Execution engine
    # ------------------------------------------------------------------

    async def execute_parallel(
        self,
        tasks: List[SubTask],
        agent_executor: Optional[Callable[[SubTask], Any]] = None,
    ) -> Dict[str, Any]:
        """Execute tasks respecting dependencies, parallel where possible.

        A topological sort determines execution order.  Tasks with no
        remaining uncompleted dependencies are eligible to run
        concurrently, subject to :attr:`max_parallel`.

        Args:
            tasks: The list of tasks to execute.  All tasks must already
                be registered via :meth:`add_task`.
            agent_executor: Optional async callable that actually runs a
                task.  Receives a :class:`SubTask` and should mutate it
                in-place (setting ``result``, ``status``, etc.).  If not
                provided, a placeholder executor is used.

        Returns:
            Summary dictionary with keys ``completed``, ``failed``,
            ``results``, and ``elapsed_ms``.
        """
        if agent_executor is None:
            agent_executor = self._default_executor

        # Build dependency graph
        graph = self._build_dependency_graph(tasks)
        in_degree = self._compute_in_degrees(graph)

        # Track which tasks are done
        completed_ids: Set[str] = set()
        failed_ids: Set[str] = set()
        pending = list(tasks)

        start_time = time.time()

        for task in pending:
            if task.status not in (TaskStatus.COMPLETED, TaskStatus.FAILED):
                task.status = TaskStatus.PENDING

        logger.info("Starting parallel execution of %d tasks", len(tasks))

        while pending:
            # Find tasks that are ready (all deps completed)
            ready = [
                t for t in pending
                if t.status == TaskStatus.PENDING
                and all(d in completed_ids for d in t.dependencies)
            ]

            if not ready:
                # Check for deadlock: pending tasks but none ready
                stuck = [
                    t for t in pending
                    if t.status != TaskStatus.RUNNING
                    and any(d in failed_ids for d in t.dependencies)
                ]
                if stuck:
                    for t in stuck:
                        t.status = TaskStatus.FAILED
                        t.error = "Dependency task failed"
                        failed_ids.add(t.id)
                    pending = [t for t in pending if t.id not in failed_ids]
                    continue

                running = [t for t in pending if t.status == TaskStatus.RUNNING]
                if running:
                    # Wait a bit for running tasks to complete
                    await asyncio.sleep(0.1)
                    continue
                else:
                    logger.error("Dependency deadlock detected")
                    break

            # Sort ready tasks by priority (lower number = higher priority)
            ready.sort(key=lambda t: t.priority)

            # Launch ready tasks concurrently up to semaphore limit
            async def _run_one(task: SubTask) -> None:
                async with self._sem:
                    task.status = TaskStatus.RUNNING
                    task.started_at = time.time()
                    task.attempts += 1
                    logger.debug("Starting task %s", task.id)
                    try:
                        await asyncio.wait_for(
                            self._ensure_async(agent_executor, task),
                            timeout=300,
                        )
                        if task.status != TaskStatus.FAILED:
                            task.status = TaskStatus.COMPLETED
                            task.completed_at = time.time()
                            task.result = task.result or "completed"
                            completed_ids.add(task.id)
                            logger.info("Task %s completed", task.id)
                    except asyncio.TimeoutError:
                        task.status = TaskStatus.FAILED
                        task.error = "Execution timed out after 300s"
                        task.completed_at = time.time()
                        failed_ids.add(task.id)
                        logger.error("Task %s timed out", task.id)
                    except Exception as exc:
                        task.status = TaskStatus.FAILED
                        task.error = str(exc)
                        task.completed_at = time.time()
                        failed_ids.add(task.id)
                        logger.exception("Task %s failed", task.id)

            # Launch as many as we can (semaphore controls actual concurrency)
            await asyncio.gather(*[_run_one(t) for t in ready])
            pending = [t for t in pending if t.id not in completed_ids | failed_ids]

        elapsed_ms = int((time.time() - start_time) * 1000)
        summary = {
            "completed": len(completed_ids),
            "failed": len(failed_ids),
            "results": {
                tid: self.tasks[tid].to_dict()
                for tid in (completed_ids | failed_ids)
                if tid in self.tasks
            },
            "elapsed_ms": elapsed_ms,
        }
        logger.info(
            "Execution finished in %d ms: %d completed, %d failed",
            elapsed_ms,
            summary["completed"],
            summary["failed"],
        )
        return summary

    @staticmethod
    async def _default_executor(task: SubTask) -> None:
        """Execute a task using the real agent executor and tool system.

        Connects to LLMService and AgentExecutor from the core module.
        Publishes progress updates on the context bus when available.
        """
        import time

        start_time = time.time()
        task.status = TaskStatus.IN_PROGRESS
        task.started_at = start_time

        try:
            from core.executor import AgentExecutor
            from core.llm_service import LLMService
            from tools import ToolRegistry

            llm = LLMService()
            tools = ToolRegistry()
            executor = AgentExecutor(llm_service=llm, tool_registry=tools)

            context = {
                "task": task.description,
                "role": task.role_required,
                "task_id": task.id,
            }

            result = await asyncio.wait_for(
                executor.execute_task(task.description, context),
                timeout=300,
            )

            duration_ms = int((time.time() - start_time) * 1000)

            if result.get("success"):
                task.status = TaskStatus.COMPLETED
                task.result = result.get("output", "")
                task.completed_at = time.time()
                logger.info(
                    "Task %s completed by %s in %dms",
                    task.id, task.role_required, duration_ms,
                )
            else:
                task.status = TaskStatus.FAILED
                task.error = result.get("error", "Unknown error")
                task.completed_at = time.time()
                logger.warning(
                    "Task %s failed: %s", task.id, task.error,
                )

        except asyncio.TimeoutError:
            task.status = TaskStatus.FAILED
            task.error = "Task timed out after 5 minutes"
            task.completed_at = time.time()
            logger.error("Task %s timed out after 300s", task.id)

        except Exception as exc:
            task.status = TaskStatus.FAILED
            task.error = str(exc)
            task.completed_at = time.time()
            logger.exception("Task %s failed with exception", task.id)

    @staticmethod
    def _build_dependency_graph(
        tasks: List[SubTask],
    ) -> Dict[str, List[str]]:
        """Build adjacency list: task -> list of tasks that depend on it."""
        graph: Dict[str, List[str]] = {t.id: [] for t in tasks}
        task_ids = {t.id for t in tasks}
        for task in tasks:
            for dep in task.dependencies:
                if dep in task_ids:
                    graph.setdefault(dep, []).append(task.id)
        return graph

    @staticmethod
    def _compute_in_degrees(
        graph: Dict[str, List[str]], tasks: Optional[List[SubTask]] = None
    ) -> Dict[str, int]:
        """Compute in-degree (number of dependencies) for each task."""
        in_degree: Dict[str, int] = {}
        if tasks:
            for t in tasks:
                in_degree[t.id] = len(t.dependencies)
        for node, neighbors in graph.items():
            in_degree.setdefault(node, 0)
            for n in neighbors:
                in_degree[n] = in_degree.get(n, 0)
        return in_degree

    @staticmethod
    def _ensure_async(
        executor: Callable[..., Any], task: SubTask
    ) -> Any:
        """Ensure the executor is called as an async operation.

        If *executor* is a sync function, run it in a thread pool.
        """
        result = executor(task)
        if asyncio.iscoroutine(result):
            return result
        if asyncio.isfuture(result):
            return result
        # Sync function — run in default executor (thread pool)
        loop = asyncio.get_running_loop()
        return loop.run_in_executor(None, executor, task)

    # ------------------------------------------------------------------
    # Dependency & scheduling queries
    # ------------------------------------------------------------------

    def get_ready_tasks(self) -> List[SubTask]:
        """Return tasks whose dependencies are all completed.

        A task is "ready" when:

        - Its status is :attr:`TaskStatus.PENDING`, and
        - Every task ID in its ``dependencies`` list has status
          :attr:`TaskStatus.COMPLETED`.

        Returns:
            List of ready :class:`SubTask` objects.
        """
        completed_ids = {
            t.id for t in self.tasks.values()
            if t.status == TaskStatus.COMPLETED
        }
        ready = []
        for task in self.tasks.values():
            if task.status != TaskStatus.PENDING:
                continue
            if all(dep in completed_ids for dep in task.dependencies):
                ready.append(task)
        return ready

    def get_critical_path(self) -> List[SubTask]:
        """Find the critical path (bottleneck chain) through tasks.

        Uses a simplified longest-path calculation on the dependency DAG.
        The critical path is the sequence of dependent tasks with the
        greatest cumulative estimated duration.

        Returns:
            Ordered list of :class:`SubTask` objects on the critical path.
        """
        if not self.tasks:
            return []

        # Build reverse mapping: task -> tasks it depends on (that exist)
        task_ids = set(self.tasks.keys())
        durations: Dict[str, int] = {}
        preds: Dict[str, List[str]] = {}

        for tid, task in self.tasks.items():
            durations[tid] = task.duration_ms or 50  # default 50ms estimate
            preds[tid] = [d for d in task.dependencies if d in task_ids]

        # Dynamic programming: longest path to each node
        longest: Dict[str, int] = {tid: 0 for tid in task_ids}
        parent: Dict[str, Optional[str]] = {tid: None for tid in task_ids}

        # Topological order via Kahn's algorithm
        in_degree = {tid: len(preds[tid]) for tid in task_ids}
        queue = deque([t for t in task_ids if in_degree[t] == 0])
        topo_order: List[str] = []

        while queue:
            node = queue.popleft()
            topo_order.append(node)
            for succ in self.tasks:
                if node in preds.get(succ, []):
                    in_degree[succ] -= 1
                    if in_degree[succ] == 0:
                        queue.append(succ)

        for node in topo_order:
            for succ in self.tasks:
                if node in preds.get(succ, []):
                    new_dist = longest[node] + durations[node]
                    if new_dist > longest[succ]:
                        longest[succ] = new_dist
                        parent[succ] = node

        # Find the end node with maximum total distance
        if not longest:
            return []
        end_node = max(longest, key=lambda k: longest[k])

        # Reconstruct path
        path: List[SubTask] = []
        node: Optional[str] = end_node
        while node is not None:
            path.append(self.tasks[node])
            node = parent[node]
        path.reverse()

        logger.debug("Critical path has %d tasks", len(path))
        return path

    # ------------------------------------------------------------------
    # Failure handling
    # ------------------------------------------------------------------

    def handle_failure(self, task: SubTask, error: str) -> RecoveryPlan:
        """Generate a recovery plan for a failed task.

        The strategy depends on how many attempts have already been made
        and whether the error looks transient or permanent.

        Args:
            task: The task that failed.
            error: The error message / exception string.

        Returns:
            A :class:`RecoveryPlan` describing the recovery action.
        """
        task.error = error
        task.attempts += 1

        # Determine if error is transient
        transient_markers = [
            "timeout", "connection", "temporarily", "rate limit",
            "503", "502", "500", "network",
        ]
        is_transient = any(m in error.lower() for m in transient_markers)

        if task.attempts < task.max_attempts:
            if is_transient:
                plan = RecoveryPlan(
                    strategy="retry_same_agent",
                    agent_id=task.assigned_agent,
                    reason=f"Transient error detected: {error}. Retrying same agent.",
                    delay_seconds=2 ** task.attempts,  # Exponential backoff
                )
            else:
                plan = RecoveryPlan(
                    strategy="retry_different_agent",
                    reason=f"Non-transient error: {error}. Trying different agent.",
                    delay_seconds=1,
                )
        elif task.attempts == task.max_attempts:
            plan = RecoveryPlan(
                strategy="split_task",
                reason="Max attempts reached. Splitting task into smaller subtasks.",
                delay_seconds=0,
            )
        else:
            plan = RecoveryPlan(
                strategy="escalate",
                reason="All recovery strategies exhausted. Escalating to human operator.",
                delay_seconds=0,
            )

        logger.info(
            "Recovery plan for task %s: strategy=%s, attempts=%d/%d",
            task.id,
            plan.strategy,
            task.attempts,
            task.max_attempts,
        )
        return plan

    async def apply_recovery(
        self, task: SubTask, plan: RecoveryPlan
    ) -> bool:
        """Apply a recovery plan to a failed task.

        Args:
            task: The failed task.
            plan: The recovery plan from :meth:`handle_failure`.

        Returns:
            ``True`` if recovery was initiated successfully.
        """
        if plan.delay_seconds > 0:
            logger.info(
                "Waiting %ds before recovery of task %s",
                plan.delay_seconds,
                task.id,
            )
            await asyncio.sleep(plan.delay_seconds)

        if plan.strategy == "retry_same_agent":
            task.status = TaskStatus.RETRYING
            task.error = None
            return True
        elif plan.strategy == "retry_different_agent":
            task.status = TaskStatus.RETRYING
            task.assigned_agent = None
            task.error = None
            return True
        elif plan.strategy == "split_task":
            task.status = TaskStatus.FAILED
            logger.warning("Task %s marked for splitting", task.id)
            return False
        else:  # escalate
            task.status = TaskStatus.FAILED
            logger.error("Task %s escalated to human operator", task.id)
            return False

    def get_progress(self) -> Dict[str, Any]:
        """Return a summary of overall task execution progress.

        Returns:
            Dictionary with counts per status and completion percentage.
        """
        counts: Dict[str, int] = {}
        for task in self.tasks.values():
            key = task.status.value
            counts[key] = counts.get(key, 0) + 1
        total = len(self.tasks)
        completed = counts.get(TaskStatus.COMPLETED.value, 0)
        pct = (completed / total * 100) if total > 0 else 0.0
        return {
            "total": total,
            "counts": counts,
            "completion_percentage": round(pct, 2),
            "critical_path_length": len(self.get_critical_path()),
        }


# ---------------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------------

async def _async_demo() -> None:
    """Demonstrate the TaskOrchestrator."""
    orch = TaskOrchestrator(llm_service=None, max_parallel=3)

    # Decompose a goal
    tasks = orch.decompose_goal("Build a REST API with auth and tests")
    print(f"Decomposed into {len(tasks)} tasks:")
    for t in tasks:
        print(f"  [{t.role_required}] {t.description} (deps: {t.dependencies})")
        orch.add_task(t)

    # Assign agents
    agents = [
        {"id": "arch-1", "roles": ["architecture"], "current_load": 0},
        {"id": "dev-1", "roles": ["code"], "current_load": 0},
        {"id": "dev-2", "roles": ["code", "test"], "current_load": 1},
        {"id": "sec-1", "roles": ["security"], "current_load": 0},
        {"id": "doc-1", "roles": ["docs"], "current_load": 0},
    ]
    for task in tasks:
        orch.assign_task(task, agents)

    print("\nAgent assignments:")
    for t in tasks:
        print(f"  {t.description} -> {t.assigned_agent}")

    # Show ready tasks (should be design/architecture first)
    ready = orch.get_ready_tasks()
    print(f"\nReady tasks: {len(ready)}")
    for r in ready:
        print(f"  - {r.description}")

    # Execute
    print("\n--- Executing ---")
    results = await orch.execute_parallel(tasks)
    print(f"Completed: {results['completed']}, Failed: {results['failed']}")
    print(f"Elapsed: {results['elapsed_ms']} ms")

    # Critical path
    cp = orch.get_critical_path()
    print(f"\nCritical path has {len(cp)} tasks:")
    for t in cp:
        print(f"  -> {t.description}")

    # Progress
    print(f"\nProgress: {orch.get_progress()}")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    print("=" * 60)
    print("TaskOrchestrator V2 Demo")
    print("=" * 60)
    asyncio.run(_async_demo())
