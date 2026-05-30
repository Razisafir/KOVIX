"""
File tool operations with safety validation.

Tools: read_file, write_file, list_directory, search_files

Each tool returns structured results for LLM consumption and includes
comprehensive safety checks to prevent destructive operations.
"""

import os
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path traversal prevention
# ---------------------------------------------------------------------------

# Base directory for all file operations — resolved at import time.
# All file paths are validated to be within this directory tree.
# Can be overridden per-session via set_base_dir().
BASE_DIR: str = os.path.abspath(os.getcwd())


def set_base_dir(new_base: str) -> str:
    """
    Set the base directory for file operation validation.

    This should be called by the executor when starting a new session,
    so that file tools resolve and validate paths against the session's
    project directory rather than the CWD at import time.

    Parameters
    ----------
    new_base:
        The new base directory (typically ``session.project_path``).
        Must be an absolute path.  Relative paths are resolved against
        the current ``BASE_DIR``.

    Returns
    -------
    str
        The previous ``BASE_DIR`` value (for restoration if needed).
    """
    global BASE_DIR
    old = BASE_DIR
    expanded = os.path.expanduser(new_base)
    BASE_DIR = os.path.abspath(expanded)
    logger.info("BASE_DIR changed: %s -> %s", old, BASE_DIR)
    return old


def _resolve_and_validate(path: str, must_exist: bool = False, base_dir: Optional[str] = None) -> str:
    """
    Resolve *path* to an absolute path and validate it is within *BASE_DIR*.

    This prevents path traversal attacks (``../``) and symlink following
    that would escape the project directory.

    Parameters
    ----------
    path:
        Absolute or relative file path.
    must_exist:
        If *True*, also verify the path exists on disk.
    base_dir:
        Override the module-level ``BASE_DIR`` for this call.  If *None*,
        the module-level ``BASE_DIR`` is used.

    Returns
    -------
    str
        The resolved absolute path.

    Raises
    ------
    ValueError
        If the path escapes *BASE_DIR* or contains traversal patterns.
    FileNotFoundError
        If *must_exist* is *True* and the path does not exist.
    """
    effective_base = base_dir if base_dir is not None else BASE_DIR
    expanded = os.path.expanduser(path)
    # For relative paths, resolve against effective_base instead of CWD
    if not os.path.isabs(expanded):
        expanded = os.path.join(effective_base, expanded)
    # Resolve symlinks and ``..`` segments to get the real path
    resolved = os.path.realpath(expanded)
    abs_path = os.path.abspath(resolved)

    # Check for common traversal indicators in the original input
    if ".." in os.path.normpath(expanded).split(os.sep):
        # Allow ``..`` only if the resolved path stays within effective_base
        try:
            os.path.commonpath([effective_base, abs_path])
        except ValueError:
            raise ValueError(
                f"Path traversal blocked: '{path}' resolves outside "
                f"the allowed directory ({effective_base})"
            )

    # Ensure the resolved path is under effective_base
    try:
        common = os.path.commonpath([effective_base, abs_path])
    except ValueError:
        raise ValueError(
            f"Path traversal blocked: '{path}' resolves outside "
            f"the allowed directory ({effective_base})"
        )

    if common != effective_base:
        raise ValueError(
            f"Path traversal blocked: '{path}' resolves to '{abs_path}' "
            f"which is outside the allowed directory ({effective_base})"
        )

    if must_exist and not os.path.exists(abs_path):
        raise FileNotFoundError(f"Path does not exist: {path}")

    return abs_path

# ---------------------------------------------------------------------------
# Safety configuration
# ---------------------------------------------------------------------------

# Maximum file sizes
MAX_READ_SIZE: int = 1_048_576       # 1 MB
MAX_WRITE_SIZE: int = 5_242_880      # 5 MB

# Blocked path patterns (no writes allowed)
BLOCKED_PATTERNS: List[str] = [
    r"^/etc/.*",
    r"^/usr/.*",
    r"^/bin/.*",
    r"^/sbin/.*",
    r"^/lib/.*",
    r"^/lib64/.*",
    r"^/sys/.*",
    r"^/proc/.*",
    r"^/dev/.*",
    r"^/boot/.*",
    r"^/var/log/.*",
    r"^/var/spool/.*",
    r"^/root/.*",
    r"^/home/[^/]+/\.ssh/.*",
    r"^~/.ssh/.*",
    r"^/tmp/.*",
    r"^/run/.*",
    r"^/initrd/.*",
    r"^.*\.ssh/.*",
    r"^.*\.gnupg/.*",
    r"^.*\.password.*",
    r"^.*\.netrc$",
    r"^.*\.aws/.*",
    r"^.*\.kube/.*",
    r"^.*id_rsa.*",
    r"^.*id_ed25519.*",
    r"^.*id_ecdsa.*",
    r"^.*known_hosts$",
    r"^.*authorized_keys$",
    r"^.*shadow$",
    r"^.*passwd$",
    r"^.*sudoers.*",
]

