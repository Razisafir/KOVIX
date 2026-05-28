"""
Notification Service — Send native OS notifications via Tauri.

The Rust / Tauri backend exposes a notification endpoint that this Python
service calls via HTTP POST to display native OS notifications.

If the Tauri endpoint is unavailable, notifications are queued to a local
JSONL file and delivered later when the connection is restored.

Storage layout::

    resources/
    └── notifications.jsonl   # local fallback queue

Usage::

    from core.notifications import NotificationService

    notifier = NotificationService(tauri_port=3000)
    await notifier.send(
        title="Construct Agent",
        body="Task completed!",
        actions=["approve", "dismiss"],
        urgency="normal",
    )
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_TAURI_PORT: int = 3000
DEFAULT_TAURI_HOST: str = "127.0.0.1"
NOTIFICATION_QUEUE_PATH: str = "resources/notifications.jsonl"
NOTIFICATION_RETENTION_COUNT: int = 100  # max recent notifications to keep

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class Notification:
    """A single notification message."""

    title: str
    body: str
    actions: List[str] = field(default_factory=list)
    urgency: str = "normal"     # low | normal | critical
    timestamp: float = field(default_factory=time.time)
    id: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "body": self.body,
            "actions": self.actions,
            "urgency": self.urgency,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Notification:
        return cls(
            id=data.get("id", ""),
            title=data.get("title", ""),
            body=data.get("body", ""),
            actions=data.get("actions", []),
            urgency=data.get("urgency", "normal"),
            timestamp=data.get("timestamp", time.time()),
        )


# ---------------------------------------------------------------------------
# Notification Service
# ---------------------------------------------------------------------------


class NotificationService:
    """Send notifications via Tauri or a local fallback queue.

    Parameters
    ----------
    tauri_host:
        Hostname / IP of the Tauri backend.
    tauri_port:
        HTTP port of the Tauri backend notification endpoint.
    queue_path:
        Local JSONL file path for the fallback queue.
    """

    def __init__(
        self,
        tauri_host: str = DEFAULT_TAURI_HOST,
        tauri_port: int = DEFAULT_TAURI_PORT,
        queue_path: str = NOTIFICATION_QUEUE_PATH,
    ) -> None:
        self._host = tauri_host
        self._port = tauri_port
        self._queue_path = Path(queue_path)
        self._queue_path.parent.mkdir(parents=True, exist_ok=True)
        self._recent: List[Notification] = []
        self._lock = asyncio.Lock()

    # -- Core API --------------------------------------------------------------

    async def send(
        self,
        title: str,
        body: str,
        actions: Optional[List[str]] = None,
        urgency: str = "normal",
    ) -> bool:
        """Send a notification.

        Attempts the Tauri HTTP endpoint first; on failure the notification
        is appended to the local queue for later delivery.

        Returns
        -------
        bool
            *True* if the notification was delivered (or queued).
        """
        notification = Notification(
            title=title,
            body=body,
            actions=actions or [],
            urgency=urgency,
            id=_short_id(),
        )

        # Try Tauri endpoint
        tauri_ok = await self._send_to_tauri(notification)

        # Always store locally for history / fallback
        await self._store_locally(notification)

        if not tauri_ok:
            logger.debug("Notification queued locally (Tauri unavailable)")

        return True

    async def send_task_complete(self, task_description: str) -> bool:
        """Preset: notify that a task has been completed."""
        return await self.send(
            title="Construct Agent — Task Complete",
            body=f"Completed: {task_description}",
            urgency="normal",
        )

    async def send_checkpoint_saved(self, progress_percent: float = 0.0) -> bool:
        """Preset: notify that a checkpoint was saved."""
        return await self.send(
            title="Construct Agent — Checkpoint",
            body=f"Progress saved: {progress_percent:.0f}%",
            urgency="low",
        )

    async def send_human_needed(self, reason: str) -> bool:
        """Preset: notify that human approval is required."""
        return await self.send(
            title="Construct Agent — Approval Needed",
            body=reason,
            actions=["approve", "dismiss", "review"],
            urgency="critical",
        )

    async def send_error_recovered(self, error: str, retry_count: int) -> bool:
        """Preset: notify that an error occurred but recovery is in progress."""
        return await self.send(
            title="Construct Agent — Error Recovery",
            body=f"Error (retry #{retry_count}): {error[:200]}",
            actions=["review", "dismiss"],
            urgency="high" if retry_count >= 5 else "normal",
        )

    async def get_recent(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Return the most recent notifications (from memory + disk).

        Parameters
        ----------
        limit:
            Maximum number of notifications to return.

        Returns
        -------
        list[dict]
            Notifications as dictionaries, most-recent first.
        """
        async with self._lock:
            # Combine in-memory recent + disk queue
            disk_notifications = self._read_disk_queue()

            # Merge and deduplicate by ID
            seen: set = set()
            merged: List[Notification] = []

            for n in self._recent + disk_notifications:
                if n.id not in seen:
                    seen.add(n.id)
                    merged.append(n)

            # Sort by timestamp descending
            merged.sort(key=lambda n: n.timestamp, reverse=True)
            return [n.to_dict() for n in merged[:limit]]

    # -- Tauri communication ---------------------------------------------------

    async def _send_to_tauri(self, notification: Notification) -> bool:
        """Attempt to POST the notification to the Tauri notification endpoint."""
        try:
            import aiohttp
        except ImportError:
            logger.debug("aiohttp not available — cannot send to Tauri")
            return False

        url = f"http://{self._host}:{self._port}/notification"
        payload = {
            "title": notification.title,
            "body": notification.body,
            "actions": notification.actions,
            "urgency": notification.urgency,
        }

        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as response:
                    if response.status in (200, 201, 204):
                        logger.debug("Notification sent to Tauri: %s", notification.title)
                        return True
                    else:
                        logger.debug(
                            "Tauri returned HTTP %d for notification", response.status,
                        )
                        return False
        except asyncio.TimeoutError:
            logger.debug("Tauri notification request timed out")
            return False
        except Exception as exc:
            logger.debug("Tauri notification failed: %s", exc)
            return False

    # -- Local fallback --------------------------------------------------------

    async def _store_locally(self, notification: Notification) -> None:
        """Append a notification to the local JSONL queue."""
        async with self._lock:
            self._recent.append(notification)
            # Trim in-memory cache
            if len(self._recent) > NOTIFICATION_RETENTION_COUNT:
                self._recent = self._recent[-NOTIFICATION_RETENTION_COUNT:]

            # Append to disk
            try:
                line = json.dumps(notification.to_dict(), default=str) + "\n"
                self._queue_path.write_text(
                    self._queue_path.read_text(encoding="utf-8") + line
                    if self._queue_path.exists()
                    else line,
                    encoding="utf-8",
                )
            except Exception as exc:
                logger.warning("Failed to write notification to disk: %s", exc)

    def _read_disk_queue(self) -> List[Notification]:
        """Read all notifications from the local JSONL file."""
        if not self._queue_path.exists():
            return []

        notifications: List[Notification] = []
        try:
            for line in self._queue_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    notifications.append(Notification.from_dict(data))
                except (json.JSONDecodeError, KeyError):
                    continue
        except Exception as exc:
            logger.warning("Failed to read notification queue: %s", exc)

        return notifications

    async def flush_queue(self) -> int:
        """Attempt to re-send all queued notifications to Tauri.

        Returns
        -------
        int
            Number of notifications successfully delivered.
        """
        disk_notifications = self._read_disk_queue()
        if not disk_notifications:
            return 0

        delivered = 0
        failed: List[Notification] = []

        for notification in disk_notifications:
            ok = await self._send_to_tauri(notification)
            if ok:
                delivered += 1
            else:
                failed.append(notification)

        # Rewrite queue with only failed items
        if failed:
            try:
                lines = ""
                for n in failed:
                    lines += json.dumps(n.to_dict(), default=str) + "\n"
                self._queue_path.write_text(lines, encoding="utf-8")
            except Exception as exc:
                logger.warning("Failed to rewrite notification queue: %s", exc)
        else:
            # All delivered — clear the file
            try:
                self._queue_path.unlink(missing_ok=True)
            except Exception:
                pass

        logger.info("Flushed %d/%d queued notifications", delivered, len(disk_notifications))
        return delivered

    async def clear_history(self) -> None:
        """Clear all notification history from memory and disk."""
        async with self._lock:
            self._recent.clear()
            try:
                self._queue_path.unlink(missing_ok=True)
            except Exception as exc:
                logger.warning("Failed to clear notification queue: %s", exc)

    def get_stats(self) -> Dict[str, Any]:
        """Return notification service statistics."""
        disk_count = 0
        if self._queue_path.exists():
            try:
                disk_count = len(
                    [l for l in self._queue_path.read_text(encoding="utf-8").splitlines() if l.strip()]
                )
            except Exception:
                pass

        return {
            "recent_in_memory": len(self._recent),
            "queued_on_disk": disk_count,
            "tauri_endpoint": f"http://{self._host}:{self._port}/notification",
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _short_id() -> str:
    """Generate a short unique identifier (8 hex chars)."""
    import secrets
    return secrets.token_hex(4)