"""
Core package for the Construct AI agent backend.

Re-exports the main classes for convenient imports.

Usage::

    from core import LLMService, AgentExecutor, ToolRegistry, AgentSession
    from core import BackgroundWorker, CheckpointManager, SafetyMonitor
    from core import ResourceMonitor, NotificationService
"""

from core.llm_service import LLMService, LLMProvider, LLMConfig, Message
from core.executor import AgentExecutor, AgentSession, AgentTask, TaskStatus, AgentStatus
from core.background_worker import (
    BackgroundWorker,
    GoalQueue,
    GoalPriority,
    ResourceMonitor,
    QueuedGoal,
    WorkerStatus,
)
from core.checkpoint import CheckpointManager, Checkpoint, GitSnapshot, FileSnapshot
from core.safety import SafetyMonitor, SafetySettings, SafetyCheckResult
from core.notifications import NotificationService, Notification

__all__ = [
    # LLM Service
    "LLMService",
    "LLMProvider",
    "LLMConfig",
    "Message",
    # Executor
    "AgentExecutor",
    "AgentSession",
    "AgentTask",
    "TaskStatus",
    "AgentStatus",
    # Background Worker
    "BackgroundWorker",
    "GoalQueue",
    "GoalPriority",
    "ResourceMonitor",
    "QueuedGoal",
    "WorkerStatus",
    # Checkpoint
    "CheckpointManager",
    "Checkpoint",
    "GitSnapshot",
    "FileSnapshot",
    # Safety
    "SafetyMonitor",
    "SafetySettings",
    "SafetyCheckResult",
    # Notifications
    "NotificationService",
    "Notification",
]