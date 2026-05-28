"""
Background Worker — Autonomous agent execution engine.

Runs as a persistent process, manages:
- Goal queue (multiple goals, prioritised by deadline/importance)
- Task scheduler (what to work on next)
- Checkpoint manager (save/resume state every 5 min + after each task)
- Resource monitor (CPU, memory, disk — throttle if overloaded)
- Error recovery (retry with exponential backoff, escalate to user)
- Notification service (native OS notifications via Tauri)

Usage::

    worker = BackgroundWorker(
        agent_executor=executor,
        checkpoint_manager=checkpoint_mgr,
        safety_monitor=safety,
        resource_monitor=resources,
        notification_service=notifier,
    )
    await worker.start()   # blocks until stop() is called
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import random
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CHECKPOINT_INTERVAL_S: int = 300       # 5 minutes
RESOURCE_CHECK_INTERVAL_S: int = 30    # 30 seconds
ERROR_BACKOFF_BASE_S: float = 5.0      # first retry after 5s
ERROR_BACKOFF_MAX_S: float = 300.0     # max 5 min between retries
ERROR_BACKOFF_MULTIPLIER: float = 2.0  # exponential factor
GOAL_POLL_INTERVAL_S: int = 5          # sleep when no goals
ERROR_MAX_RETRIES: int = 10            # max retries before escalation
SESSION_POLL_INTERVAL_S: int = 10      # poll session status every 10s


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class GoalPriority(Enum):
    """Priority levels for queued goals."""

    CRITICAL = 0  # e.g. "Fix production bug"
    HIGH = 1      # e.g. "Implement feature needed for release"
    NORMAL = 2    # e.g. "Refactor code"
    LOW = 3       # e.g. "Add documentation"


class WorkerStatus(Enum):
    """Operational status of the background worker."""

    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    THROTTLED = "throttled"
    ERROR = "error"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class QueuedGoal:
    """A single goal waiting in the worker's queue."""

    id: str
    description: str
    priority: GoalPriority
    deadline: Optional[float]           # Unix timestamp, None = no deadline
    project_path: str
    created_at: float
    status: str = "queued"              # queued | active | completed | failed
    session_id: Optional[str] = None
    progress_percent: float = 0.0
    error: Optional[str] = None
    retries: int = 0
    started_at: Optional[float] = None
    completed_at: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a plain dictionary."""
        return {
            "id": self.id,
            "description": self.description,
            "priority": self.priority.value,
            "priority_name": self.priority.name,
            "deadline": self.deadline,
            "project_path": self.project_path,
            "created_at": self.created_at,
            "status": self.status,
            "session_id": self.session_id,
            "progress_percent": self.progress_percent,
            "error": self.error,
            "retries": self.retries,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }


# ---------------------------------------------------------------------------
# Goal Queue
# ---------------------------------------------------------------------------


class GoalQueue:
    """Priority queue for agent goals with deadline awareness.

    Sort order:
    1. Priority (CRITICAL first)
    2. Deadline (earliest first; no deadline = low priority)
    3. Creation time (FIFO for ties)
    """

    def __init__(self) -> None:
        self._goals: List[QueuedGoal] = []
        self._lock = asyncio.Lock()

    # -- Public API ------------------------------------------------------------

    async def add_goal(
        self,
        description: str,
        priority: GoalPriority = GoalPriority.NORMAL,
        deadline: Optional[float] = None,
        project_path: str = ".",
    ) -> str:
        """Add a new goal to the queue.  Returns the generated goal ID."""
        goal_id = _short_id()
        goal = QueuedGoal(
            id=goal_id,
            description=description,
            priority=priority,
            deadline=deadline,
            project_path=project_path,
            created_at=time.time(),
        )
        async with self._lock:
            self._goals.append(goal)
            logger.info(
                "Goal %s added (priority=%s, deadline=%s): %s",
                goal_id, priority.name, deadline, description[:80],
            )
        return goal_id

    async def next_goal(self) -> Optional[QueuedGoal]:
        """Return the highest-priority goal that should be worked on next."""
        async with self._lock:
            candidates = [g for g in self._goals if g.status == "queued"]
            if not candidates:
                return None

            # Sort by priority, deadline, created_at
            def sort_key(g: QueuedGoal) -> tuple:
                deadline_sort = g.deadline if g.deadline is not None else float("inf")
                return (g.priority.value, deadline_sort, g.created_at)

            candidates.sort(key=sort_key)
            chosen = candidates[0]
            chosen.status = "active"
            chosen.started_at = time.time()
            return chosen

    async def complete_goal(self, goal_id: str) -> None:
        """Mark a goal as completed."""
        async with self._lock:
            goal = self._find(goal_id)
            if goal is not None:
                goal.status = "completed"
                goal.completed_at = time.time()
                goal.progress_percent = 100.0
                logger.info("Goal %s completed: %s", goal_id, goal.description[:80])

    async def fail_goal(self, goal_id: str, error: str) -> None:
        """Mark a goal as failed and store the error reason."""
        async with self._lock:
            goal = self._find(goal_id)
            if goal is not None:
                goal.status = "failed"
                goal.error = error
                goal.completed_at = time.time()
                goal.retries += 1
                logger.warning("Goal %s failed: %s", goal_id, error[:200])

    async def retry_goal(self, goal_id: str) -> bool:
        """Reset a failed goal back to queued for retry.  Returns *True* if reset."""
        async with self._lock:
            goal = self._find(goal_id)
            if goal is not None and goal.retries < ERROR_MAX_RETRIES:
                goal.status = "queued"
                goal.session_id = None
                goal.progress_percent = 0.0
                goal.error = None
                logger.info("Goal %s queued for retry #%d", goal_id, goal.retries)
                return True
            return False

    async def update_progress(self, goal_id: str, percent: float) -> None:
        """Update the progress percentage for an active goal."""
        async with self._lock:
            goal = self._find(goal_id)
            if goal is not None:
                goal.progress_percent = max(0.0, min(100.0, percent))

    async def list_goals(self) -> List[QueuedGoal]:
        """Return a snapshot of all goals (copies) ordered by priority."""
        async with self._lock:
            return sorted(
                self._goals,
                key=lambda g: (g.priority.value, g.created_at),
            )

    async def remove_goal(self, goal_id: str) -> bool:
        """Permanently remove a goal from the queue.  Returns *True* if found."""
        async with self._lock:
            goal = self._find(goal_id)
            if goal is not None:
                self._goals.remove(goal)
                logger.info("Goal %s removed from queue", goal_id)
                return True
            return False

    async def get_goal(self, goal_id: str) -> Optional[QueuedGoal]:
        """Get a single goal by ID."""
        async with self._lock:
            return self._find(goal_id)

    # -- Internal helpers ------------------------------------------------------

    def _find(self, goal_id: str) -> Optional[QueuedGoal]:
        """Find a goal by ID (must hold ``_lock``)."""
        for g in self._goals:
            if g.id == goal_id:
                return g
        return None

    @property
    def size(self) -> int:
        """Current number of goals in the queue (thread-unsafe — use in controlled contexts)."""
        return len(self._goals)


# ---------------------------------------------------------------------------
# Resource Monitor
# ---------------------------------------------------------------------------


class ResourceMonitor:
    """Monitor system resources and throttle the agent when overloaded.

    Uses ``psutil`` for cross-platform CPU and memory metrics.
    """

    def __init__(
        self,
        max_cpu_percent: float = 30.0,
        max_memory_mb: float = 2048.0,
        max_disk_percent: float = 95.0,
    ) -> None:
        self.max_cpu = max_cpu_percent
        self.max_memory = max_memory_mb
        self.max_disk = max_disk_percent
        self._throttled = False
        self._last_check: float = 0.0
        self._cached: Dict[str, Any] = {}

    # -- Public API ------------------------------------------------------------

    def check_resources(self) -> Dict[str, Any]:
        """Return current resource usage snapshot.

        Returns
        -------
        dict
            ``cpu_percent``, ``memory_mb``, ``memory_percent``, ``disk_percent``,
            ``throttled``.
        """
        try:
            import psutil
        except ImportError:  # pragma: no cover
            logger.warning("psutil not installed — resource monitoring disabled")
            return {
                "cpu_percent": 0.0,
                "memory_mb": 0.0,
                "memory_percent": 0.0,
                "disk_percent": 0.0,
                "throttled": False,
            }

        # CPU over 1-second interval
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage("/")

        result: Dict[str, Any] = {
            "cpu_percent": round(cpu_percent, 1),
            "memory_mb": round(memory.used / (1024 * 1024), 1),
            "memory_percent": round(memory.percent, 1),
            "disk_percent": round(disk.percent, 1),
            "throttled": False,
        }

        result["throttled"] = self._is_overloaded(result)
        self._throttled = result["throttled"]
        self._last_check = time.time()
        self._cached = result.copy()
        return result

    def should_throttle(self) -> bool:
        """Return *True* if the agent should pause to save resources.

        Uses cached data if the last check was < *RESOURCE_CHECK_INTERVAL_S* ago.
        """
        if time.time() - self._last_check > RESOURCE_CHECK_INTERVAL_S:
            self.check_resources()
        return self._throttled

    def wait_if_throttled(self) -> None:
        """Blocking synchronous wait until resources are available again."""
        while True:
            resources = self.check_resources()
            if not resources["throttled"]:
                self._throttled = False
                logger.info("Resources recovered — resuming work")
                break
            logger.debug(
                "Throttled: CPU=%s%% Mem=%sMB Disk=%s%% — waiting 10s",
                resources["cpu_percent"],
                resources["memory_mb"],
                resources["disk_percent"],
            )
            time.sleep(10)

    async def async_wait_if_throttled(self) -> None:
        """Asynchronous wait until resources are available."""
        while True:
            resources = self.check_resources()
            if not resources["throttled"]:
                self._throttled = False
                logger.info("Resources recovered — resuming work")
                break
            logger.debug(
                "Throttled: CPU=%s%% Mem=%sMB Disk=%s%% — waiting 10s",
                resources["cpu_percent"],
                resources["memory_mb"],
                resources["disk_percent"],
            )
            await asyncio.sleep(10)

    # -- Internal helpers ------------------------------------------------------

    def _is_overloaded(self, resources: Dict[str, Any]) -> bool:
        """Determine whether any resource exceeds its threshold."""
        if resources["cpu_percent"] > self.max_cpu:
            logger.debug(
                "CPU throttled: %.1f%% > %.1f%%", resources["cpu_percent"], self.max_cpu
            )
            return True
        if resources["memory_mb"] > self.max_memory:
            logger.debug(
                "Memory throttled: %.1fMB > %.1fMB",
                resources["memory_mb"], self.max_memory,
            )
            return True
        if resources["disk_percent"] > self.max_disk:
            logger.debug(
                "Disk throttled: %.1f%% > %.1f%%",
                resources["disk_percent"], self.max_disk,
            )
            return True
        return False


# ---------------------------------------------------------------------------
# Background Worker
# ---------------------------------------------------------------------------


class BackgroundWorker:
    """Main background worker that runs the agent continuously.

    Parameters
    ----------
    agent_executor:
        An ``AgentExecutor`` instance (from ``core.executor``).
    checkpoint_manager:
        A ``CheckpointManager`` instance (from ``core.checkpoint``).
    safety_monitor:
        A ``SafetyMonitor`` instance (from ``core.safety``).
    resource_monitor:
        A ``ResourceMonitor`` instance.
    notification_service:
        A ``NotificationService`` instance (from ``core.notifications``).
    """

    def __init__(
        self,
        agent_executor: Any,
        checkpoint_manager: Any,
        safety_monitor: Any,
        resource_monitor: ResourceMonitor,
        notification_service: Any,
    ) -> None:
        self.executor = agent_executor
        self.checkpointer = checkpoint_manager
        self.safety = safety_monitor
        self.resources = resource_monitor
        self.notifications = notification_service
        self.queue = GoalQueue()
        self.status = WorkerStatus.IDLE
        self._current_goal: Optional[QueuedGoal] = None
        self._stop_event = asyncio.Event()
        self._error_retry_count: int = 0
        self._last_checkpoint_time: float = 0.0
        self._total_goals_completed: int = 0
        self._total_goals_failed: int = 0
        self._task: Optional[asyncio.Task[None]] = None

    # -- Lifecycle -------------------------------------------------------------

    async def start(self) -> None:
        """Start the background worker loop — blocks until :meth:`stop` is called."""
        if self._task is not None and not self._task.done():
            logger.warning("Worker already running")
            return

        self._stop_event.clear()
        self.status = WorkerStatus.RUNNING
        self._task = asyncio.create_task(self._main_loop())
        logger.info("Background worker started")

    async def stop(self) -> None:
        """Signal the worker to stop gracefully."""
        logger.info("Stop signal received — shutting down worker...")
        self._stop_event.set()

        # Pause any active session
        if self._current_goal and self._current_goal.session_id:
            try:
                self.executor.pause_session(self._current_goal.session_id)
                logger.info("Paused active session %s during shutdown", self._current_goal.session_id)
            except Exception:
                pass

        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=30.0)
            except asyncio.TimeoutError:
                logger.warning("Worker did not stop within 30s — forcing cancel")
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            except Exception:
                pass

        self.status = WorkerStatus.IDLE
        self._current_goal = None
        logger.info("Background worker stopped")

    async def pause(self) -> None:
        """Pause the worker and the current active session."""
        if self.status != WorkerStatus.RUNNING:
            return
        self.status = WorkerStatus.PAUSED
        if self._current_goal and self._current_goal.session_id:
            self.executor.pause_session(self._current_goal.session_id)
        logger.info("Worker paused")

    async def resume(self) -> None:
        """Resume the worker and the current active session."""
        if self.status not in (WorkerStatus.PAUSED, WorkerStatus.THROTTLED, WorkerStatus.ERROR):
            return
        self.status = WorkerStatus.RUNNING
        if self._current_goal and self._current_goal.session_id:
            self.executor.resume_session(self._current_goal.session_id)
        logger.info("Worker resumed")

    # -- Status ----------------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        """Return current worker status for the UI."""
        return {
            "status": self.status.value,
            "current_goal": (
                {
                    "id": self._current_goal.id,
                    "description": self._current_goal.description,
                    "progress_percent": self._current_goal.progress_percent,
                    "session_id": self._current_goal.session_id,
                    "priority": self._current_goal.priority.name,
                    "status": self._current_goal.status,
                }
                if self._current_goal
                else None
            ),
            "queue_size": self.queue.size,
            "goals_completed": self._total_goals_completed,
            "goals_failed": self._total_goals_failed,
            "error_retries": self._error_retry_count,
        }

    # -- Internal loop ---------------------------------------------------------

    async def _main_loop(self) -> None:
        """Core worker loop — handles goal scheduling, execution, and recovery."""
        while not self._stop_event.is_set():
            try:
                # ---- 1. Resource check ----------------------------------------
                if self.resources.should_throttle():
                    self.status = WorkerStatus.THROTTLED
                    await self.resources.async_wait_if_throttled()
                    if self._stop_event.is_set():
                        break
                    self.status = WorkerStatus.RUNNING

                # ---- 2. Check for pause ---------------------------------------
                if self.status == WorkerStatus.PAUSED:
                    await asyncio.sleep(1)
                    continue

                # ---- 3. Get next goal -----------------------------------------
                goal = await self.queue.next_goal()
                if goal is None:
                    await self._sleep_interruptible(GOAL_POLL_INTERVAL_S)
                    continue

                self._current_goal = goal
                self._error_retry_count = 0
                logger.info("Working on goal %s: %s", goal.id, goal.description)

                # ---- 4. Notify start ------------------------------------------
                try:
                    await self.notifications.send(
                        title="Construct Agent",
                        body=f"Started: {goal.description}",
                    )
                except Exception as exc:
                    logger.warning("Notification failed (non-critical): %s", exc)

                # ---- 5. Execute via agent executor ----------------------------
                await self._execute_goal(goal)

                # ---- 6. Post-execution ----------------------------------------
                await self._post_execution(goal)

            except asyncio.CancelledError:
                logger.info("Worker loop cancelled")
                break
            except Exception as exc:
                await self._handle_error(exc)

        logger.info("Background worker loop exited")

    # -- Goal execution --------------------------------------------------------

    async def _execute_goal(self, goal: QueuedGoal) -> None:
        """Execute a single goal through the agent executor."""
        session = await self.executor.start_session(
            goal=goal.description,
            project_path=goal.project_path,
        )
        goal.session_id = session.id
        self._last_checkpoint_time = time.time()

        # Monitor session progress
        while session.status.value in ("running", "paused", "waiting"):
            if self._stop_event.is_set():
                break

            # Periodic checkpoint
            if time.time() - self._last_checkpoint_time > CHECKPOINT_INTERVAL_S:
                try:
                    await self.checkpointer.save_checkpoint(session)
                    self._last_checkpoint_time = time.time()
                    await self.notifications.send_checkpoint_saved(
                        progress_percent=goal.progress_percent,
                    )
                except Exception as exc:
                    logger.warning("Checkpoint save failed: %s", exc)

            # Safety check
            try:
                safety_result = await self.safety.check(session)
                if safety_result.should_pause:
                    await self._handle_safety_pause(goal, session, safety_result)
            except Exception as exc:
                logger.warning("Safety check failed (non-critical): %s", exc)

            # Update progress estimate
            total_tasks = max(len(session.tasks), 1)
            completed_tasks = sum(
                1 for t in session.tasks if t.status.value == "completed"
            )
            goal.progress_percent = (completed_tasks / total_tasks) * 100.0
            await self.queue.update_progress(goal.id, goal.progress_percent)

            await asyncio.sleep(SESSION_POLL_INTERVAL_S)

    async def _post_execution(self, goal: QueuedGoal) -> None:
        """Handle completion / failure of a goal's session."""
        session = self.executor.get_session(goal.session_id) if goal.session_id else None
        if session is None:
            logger.warning("Session %s not found for post-execution", goal.session_id)
            await self.queue.fail_goal(goal.id, "Session not found")
            return

        # Save final checkpoint
        try:
            await self.checkpointer.save_checkpoint(session)
        except Exception as exc:
            logger.warning("Final checkpoint save failed: %s", exc)

        if session.status.value == "completed":
            await self.queue.complete_goal(goal.id)
            self._total_goals_completed += 1
            await self.notifications.send_task_complete(goal.description)
            logger.info("Goal %s completed successfully", goal.id)

        elif session.status.value == "failed":
            if goal.retries < ERROR_MAX_RETRIES:
                ok = await self.queue.retry_goal(goal.id)
                if ok:
                    await self.notifications.send_error_recovered(
                        error=f"Goal failed, retrying ({goal.retries}/{ERROR_MAX_RETRIES})",
                        retry_count=goal.retries,
                    )
            else:
                await self.queue.fail_goal(goal.id, "Max retries exceeded")
                self._total_goals_failed += 1
                await self.notifications.send_human_needed(
                    reason=f"Goal failed after {ERROR_MAX_RETRIES} retries: {goal.description}",
                )

        elif session.status.value in ("paused", "waiting"):
            # Worker was paused — goal remains active
            goal.status = "queued"  # will be picked up again on resume
            logger.info("Goal %s re-queued (worker paused)", goal.id)

        self._current_goal = None

    async def _handle_safety_pause(
        self,
        goal: QueuedGoal,
        session: Any,
        safety_result: Any,
    ) -> None:
        """Handle a safety-triggered pause."""
        self.executor.pause_session(session.id)
        self.status = WorkerStatus.PAUSED
        logger.warning(
            "Safety pause triggered for goal %s: %s", goal.id, safety_result.reason
        )

        await self.notifications.send_human_needed(
            reason=f"{safety_result.reason} [severity={safety_result.severity}]",
        )

        # Wait for resume (poll)
        wait_start = time.time()
        while self.status == WorkerStatus.PAUSED:
            if self._stop_event.is_set():
                break

            # Auto-resume after timeout
            elapsed = time.time() - wait_start
            auto_resume = getattr(self.safety, "RESUME_TIMEOUT", 1800)
            if elapsed > auto_resume:
                logger.info("Auto-resuming after safety timeout (%.0fs)", elapsed)
                await self.resume()
                break

            await asyncio.sleep(5)

    async def _handle_error(self, exc: Exception) -> None:
        """Handle an exception in the main loop with exponential backoff."""
        self._error_retry_count += 1
        delay = min(
            ERROR_BACKOFF_BASE_S * (ERROR_BACKOFF_MULTIPLIER ** (self._error_retry_count - 1)),
            ERROR_BACKOFF_MAX_S,
        )
        # Add jitter to prevent thundering herd
        delay = delay * (0.8 + random.random() * 0.4)

        logger.exception(
            "Background worker error (retry %d/%d): sleeping %.1fs",
            self._error_retry_count, ERROR_MAX_RETRIES, delay,
        )

        self.status = WorkerStatus.ERROR

        # Notify on escalation (every few retries)
        if self._error_retry_count % 3 == 0:
            try:
                await self.notifications.send_error_recovered(
                    error=str(exc), retry_count=self._error_retry_count,
                )
            except Exception:
                pass

        await self._sleep_interruptible(delay)

        # Reset to running if we're not stopped
        if not self._stop_event.is_set():
            self.status = WorkerStatus.RUNNING

    async def _sleep_interruptible(self, seconds: float) -> None:
        """Sleep that can be interrupted by the stop event."""
        try:
            await asyncio.wait_for(
                self._stop_event.wait(), timeout=seconds,
            )
        except asyncio.TimeoutError:
            pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _short_id() -> str:
    """Generate a short unique identifier (8 hex chars)."""
    return uuid.uuid4().hex[:8]