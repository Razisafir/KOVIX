"""
Tool registry — central registration and schema collection for all tools.

This module collects all tool function schemas in OpenAI's function calling format
and provides dispatch so the executor can call tools by name with JSON arguments.

Usage::

    from tools import ToolRegistry, TOOL_DEFINITIONS

    registry = ToolRegistry()
    schemas = registry.get_tool_schemas()          # for LLM function calling
    result = registry.execute_tool("read_file", {"file_path": "app.py"})
"""

import json
import logging
import os
import importlib
import importlib.util
import inspect
from pathlib import Path
from typing import Dict, List, Any, Callable, Optional

from tools.file_tools import read_file, write_file, list_directory, search_files
from tools.shell_tools import execute_command, run_test, install_dependency
from tools.git_tools import (
    git_status,
    git_diff,
    git_commit,
    git_branch,
    git_log,
    git_checkout,
    git_add,
    git_reset,
)
from tools.code_tools import parse_ast, find_references, refactor_rename, extract_function
from tools.markitdown_tool import MarkItDownTool
from tools.ghidra_tool import GhidraTool
from tools.browser_tool import BrowserTool
from tools.code_search_tool import CodeSearchTool
from tools.database_tool import DatabaseTool

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool adapter helpers — bridge class-based tools to the function registry
# ---------------------------------------------------------------------------

# Lazy-initialized singleton instances for stateful tools
_markitdown_instance: Optional[MarkItDownTool] = None
_ghidra_instance: Optional[GhidraTool] = None
_browser_instance: Optional[BrowserTool] = None
_code_search_instance: Optional[CodeSearchTool] = None
_database_instance: Optional[DatabaseTool] = None


def _get_markitdown() -> MarkItDownTool:
    """Return (creating if needed) the shared MarkItDownTool instance."""
    global _markitdown_instance
    if _markitdown_instance is None:
        _markitdown_instance = MarkItDownTool()
    return _markitdown_instance


def _get_ghidra() -> GhidraTool:
    """Return (creating if needed) the shared GhidraTool instance."""
    global _ghidra_instance
    if _ghidra_instance is None:
        _ghidra_instance = GhidraTool()
    return _ghidra_instance


def _get_browser() -> BrowserTool:
    """Return (creating if needed) the shared BrowserTool instance."""
    global _browser_instance
    if _browser_instance is None:
        _browser_instance = BrowserTool()
    return _browser_instance


def _get_code_search() -> CodeSearchTool:
    """Return (creating if needed) the shared CodeSearchTool instance."""
    global _code_search_instance
    if _code_search_instance is None:
        _code_search_instance = CodeSearchTool()
    return _code_search_instance


def _get_database() -> DatabaseTool:
    """Return (creating if needed) the shared DatabaseTool instance."""
    global _database_instance
    if _database_instance is None:
        _database_instance = DatabaseTool()
    return _database_instance


# -- MarkItDown tool wrappers -----------------------------------------------

