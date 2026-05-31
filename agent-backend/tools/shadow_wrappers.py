"""Shadow filesystem wrappers for file tools.

These wrappers intercept agent file operations and route them through
the ShadowFileSystem instead of hitting disk directly.  This prevents
race conditions when the user is editing files in VS Code while the
agent writes to the same files.

Usage::

    from tools.shadow_wrappers import ShadowFileTools
    from core.shadow_fs import ShadowFileSystem

    shadow_fs = ShadowFileSystem(project_path)
    tools = ShadowFileTools(shadow_fs)

    # Agent calls:
    tools.write_file("src/app.py", "print('hello')")  # → writes to shadow
    tools.read_file("src/app.py")                      # → reads from shadow
"""

from __future__ import annotations

import logging
from typing import Optional

from core.shadow_fs import ShadowFileSystem

logger = logging.getLogger(__name__)


class ShadowFileTools:
    """Wraps file operations to use ShadowFileSystem.

    When the agent executes file tools (write_file, read_file, etc.),
    these wrappers redirect the operations to the in-memory shadow
    filesystem.  The user sees diffs and must explicitly accept/reject
    changes before they reach the real disk.
    """

    def __init__(self, shadow_fs: ShadowFileSystem) -> None:
        self.fs = shadow_fs

    # ── File operations ────────────────────────────────────────────

    def write_file(self, file_path: str, content: str) -> str:
        """Write to shadow FS. Does NOT touch disk."""
        node = self.fs.write_file(file_path, content)
        status = "created" if node.created else "modified"
        size = len(content) if content else 0
        logger.debug("Shadow write [%s]: %s (%d bytes)", status, file_path, size)
        return f"File {status} in shadow: {file_path} ({size} bytes)"

    def read_file(self, file_path: str) -> str:
        """Read from shadow (if modified) or real filesystem."""
        content = self.fs.read_file(file_path)
        if content is None:
            return f"Error: File not found (or deleted in shadow): {file_path}"
        return content

    def delete_file(self, file_path: str) -> str:
        """Mark file as deleted in shadow. Does NOT touch disk."""
        success = self.fs.delete_file(file_path)
        if success:
            logger.debug("Shadow delete: %s", file_path)
            return f"File marked for deletion in shadow: {file_path}"
        return f"Error: File not found: {file_path}"

    def list_directory(self, dir_path: str = ".") -> str:
        """List shadow + real directory contents."""
        entries = self.fs.list_directory(dir_path)
        lines = [f"Directory: {dir_path or '.'}"]
        for entry in entries:
            prefix = "[DIR]" if entry.is_directory else "[FILE]"
            status = ""
            if entry.created:
                status = " [NEW]"
            elif entry.modified:
                status = " [MODIFIED]"
            elif entry.deleted:
                status = " [DELETED]"
            lines.append(f"  {prefix} {entry.path}{status}")
        return "\n".join(lines)

    def search_files(self, pattern: str, path: str = ".") -> str:
        """Search for files matching pattern in shadow + real FS."""
        results = self.fs.search_files(pattern, path)
        if not results:
            return f"No files matching '{pattern}' found"
        return "\n".join(f"  {r}" for r in results)

    # ── Diff operations ────────────────────────────────────────────

    def get_diff(self, file_path: str) -> str:
        """Get unified diff for a single file."""
        diff = self.fs.generate_unified_diff(file_path)
        if not diff:
            return f"No changes for: {file_path}"
        lines = diff.get("unified_diff", [])
        return "\n".join(lines) if lines else f"No diff lines for: {file_path}"

    def get_all_diffs_summary(self) -> str:
        """Get a human-readable summary of all pending changes."""
        diffs = self.fs.get_all_diffs()
        stats = self.fs.get_stats()
        if not diffs:
            return "No pending changes in shadow filesystem."

        lines = [
            f"Shadow FS — {stats['total']} pending changes "
            f"(+{stats['created']} new, ~{stats['modified']} modified, -{stats['deleted']} deleted):",
        ]
        for diff in diffs:
            status_icon = {"added": "+", "modified": "~", "deleted": "-"}.get(
                diff["status"], "?"
            )
            lines.append(f"  [{status_icon}] {diff['path']}")
        return "\n".join(lines)

    # ── Merge / Discard ────────────────────────────────────────────

    def merge_to_disk(self, file_path: Optional[str] = None) -> str:
        """Merge shadow changes to disk (user clicked Accept)."""
        results = self.fs.merge_to_disk(file_path)
        success = sum(1 for v in results.values() if v)
        failed = sum(1 for v in results.values() if not v)
        target = file_path or "all files"
        msg = f"Merged {success} file(s) to disk"
        if failed:
            msg += f" ({failed} failed!)"
        logger.info("Shadow merge [%s]: %s", target, msg)
        return msg

    def discard_changes(self, file_path: Optional[str] = None) -> str:
        """Discard shadow changes (user clicked Reject)."""
        self.fs.discard_changes(file_path)
        target = file_path or "all files"
        logger.info("Shadow discard [%s]", target)
        return f"Discarded changes for: {target}"

    # ── Status helpers ─────────────────────────────────────────────

    def has_pending_changes(self) -> bool:
        """Check if there are any pending changes in shadow."""
        stats = self.fs.get_stats()
        return stats["total"] > 0

    def get_stats(self) -> dict:
        """Get shadow filesystem statistics."""
        return self.fs.get_stats()
