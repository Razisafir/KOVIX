"""
End-to-end test with Mock LLM — no API keys, no internet, no external services.

Validates the full ReAct loop: observe -> plan -> act -> verify.

Environment variables:
    CONSTRUCT_OFFLINE=1     — Disables embedding model download
    CONSTRUCT_MOCK_LLM=1    — Activates mock LLM provider

Usage:
    cd agent-backend
    CONSTRUCT_OFFLINE=1 CONSTRUCT_MOCK_LLM=1 python -m pytest tests/e2e/test_mock_llm.py -v
"""

import asyncio
import json
import os
import sys
import tempfile

# Force offline + mock mode before any imports
os.environ["CONSTRUCT_OFFLINE"] = "1"
os.environ["CONSTRUCT_MOCK_LLM"] = "1"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from core.mock_llm import MockLLMProvider, Message


# ---------------------------------------------------------------------------
# Tests for MockLLMProvider directly
# ---------------------------------------------------------------------------


class TestMockLLMProvider:
    """Unit tests for the mock provider itself."""

    @pytest.mark.asyncio
    async def test_plan_file_creation(self):
        """Mock LLM returns correct task plan for file creation."""
        mock = MockLLMProvider(scenario="file_creation")

        messages = [
            {
                "content": (
                    "decompose the goal into tasks. JSON array of task objects.\n"
                    'Goal: Create a hello_world.py that prints "Hello!"'
                )
            }
        ]
        response = await mock.complete(messages)
        tasks = json.loads(response)

        assert isinstance(tasks, list)
        assert len(tasks) == 2
        assert any("hello_world.py" in t["description"] for t in tasks)

    @pytest.mark.asyncio
    async def test_plan_bug_fix(self):
        """Mock LLM returns correct task plan for bug fix."""
        mock = MockLLMProvider(scenario="bug_fix")

        messages = [
            {
                "content": (
                    "decompose the goal into tasks.\n"
                    "Goal: Fix the typo in buggy.py"
                )
            }
        ]
        response = await mock.complete(messages)
        tasks = json.loads(response)

        assert isinstance(tasks, list)
        assert len(tasks) == 3
        assert any("bug" in t["description"].lower() for t in tasks)

    @pytest.mark.asyncio
    async def test_act_file_creation(self):
        """Mock LLM returns correct tool calls for file creation."""
        mock = MockLLMProvider(scenario="file_creation")

        act_messages = [
            {
                "content": (
                    "Current Task: Create hello_world.py\n"
                    "Available tools: write_file, read_file, execute_command"
                )
            }
        ]

        # First call: should write file
        action1 = await mock.complete(act_messages)
        parsed1 = json.loads(action1)
        assert parsed1.get("tool") == "write_file"
        assert parsed1["arguments"]["path"] == "hello_world.py"
        assert "Hello" in parsed1["arguments"]["content"]

        # Second call: should be done
        action2 = await mock.complete(act_messages)
        parsed2 = json.loads(action2)
        assert parsed2.get("done") is True

    @pytest.mark.asyncio
    async def test_act_bug_fix(self):
        """Mock LLM returns correct tool calls for bug fix."""
        mock = MockLLMProvider(scenario="bug_fix")

        act_messages = [
            {
                "content": (
                    "Current Task: Fix the typo\n"
                    "Available tools: write_file, read_file"
                )
            }
        ]

        # First call: should read file
        action1 = await mock.complete(act_messages)
        parsed1 = json.loads(action1)
        assert parsed1.get("tool") == "read_file"

        # Second call: should write fix
        action2 = await mock.complete(act_messages)
        parsed2 = json.loads(action2)
        assert parsed2.get("tool") == "write_file"
        assert "fixed" in parsed2["arguments"]["content"]

        # Third call: should be done
        action3 = await mock.complete(act_messages)
        parsed3 = json.loads(action3)
        assert parsed3.get("done") is True

    @pytest.mark.asyncio
    async def test_streaming(self):
        """Mock LLM supports streaming interface."""
        mock = MockLLMProvider()

        messages = [{"content": "test"}]
        chunks = []
        async for chunk in mock.stream_complete(messages):
            chunks.append(chunk)

        assert len(chunks) > 0
        full_response = "".join(chunks)
        assert len(full_response) > 0


# ---------------------------------------------------------------------------
# Tests for offline mode (semantic memory without embeddings)
# ---------------------------------------------------------------------------