def convert_document(file_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
    """Convert a document (PDF, DOCX, PPTX, CSV, JSON, etc.) to Markdown.

    Uses Microsoft's MarkItDown library with custom fallback parsers.
    Supports 20+ formats including images (OCR) and audio (transcription).
    """
    return _get_markitdown().convert_file(file_path, output_path)


def batch_convert_documents(directory: str, output_dir: str) -> Dict[str, Any]:
    """Convert all supported documents in a directory to Markdown."""
    return _get_markitdown().convert_batch(directory, output_dir)


def extract_document_structure(file_path: str) -> Dict[str, Any]:
    """Extract structure from a document: headings, tables, word count."""
    return _get_markitdown().extract_structure(file_path)


# -- Ghidra tool wrappers ---------------------------------------------------

def analyze_binary(binary_path: str, project_name: str = "construct_analysis") -> Dict[str, Any]:
    """Analyze a binary with NSA Ghidra: functions, strings, sections, imports."""
    tool = _get_ghidra()
    if not tool.is_available():
        return {
            "success": False,
            "error": (
                "Ghidra is not installed or not found. "
                "Install at /opt/ghidra or set GHIDRA_PATH environment variable."
            ),
        }
    return tool.analyze_binary(binary_path, project_name)


def decompile_function(binary_path: str, function_name: str) -> Dict[str, Any]:
    """Decompile a specific function from a binary to C pseudocode via Ghidra."""
    tool = _get_ghidra()
    if not tool.is_available():
        return {
            "success": False,
            "error": (
                "Ghidra is not installed or not found. "
                "Install at /opt/ghidra or set GHIDRA_PATH environment variable."
            ),
            "c_code": None,
        }
    return tool.decompile_function(binary_path, function_name)


def find_vulnerabilities(binary_path: str) -> Dict[str, Any]:
    """Scan a binary for dangerous functions and potential vulnerabilities."""
    tool = _get_ghidra()
    if not tool.is_available():
        return {
            "success": False,
            "error": (
                "Ghidra is not installed or not found. "
                "Install at /opt/ghidra or set GHIDRA_PATH environment variable."
            ),
            "severity_score": 0,
        }
    return tool.find_vulnerabilities(binary_path)


def compare_binaries(binary_a: str, binary_b: str) -> Dict[str, Any]:
    """Compare two binaries and report differences in functions and strings."""
    tool = _get_ghidra()
    if not tool.is_available():
        return {"success": False, "error": "Ghidra is not installed or not found.", "similarity_score": 0.0}
    return tool.compare_binaries(binary_a, binary_b)

# -- Browser tool wrappers --------------------------------------------------

async def browser_navigate(url: str, wait_until: str = "networkidle") -> Dict[str, Any]:
    """Launch a headless browser, navigate to a URL, and return page info."""
    tool = _get_browser()
    if not tool.is_available():
        return {
            "success": False,
            "error": "Playwright not installed. Run: pip install playwright && playwright install",
        }
    await tool.launch()
    try:
        result = await tool.navigate(url, wait_until=wait_until)
        page_info = await tool.get_page_info()
        result.update(page_info)
        return result
    finally:
        await tool.close()


async def browser_screenshot(url: str, full_page: bool = True) -> Dict[str, Any]:
    """Take a screenshot of a web page and return as base64."""
    tool = _get_browser()
    if not tool.is_available():
        return {
            "success": False,
            "error": "Playwright not installed. Run: pip install playwright && playwright install",
        }
    await tool.launch()
    try:
        nav_result = await tool.navigate(url)
        if not nav_result.get("success"):
            return nav_result
        return await tool.screenshot(full_page=full_page)
    finally:
        await tool.close()


async def browser_extract_text(url: str, selector: Optional[str] = None) -> Dict[str, Any]:
    """Extract text from a web page or a specific element."""
    tool = _get_browser()
    if not tool.is_available():
        return {
            "success": False,
            "error": "Playwright not installed. Run: pip install playwright && playwright install",
        }
    await tool.launch()
    try:
        nav_result = await tool.navigate(url)
        if not nav_result.get("success"):
            return nav_result
        return await tool.extract_text(selector=selector)
    finally:
        await tool.close()


async def browser_click(url: str, selector: str) -> Dict[str, Any]:
    """Navigate to a page and click an element."""
    tool = _get_browser()
    if not tool.is_available():
        return {
            "success": False,
            "error": "Playwright not installed. Run: pip install playwright && playwright install",
        }
    await tool.launch()
    try:
        nav_result = await tool.navigate(url)
        if not nav_result.get("success"):
            return nav_result
        return await tool.click(selector)
    finally:
        await tool.close()


# -- Code search tool wrappers ----------------------------------------------

def code_search(query: str, file_pattern: Optional[str] = None, max_results: int = 50) -> Dict[str, Any]:
    """Search for text across project source files."""
    tool = _get_code_search()
    return tool.search_text(query, file_pattern=file_pattern, max_results=max_results)


def code_find_definition(symbol: str, language: Optional[str] = None) -> Dict[str, Any]:
    """Find where a symbol (function, class, variable) is defined."""
    tool = _get_code_search()
    return tool.find_definition(symbol, language=language)


def code_find_usages(symbol: str) -> Dict[str, Any]:
    """Find all usages of a symbol across the project."""
    tool = _get_code_search()
    return tool.find_usages(symbol)


def code_file_structure(path: str = ".") -> Dict[str, Any]:
    """Get directory/file structure with metadata."""
    tool = _get_code_search()
    return tool.get_file_structure(path)


# -- Database tool wrappers -------------------------------------------------

def db_connect_sqlite(path: str) -> Dict[str, Any]:
    """Connect to a SQLite database file."""
    tool = _get_database()
    success = tool.connect_sqlite(path)
    return {"success": success, "db_type": "sqlite", "path": path}


def db_connect_postgres(
    host: str, database: str, user: str, password: str, port: int = 5432
) -> Dict[str, Any]:
    """Connect to a PostgreSQL database."""
    tool = _get_database()
    try:
        success = tool.connect_postgres(host, database, user, password, port)
        return {"success": success, "db_type": "postgresql", "host": host, "database": database}
    except RuntimeError as exc:
        return {"success": False, "error": str(exc)}


def db_connect_mysql(
    host: str, database: str, user: str, password: str, port: int = 3306
) -> Dict[str, Any]:
    """Connect to a MySQL database."""
    tool = _get_database()
    try:
        success = tool.connect_mysql(host, database, user, password, port)
        return {"success": success, "db_type": "mysql", "host": host, "database": database}
    except RuntimeError as exc:
        return {"success": False, "error": str(exc)}


def db_query(sql: str, params: Optional[tuple] = None) -> Dict[str, Any]:
    """Execute a SQL query on the connected database."""
    tool = _get_database()
    result = tool.query(sql, params=params)
    return result.to_dict()


def db_list_tables() -> Dict[str, Any]:
    """List all tables in the connected database."""
    tool = _get_database()
    tables = tool.list_tables()
    return {"success": True, "tables": tables}


def db_get_schema(table: str) -> Dict[str, Any]:
    """Get the column schema for a table."""
    tool = _get_database()
    return tool.get_schema(table)


def db_disconnect() -> Dict[str, Any]:
    """Close the active database connection."""
    tool = _get_database()
    tool.close()
    return {"success": True, "message": "Disconnected"}


# ---------------------------------------------------------------------------
# Tool definitions (OpenAI function calling format)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    # -- File tools ---------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read the contents of a text file. Use offset and limit to "
                "read large files in chunks. Returns the file content, total "
                "line count, and whether there is more content to read."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file",
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Number of lines to skip from the start (default 0)",
                        "default": 0,
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of lines to read (default 100)",
                        "default": 100,
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Write or overwrite a text file with the given content. "
                "Use append=True to append instead of overwrite. "
                "Parent directories are created automatically."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Absolute or relative path to the file",
                    },
                    "content": {
                        "type": "string",
                        "description": "Text content to write",
                    },
                    "append": {
                        "type": "boolean",
                        "description": "If true, append to the file instead of overwriting",
                        "default": False,
                    },
                },
                "required": ["file_path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": (
                "List files and directories with metadata. Returns name, type, "
                "size, modified timestamp, and permissions for each entry."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "dir_path": {
                        "type": "string",
                        "description": "Directory path (default: current directory)",
                        "default": ".",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": (
                "Search for text inside files (grep-like). Searches file contents "
                "using a regex pattern. Returns matching file path, line number, "
                "column, and the matching text. Skips binary files and hidden directories."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text string or regex pattern to search for",
                    },
                    "dir_path": {
                        "type": "string",
                        "description": "Root directory to search in (default: current directory)",
                        "default": ".",
                    },
                    "glob_pattern": {
                        "type": "string",
                        "description": "File glob pattern to filter files (default: * for all)",
                        "default": "*",
                    },
                },
                "required": ["query"],
            },
        },
    },
    # -- Shell tools --------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": (
                "Execute a shell command and return structured output including "
                "stdout, stderr, exit code, and duration. Dangerous commands are "
                "automatically blocked for safety."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory (default: current directory)",
                        "default": ".",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Maximum execution time in seconds (default 60, max 300)",
                        "default": 60,
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_test",
            "description": (
                "Run the project's test suite. Auto-detects the test framework "
                "from project files (npm test, pytest, cargo test, go test, etc.). "
                "Returns test output, pass/fail status, and exit code."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "test_command": {
                        "type": "string",
                        "description": "Test command to run (default: auto-detect)",
                        "default": "npm test",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory (default: current directory)",
                        "default": ".",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "install_dependency",
            "description": (
                "Install a package dependency. Auto-detects the package manager "
                "(npm, pip, cargo, go get, bundler) from project files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "package": {
                        "type": "string",
                        "description": "Package name to install (e.g. 'requests', 'lodash')",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory (default: current directory)",
                        "default": ".",
                    },
                },
                "required": ["package"],
            },
        },
    },
    # -- Git tools ----------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "git_status",
            "description": (
                "Get the git working tree status. Returns current branch, "
                "ahead/behind counts, and lists of staged, unstaged, and untracked files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cwd": {
                        "type": "string",
                        "description": "Repository working directory (default: current directory)",
                        "default": ".",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_diff",
            "description": (
                "Show changes between commits, commit and working tree, etc. "
                "Returns the diff text and list of changed files."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cwd": {
                        "type": "string",
                        "description": "Repository working directory",
                        "default": ".",
                    },
                    "staged": {
                        "type": "boolean",
                        "description": "If true, show staged changes instead of unstaged",
                        "default": False,
                    },
                    "file_path": {
                        "type": "string",
                        "description": "If provided, limit diff to this file",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_commit",
            "description": (
                "Create a git commit. Auto-stages all modified and deleted files. "
                "Returns the commit hash and message."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Commit message",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Repository working directory",
                        "default": ".",
                    },
                    "auto_stage": {
                        "type": "boolean",
                        "description": "If true, stage all changes before committing",
                        "default": True,
                    },
                },
                "required": ["message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_branch",
            "description": (
                "List git branches or create a new branch. Returns current branch "
                "and a list of all branches with their names and current status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cwd": {
                        "type": "string",
                        "description": "Repository working directory",
                        "default": ".",
                    },
                    "create": {
                        "type": "string",
                        "description": "If provided, create a new branch with this name",
                    },
                    "list_all": {
                        "type": "boolean",
                        "description": "If true, list all branches",
                        "default": True,
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_log",
            "description": (
                "Show commit history. Returns structured commit info with hash, "
                "author, date, and message for each commit."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cwd": {
                        "type": "string",
                        "description": "Repository working directory",
                        "default": ".",
                    },
                    "max_count": {
                        "type": "integer",
                        "description": "Maximum number of commits to return (default 20)",
                        "default": 20,
                    },
                    "file_path": {
                        "type": "string",
                        "description": "If provided, only show commits affecting this file",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_checkout",
            "description": (
                "Switch to a different git branch or commit. Returns the current "
                "branch after the operation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Branch name, commit hash, or file path to checkout",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Repository working directory",
                        "default": ".",
                    },
                    "create": {
                        "type": "boolean",
                        "description": "If true, create the branch if it doesn't exist",
                        "default": False,
                    },
                },
                "required": ["target"],
            },
        },
    },
    # -- Document conversion tools (MarkItDown) -----------------------------
    {
        "type": "function",
        "function": {
            "name": "convert_document",
            "description": (
                "Convert a document to Markdown. Supports 20+ formats: PDF, DOCX, "
                "PPTX, XLSX, HTML, CSV, JSON, XML, ZIP, EPUB, images (OCR), audio "
                "(transcription), and plain text. Returns the markdown text, document "
                "title, and output path if written to disk."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Absolute or relative path to the document file",
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Optional path to write the Markdown output",
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "batch_convert_documents",
            "description": (
                "Convert all supported documents in a directory (recursively) to "
                "Markdown. Returns the number converted, failed, and skipped, plus "
                "per-file results."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Root directory to scan for convertible files",
                    },
                    "output_dir": {
                        "type": "string",
                        "description": "Directory where Markdown outputs will be written",
                    },
                },
                "required": ["directory", "output_dir"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_document_structure",
            "description": (
                "Extract structure from a document: headings, tables, lists, "
                "word count, and character count. Useful for understanding document "
                "organization without reading the full content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the document to analyze",
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    # -- Binary analysis tools (Ghidra) --------------------------------------
    {
        "type": "function",
        "function": {
            "name": "analyze_binary",
            "description": (
                "Analyze a binary executable with NSA Ghidra. Returns functions, "
                "strings, memory sections, imports, and metadata. Requires Ghidra "
                "to be installed separately at /opt/ghidra or a custom path."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "binary_path": {
                        "type": "string",
                        "description": "Absolute path to the binary file to analyze",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Name for the temporary Ghidra project",
                        "default": "construct_analysis",
                    },
                },
                "required": ["binary_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "decompile_function",
            "description": (
                "Decompile a specific function from a binary to C pseudocode using "
                "Ghidra's decompiler. Returns the C code, function signature, and "
                "entry address. Requires Ghidra to be installed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "binary_path": {
                        "type": "string",
                        "description": "Path to the binary file",
                    },
                    "function_name": {
                        "type": "string",
                        "description": "Name of the function to decompile (e.g., main)",
                    },
                },
                "required": ["binary_path", "function_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_vulnerabilities",
            "description": (
                "Scan a binary for potential security vulnerabilities. Detects "
                "dangerous function calls (strcpy, sprintf, gets, system, etc.), "
                "suspicious strings, and missing protections (NX, canary, PIE, RELRO). "
                "Returns a severity score (0-100) and actionable recommendations. "
                "Requires Ghidra to be installed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "binary_path": {
                        "type": "string",
                        "description": "Path to the binary file to scan",
                    },
                },
                "required": ["binary_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_binaries",
            "description": (
                "Compare two binaries and report differences in functions, strings, "
                "and metadata. Returns a similarity score (0.0 to 1.0) and lists of "
                "functions/strings unique to each binary. Requires Ghidra to be installed."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "binary_a": {
                        "type": "string",
                        "description": "Path to the first binary",
                    },
                    "binary_b": {
                        "type": "string",
                        "description": "Path to the second binary",
                    },
                },
                "required": ["binary_a", "binary_b"],
            },
        },
    },
    # -- Code tools ---------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "parse_ast",
            "description": (
                "Parse a source file into an AST structure. Supports Python and "
                "JavaScript/TypeScript (JS uses regex fallback). Returns functions, "
                "classes, imports, and the full AST structure."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the source file",
                    },
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_references",
            "description": (
                "Find all references to a symbol (variable, function, class) "
                "in a source file. Returns line numbers, columns, and context "
                "for each reference."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "The symbol name to search for",
                    },
                    "file_path": {
                        "type": "string",
                        "description": "Path to the source file",
                    },
                },
                "required": ["symbol", "file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refactor_rename",
            "description": (
                "Rename a symbol (function, class, variable) in a source file. "
                "Returns the number of renames performed and a preview of the "
                "modified source. The caller must write the result back with write_file."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "old_name": {
                        "type": "string",
                        "description": "Current symbol name",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "New symbol name",
                    },
                    "file_path": {
                        "type": "string",
                        "description": "Path to the source file",
                    },
                },
                "required": ["old_name", "new_name", "file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_function",
            "description": (
                "Extract a block of code (from start_line to end_line) into a "
                "new named function. Returns the extracted function source code "
                "which the caller can then insert elsewhere with write_file."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the source file (for language detection)",
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "First line to extract (1-based)",
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Last line to extract (1-based, inclusive)",
                    },
                    "new_name": {
                        "type": "string",
                        "description": "Name for the extracted function",
                    },
                },
                "required": ["file_path", "start_line", "end_line", "new_name"],
            },
        },
    },
    # -- Browser tools --------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": (
                "Launch a headless browser, navigate to a URL, and return page "
                "information including title, status, and URL. Supports wait strategies "
                "(networkidle, load, domcontentloaded). Closes browser automatically."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to navigate to",
                    },
                    "wait_until": {
                        "type": "string",
                        "description": "When to consider navigation complete: networkidle, load, domcontentloaded",
                        "default": "networkidle",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_screenshot",
            "description": (
                "Take a screenshot of a web page and return it as a base64-encoded "
                "PNG image. Supports full-page capture. Useful for visual verification "
                "of rendered pages."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to screenshot",
                    },
                    "full_page": {
                        "type": "boolean",
                        "description": "Capture the full scrollable page (default: true)",
                        "default": True,
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_extract_text",
            "description": (
                "Extract visible text from a web page or a specific CSS selector. "
                "Returns the extracted text and the count of matched elements. "
                "Useful for scraping content from web pages."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to extract text from",
                    },
                    "selector": {
                        "type": "string",
                        "description": "Optional CSS selector to extract text from a specific element (e.g., 'article', '#main')",
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": (
                "Navigate to a URL and click an element identified by a CSS selector. "
                "Useful for interacting with buttons, links, and form elements on web pages. "
                "Returns success status of the click operation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL of the page containing the element",
                    },
                    "selector": {
                        "type": "string",
                        "description": "CSS selector for the element to click (e.g., 'button#submit', 'a.login')",
                    },
                },
                "required": ["url", "selector"],
            },
        },
    },
    # -- Code search tools ----------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "code_search",
            "description": (
                "Search for text across project source files using ripgrep (fast) or "
                "a Python fallback. Supports regex patterns, file glob filters, and "
                "configurable result limits. Returns file paths, line numbers, columns, "
                "and matching context."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text string or regex pattern to search for",
                    },
                    "file_pattern": {
                        "type": "string",
                        "description": "Glob pattern to filter files (e.g., '*.py', '*.js')",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of matches to return (default 50)",
                        "default": 50,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_find_definition",
            "description": (
                "Find where a symbol (function, class, variable, trait, struct, etc.) "
                "is defined in the codebase. Uses language-aware patterns for Python, "
                "JavaScript, TypeScript, Rust, Go, Java, C, C++, Ruby, PHP, Swift, and Kotlin. "
                "Returns file paths, line numbers, and surrounding context."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "The symbol name to find definitions for",
                    },
                    "language": {
                        "type": "string",
                        "description": "Optional: restrict search to a specific language (e.g., 'python', 'rust')",
                    },
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_find_usages",
            "description": (
                "Find all references/usages of a symbol across the entire project. "
                "Returns every occurrence with file path, line number, column, and "
                "context line. Useful for refactoring and understanding code impact."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "The symbol name to find usages of",
                    },
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_file_structure",
            "description": (
                "List files and directories within a project path with metadata "
                "(name, type, size, modification time). Skips hidden directories "
                "and common build artifacts. Useful for exploring project layout."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to explore (default: project root)",
                        "default": ".",
                    },
                },
                "required": [],
            },
        },
    },
    # -- Database tools -------------------------------------------------------
    {
        "type": "function",
        "function": {
            "name": "db_connect_sqlite",
            "description": (
                "Connect to a SQLite database file (or :memory: for in-memory). "
                "Connection persists for subsequent db_query calls. Use db_disconnect "
                "to close the connection."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the SQLite database file, or ':memory:'",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "db_connect_postgres",
            "description": (
                "Connect to a PostgreSQL database server. Requires psycopg2-binary "
                "to be installed. Connection persists for subsequent db_query calls."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "host": {
                        "type": "string",
                        "description": "Database server hostname or IP",
                    },
                    "database": {
                        "type": "string",
                        "description": "Name of the database to connect to",
                    },
                    "user": {
                        "type": "string",
                        "description": "Database username",
                    },
                    "password": {
                        "type": "string",
                        "description": "Database password",
                    },
                    "port": {
                        "type": "integer",
                        "description": "TCP port (default 5432)",
                        "default": 5432,
                    },
                },
                "required": ["host", "database", "user", "password"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "db_connect_mysql",
            "description": (
                "Connect to a MySQL database server. Requires pymysql to be installed. "
                "Connection persists for subsequent db_query calls."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "host": {
                        "type": "string",
                        "description": "Database server hostname or IP",
                    },
                    "database": {
                        "type": "string",
                        "description": "Name of the database/schema to connect to",
                    },
                    "user": {
                        "type": "string",
                        "description": "Database username",
                    },
                    "password": {
                        "type": "string",
                        "description": "Database password",
                    },
                    "port": {
                        "type": "integer",
                        "description": "TCP port (default 3306)",
                        "default": 3306,
                    },
                },
                "required": ["host", "database", "user", "password"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "db_query",
            "description": (
                "Execute a SQL query on the currently connected database. "
                "Supports SELECT, INSERT, UPDATE, DELETE, CREATE, and DDL statements. "
                "Use parameterized queries via the params argument for safety. "
                "Returns columns, rows, row count, and execution duration."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {
                        "type": "string",
                        "description": "SQL query string to execute",
                    },
                    "params": {
                        "type": "string",
                        "description": "Optional: JSON array of parameter values for parameterized queries",
                    },
                },
                "required": ["sql"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "db_list_tables",
            "description": (
                "List all tables/views in the currently connected database. "
                "Works for SQLite, PostgreSQL, and MySQL."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "db_get_schema",
            "description": (
                "Get the column schema for a table: column names, data types, "
                "nullability, defaults, and primary key status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "table": {
                        "type": "string",
                        "description": "Name of the table to describe",
                    },
                },
                "required": ["table"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "db_disconnect",
            "description": (
                "Close the active database connection. Call this when done "
                "with database operations to release resources."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Tool dispatch map
# ---------------------------------------------------------------------------

_TOOL_FUNCTIONS: Dict[str, Callable] = {
    # File tools
    "read_file": read_file,
    "write_file": write_file,
    "list_directory": list_directory,
    "search_files": search_files,
    # Shell tools
    "execute_command": execute_command,
    "run_test": run_test,
    "install_dependency": install_dependency,
    # Git tools
    "git_status": git_status,
    "git_diff": git_diff,
    "git_commit": git_commit,
    "git_branch": git_branch,
    "git_log": git_log,
    "git_checkout": git_checkout,
    # Document conversion tools
    "convert_document": convert_document,
    "batch_convert_documents": batch_convert_documents,
    "extract_document_structure": extract_document_structure,
    # Binary analysis tools
    "analyze_binary": analyze_binary,
    "decompile_function": decompile_function,
    "find_vulnerabilities": find_vulnerabilities,
    "compare_binaries": compare_binaries,
    # Code tools
    "parse_ast": parse_ast,
    "find_references": find_references,
    "refactor_rename": refactor_rename,
    "extract_function": extract_function,
    # Browser tools
    "browser_navigate": browser_navigate,
    "browser_screenshot": browser_screenshot,
    "browser_extract_text": browser_extract_text,
    "browser_click": browser_click,
    # Code search tools
    "code_search": code_search,
    "code_find_definition": code_find_definition,
    "code_find_usages": code_find_usages,
    "code_file_structure": code_file_structure,
    # Database tools
    "db_connect_sqlite": db_connect_sqlite,
    "db_connect_postgres": db_connect_postgres,
    "db_connect_mysql": db_connect_mysql,
    "db_query": db_query,
    "db_list_tables": db_list_tables,
    "db_get_schema": db_get_schema,
    "db_disconnect": db_disconnect,
}

# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------


class ToolRegistry:
    """
    Central registry for all agent tools.

    Collects tool schemas for LLM function calling and dispatches
    execution requests to the correct tool function.
    """

    def __init__(self) -> None:
        self._tools: Dict[str, Callable] = dict(_TOOL_FUNCTIONS)
        self._schemas: Dict[str, Dict[str, Any]] = {
            s["function"]["name"]: s for s in TOOL_DEFINITIONS
        }

        # Load installed skills
        self._load_skills_from_directory()

        # Bridge MCP tools if enabled
        self._register_mcp_tools()

    # -- Schema access ------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """
        Return all tool schemas in OpenAI function calling format.

        Returns
        -------
        list[dict]
            Tool definitions ready to pass to an LLM's ``tools`` parameter.
            Includes both statically defined and dynamically discovered tools.
        """
        return list(self._schemas.values())

    def get_tool_names(self) -> List[str]:
        """Return a list of all registered tool names."""
        return list(self._tools.keys())

    def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get the schema for a single tool by name."""
        return self._schemas.get(tool_name)

    def get_tool_description(self, tool_name: str) -> str:
        """Get the human-readable description for a tool."""
        schema = self._schemas.get(tool_name)
        if schema:
            return schema.get("function", {}).get("description", "")
        return ""

    # -- Tool execution -----------------------------------------------------

    def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a tool by name with the given arguments.

        Parameters
        ----------
        tool_name:
            The registered name of the tool (e.g. ``"read_file"``).
        arguments:
            Keyword arguments to pass to the tool function.

        Returns
        -------
        dict
            The tool's result.  If the tool is not found, returns a dict
            with ``success: False`` and an error message.
        """
        if tool_name not in self._tools:
            available = ", ".join(sorted(self._tools.keys()))
            logger.error("Unknown tool: %s (available: %s)", tool_name, available)
            return {
                "success": False,
                "error": f"Unknown tool: '{tool_name}'. Available tools: {available}",
            }

        tool_func = self._tools[tool_name]
        logger.info(
            "Executing tool: %s(%s)",
            tool_name,
            ", ".join(f"{k}={repr(v)[:60]}" for k, v in arguments.items()),
        )

        try:
            # Inspect the function to determine if it's async
            if inspect.iscoroutinefunction(tool_func):
                import asyncio
                import concurrent.futures

                try:
                    # Check if we're already in an event loop (e.g., FastAPI)
                    asyncio.get_running_loop()
                    # We're in an async context — run in a thread pool
                    # to avoid "asyncio.run() cannot be called from a running loop"
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                        future = pool.submit(asyncio.run, tool_func(**arguments))
                        result = future.result()
                except RuntimeError:
                    # No running loop — safe to use asyncio.run directly
                    result = asyncio.run(tool_func(**arguments))
            else:
                result = tool_func(**arguments)

            # Normalize non-dict returns
            if not isinstance(result, dict):
                result = {"success": True, "output": result}

            return result

        except Exception as exc:
            logger.exception("Tool %s failed", tool_name)
            return {"success": False, "error": f"Tool execution failed: {exc}"}

    def has_tool(self, tool_name: str) -> bool:
        """Return *True* if the named tool is registered."""
        return tool_name in self._tools

    # -- Registration (extensibility) ---------------------------------------

    def register_tool(
        self,
        name: str,
        func: Callable,
        schema: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Register a new tool at runtime.

        Parameters
        ----------
        name:
            The tool name (used in LLM function calling).
        func:
            The callable to execute.
        schema:
            Optional OpenAI-format schema for the tool.
        """
        self._tools[name] = func
        if schema:
            self._schemas[name] = schema
        logger.info("Registered tool: %s", name)

    def unregister_tool(self, name: str) -> None:
        """Remove a tool from the registry."""
        self._tools.pop(name, None)
        self._schemas.pop(name, None)
        logger.info("Unregistered tool: %s", name)

    # -- Schema generation for dynamic tools --------------------------------

    def _make_tool_schema(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Create an OpenAI function-calling schema for a dynamically discovered tool.

        Parameters
        ----------
        name:
            The tool name used in LLM function calling.
        description:
            Human-readable description of what the tool does.
        parameters:
            A dictionary matching the OpenAI ``parameters`` format, i.e.
            ``{"type": "object", "properties": {...}, "required": [...]}``.
            If empty, a minimal schema with no required parameters is generated.

        Returns
        -------
        dict
            A complete tool definition in OpenAI function-calling format.
        """
        if not parameters:
            parameters = {"type": "object", "properties": {}, "required": []}
        return {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            },
        }

    # -- Skill loading ------------------------------------------------------

    def _load_skills_from_directory(self) -> None:
        """Scan installed/bundled skill directories and register their tools.

        Looks for skill manifests (``SKILL.md`` or ``skill.json``) under
        ``resources/skills/installed/`` and ``resources/skills/bundled/``.
        For each skill found, attempts to import a companion Python module
        (``tool.py`` or ``main.py``) and register any tool functions it exposes.

        The skill module may expose tools in two ways:

        1. A ``register(registry)`` function that receives this :class:`ToolRegistry`
           and calls :meth:`register_tool` for each tool it wants to add.
        2. Functions decorated with a ``__tool_metadata__`` attribute (a dict
           with ``name``, ``description``, and ``parameters`` keys).

        Failures for individual skills are logged as warnings and do **not**
        prevent other skills from loading.
        """
        skill_dirs: List[Path] = []
        for base in ("resources/skills/installed", "resources/skills/bundled"):
            p = Path(base)
            if p.is_dir():
                for child in sorted(p.iterdir()):
                    if child.is_dir():
                        skill_dirs.append(child)

        if not skill_dirs:
            logger.debug("No skill directories found — skipping skill loading")
            return

        loaded_count = 0
        for skill_dir in skill_dirs:
            try:
                self._load_single_skill(skill_dir)
                loaded_count += 1
            except Exception as exc:
                logger.warning(
                    "Failed to load skill from %s: %s", skill_dir, exc
                )

        if loaded_count:
            logger.info("Loaded %d skill(s) into tool registry", loaded_count)

    def _load_single_skill(self, skill_dir: Path) -> None:
        """Load and register tools from a single skill directory.

        Parameters
        ----------
        skill_dir:
            Path to the skill directory containing a manifest and optional
            Python tool module.
        """
        # --- Locate manifest ---------------------------------------------------
        manifest: Optional[Path] = None
        for candidate in ("SKILL.md", "skill.json"):
            candidate_path = skill_dir / candidate
            if candidate_path.is_file():
                manifest = candidate_path
                break

        if manifest is None:
            logger.debug("No manifest found in %s — skipping", skill_dir)
            return

        skill_name = skill_dir.name
        logger.info("Loading skill: %s (manifest: %s)", skill_name, manifest.name)

        # --- Locate Python module ----------------------------------------------
        module_path: Optional[Path] = None
        for candidate in ("tool.py", "main.py"):
            candidate_path = skill_dir / candidate
            if candidate_path.is_file():
                module_path = candidate_path
                break

        if module_path is None:
            logger.debug(
                "No Python module (tool.py/main.py) in %s — skill has no tools",
                skill_dir,
            )
            return

        # --- Dynamic import ----------------------------------------------------
        module_name = f"skills.custom.{skill_name}"
        spec = importlib.util.spec_from_file_location(module_name, module_path)
        if spec is None or spec.loader is None:
            logger.warning(
                "Could not create import spec for %s — skipping", module_path
            )
            return

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # --- Register tools from module ----------------------------------------
        # Strategy 1: module has a register(registry) function
        if hasattr(module, "register") and callable(module.register):
            module.register(self)
            logger.debug(
                "Skill %s registered tools via register() function", skill_name
            )
            return

        # Strategy 2: functions with __tool_metadata__ decorator attribute
        registered_from_module = 0
        for attr_name in dir(module):
            obj = getattr(module, attr_name, None)
            if obj is None or not callable(obj):
                continue
            metadata = getattr(obj, "__tool_metadata__", None)
            if not isinstance(metadata, dict):
                continue

            tool_name = metadata.get("name", attr_name)
            tool_desc = metadata.get("description", inspect.getdoc(obj) or "")
            tool_params = metadata.get("parameters", {})

            schema = self._make_tool_schema(tool_name, tool_desc, tool_params)
            self.register_tool(tool_name, obj, schema)
            registered_from_module += 1

        if registered_from_module:
            logger.debug(
                "Skill %s registered %d tool(s) via __tool_metadata__",
                skill_name,
                registered_from_module,
            )
        else:
            logger.debug(
                "Skill %s module loaded but no tools discovered", skill_name
            )

    # -- MCP tool bridge ----------------------------------------------------

    def _register_mcp_tools(self) -> None:
        """Bridge MCP server tools into the tool registry.

        If the ``CONSTRUCT_MCP_ENABLED`` environment variable is set to ``1``,
        this method attempts to connect to any MCP servers specified via
        environment variables and registers their tools in this registry.

        At startup, this only connects to servers whose connection details
        are provided via the ``CONSTRUCT_MCP_SERVERS`` env var (JSON array
        of ``{"name", "command", "args"}`` objects).

        Runtime connections are handled via :meth:`register_mcp_server_tools`
        which is called by the ``POST /mcp/connect`` API endpoint.

        Each MCP tool is exposed as a regular tool function that internally
        delegates to the stdio MCP connection manager.  The wrapper handles
        the async-to-sync bridging transparently.

        Failures are logged as warnings and do **not** prevent the registry
        from functioning.
        """
        if os.environ.get("CONSTRUCT_MCP_ENABLED") != "1":
            logger.debug("MCP bridging disabled (CONSTRUCT_MCP_ENABLED != 1)")
            return

        # Initialize the shared MCP connection manager
        self._mcp_manager = self._get_mcp_manager()

        # Auto-connect to servers specified via environment variable
        servers_json = os.environ.get("CONSTRUCT_MCP_SERVERS", "")
        if servers_json:
            try:
                import asyncio
                servers = json.loads(servers_json)
                for srv in servers:
                    try:
                        from mcp.connection_manager import StdioServerConfig
                        config = StdioServerConfig(
                            name=srv["name"],
                            command=srv["command"],
                            args=srv.get("args", []),
                            env=srv.get("env"),
                        )
                        success = asyncio.run(self._mcp_manager.connect_stdio(srv["name"], config))
                        if success:
                            self.register_mcp_server_tools(srv["name"])
                            logger.info("Auto-connected MCP server: %s", srv["name"])
                        else:
                            logger.warning("Failed to auto-connect MCP server: %s", srv["name"])
                    except Exception as exc:
                        logger.warning("Failed to auto-connect MCP server %s: %s", srv.get("name", "?"), exc)
            except json.JSONDecodeError as exc:
                logger.warning("Invalid CONSTRUCT_MCP_SERVERS JSON: %s", exc)
            except Exception as exc:
                logger.warning("Error processing CONSTRUCT_MCP_SERVERS: %s", exc)

        logger.info("MCP tool bridge initialized (manager=%s)", type(self._mcp_manager).__name__)

    # -- MCP runtime tool registration ---------------------------------------

    _mcp_manager: Optional[Any] = None

    @classmethod
    def _get_mcp_manager(cls):
        """Return (creating if needed) the shared MCPConnectionManager."""
        from mcp.connection_manager import MCPConnectionManager
        if cls._mcp_manager is None:
            cls._mcp_manager = MCPConnectionManager()
        return cls._mcp_manager

    def register_mcp_server_tools(self, server_name: str) -> int:
        """Register all tools from a connected stdio MCP server.

        Called after ``MCPConnectionManager.connect_stdio()`` succeeds.
        Creates wrapper functions for each discovered tool and registers
        them in the tool registry so the agent can use them in the ReAct loop.

        Args:
            server_name: The connected MCP server identifier.

        Returns:
            Number of tools registered.
        """
        manager = self._get_mcp_manager()
        conn = manager._stdio_connections.get(server_name)
        if conn is None:
            logger.warning("Cannot register tools: stdio server '%s' not connected", server_name)
            return 0

        registered_count = 0
        for mcp_tool in conn.tools:
            try:
                tool_name = f"mcp_{server_name}_{mcp_tool.name}"

                # Build a closure that captures the tool info
                def _make_stdio_wrapper(
                    srv_name: str, tool_name_inner: str, mgr: Any
                ) -> Callable[..., Dict[str, Any]]:
                    """Create a sync wrapper for an async MCP stdio tool call.

                    Handles the tricky async-to-sync bridging: MCP stdio
                    connections use subprocess pipes that are bound to a
                    specific event loop.  When called from FastAPI (which
                    runs its own loop), we must schedule the coroutine on
                    that running loop rather than creating a new one.
                    """

                    # Store a reference to the loop where the connection was created
                    # so we can schedule coroutines on it from other threads.
                    _origin_loop: Optional[Any] = None
                    import asyncio as _asyncio
                    try:
                        _origin_loop = _asyncio.get_running_loop()
                    except RuntimeError:
                        pass

                    def wrapper(**kwargs: Any) -> Dict[str, Any]:
                        import asyncio
                        import concurrent.futures

                        async def _call() -> Dict[str, Any]:
                            return await mgr.call_stdio_tool(srv_name, tool_name_inner, kwargs)

                        # Strategy 1: If we're on the same loop as the connection,
                        # use run_coroutine_threadsafe from a worker thread.
                        origin = _origin_loop
                        if origin is not None and origin.is_running():
                            future = asyncio.run_coroutine_threadsafe(_call(), origin)
                            try:
                                return future.result(timeout=60)
                            except Exception as exc:
                                return {
                                    "success": False,
                                    "error": str(exc),
                                    "tool": tool_name_inner,
                                    "server": srv_name,
                                }

                        # Strategy 2: No running loop — create one
                        try:
                            loop = asyncio.get_running_loop()
                            # We're in an async context but not on the origin loop.
                            # Run in a separate thread.
                            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                                future = pool.submit(asyncio.run, _call())
                                return future.result(timeout=60)
                        except RuntimeError:
                            return asyncio.run(_call())

                    return wrapper

                tool_func = _make_stdio_wrapper(server_name, mcp_tool.name, manager)

                # Preserve original function name for inspect / logging
                tool_func.__name__ = tool_name
                tool_func.__qualname__ = tool_name

                # Build schema from MCP tool metadata
                description = mcp_tool.description or f"MCP tool: {mcp_tool.name} (server: {server_name})"
                parameters = mcp_tool.input_schema if isinstance(mcp_tool.input_schema, dict) else {}
                schema = self._make_tool_schema(tool_name, description, parameters)

                self.register_tool(tool_name, tool_func, schema)
                registered_count += 1

            except Exception as exc:
                logger.warning(
                    "Failed to register MCP tool %s/%s: %s",
                    server_name,
                    mcp_tool.name,
                    exc,
                )

        if registered_count > 0:
            logger.info(
                "MCP tool bridge: registered %d tool(s) from stdio server '%s'",
                registered_count,
                server_name,
            )
        return registered_count

    def unregister_mcp_server_tools(self, server_name: str) -> int:
        """Unregister all tools from a disconnected stdio MCP server.

        Args:
            server_name: The MCP server identifier.

        Returns:
            Number of tools unregistered.
        """
        prefix = f"mcp_{server_name}_"
        tools_to_remove = [name for name in self._tools if name.startswith(prefix)]
        for name in tools_to_remove:
            self.unregister_tool(name)
        if tools_to_remove:
            logger.info(
                "MCP tool bridge: unregistered %d tool(s) from stdio server '%s'",
                len(tools_to_remove),
                server_name,
            )
        return len(tools_to_remove)


# Convenience singleton
_default_registry: Optional[ToolRegistry] = None


def get_registry() -> ToolRegistry:
    """Return the default tool registry singleton."""
    global _default_registry
    if _default_registry is None:
        _default_registry = ToolRegistry()
    return _default_registry
