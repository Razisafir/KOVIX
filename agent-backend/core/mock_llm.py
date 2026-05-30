"""
Mock LLM provider for deterministic CI testing.

No API keys, no network, no external dependencies. Returns predictable JSON
responses that the executor's ReAct loop can consume.

Supported scenarios:
    - file_creation: Creates files using write_file tool
    - bug_fix: Reads files, applies fixes using write_file
    - refactor: Reads, rewrites, verifies

Usage:
    # In tests
    os.environ["LLM_PROVIDER"] = "mock"
    llm = LLMService()  # Will auto-select mock provider

    # Or explicitly
    llm = LLMService(provider_override="mock")
"""

import json
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class Message:
    """Minimal Message class for compatibility."""

    def __init__(self, role: str = "user", content: str = ""):
        self.role = role
        self.content = content


class MockLLMProvider:
    """
    Deterministic LLM for testing the ReAct loop without real LLM calls.

    The provider analyses the conversation to determine intent (file creation,
    bug fix, etc.) and returns structured JSON responses that match what the
    executor expects from real LLMs.
    """

    def __init__(self, scenario: Optional[str] = None, delay_ms: float = 0.0) -> None:
        self.scenario = scenario or "default"
        self.delay_ms = delay_ms
        self._call_count = 0
        self._act_call_count = 0  # Separate counter for acting phase
        self._max_tool_calls = 5
        logger.info("MockLLMProvider initialised (scenario=%s)", self.scenario)

    # -- Internal helpers --------------------------------------------------

    def _detect_intent(self, messages) -> str:
        """Determine intent from conversation content."""
        text = " ".join(
            m.content if hasattr(m, "content") else str(m.get("content", ""))
            for m in messages
        ).lower()

        if any(w in text for w in ["create", "make", "generate", "new file", "write a"]):
            return "file_creation"
        if any(w in text for w in ["fix", "bug", "error", "broken", "repair", "typo"]):
            return "bug_fix"
        if any(w in text for w in ["refactor", "rewrite", "restructure", "clean up"]):
            return "refactor"
        return self.scenario

    def _extract_filename(self, text: str) -> Optional[str]:
        """Try to extract a filename from the conversation."""
        import re

        patterns = [
            r"([\w/]+\.(py|js|ts|tsx|rs|go|java|cpp|c|h|html|css|json|md|yml|yaml|txt))",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                return m.group(1)
        return None

    # -- LLMService-compatible interface -----------------------------------

    async def complete(self, messages, **kwargs: Any) -> str:
        """
        Return a deterministic response based on conversation context.

        The executor calls this for both PLANNING and ACTING phases.
        We distinguish between them by the message content.
        """
        import asyncio

        if self.delay_ms > 0:
            await asyncio.sleep(self.delay_ms / 1000)

        self._call_count += 1
        text = " ".join(
            m.content if hasattr(m, "content") else str(m.get("content", ""))
            for m in messages
        )

        # Phase detection:
        # - Planning: long prompt with PLANNING_PROMPT_TEMPLATE (contains "decompose")
        # - Acting: contains "Available tools" or "Current Task"
        # - Fallback: if the message looks like a creation/fix/refactor request
        #   but doesn't match planning or acting patterns, treat it as planning.
        is_planning = "decompose" in text.lower() or "json array of task" in text.lower()
        is_acting = "available tools" in text.lower() or "current task" in text.lower()
        # Detect task-like messages that should produce a plan (JSON list)
        is_task_request = any(
            w in text.lower()
            for w in ["create", "make", "generate", "new file", "write a", "fix", "bug", "refactor"]
        )

        if is_planning:
            return self._plan_response(text)
        elif is_acting:
            self._act_call_count += 1
            return self._act_response(text)
        elif is_task_request:
            # Treat simple task requests as planning to return a JSON task list
            return self._plan_response(text)
        else:
            return self._generic_response(text)

    async def stream_complete(self, messages, **kwargs: Any):
        """Stream word by word (required interface)."""
        response = await self.complete(messages, **kwargs)
        for word in response.split():
            yield word + " "

    # -- Response generators -----------------------------------------------

    def _plan_response(self, text: str) -> str:
        """Generate a task plan (JSON array of tasks)."""
        intent = self._detect_intent([{"content": text}])

        if intent == "file_creation":
            filename = self._extract_filename(text) or "output.txt"
            tasks = [
                {
                    "id": "task-1",
                    "description": f"Create {filename} with the required content",
                },
                {
                    "id": "task-2",
                    "description": f"Verify {filename} was created correctly",
                },
            ]
        elif intent == "bug_fix":
            filename = self._extract_filename(text) or "buggy.py"
            tasks = [
                {"id": "task-1", "description": f"Read {filename} to identify the bug"},
                {"id": "task-2", "description": f"Fix the bug in {filename}"},
                {"id": "task-3", "description": f"Verify the fix works"},
            ]
        elif intent == "refactor":
            filename = self._extract_filename(text) or "main.py"
            tasks = [
                {"id": "task-1", "description": f"Read current {filename}"},
                {
                    "id": "task-2",
                    "description": f"Refactor {filename} with improvements",
                },
                {"id": "task-3", "description": f"Verify refactored code works"},
            ]
        else:
            tasks = [
                {"id": "task-1", "description": "Analyse the requirements"},
                {"id": "task-2", "description": "Implement the solution"},
                {"id": "task-3", "description": "Verify the result"},
            ]

        return json.dumps(tasks)

    def _act_response(self, text: str) -> str:
        """Generate a tool call for the acting phase."""
        intent = self._detect_intent([{"content": text}])
        filename = self._extract_filename(text) or "output.txt"

        call_idx = self._act_call_count % self._max_tool_calls

        if intent == "file_creation":
            if call_idx == 1:
                return json.dumps(
                    {
                        "tool": "write_file",
                        "arguments": {
                            "path": filename,
                            "content": 'print("Hello, Construct!")',
                        },
                        "reasoning": f"Creating {filename} with the required content",
                    }
                )
            else:
                return json.dumps(
                    {"done": True, "summary": f"Created {filename} successfully"}
                )

        elif intent == "bug_fix":
            if call_idx == 1:
                return json.dumps(
                    {
                        "tool": "read_file",
                        "arguments": {"path": filename},
                        "reasoning": f"Reading {filename} to find the bug",
                    }
                )
            elif call_idx == 2:
                return json.dumps(
                    {
                        "tool": "write_file",
                        "arguments": {
                            "path": filename,
                            "content": 'print("Hello")\nprint("World")  # fixed\n',
                        },
                        "reasoning": "Fixing the typo",
                    }
                )
            else:
                return json.dumps(
                    {"done": True, "summary": f"Fixed bug in {filename}"}
                )

        elif intent == "refactor":
            if call_idx == 1:
                return json.dumps(
                    {
                        "tool": "read_file",
                        "arguments": {"path": filename},
                        "reasoning": f"Reading {filename} before refactoring",
                    }
                )
            elif call_idx == 2:
                return json.dumps(
                    {
                        "tool": "write_file",
                        "arguments": {
                            "path": filename,
                            "content": "# Refactored\ndef main():\n    print('Hello')\n",
                        },
                        "reasoning": "Applying refactoring changes",
                    }
                )
            else:
                return json.dumps(
                    {"done": True, "summary": f"Refactored {filename}"}
                )

        # Default scenario
        if call_idx == 1:
            return json.dumps(
                {
                    "tool": "write_file",
                    "arguments": {"path": filename, "content": "Hello"},
                    "reasoning": "Writing output file",
                }
            )
        else:
            return json.dumps({"done": True, "summary": "Task completed"})

    def _generic_response(self, text: str) -> str:
        """Generic completion for non-plan/act calls."""
        return json.dumps(
            {
                "content": "Task complete. The requested changes have been applied.",
                "done": True,
            }
        )


def create_mock_llm(config: Optional[Dict[str, Any]] = None) -> "MockLLMProvider":
    """Factory function for creating a mock LLM provider."""
    cfg = config or {}
    return MockLLMProvider(
        scenario=cfg.get("scenario"),
        delay_ms=cfg.get("delay_ms", 0.0),
    )
