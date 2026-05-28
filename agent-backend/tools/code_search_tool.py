"""Code Search Tool — advanced code search using ripgrep.

Features: text search, definition finding, usage finding, file structure,
grep with context, symbol extraction.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# File extensions mapped to language names
_LANGUAGE_EXTENSIONS: Dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".jsx": "javascript",
    ".tsx": "typescript",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".r": "r",
    ".m": "objc",
    ".cs": "csharp",
}

# Language-aware definition patterns
_DEFINITION_PATTERNS: Dict[str, List[str]] = {
    "python": [r"^(\s*)(def|class)\s+{symbol}\b", r"^(\s*){symbol}\s*="],
    "javascript": [r"^(\s*)(function\s+{symbol}|const\s+{symbol}|let\s+{symbol}|var\s+{symbol})\b"],
    "typescript": [r"^(\s*)(function\s+{symbol}|const\s+{symbol}|let\s+{symbol}|var\s+{symbol}|interface\s+{symbol}|type\s+{symbol})\b"],
    "rust": [r"^(\s*)(fn|struct|enum|trait|impl|type|const|static|macro)\s+{symbol}\b"],
    "go": [r"^(\s*)(func)\s+.*\b{symbol}\b"],
    "java": [r"^(\s*)(class|interface|enum|void|int|String|boolean|double|float|long|char|byte|short)\s+{symbol}\b"],
    "c": [r"^(\s*)(void|int|char|float|double|struct|enum|typedef|static|extern|inline|unsigned|signed|long|short|const)\s+.*\b{symbol}\b"],
    "cpp": [r"^(\s*)(void|int|char|float|double|class|struct|enum|template|namespace|typedef|static|extern|inline|virtual|unsigned|signed|long|short|const|auto)\s+.*\b{symbol}\b"],
    "ruby": [r"^(\s*)(def|class|module)\s+{symbol}\b"],
    "php": [r"^(\s*)(function|class|interface|trait)\s+{symbol}\b"],
    "swift": [r"^(\s*)(func|class|struct|enum|protocol|let|var)\s+{symbol}\b"],
    "kotlin": [r"^(\s*)(fun|class|interface|object|val|var)\s+{symbol}\b"],
}

# Default binary / skip directories
_SKIP_DIRS: frozenset = frozenset(
    {".git", "__pycache__", "node_modules", ".venv", "venv", "build", "dist", ".tox", ".egg-info"}
)


class CodeSearchTool:
    """Advanced code search using ripgrep with fallback to Python grep.

    Provides fast text search, symbol definition finding, usage tracking,
    and file structure exploration across a project codebase.
    """

    def __init__(self, project_path: str = "."):
        self.project_path = os.path.abspath(project_path)
        self._has_rg = self._check_rg()

    def _check_rg(self) -> bool:
        """Check if ripgrep (rg) is available on the system."""
        try:
            subprocess.run(
                ["rg", "--version"],
                capture_output=True,
                check=True,
                timeout=5,
            )
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            logger.info("ripgrep not found — using Python fallback")
            return False

    def search_text(
        self,
        query: str,
        file_pattern: Optional[str] = None,
        context_lines: int = 2,
        max_results: int = 50,
    ) -> Dict[str, Any]:
        """Search for text across project files.

        Parameters
        ----------
        query:
            Text or regex pattern to search for.
        file_pattern:
            Glob pattern to filter files (e.g. "*.py").
        context_lines:
            Number of context lines around each match.
        max_results:
            Maximum number of matches to return.

        Returns
        -------
        dict
            Contains ``success``, ``matches``, ``total``, and ``error``.
        """
        try:
            if self._has_rg:
                args = [
                    "rg",
                    "--json",
                    "--context",
                    str(context_lines),
                    "--max-count",
                    str(max_results),
                    "--max-columns",
                    "500",
                ]
                if file_pattern:
                    args.extend(["--glob", file_pattern])
                args.extend(["-e", query, self.project_path])
                raw = self._run_rg(args)
                matches = self._parse_rg_json(raw, max_results)
            else:
                matches = self._python_grep(query, self.project_path, max_results=max_results)

            logger.info(
                "search_text: found %d matches for '%s' in %s",
                len(matches),
                query,
                self.project_path,
            )
            return {"success": True, "matches": matches, "total": len(matches)}
        except Exception as exc:
            logger.exception("search_text failed")
            return {"success": False, "matches": [], "total": 0, "error": str(exc)}

    def find_definition(
        self, symbol: str, language: Optional[str] = None
    ) -> Dict[str, Any]:
        """Find where a symbol is defined.

        Uses language-aware patterns to locate function, class, and
        variable definitions.

        Parameters
        ----------
        symbol:
            The symbol name to search for.
        language:
            If provided, restrict to this language (e.g. "python").

        Returns
        -------
        dict
            Contains ``success``, ``definitions``, and ``error``.
        """
        try:
            definitions: List[Dict[str, Any]] = []
            langs = [language] if language else list(_DEFINITION_PATTERNS.keys())

            for lang in langs:
                patterns = _DEFINITION_PATTERNS.get(lang, [])
                for pattern_template in patterns:
                    pattern = pattern_template.format(symbol=re.escape(symbol))
                    result = self.search_text(pattern, context_lines=1)
                    for match in result.get("matches", []):
                        match["language"] = lang
                        definitions.append(match)

            # Deduplicate by (file, line)
            seen: set = set()
            unique: List[Dict[str, Any]] = []
            for d in definitions:
                key = (d.get("file", ""), d.get("line", 0))
                if key not in seen:
                    seen.add(key)
                    unique.append(d)

            logger.info("find_definition: %d definitions for '%s'", len(unique), symbol)
            return {"success": True, "symbol": symbol, "definitions": unique}
        except Exception as exc:
            logger.exception("find_definition failed for '%s'", symbol)
            return {"success": False, "symbol": symbol, "definitions": [], "error": str(exc)}

    def find_usages(self, symbol: str) -> Dict[str, Any]:
        """Find all usages of a symbol across the project.

        Parameters
        ----------
        symbol:
            The symbol name to find usages of.

        Returns
        -------
        dict
            Contains ``success``, ``usages``, ``total``, and ``error``.
        """
        try:
            escaped = re.escape(symbol)
            pattern = rf"\b{escaped}\b"
            result = self.search_text(pattern, context_lines=1)
            usages = result.get("matches", [])

            logger.info("find_usages: %d usages of '%s'", len(usages), symbol)
            return {"success": True, "symbol": symbol, "usages": usages, "total": len(usages)}
        except Exception as exc:
            logger.exception("find_usages failed for '%s'", symbol)
            return {"success": False, "symbol": symbol, "usages": [], "total": 0, "error": str(exc)}

    def get_file_structure(self, path: str) -> Dict[str, Any]:
        """Get directory/file structure with metadata.

        Parameters
        ----------
        path:
            Relative or absolute path within the project.

        Returns
        -------
        dict
            Contains ``success``, ``entries``, and ``error``.
        """
        try:
            target = os.path.join(self.project_path, path) if not os.path.isabs(path) else path
            target = os.path.abspath(target)

            if not os.path.exists(target):
                return {"success": False, "entries": [], "error": f"Path not found: {target}"}

            if os.path.isfile(target):
                stat = os.stat(target)
                return {
                    "success": True,
                    "entries": [
                        {
                            "name": os.path.basename(target),
                            "path": target,
                            "type": "file",
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                        }
                    ],
                }

            entries: List[Dict[str, Any]] = []
            with os.scandir(target) as it:
                for entry in sorted(it, key=lambda e: (not e.is_dir(), e.name.lower())):
                    if entry.name.startswith(".") and entry.is_dir():
                        continue
                    if entry.is_dir() and entry.name in _SKIP_DIRS:
                        continue
                    stat = entry.stat()
                    entries.append(
                        {
                            "name": entry.name,
                            "path": os.path.join(target, entry.name),
                            "type": "directory" if entry.is_dir() else "file",
                            "size": stat.st_size if entry.is_file() else None,
                            "modified": stat.st_mtime,
                        }
                    )

            logger.info("get_file_structure: %d entries in %s", len(entries), target)
            return {"success": True, "path": target, "entries": entries}
        except Exception as exc:
            logger.exception("get_file_structure failed")
            return {"success": False, "entries": [], "error": str(exc)}

    def grep_with_context(
        self,
        pattern: str,
        path: str = ".",
        before: int = 3,
        after: int = 3,
    ) -> Dict[str, Any]:
        """Grep with line context (before and after lines).

        Parameters
        ----------
        pattern:
            Regex pattern to search for.
        path:
            Subdirectory or file to search in (relative to project root).
        before:
            Number of lines to include before each match.
        after:
            Number of lines to include after each match.

        Returns
        -------
        dict
            Contains ``success``, ``matches``, ``total``, and ``error``.
        """
        try:
            target = os.path.join(self.project_path, path) if not os.path.isabs(path) else path
            target = os.path.abspath(target)

            if self._has_rg:
                args = [
                    "rg",
                    "--json",
                    "--before-context",
                    str(before),
                    "--after-context",
                    str(after),
                    "--max-columns",
                    "500",
                    "-e",
                    pattern,
                    target if os.path.isdir(target) else target,
                ]
                raw = self._run_rg(args)
                matches = self._parse_rg_json(raw, 200)
            else:
                matches = self._python_grep(pattern, target)

            logger.info("grep_with_context: %d matches for '%s'", len(matches), pattern)
            return {"success": True, "matches": matches, "total": len(matches)}
        except Exception as exc:
            logger.exception("grep_with_context failed")
            return {"success": False, "matches": [], "total": 0, "error": str(exc)}

    def _run_rg(self, args: List[str]) -> str:
        """Run ripgrep with the given arguments.

        Parameters
        ----------
        args:
            Command-line arguments for ``rg``.

        Returns
        -------
        str
            Raw stdout from ripgrep.
        """
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=60,
            )
            return result.stdout
        except subprocess.TimeoutExpired:
            logger.warning("ripgrep timed out after 60s")
            return ""
        except Exception as exc:
            logger.warning("ripgrep execution failed: %s", exc)
            return ""

    def _parse_rg_json(self, raw: str, max_results: int) -> List[Dict[str, Any]]:
        """Parse ripgrep's --json output into structured match dicts.

        Parameters
        ----------
        raw:
            Raw newline-delimited JSON from ``rg --json``.
        max_results:
            Maximum number of matches to return.

        Returns
        -------
        list[dict]
            Parsed match dictionaries with ``file``, ``line``, ``column``,
            ``match``, and ``context`` keys.
        """
        import json

        matches: List[Dict[str, Any]] = []
        current_file: Optional[str] = None

        for line in raw.strip().split("\n"):
            if len(matches) >= max_results:
                break
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                msg_type = data.get("type")

                if msg_type == "begin":
                    current_file = data.get("data", {}).get("path", {}).get("text", "")
                elif msg_type == "match" and current_file:
                    mdata = data.get("data", {})
                    line_num = mdata.get("line_number", 0)
                    submatches = mdata.get("submatches", [])
                    for sm in submatches:
                        mtext = sm.get("match", {}).get("text", "")
                        mline = sm.get("line", {}).get("text", "")
                        matches.append(
                            {
                                "file": current_file,
                                "line": line_num,
                                "column": sm.get("start", 0),
                                "match": mtext,
                                "context": mline,
                            }
                        )
            except json.JSONDecodeError:
                continue

        return matches

    def _python_grep(
        self,
        pattern: str,
        path: str,
        max_results: int = 50,
    ) -> List[Dict[str, Any]]:
        """Pure-Python grep fallback when ripgrep is unavailable.

        Walks the directory tree, reads each file, and applies regex search.

        Parameters
        ----------
        pattern:
            Regex pattern to search for.
        path:
            Directory (or file) to search in.
        max_results:
            Maximum number of matches to return.

        Returns
        -------
        list[dict]
            Match dictionaries with ``file``, ``line``, ``column``,
            ``match``, and ``context`` keys.
        """
        matches: List[Dict[str, Any]] = []
        compiled = re.compile(pattern)

        targets: List[str] = []
        if os.path.isfile(path):
            targets.append(path)
        elif os.path.isdir(path):
            for root, dirs, files in os.walk(path):
                dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
                for fname in files:
                    fpath = os.path.join(root, fname)
                    targets.append(fpath)

        for fpath in targets:
            if len(matches) >= max_results:
                break
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                    for line_idx, line in enumerate(fh, start=1):
                        for m in compiled.finditer(line):
                            matches.append(
                                {
                                    "file": fpath,
                                    "line": line_idx,
                                    "column": m.start(),
                                    "match": m.group(),
                                    "context": line.rstrip("\n"),
                                }
                            )
                            if len(matches) >= max_results:
                                break
                        if len(matches) >= max_results:
                            break
            except (IOError, OSError) as exc:
                logger.debug("Skipping file %s: %s", fpath, exc)
                continue

        return matches

    def detect_language(self, file_path: str) -> Optional[str]:
        """Detect programming language from file extension.

        Parameters
        ----------
        file_path:
            Path to the source file.

        Returns
        -------
        str or None
            Language name or *None* if unknown.
        """
        ext = Path(file_path).suffix.lower()
        return _LANGUAGE_EXTENSIONS.get(ext)
