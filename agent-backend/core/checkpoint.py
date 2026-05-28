"""
Checkpoint System — Save and resume agent session state.

Persists agent session snapshots to disk so execution can survive
process restarts, crashes, or intentional shutdowns.

Each checkpoint captures:
- Session metadata (ID, goal, status, timestamps)
- Task list with current progress
- Output log (last N events)
- File state hashes (to detect external changes)
- Git repository state

Storage layout::

    resources/
    └── checkpoints/
        ├── chk-{session_id}.json          # main checkpoint file
        ├── chk-{session_id}.files.json    # file hashes snapshot
        └── manifest.json                  # index of all checkpoints

Usage::

    from core.checkpoint import CheckpointManager

    mgr = CheckpointManager("resources/checkpoints")
    await mgr.save_checkpoint(session)
    restored = await mgr.load_checkpoint(session_id)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.executor import AgentSession, AgentTask, AgentStatus, TaskStatus

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_CHECKPOINT_DIR: str = "resources/checkpoints"
CHECKPOINT_VERSION: int = 1
MAX_OUTPUT_EVENTS_IN_CHECKPOINT: int = 500
MANIFEST_FILENAME: str = "manifest.json"
FILE_SNAPSHOT_SUFFIX: str = ".files.json"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class FileSnapshot:
    """Hash-based snapshot of a single file at a point in time."""

    path: str
    md5: str
    size: int
    mtime: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "md5": self.md5,
            "size": self.size,
            "mtime": self.mtime,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> FileSnapshot:
        return cls(
            path=data["path"],
            md5=data["md5"],
            size=data["size"],
            mtime=data["mtime"],
        )


@dataclass
class GitSnapshot:
    """Snapshot of git repository state."""

    branch: str
    commit: str
    is_clean: bool
    unstaged_count: int
    untracked_count: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "branch": self.branch,
            "commit": self.commit,
            "is_clean": self.is_clean,
            "unstaged_count": self.unstaged_count,
            "untracked_count": self.untracked_count,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> GitSnapshot:
        return cls(
            branch=data.get("branch", "unknown"),
            commit=data.get("commit", ""),
            is_clean=data.get("is_clean", True),
            unstaged_count=data.get("unstaged_count", 0),
            untracked_count=data.get("untracked_count", 0),
        )


@dataclass
class Checkpoint:
    """Full checkpoint of an agent session."""

    version: int = CHECKPOINT_VERSION
    session_id: str = ""
    goal: str = ""
    status: str = "idle"
    project_path: str = "."
    current_task_index: int = 0
    created_at: float = field(default_factory=time.time)
    saved_at: float = field(default_factory=time.time)
    tasks: List[Dict[str, Any]] = field(default_factory=list)
    output_log: List[Dict[str, Any]] = field(default_factory=list)
    git_state: Optional[GitSnapshot] = None
    file_hashes: Dict[str, str] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a JSON-friendly dictionary."""
        return {
            "version": self.version,
            "session_id": self.session_id,
            "goal": self.goal,
            "status": self.status,
            "project_path": self.project_path,
            "current_task_index": self.current_task_index,
            "created_at": self.created_at,
            "saved_at": self.saved_at,
            "tasks": self.tasks,
            "output_log": self.output_log,
            "git_state": self.git_state.to_dict() if self.git_state else None,
            "file_hashes": self.file_hashes,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Checkpoint:
        """Deserialise from a dictionary."""
        git_data = data.get("git_state")
        return cls(
            version=data.get("version", 1),
            session_id=data.get("session_id", ""),
            goal=data.get("goal", ""),
            status=data.get("status", "idle"),
            project_path=data.get("project_path", "."),
            current_task_index=data.get("current_task_index", 0),
            created_at=data.get("created_at", 0.0),
            saved_at=data.get("saved_at", 0.0),
            tasks=data.get("tasks", []),
            output_log=data.get("output_log", []),
            git_state=GitSnapshot.from_dict(git_data) if git_data else None,
            file_hashes=data.get("file_hashes", {}),
            metadata=data.get("metadata", {}),
        )


# ---------------------------------------------------------------------------
# File hashing utilities
# ---------------------------------------------------------------------------


def calculate_file_hash(file_path: str | Path) -> str:
    """Calculate the MD5 hash of a single file's contents.

    Returns
    -------
    str
        Hex-encoded MD5 digest, or "" if the file cannot be read.
    """
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return ""
    try:
        h = hashlib.md5()
        h.update(path.read_bytes())
        return h.hexdigest()
    except (OSError, PermissionError) as exc:
        logger.debug("Cannot hash %s: %s", file_path, exc)
        return ""


def calculate_file_hashes(
    dir_path: str | Path,
    ignore_patterns: Optional[List[str]] = None,
    max_files: int = 5000,
) -> Dict[str, str]:
    """Calculate MD5 hashes for all files under *dir_path*.

    Parameters
    ----------
    dir_path:
        Root directory to scan.
    ignore_patterns:
        List of path substrings to skip (e.g. ``node_modules``, ``.git``).
    max_files:
        Maximum number of files to hash before stopping.

    Returns
    -------
    dict[str, str]
        Mapping of relative file paths → MD5 hex digests.
    """
    if ignore_patterns is None:
        ignore_patterns = [
            ".git/", "__pycache__/", ".pytest_cache/", "node_modules/",
            ".venv/", "venv/", "*.pyc", ".DS_Store", ".idea/", ".vscode/",
        ]

    root = Path(dir_path).resolve()
    result: Dict[str, str] = {}
    count = 0

    for path in root.rglob("*"):
        if not path.is_file():
            continue

        rel = path.relative_to(root).as_posix()

        # Apply ignore patterns
        skip = False
        for pat in ignore_patterns:
            if pat.startswith("*"):
                if rel.endswith(pat[1:]):
                    skip = True
                    break
            elif pat in rel:
                skip = True
                break
        if skip:
            continue

        h = calculate_file_hash(path)
        if h:
            result[rel] = h
            count += 1

        if count >= max_files:
            logger.warning("File hash limit (%d) reached for %s", max_files, dir_path)
            break

    logger.debug("Hashed %d files in %s", count, dir_path)
    return result


def compare_file_hashes(
    old_hashes: Dict[str, str],
    new_hashes: Dict[str, str],
) -> Dict[str, List[str]]:
    """Compare two file-hash snapshots and report changes.

    Returns
    -------
    dict
        Keys: ``added``, ``removed``, ``modified`` — each a list of paths.
    """
    old_keys = set(old_hashes.keys())
    new_keys = set(new_hashes.keys())

    added = sorted(new_keys - old_keys)
    removed = sorted(old_keys - new_keys)
    modified = sorted(
        p for p in (old_keys & new_keys) if old_hashes[p] != new_hashes[p]
    )

    return {"added": added, "removed": removed, "modified": modified}


# ---------------------------------------------------------------------------
# Checkpoint Manager
# ---------------------------------------------------------------------------


class CheckpointManager:
    """Save and restore agent session checkpoints to disk.

    Parameters
    ----------
    checkpoint_dir:
        Directory where checkpoint files are stored.  Created automatically.
    """

    def __init__(self, checkpoint_dir: str = DEFAULT_CHECKPOINT_DIR) -> None:
        self._dir = Path(checkpoint_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._manifest_path = self._dir / MANIFEST_FILENAME

    # -- Public API ------------------------------------------------------------

    async def save_checkpoint(self, session: AgentSession) -> str:
        """Save a checkpoint for *session*.  Returns the checkpoint filename.

        The checkpoint is written atomically (temp file + rename) to avoid
        corruption if the process crashes mid-write.
        """
        async with self._lock:
            checkpoint = self._session_to_checkpoint(session)
            filename = self._checkpoint_filename(session.id)
            filepath = self._dir / filename

            # Write atomically
            tmp_path = filepath.with_suffix(".tmp")
            try:
                tmp_path.write_text(
                    json.dumps(checkpoint.to_dict(), indent=2, default=str),
                    encoding="utf-8",
                )
                tmp_path.replace(filepath)
            except Exception:
                if tmp_path.exists():
                    tmp_path.unlink(missing_ok=True)
                raise

            # Save separate file snapshot
            await self._save_file_snapshot(session)

            # Update manifest
            await self._update_manifest(checkpoint)

            logger.info(
                "Checkpoint saved for session %s (%d tasks, %d output events)",
                session.id,
                len(checkpoint.tasks),
                len(checkpoint.output_log),
            )
            return str(filepath)

    async def load_checkpoint(self, session_id: str) -> Optional[Checkpoint]:
        """Load a checkpoint by session ID.  Returns *None* if not found."""
        async with self._lock:
            filepath = self._dir / self._checkpoint_filename(session_id)
            if not filepath.exists():
                return None

            try:
                data = json.loads(filepath.read_text(encoding="utf-8"))
                checkpoint = Checkpoint.from_dict(data)
                logger.info("Checkpoint loaded for session %s", session_id)
                return checkpoint
            except (json.JSONDecodeError, KeyError, OSError) as exc:
                logger.error("Failed to load checkpoint %s: %s", session_id, exc)
                return None

    async def restore_session(self, session_id: str) -> Optional[AgentSession]:
        """Restore a full ``AgentSession`` from its checkpoint.

        Returns *None* if the checkpoint does not exist or is corrupt.
        """
        checkpoint = await self.load_checkpoint(session_id)
        if checkpoint is None:
            return None

        try:
            session = self._checkpoint_to_session(checkpoint)
            logger.info("Session %s restored from checkpoint", session_id)
            return session
        except Exception as exc:
            logger.error("Failed to restore session %s: %s", session_id, exc)
            return None

    async def list_checkpoints(self) -> List[Dict[str, Any]]:
        """List all available checkpoints with metadata.

        Returns
        -------
        list[dict]
            Each dict has ``session_id``, ``goal``, ``status``, ``saved_at``,
            ``task_count``, ``file_size``.
        """
        async with self._lock:
            manifest = self._read_manifest()
            entries: List[Dict[str, Any]] = []

            for entry in manifest.get("entries", []):
                session_id = entry.get("session_id", "")
                filepath = self._dir / self._checkpoint_filename(session_id)
                file_size = filepath.stat().st_size if filepath.exists() else 0
                entries.append({
                    "session_id": session_id,
                    "goal": entry.get("goal", ""),
                    "status": entry.get("status", "unknown"),
                    "saved_at": entry.get("saved_at", 0),
                    "task_count": entry.get("task_count", 0),
                    "file_size": file_size,
                })

            # Sort by most-recent first
            entries.sort(key=lambda e: e["saved_at"], reverse=True)
            return entries

    def has_checkpoint(self, session_id: str) -> bool:
        """Return *True* if a checkpoint exists for *session_id*."""
        filepath = self._dir / self._checkpoint_filename(session_id)
        return filepath.exists()

    async def get_latest_for_goal(self, goal_description: str) -> Optional[Checkpoint]:
        """Find the most recent checkpoint whose goal contains *goal_description*.

        The match is case-insensitive substring search on the goal text.
        """
        checkpoints = await self.list_checkpoints()
        goal_lower = goal_description.lower()

        for entry in checkpoints:
            if goal_lower in entry.get("goal", "").lower():
                return await self.load_checkpoint(entry["session_id"])

        # Fuzzy fallback: try each checkpoint individually for closer match
        for entry in checkpoints:
            cp = await self.load_checkpoint(entry["session_id"])
            if cp is None:
                continue
            # Simple word overlap check
            goal_words = set(goal_lower.split())
            cp_words = set(cp.goal.lower().split())
            if goal_words & cp_words:
                return cp

        return None

    async def delete_checkpoint(self, session_id: str) -> bool:
        """Remove the checkpoint file for *session_id*.  Returns *True* if deleted."""
        async with self._lock:
            filepath = self._dir / self._checkpoint_filename(session_id)
            deleted = False
            if filepath.exists():
                filepath.unlink()
                deleted = True

            # Also delete file snapshot
            snapshot_path = self._dir / f"chk-{session_id}{FILE_SNAPSHOT_SUFFIX}"
            if snapshot_path.exists():
                snapshot_path.unlink()

            if deleted:
                logger.info("Checkpoint deleted for session %s", session_id)
                await self._remove_from_manifest(session_id)

            return deleted

    async def get_file_changes(self, session_id: str, project_path: str) -> Dict[str, List[str]]:
        """Compare stored file hashes against the current filesystem state.

        Returns
        -------
        dict
            ``added``, ``removed``, ``modified`` file lists.
        """
        old_hashes = await self._load_file_snapshot(session_id)
        if not old_hashes:
            return {"added": [], "removed": [], "modified": []}

        new_hashes = calculate_file_hashes(project_path)
        return compare_file_hashes(old_hashes, new_hashes)

    async def cleanup_old_checkpoints(self, max_age_days: int = 7) -> int:
        """Delete checkpoints older than *max_age_days*.  Returns deletion count."""
        async with self._lock:
            cutoff = time.time() - (max_age_days * 86400)
            deleted = 0

            for entry in self._read_manifest().get("entries", []):
                if entry.get("saved_at", 0) < cutoff:
                    sid = entry.get("session_id", "")
                    filepath = self._dir / self._checkpoint_filename(sid)
                    if filepath.exists():
                        filepath.unlink()
                        deleted += 1
                    snapshot = self._dir / f"chk-{sid}{FILE_SNAPSHOT_SUFFIX}"
                    if snapshot.exists():
                        snapshot.unlink()

            # Rebuild manifest
            await self._rebuild_manifest()
            logger.info("Cleaned up %d old checkpoints", deleted)
            return deleted

    # -- Internal helpers ------------------------------------------------------

    @staticmethod
    def _checkpoint_filename(session_id: str) -> str:
        return f"chk-{session_id}.json"

    def _session_to_checkpoint(self, session: AgentSession) -> Checkpoint:
        """Convert an ``AgentSession`` into a ``Checkpoint``."""
        # Trim output log to prevent unbounded growth
        output_log = session.output_log[-MAX_OUTPUT_EVENTS_IN_CHECKPOINT:]

        # Try to get git state
        git_state = self._capture_git_state(session.project_path)

        # Capture file hashes
        file_hashes = calculate_file_hashes(session.project_path)

        return Checkpoint(
            session_id=session.id,
            goal=session.goal,
            status=session.status.value,
            project_path=session.project_path,
            current_task_index=session.current_task_index,
            created_at=session.created_at,
            saved_at=time.time(),
            tasks=[t.to_dict() for t in session.tasks],
            output_log=output_log,
            git_state=git_state,
            file_hashes=file_hashes,
            metadata={
                "task_summary": {
                    "total": len(session.tasks),
                    "pending": sum(1 for t in session.tasks if t.status == TaskStatus.PENDING),
                    "in_progress": sum(1 for t in session.tasks if t.status == TaskStatus.IN_PROGRESS),
                    "completed": sum(1 for t in session.tasks if t.status == TaskStatus.COMPLETED),
                    "failed": sum(1 for t in session.tasks if t.status == TaskStatus.FAILED),
                },
                "checkpoint_version": CHECKPOINT_VERSION,
            },
        )

    def _checkpoint_to_session(self, checkpoint: Checkpoint) -> AgentSession:
        """Restore an ``AgentSession`` from a ``Checkpoint``."""
        tasks = []
        for td in checkpoint.tasks:
            task = AgentTask(
                id=td.get("id", "unknown"),
                description=td.get("description", ""),
                status=TaskStatus(td.get("status", "pending")),
                tool_calls=td.get("tool_calls", []),
                result=td.get("result"),
                error=td.get("error"),
                started_at=td.get("started_at"),
                completed_at=td.get("completed_at"),
            )
            tasks.append(task)

        try:
            status_enum = AgentStatus(checkpoint.status)
        except ValueError:
            status_enum = AgentStatus.IDLE

        session = AgentSession(
            id=checkpoint.session_id,
            goal=checkpoint.goal,
            status=status_enum,
            tasks=tasks,
            current_task_index=checkpoint.current_task_index,
            output_log=checkpoint.output_log,
            created_at=checkpoint.created_at,
            updated_at=checkpoint.saved_at,
            project_path=checkpoint.project_path,
        )
        return session

    def _capture_git_state(self, project_path: str) -> Optional[GitSnapshot]:
        """Capture the current git state for *project_path*."""
        try:
            import subprocess
            cwd = Path(project_path).resolve()

            # Get branch
            result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=cwd, capture_output=True, text=True, timeout=10,
            )
            branch = result.stdout.strip() if result.returncode == 0 else "unknown"

            # Get commit
            result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=cwd, capture_output=True, text=True, timeout=10,
            )
            commit = result.stdout.strip() if result.returncode == 0 else ""

            # Get status counts
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=cwd, capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                lines = [l for l in result.stdout.splitlines() if l.strip()]
                unstaged = sum(1 for l in lines if l.startswith(" M") or l.startswith(" D"))
                untracked = sum(1 for l in lines if l.startswith("??"))
                is_clean = len(lines) == 0
            else:
                unstaged = 0
                untracked = 0
                is_clean = True

            return GitSnapshot(
                branch=branch,
                commit=commit,
                is_clean=is_clean,
                unstaged_count=unstaged,
                untracked_count=untracked,
            )
        except Exception as exc:
            logger.debug("Git snapshot failed (non-critical): %s", exc)
            return None

    async def _save_file_snapshot(self, session: AgentSession) -> None:
        """Save a separate file hash snapshot for the session."""
        snapshot_path = self._dir / f"chk-{session.id}{FILE_SNAPSHOT_SUFFIX}"
        hashes = calculate_file_hashes(session.project_path)
        try:
            snapshot_path.write_text(
                json.dumps(hashes, indent=2), encoding="utf-8",
            )
        except Exception as exc:
            logger.warning("File snapshot save failed: %s", exc)

    async def _load_file_snapshot(self, session_id: str) -> Dict[str, str]:
        """Load a previously saved file hash snapshot."""
        snapshot_path = self._dir / f"chk-{session_id}{FILE_SNAPSHOT_SUFFIX}"
        if not snapshot_path.exists():
            return {}
        try:
            return json.loads(snapshot_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("File snapshot load failed: %s", exc)
            return {}

    # -- Manifest management ---------------------------------------------------

    def _read_manifest(self) -> Dict[str, Any]:
        """Read the manifest file.  Returns empty dict if not present."""
        if not self._manifest_path.exists():
            return {"entries": []}
        try:
            return json.loads(self._manifest_path.read_text(encoding="utf-8"))
        except Exception:
            return {"entries": []}

    async def _update_manifest(self, checkpoint: Checkpoint) -> None:
        """Add or update an entry in the manifest for *checkpoint*."""
        manifest = self._read_manifest()
        entries = manifest.get("entries", [])

        # Remove existing entry for this session
        entries = [e for e in entries if e.get("session_id") != checkpoint.session_id]

        # Add new entry at the front
        entries.insert(0, {
            "session_id": checkpoint.session_id,
            "goal": checkpoint.goal,
            "status": checkpoint.status,
            "saved_at": checkpoint.saved_at,
            "task_count": len(checkpoint.tasks),
        })

        # Keep only last 100 entries
        entries = entries[:100]
        manifest["entries"] = entries
        manifest["updated_at"] = time.time()

        tmp = self._manifest_path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            tmp.replace(self._manifest_path)
        except Exception:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            raise

    async def _remove_from_manifest(self, session_id: str) -> None:
        """Remove an entry from the manifest."""
        manifest = self._read_manifest()
        manifest["entries"] = [
            e for e in manifest.get("entries", [])
            if e.get("session_id") != session_id
        ]
        tmp = self._manifest_path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            tmp.replace(self._manifest_path)
        except Exception:
            pass

    async def _rebuild_manifest(self) -> None:
        """Rebuild the manifest from existing checkpoint files on disk."""
        entries: List[Dict[str, Any]] = []
        for f in sorted(self._dir.glob("chk-*.json")):
            if f.name == MANIFEST_FILENAME:
                continue
            sid = f.stem.replace("chk-", "")
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                entries.append({
                    "session_id": sid,
                    "goal": data.get("goal", ""),
                    "status": data.get("status", "unknown"),
                    "saved_at": data.get("saved_at", 0),
                    "task_count": len(data.get("tasks", [])),
                })
            except Exception:
                pass

        entries.sort(key=lambda e: e["saved_at"], reverse=True)
        manifest = {"entries": entries[:100], "updated_at": time.time()}

        tmp = self._manifest_path.with_suffix(".tmp")
        try:
            tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            tmp.replace(self._manifest_path)
        except Exception:
            pass