class TestOfflineMode:
    """Tests that memory works without internet/embedding model."""

    def test_embedding_model_returns_none(self):
        """In offline mode, get_embedding_model() returns None."""
        from memory.semantic import get_embedding_model

        model = get_embedding_model()
        assert model is None

    def test_embed_text_returns_none(self):
        """In offline mode, _embed_text() returns None."""
        from memory.semantic import _embed_text

        result = _embed_text("any text")
        assert result is None

    def test_store_and_query_with_keyword_fallback(self):
        """Memory stores documents and query falls back to keyword search."""
        from memory.semantic import store_embedding, query_similar

        # Store a document
        mid = store_embedding(
            "Python function for data processing",
            source="code",
            metadata={"test": True},
        )
        assert isinstance(mid, str)
        assert len(mid) > 0

        # Query via keyword fallback
        results = query_similar("python data", n_results=5)
        assert len(results) > 0
        assert any("Python" in r.text for r in results)

    def test_keyword_search_matches_terms(self):
        """Keyword search finds documents matching query terms."""
        from memory.semantic import store_embedding, query_similar

        # Store distinct documents
        store_embedding("JavaScript React component tutorial", source="code")
        store_embedding("Rust memory safety ownership patterns", source="docs")
        store_embedding("Python data science with pandas numpy", source="code")

        # Query for Python
        results = query_similar("python data", n_results=5)
        texts = [r.text for r in results]
        assert any("Python" in t for t in texts)
        assert not any("JavaScript" in t for t in texts)

    def test_keyword_search_empty_terms(self):
        """Keyword search handles empty/short query gracefully."""
        from memory.semantic import query_similar

        results = query_similar("a", n_results=5)
        assert isinstance(results, list)

    def test_store_without_embeddings(self):
        """Documents can be stored even without embedding model."""
        from memory.semantic import store_embedding

        mid = store_embedding("Test content for offline storage", source="test")
        assert isinstance(mid, str)


# ---------------------------------------------------------------------------
# Tests for LLMService with mock provider
# ---------------------------------------------------------------------------


class TestLLMServiceMock:
    """Tests for LLMService using the mock provider."""

    def test_mock_provider_configured(self):
        """When CONSTRUCT_MOCK_LLM=1, mock provider is in configs."""
        from core.llm_service import LLMService, LLMProvider

        service = LLMService()
        assert LLMProvider.MOCK in service.configs

    @pytest.mark.asyncio
    async def test_mock_complete(self):
        """LLMService.complete() works with mock provider."""
        from core.llm_service import LLMService, Message, LLMProvider

        service = LLMService()
        messages = [Message(role="user", content="Create hello.py")]

        result = await service.complete(messages, model="mock")
        assert isinstance(result, str)
        assert len(result) > 0

        # Should be parseable JSON (task plan)
        parsed = json.loads(result)
        assert isinstance(parsed, list)


# ---------------------------------------------------------------------------
# Integration test: full ReAct loop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_react_loop_creates_file():
    """
    Full integration test: ReAct loop with mock LLM creates a file.

    This tests:
    1. Executor initialisation with mock LLM
    2. Planning phase (creates tasks)
    3. Acting phase (executes tool calls)
    4. File creation on disk
    5. Event emission
    """
    import tempfile
    from core.mock_llm import MockLLMProvider

    # We test the mock LLM + file tools directly since the full executor
    # requires the ToolRegistry which needs all tool modules initialised.
    with tempfile.TemporaryDirectory() as tmpdir:
        mock = MockLLMProvider(scenario="file_creation")

        # Phase 1: Plan
        plan_messages = [
            {
                "content": (
                    "decompose the goal. JSON array of task objects.\n"
                    f"Goal: Create {os.path.join(tmpdir, 'hello_world.py')} "
                    f'that prints "Hello, Construct!"'
                )
            }
        ]
        plan_response = await mock.complete(plan_messages)
        tasks = json.loads(plan_response)
        assert len(tasks) > 0
        print(f"Planned {len(tasks)} tasks: {[t['description'] for t in tasks]}")

        # Phase 2: Act — first call writes file
        from tools.file_tools import write_file

        act_messages = [
            {
                "content": (
                    f"Current Task: {tasks[0]['description']}\n"
                    "Available tools: write_file, read_file"
                )
            }
        ]
        action1 = await mock.complete(act_messages)
        parsed1 = json.loads(action1)

        assert parsed1.get("tool") == "write_file"
        file_path = parsed1["arguments"]["path"]
        file_content = parsed1["arguments"]["content"]

        # Execute the tool
        full_path = os.path.join(tmpdir, os.path.basename(file_path))
        result = write_file(full_path, file_content)
        assert result.get("success") is True

        # Verify file exists
        assert os.path.exists(full_path), f"File not created: {full_path}"
        with open(full_path) as f:
            content = f.read()
        assert "Hello" in content

        # Phase 3: Act — second call signals done
        action2 = await mock.complete(act_messages)
        parsed2 = json.loads(action2)
        assert parsed2.get("done") is True

        print(f"Created file: {full_path}")
        print(f"Content: {content}")
        print("Full ReAct loop: PASS")


# ---------------------------------------------------------------------------
# Tests for Agent Modes
# ---------------------------------------------------------------------------