# Binary file extensions to reject for writes
BINARY_EXTENSIONS: set = {
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".obj",
    ".a", ".lib", ".class", ".jar", ".war", ".ear",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".db", ".sqlite", ".sqlite3", ".mdb",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".wasm", ".pak", ".nib", ".mo",
}


# ---------------------------------------------------------------------------
# Safety helpers
# ---------------------------------------------------------------------------

def _is_path_blocked(file_path: str) -> Optional[str]:
    """
    Check if a path matches any blocked pattern.

    Returns
    -------
    Optional[str]
        The matched pattern if blocked, *None* if safe.
    """
    expanded = os.path.expanduser(file_path)
    abs_path = os.path.abspath(expanded)
    for pattern in BLOCKED_PATTERNS:
        if re.match(pattern, abs_path) or re.match(pattern, file_path):
            return pattern
    return None


def _is_symlink_outside_base(file_path: str) -> bool:
    """
    Check whether *file_path* or any of its parents is a symlink
    that points outside *BASE_DIR*.

    Returns *True* if a dangerous symlink is detected.
    """
    expanded = os.path.expanduser(file_path)
    abs_path = os.path.abspath(expanded)
    current = abs_path
    while current and current != os.path.dirname(current):
        if os.path.islink(current):
            link_target = os.path.realpath(current)
            try:
                common = os.path.commonpath([BASE_DIR, link_target])
                if common != BASE_DIR:
                    return True
            except ValueError:
                return True
        current = os.path.dirname(current)
    return False


def _is_binary_extension(file_path: str) -> bool:
    """Return *True* if the file extension indicates a binary file."""
    _, ext = os.path.splitext(file_path.lower())
    return ext in BINARY_EXTENSIONS


