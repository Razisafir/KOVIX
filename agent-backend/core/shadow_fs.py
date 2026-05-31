"""
Virtual Shadow File System — in-memory staging layer for the Construct AI Agent.

Agent writes go here instead of directly to disk. The user sees diffs between
the shadow and the real filesystem, then clicks **Accept** to merge or
**Reject** to discard.

Key design points
-----------------
* Every file the agent creates or modifies lives as a :class:`ShadowNode` in
  an in-memory dict keyed by normalised relative path.
* ``_snapshot_original_files`` seeds the shadow with the current on-disk state
  so we can produce accurate diffs and safe rollbacks.
* ``merge_to_disk`` is atomic per-file (write‑to‑temp + replace) so a crash
  never leaves a half-written file.
* Encoding errors are handled gracefully — undecodable files are treated as
  binary and skipped from diff generation rather than crashing.
"""

from __future__ import annotations

import difflib
import fnmatch
import hashlib
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


# ---------------------------------------------------------------------------
# ShadowNode
# ---------------------------------------------------------------------------

@dataclass
class ShadowNode:
    """Represents a single file or directory entry inside the shadow FS.

    Attributes
    ----------
    path:
        Relative path (forward-slash normalised) from the project root.
    content:
        Current content in the shadow layer.  ``None`` for directories or
        binary files that could not be decoded.
    is_directory:
        ``True`` if this node represents a directory.
    original_content:
        Snapshot of the content at the moment the node was first created.
        For pre-existing files this is the on-disk content at init time.
        For newly created files this stays ``None``.
    modified:
        ``True`` when the content differs from ``original_content``.
    deleted:
        ``True`` when the file has been logically deleted in the shadow.
    created:
        ``True`` when the file did not exist on disk at snapshot time.
    """

    path: str
    content: Optional[str] = None
    is_directory: bool = False
    original_content: Optional[str] = None
    modified: bool = False
    deleted: bool = False
    created: bool = False

    def checksum(self) -> str:
        """Return a short SHA-256 hex digest (16 chars) of the current content.

        Returns ``"0" * 16`` when content is ``None`` (directories / binary).
        """
        if self.content is None:
            return "0" * 16
        return hashlib.sha256(self.content.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# ShadowFileSystem
# ---------------------------------------------------------------------------

class ShadowFileSystem:
    """In-memory staging filesystem that sits between the agent and real disk.

    Workflow::

        sfs = ShadowFileSystem("/path/to/project")

        # Agent writes
        sfs.write_file("src/main.py", "print('hello')")

        # User reviews diffs
        diffs = sfs.get_all_diffs()

        # User accepts or rejects
        sfs.merge_to_disk()       # accept all
        sfs.discard_changes()     # reject all
    """

    def __init__(self, project_path: str) -> None:
        self.project_path: Path = Path(project_path).resolve()
        self._nodes: Dict[str, ShadowNode] = {}
        self._snapshot_original_files()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_path(path: str) -> str:
        """Convert *path* to a relative, forward-slash normalised string.

        Leading ``./`` and ``/`` are stripped so the result is always a
        simple relative path (or ``"."`` for the root).
        """
        p = Path(path).as_posix()
        # Strip leading "./"
        if p.startswith("./"):
            p = p[2:]
        # Strip leading "/" — force relative
        if p.startswith("/"):
            p = p.lstrip("/")
        return p if p else "."

    @staticmethod
    def _safe_read_text(file_path: Path) -> Optional[str]:
        """Try to read a text file, returning ``None`` on encoding errors."""
        try:
            return file_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError, OSError):
            return None

    # ------------------------------------------------------------------
    # Snapshot
    # ------------------------------------------------------------------

    def _snapshot_original_files(self) -> None:
        """Walk the project directory and seed shadow nodes from real files.

        Only files that can be decoded as UTF-8 are stored; everything else
        (binaries, images, etc.) is skipped.  Directories are recorded so
        that ``list_directory`` can merge them correctly later.
        """
        if not self.project_path.is_dir():
            return

        for root, dirs, files in os.walk(self.project_path):
            root_path = Path(root)

            # Record directories
            for d in sorted(dirs):
                rel = self._normalize_path(str(root_path.relative_to(self.project_path) / d))
                self._nodes[rel] = ShadowNode(
                    path=rel,
                    is_directory=True,
                    original_content=None,
                )

            # Record files
            for f in sorted(files):
                abs_path = root_path / f
                rel = self._normalize_path(str(abs_path.relative_to(self.project_path)))
                content = self._safe_read_text(abs_path)
                self._nodes[rel] = ShadowNode(
                    path=rel,
                    content=content,
                    is_directory=False,
                    original_content=content,
                )

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def write_file(self, path: str, content: str) -> ShadowNode:
        """Write *content* to the shadow layer for *path*.

        If the file already exists in the shadow, its content is updated.
        If it did not exist previously the ``created`` flag is set.

        Parameters
        ----------
        path:
            Relative or absolute path within the project.
        content:
            The new file content.

        Returns
        -------
        ShadowNode
            The node representing the written file.
        """
        norm = self._normalize_path(path)

        existing = self._nodes.get(norm)
        if existing is not None:
            # Update existing node
            existing.content = content
            existing.deleted = False
            # Mark modified if content differs from original
            existing.modified = (content != existing.original_content)
        else:
            # Brand-new file
            node = ShadowNode(
                path=norm,
                content=content,
                is_directory=False,
                original_content=None,
                modified=True,
                deleted=False,
                created=True,
            )
            self._nodes[norm] = node

        return self._nodes[norm]

    def read_file(self, path: str) -> Optional[str]:
        """Read file content from the shadow first, fall back to real FS.

        Returns ``None`` if the file is deleted in shadow, is a directory,
        or cannot be read.
        """
        norm = self._normalize_path(path)

        # Check shadow first
        node = self._nodes.get(norm)
        if node is not None:
            if node.deleted:
                return None
            if node.is_directory:
                return None
            if node.content is not None:
                return node.content
            # content is None (binary / unreadable) — fall through to disk

        # Fall back to real filesystem
        abs_path = self.project_path / norm
        if abs_path.is_file():
            return self._safe_read_text(abs_path)

        return None

    def delete_file(self, path: str) -> bool:
        """Mark *path* as deleted in the shadow layer.

        Returns ``True`` if the file existed (in shadow or on disk) and was
        successfully marked for deletion, ``False`` otherwise.
        """
        norm = self._normalize_path(path)

        node = self._nodes.get(norm)
        if node is not None:
            node.deleted = True
            node.modified = False
            return True

        # File exists on disk but not in shadow yet — create node then delete
        abs_path = self.project_path / norm
        if abs_path.is_file():
            content = self._safe_read_text(abs_path)
            self._nodes[norm] = ShadowNode(
                path=norm,
                content=content,
                is_directory=False,
                original_content=content,
                modified=False,
                deleted=True,
                created=False,
            )
            return True

        return False

    def list_directory(self, path: str = ".") -> List[ShadowNode]:
        """List entries at *path*, merging shadow and real FS state.

        Deleted entries are excluded.  Directories that exist only in the
        shadow (newly created) are included.
        """
        norm = self._normalize_path(path)
        if norm == ".":
            prefix = ""
        else:
            prefix = norm + "/"

        results: Dict[str, ShadowNode] = {}

        # Gather from shadow nodes
        for node_path, node in self._nodes.items():
            if node.deleted:
                continue
            if node_path == norm and node.is_directory:
                # The directory itself — skip, we want its children
                continue
            if prefix:
                if not node_path.startswith(prefix):
                    continue
                # Direct child only (no deeper nesting)
                remainder = node_path[len(prefix):]
                if "/" in remainder:
                    # This is a nested path — include the intermediate dir
                    top = remainder.split("/")[0]
                    top_path = prefix + top
                    if top_path not in results:
                        results[top_path] = ShadowNode(
                            path=top_path, is_directory=True
                        )
                    continue
            else:
                remainder = node_path
                if "/" in remainder:
                    top = remainder.split("/")[0]
                    if top not in results:
                        results[top] = ShadowNode(path=top, is_directory=True)
                    continue

            results[node_path] = node

        # Gather from real filesystem (items not already covered by shadow)
        abs_dir = self.project_path / norm if norm != "." else self.project_path
        if abs_dir.is_dir():
            for entry in abs_dir.iterdir():
                entry_rel = self._normalize_path(str(entry.relative_to(self.project_path)))
                if entry_rel in results:
                    continue  # Shadow already covers this
                # Check if deleted in shadow
                shadow_node = self._nodes.get(entry_rel)
                if shadow_node is not None and shadow_node.deleted:
                    continue
                if shadow_node is not None:
                    results[entry_rel] = shadow_node
                else:
                    is_dir = entry.is_dir()
                    if is_dir:
                        results[entry_rel] = ShadowNode(
                            path=entry_rel, is_directory=True
                        )
                    else:
                        content = self._safe_read_text(entry)
                        results[entry_rel] = ShadowNode(
                            path=entry_rel,
                            content=content,
                            is_directory=False,
                            original_content=content,
                        )

        return sorted(results.values(), key=lambda n: (not n.is_directory, n.path))

    # ------------------------------------------------------------------
    # Diff generation
    # ------------------------------------------------------------------

    def generate_unified_diff(self, path: str) -> Optional[Dict]:
        """Generate a unified diff for a single *path*.

        Returns a dict with keys ``path``, ``status``, ``old_content``,
        ``new_content``, ``unified_diff``, or ``None`` if there is no
        pending change for the given path.

        Status values: ``"created"``, ``"modified"``, ``"deleted"``.
        """
        norm = self._normalize_path(path)
        node = self._nodes.get(norm)

        if node is None:
            return None

        if node.is_directory:
            return None

        # Deleted file
        if node.deleted:
            old_lines = (node.original_content or "").splitlines(keepends=True)
            diff_lines = list(
                difflib.unified_diff(
                    old_lines,
                    [],
                    fromfile=f"a/{norm}",
                    tofile=f"b/{norm}",
                )
            )
            return {
                "path": norm,
                "status": "deleted",
                "old_content": node.original_content,
                "new_content": None,
                "unified_diff": "".join(diff_lines),
            }

        # Newly created file
        if node.created:
            new_lines = (node.content or "").splitlines(keepends=True)
            diff_lines = list(
                difflib.unified_diff(
                    [],
                    new_lines,
                    fromfile=f"a/{norm}",
                    tofile=f"b/{norm}",
                )
            )
            return {
                "path": norm,
                "status": "created",
                "old_content": None,
                "new_content": node.content,
                "unified_diff": "".join(diff_lines),
            }

        # Modified file
        if node.modified:
            old_lines = (node.original_content or "").splitlines(keepends=True)
            new_lines = (node.content or "").splitlines(keepends=True)
            diff_lines = list(
                difflib.unified_diff(
                    old_lines,
                    new_lines,
                    fromfile=f"a/{norm}",
                    tofile=f"b/{norm}",
                )
            )
            return {
                "path": norm,
                "status": "modified",
                "old_content": node.original_content,
                "new_content": node.content,
                "unified_diff": "".join(diff_lines),
            }

        # No change
        return None

    def get_all_diffs(self) -> List[Dict]:
        """Return unified diffs for **all** pending changes in the shadow.

        Only files with a status of created, modified, or deleted are
        included.  Unchanged files and directories are skipped.
        """
        diffs: List[Dict] = []
        for node_path in sorted(self._nodes.keys()):
            diff = self.generate_unified_diff(node_path)
            if diff is not None:
                diffs.append(diff)
        return diffs

    def get_stats(self) -> Dict:
        """Return a summary of pending changes.

        Returns ``{created: int, modified: int, deleted: int, total: int}``.
        """
        created = 0
        modified = 0
        deleted = 0
        for node in self._nodes.values():
            if node.is_directory:
                continue
            if node.deleted:
                deleted += 1
            elif node.created:
                created += 1
            elif node.modified:
                modified += 1
        return {
            "created": created,
            "modified": modified,
            "deleted": deleted,
            "total": created + modified + deleted,
        }

    # ------------------------------------------------------------------
    # Merge / Discard
    # ------------------------------------------------------------------

    def merge_to_disk(self, path: Optional[str] = None) -> Dict[str, bool]:
        """Write shadow changes to the real filesystem (atomic per file).

        Parameters
        ----------
        path:
            If given, only merge this single path.  If ``None``, merge all
            pending changes.

        Returns
        -------
        dict
            Mapping of ``{relative_path: success_bool}`` for every file
            that was attempted.
        """
        results: Dict[str, bool] = {}

        if path is not None:
            norm = self._normalize_path(path)
            node = self._nodes.get(norm)
            if node is None:
                return {norm: False}
            results[norm] = self._merge_single(node)
            return results

        # Merge all pending changes
        for node_path in sorted(self._nodes.keys()):
            node = self._nodes[node_path]
            if node.is_directory:
                continue
            if not (node.created or node.modified or node.deleted):
                continue
            results[node_path] = self._merge_single(node)

        return results

    def _merge_single(self, node: ShadowNode) -> bool:
        """Merge a single node to disk atomically.

        For writes we use a temp file in the same directory and then
        ``os.replace`` which is atomic on POSIX.  For deletions we simply
        remove the file.
        """
        abs_path = self.project_path / node.path

        try:
            if node.deleted:
                if abs_path.is_file():
                    abs_path.unlink()
                # Reset node state
                node.deleted = False
                node.modified = False
                node.created = False
                node.content = None
                node.original_content = None
                return True

            # Ensure parent directory exists
            abs_path.parent.mkdir(parents=True, exist_ok=True)

            # Atomic write: write to temp file in same dir, then replace
            content_bytes = (node.content or "").encode("utf-8")
            fd, tmp_path = tempfile.mkstemp(
                dir=str(abs_path.parent),
                prefix=".shadow_",
                suffix=".tmp",
            )
            try:
                os.write(fd, content_bytes)
                os.close(fd)
                os.replace(tmp_path, str(abs_path))
            except BaseException:
                # Clean up temp file on any failure
                try:
                    os.close(fd)
                except OSError:
                    pass
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                raise

            # Update node state — file is now consistent with disk
            node.original_content = node.content
            node.modified = False
            node.created = False
            return True

        except (OSError, PermissionError, UnicodeEncodeError):
            return False

    def discard_changes(self, path: Optional[str] = None) -> None:
        """Revert shadow changes, restoring original state or removing created files.

        Parameters
        ----------
        path:
            If given, only discard changes for this single path.  If
            ``None``, discard all pending changes.
        """
        if path is not None:
            norm = self._normalize_path(path)
            node = self._nodes.get(norm)
            if node is not None:
                self._discard_single(node)
                # Remove newly-created files from shadow entirely
                if node.created and node.original_content is None:
                    del self._nodes[norm]
            return

        # Discard all
        to_remove: List[str] = []
        for node_path, node in list(self._nodes.items()):
            if node.is_directory:
                continue
            if node.created or node.modified or node.deleted:
                self._discard_single(node)
                # Remove newly-created files from shadow entirely
                if node.created and node.original_content is None:
                    to_remove.append(node_path)

        for remove_path in to_remove:
            del self._nodes[remove_path]

    def _discard_single(self, node: ShadowNode) -> None:
        """Discard changes for a single node."""
        if node.created and node.original_content is None:
            # This was a brand-new file — remove from shadow entirely
            # (caller handles deletion from _nodes dict)
            return

        if node.deleted:
            # Restore — undelete
            node.deleted = False

        # Revert content to original
        node.content = node.original_content
        node.modified = False
        node.created = False

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    def file_exists(self, path: str) -> bool:
        """Check if a file exists in the shadow or real filesystem.

        A file that is marked as deleted in the shadow is considered
        non-existent.
        """
        norm = self._normalize_path(path)

        node = self._nodes.get(norm)
        if node is not None:
            if node.deleted:
                return False
            return True

        # Fall back to real FS
        abs_path = self.project_path / norm
        return abs_path.exists()

    def search_files(self, pattern: str, path: str = ".") -> List[str]:
        """Glob-style search for files matching *pattern* under *path*.

        Merges shadow and real FS results.  Deleted files are excluded.

        Parameters
        ----------
        pattern:
            A Unix shell-style wildcard pattern (e.g. ``"*.py"``).
        path:
            Directory to search within, relative to project root.

        Returns
        -------
        list[str]
            Sorted list of matching relative paths.
        """
        norm_dir = self._normalize_path(path)

        # Collect all candidate file paths from shadow + real FS
        all_paths: set = set()

        # From shadow
        for node_path, node in self._nodes.items():
            if node.deleted:
                continue
            if node.is_directory:
                continue
            if norm_dir == "." or node_path.startswith(norm_dir + "/") or node_path == norm_dir:
                all_paths.add(node_path)

        # From real FS
        abs_dir = self.project_path / norm_dir if norm_dir != "." else self.project_path
        if abs_dir.is_dir():
            for root, _dirs, files in os.walk(abs_dir):
                root_path = Path(root)
                for f in files:
                    rel = self._normalize_path(
                        str((root_path / f).relative_to(self.project_path))
                    )
                    # Skip if deleted in shadow
                    node = self._nodes.get(rel)
                    if node is not None and node.deleted:
                        continue
                    all_paths.add(rel)

        # Apply glob pattern matching
        matched = sorted(
            p for p in all_paths
            if fnmatch.fnmatch(p, pattern) or fnmatch.fnmatch(Path(p).name, pattern)
        )
        return matched