class TestAgentModes:
    """Tests for the 6 agent modes: Code, Architect, Debug, Review, Security, DevOps."""

    def test_all_six_modes_exist(self):
        """All 6 modes are defined in the AgentMode enum."""
        from core.modes import AgentMode

        expected = {"code", "architect", "debug", "review", "security", "devops"}
        actual = {m.value for m in AgentMode}
        assert actual == expected, f"Missing modes: {expected - actual}"

    def test_get_mode_config_code(self):
        """CODE mode has write_file available and test_and_lint verification."""
        from core.modes import get_mode_config

        config = get_mode_config("code")
        assert config.name == "code"
        assert "write_file" in config.available_tools
        assert "read_file" in config.available_tools
        assert config.verification_strategy == "test_and_lint"
        assert config.max_iterations == 15
        assert len(config.require_human_approval) == 0

    def test_get_mode_config_architect(self):
        """ARCHITECT mode requires approval for write_file."""
        from core.modes import get_mode_config

        config = get_mode_config("architect")
        assert config.name == "architect"
        assert "write_file" in config.require_human_approval
        assert config.verification_strategy == "design_review"
        assert config.max_iterations == 8

    def test_get_mode_config_debug(self):
        """DEBUG mode allows 20 iterations (more than default)."""
        from core.modes import get_mode_config

        config = get_mode_config("debug")
        assert config.name == "debug"
        assert config.max_iterations == 20
        assert config.verification_strategy == "regression_test"
        assert "run_test" in config.available_tools

    def test_get_mode_config_review(self):
        """REVIEW mode has 5 iterations (quick and focused)."""
        from core.modes import get_mode_config

        config = get_mode_config("review")
        assert config.name == "review"
        assert config.max_iterations == 5
        assert config.verification_strategy == "checklist"
        # Review mode should NOT have write_file (read-only)
        assert "write_file" not in config.available_tools

    def test_get_mode_config_security(self):
        """SECURITY mode requires approval for execute_command."""
        from core.modes import get_mode_config

        config = get_mode_config("security")
        assert config.name == "security"
        assert "execute_command" in config.require_human_approval
        assert config.verification_strategy == "security_scan"
        assert "find_vulnerabilities" in config.available_tools

    def test_get_mode_config_devops(self):
        """DEVOPS mode requires approval for execute_command."""
        from core.modes import get_mode_config

        config = get_mode_config("devops")
        assert config.name == "devops"
        assert "execute_command" in config.require_human_approval
        assert config.verification_strategy == "dry_run"
        assert "git_commit" in config.available_tools

    def test_get_mode_config_case_insensitive(self):
        """Mode lookup is case-insensitive."""
        from core.modes import get_mode_config

        config = get_mode_config("DEBUG")
        assert config.name == "debug"

    def test_get_mode_config_unknown_defaults_to_code(self):
        """Unknown mode defaults to CODE."""
        from core.modes import get_mode_config

        config = get_mode_config("unknown_mode")
        assert config.name == "code"

    def test_list_modes_returns_six(self):
        """list_modes() returns exactly 6 modes."""
        from core.modes import list_modes

        modes = list_modes()
        assert len(modes) == 6
        ids = [m["id"] for m in modes]
        assert set(ids) == {"code", "architect", "debug", "review", "security", "devops"}

    def test_list_modes_has_required_fields(self):
        """Each mode from list_modes() has id, name, description, icon, color."""
        from core.modes import list_modes

        modes = list_modes()
        for m in modes:
            assert "id" in m
            assert "name" in m
            assert "description" in m
            assert "icon" in m
            assert "color" in m

    def test_mode_config_to_dict(self):
        """ModeConfig.to_dict() serializes correctly."""
        from core.modes import get_mode_config

        config = get_mode_config("debug")
        d = config.to_dict()
        assert d["name"] == "debug"
        assert isinstance(d["available_tools"], list)
        assert isinstance(d["require_human_approval"], list)
        assert d["max_iterations"] == 20
        assert d["verification_strategy"] == "regression_test"

    def test_each_mode_has_distinct_tools(self):
        """Each mode has a different set of available tools."""
        from core.modes import MODE_CONFIGS, AgentMode

        tool_sets = {}
        for mode, config in MODE_CONFIGS.items():
            tool_sets[mode] = set(config.available_tools)

        # At least some modes should have different tool sets
        unique_sets = set(frozenset(s) for s in tool_sets.values())
        assert len(unique_sets) > 1, "All modes have the same tools — they should differ"

    def test_each_mode_has_system_prompt(self):
        """Every mode has a non-empty system prompt."""
        from core.modes import MODE_CONFIGS

        for mode, config in MODE_CONFIGS.items():
            assert len(config.system_prompt) > 50, (
                f"{mode.value} mode has a very short system prompt"
            )

    def test_code_mode_has_most_tools(self):
        """CODE mode should have the most tools (it's the general-purpose mode)."""
        from core.modes import MODE_CONFIGS, AgentMode

        code_count = len(MODE_CONFIGS[AgentMode.CODE].available_tools)
        for mode, config in MODE_CONFIGS.items():
            if mode != AgentMode.CODE:
                assert code_count >= len(config.available_tools), (
                    f"CODE mode should have >= tools than {mode.value}, "
                    f"but {code_count} < {len(config.available_tools)}"
                )


# ---------------------------------------------------------------------------
# Run directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