def _safe_read(path: str, offset: int = 0, limit: int = 100) -> Dict[str, Any]:
    """
    Internal: read a file with safety checks.

    Parameters
    ----------
    path:
        Absolute or relative file path.
    offset:
        Number of lines to skip from the beginning (default 0).
    limit:
        Maximum number of lines to read (default 100).

    Returns
    -------
    dict
        Structured result with ``success``, ``content``, ``lines_read``, etc.
    """
    try:
        # Validate path is within allowed directory
        try:
            abs_path = _resolve_and_validate(path, must_exist=True)
        except (ValueError, FileNotFoundError) as exc:
            return {"success": False, "error": str(exc)}

        # Block symlinks that escape the base directory
        if _is_symlink_outside_base(path):
            return {
                "success": False,
                "error": f"Symlink traversal blocked: '{path}' points outside the allowed directory",
            }

        if not os.path.isfile(abs_path):
            return {"success": False, "error": f"Not a file: {path}"}

        file_size = os.path.getsize(abs_path)
        if file_size > MAX_READ_SIZE:
            return {
                "success": False,
                "error": (
                    f"File too large to read ({file_size} bytes > "
                    f"{MAX_READ_SIZE} bytes limit). "
                    f"Use offset/limit to read in chunks."
                ),
            }

        if _is_binary_extension(abs_path):
            return {
                "success": False,
                "error": (
                    f"File appears to be binary ({abs_path}). "
                    f"Binary files cannot be read as text."
                ),
            }

        # Read via resolved path to ensure we follow symlinks safely
        resolved = os.path.realpath(abs_path)
        with open(resolved, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

        total_lines = len(lines)
        start = offset
        end = min(offset + limit, total_lines)
        selected = lines[start:end]
        content = "".join(selected)

        # Log to memory system if available
        _log_file_op("read_file", abs_path, lines_read=end - start)

        return {
            "success": True,
            "content": content,
            "file_path": abs_path,
            "lines_read": end - start,
            "total_lines": total_lines,
            "offset": offset,
            "limit": limit,
            "has_more": end < total_lines,
        }

    except UnicodeDecodeError:
        return {
            "success": False,
            "error": f"File appears to be binary and cannot be decoded as UTF-8: {path}",
        }
    except PermissionError:
        return {
            "success": False,
            "error": f"Permission denied reading file: {path}",
        }
    except Exception as exc:
        logger.exception("Error reading file %s", path)
        return {"success": False, "error": f"Error reading file: {exc}"}


def _safe_write(
    path: str, content: str, append: bool = False
) -> Dict[str, Any]:
    """
    Internal: write (or append to) a file with safety checks.

    Parameters
    ----------
    path:
        Target file path.
    content:
        Text content to write.
    append:
        If *True*, append instead of overwriting.

    Returns
    -------
    dict
        Structured result with ``success``, ``bytes_written``, etc.
    """
    try:
        # Validate path is within allowed directory
        try:
            abs_path = _resolve_and_validate(path)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}

        # Block symlinks that escape the base directory
        if _is_symlink_outside_base(path):
            return {
                "success": False,
                "error": f"Symlink traversal blocked: '{path}' points outside the allowed directory",
            }

        # Safety checks: only check blocked patterns if the path is outside BASE_DIR.
        # Paths within BASE_DIR are already validated by _resolve_and_validate()
        # and are safe to write to. This prevents false positives when the
        # project itself is under a blocked prefix (e.g. /tmp/ in CI).
        is_within_base = abs_path.startswith(BASE_DIR + os.sep) or abs_path == BASE_DIR
        if not is_within_base:
            blocked = _is_path_blocked(abs_path)
        else:
            blocked = None
        if blocked:
            return {
                "success": False,
                "error": (
                    f"Write blocked for security: path matches "
                    f"blocked pattern '{blocked}'"
                ),
            }

        if _is_binary_extension(abs_path):
            return {
                "success": False,
                "error": (
                    f"Write blocked: binary file extension not allowed "
                    f"({abs_path})"
                ),
            }

        content_bytes = content.encode("utf-8")
        if len(content_bytes) > MAX_WRITE_SIZE:
            return {
                "success": False,
                "error": (
                    f"Content too large ({len(content_bytes)} bytes > "
                    f"{MAX_WRITE_SIZE} bytes limit)"
                ),
            }

        # Ensure parent directory exists and is within BASE_DIR
        parent = os.path.dirname(abs_path)
        if parent:
            try:
                parent_resolved = _resolve_and_validate(parent)
                os.makedirs(parent_resolved, exist_ok=True)
            except (ValueError, FileNotFoundError) as exc:
                return {"success": False, "error": f"Invalid parent directory: {exc}"}

        mode = "a" if append else "w"
        # Write via resolved path
        resolved = os.path.realpath(abs_path) if os.path.exists(abs_path) else abs_path
        with open(resolved, mode, encoding="utf-8") as f:
            f.write(content)

        bytes_written = len(content_bytes)
        _log_file_op(
            "write_file", abs_path, bytes_written=bytes_written, append=append
        )

        return {
            "success": True,
            "file_path": abs_path,
            "bytes_written": bytes_written,
            "append": append,
        }

    except PermissionError:
        return {
            "success": False,
            "error": f"Permission denied writing file: {path}",
        }
    except Exception as exc:
        logger.exception("Error writing file %s", path)
        return {"success": False, "error": f"Error writing file: {exc}"}


def _log_file_op(operation: str, file_path: str, **kwargs) -> None:
    """Log a file operation to the memory system if available."""
    logger.debug("File op: %s %s — %s", operation, file_path, kwargs)
    # Memory logging is best-effort; we don't fail the file op if memory is unavailable.
    try:
        # Avoid circular import — memory.semantic may not be available in all contexts
        from memory.semantic import store_code_event

        store_code_event(
            file_path=file_path,
            change_type=operation,
            summary=f"{operation}: {file_path}",
            diff=str(kwargs) if kwargs else None,
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Public tool functions
# ---------------------------------------------------------------------------


def read_file(file_path: str, offset: int = 0, limit: int = 100) -> Dict[str, Any]:
    """
    Read the contents of a text file.

    Parameters
    ----------
    file_path:
        Path to the file (absolute or relative).
    offset:
        Number of lines to skip from the start (default 0).
    limit:
        Maximum number of lines to read (default 100).

    Returns
    -------
    dict
        Result with ``success``, ``content``, ``total_lines``, ``has_more``.
    """
    logger.info("read_file: %s (offset=%d, limit=%d)", file_path, offset, limit)
    return _safe_read(file_path, offset=offset, limit=limit)


def write_file(
    file_path: str, content: str, append: bool = False
) -> Dict[str, Any]:
    """
    Write (or overwrite) a text file.

    Parameters
    ----------
    file_path:
        Path to the file (absolute or relative).
    content:
        Text content to write.
    append:
        If *True*, append to the file instead of overwriting.

    Returns
    -------
    dict
        Result with ``success``, ``file_path``, ``bytes_written``.
    """
    logger.info(
        "write_file: %s (%d bytes, append=%s)", file_path, len(content), append
    )
    return _safe_write(file_path, content, append=append)


def list_directory(dir_path: str = ".") -> List[Dict[str, Any]]:
    """
    List files and directories with metadata.

    Parameters
    ----------
    dir_path:
        Directory path (default current directory).

    Returns
    -------
    list[dict]
        Each entry has ``name``, ``type`` (file|directory), ``size``,
        ``modified``, and ``permissions``.
    """
    logger.info("list_directory: %s", dir_path)

    try:
        # Validate path is within allowed directory
        abs_path = _resolve_and_validate(dir_path, must_exist=True)

        if not os.path.isdir(abs_path):
            return [{"error": f"Not a directory: {dir_path}"}]

        # Block symlinks that escape the base directory
        if _is_symlink_outside_base(dir_path):
            return [
                {
                    "error": f"Symlink traversal blocked: '{dir_path}' points outside the allowed directory"
                }
            ]

        entries = []
        for entry in sorted(os.listdir(abs_path)):
            entry_path = os.path.join(abs_path, entry)
            # Skip symlinks that point outside BASE_DIR
            if os.path.islink(entry_path):
                link_target = os.path.realpath(entry_path)
                try:
                    common = os.path.commonpath([BASE_DIR, link_target])
                    if common != BASE_DIR:
                        logger.warning("Skipping symlink '%s' -> '%s' (outside base)", entry_path, link_target)
                        continue
                except ValueError:
                    logger.warning("Skipping symlink '%s' with invalid target", entry_path)
                    continue
            try:
                stat_info = os.stat(entry_path, follow_symlinks=False)
                entries.append(
                    {
                        "name": entry,
                        "path": entry_path,
                        "type": "directory" if os.path.isdir(entry_path) else "file",
                        "size": stat_info.st_size if os.path.isfile(entry_path) else None,
                        "modified": stat_info.st_mtime,
                        "permissions": oct(stat_info.st_mode)[-3:],
                        "is_symlink": os.path.islink(entry_path),
                    }
                )
            except (OSError, PermissionError):
                # Skip entries we can't stat
                continue

        _log_file_op("list_directory", abs_path, entries_count=len(entries))
        return entries

    except (ValueError, FileNotFoundError) as exc:
        return [{"error": str(exc)}]
    except PermissionError:
        return [{"error": f"Permission denied: {dir_path}"}]
    except Exception as exc:
        logger.exception("Error listing directory %s", dir_path)
        return [{"error": f"Error listing directory: {exc}"}]


def search_files(
    query: str, dir_path: str = ".", glob_pattern: str = "*"
) -> List[Dict[str, Any]]:
    """
    Search for text inside files (grep-like).

    Parameters
    ----------
    query:
        Text string or regex pattern to search for.
    dir_path:
        Root directory to search in (default current directory).
    glob_pattern:
        File glob pattern to filter files (default ``*`` for all).

    Returns
    -------
    list[dict]
        Each entry has ``file``, ``line``, ``column``, ``match``.
    """
    logger.info(
        "search_files: query='%s' dir='%s' glob='%s'", query, dir_path, glob_pattern
    )
    expanded = os.path.expanduser(dir_path)
    abs_path = os.path.abspath(expanded)

    results: List[Dict[str, Any]] = []

    try:
        if not os.path.exists(abs_path):
            return [{"error": f"Directory not found: {dir_path}"}]

        # Compile regex for the query
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error as exc:
            return [{"error": f"Invalid regex pattern: {exc}"}]

        for root, _dirs, files in os.walk(abs_path):
            # Skip hidden dirs and common non-source directories
            _dirs[:] = [
                d
                for d in _dirs
                if not d.startswith(".")
                and d not in {"node_modules", "__pycache__", "venv", ".git", "dist", "build"}
            ]

            for filename in files:
                if not filename.startswith("."):
                    # Simple glob matching
                    if glob_pattern != "*":
                        import fnmatch

                        if not fnmatch.fnmatch(filename, glob_pattern):
                            continue

                    file_path = os.path.join(root, filename)

                    # Skip binary files
                    if _is_binary_extension(file_path):
                        continue

                    try:
                        with open(
                            file_path, "r", encoding="utf-8", errors="replace"
                        ) as f:
                            for line_no, line in enumerate(f, 1):
                                for match in pattern.finditer(line):
                                    results.append(
                                        {
                                            "file": file_path,
                                            "line": line_no,
                                            "column": match.start() + 1,
                                            "match": match.group(),
                                            "line_text": line.rstrip("\n"),
                                        }
                                    )
                                    # Limit matches per file
                                    if sum(
                                        1 for r in results if r.get("file") == file_path
                                    ) >= 50:
                                        break
                    except (PermissionError, OSError, UnicodeDecodeError):
                        continue

        logger.info(
            "search_files found %d matches for '%s'", len(results), query
        )
        return results

    except Exception as exc:
        logger.exception("Error searching files")
        return [{"error": f"Error searching files: {exc}"}]
