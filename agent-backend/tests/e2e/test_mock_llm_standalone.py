"""
Standalone mock LLM test — runs without pytest.

Usage:
    cd agent-backend
    CONSTRUCT_OFFLINE=1 CONSTRUCT_MOCK_LLM=1 python tests/e2e/test_mock_llm_standalone.py
"""

import asyncio
import json
import os
import sys

# Force offline + mock mode before any imports
os.environ["CONSTRUCT_OFFLINE"] = "1"
os.environ["CONSTRUCT_MOCK_LLM"] = "1"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


PASS = 0
FAIL = 0


def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}: {detail}")


async def test_mock_provider():
    """Test MockLLMProvider directly."""
    print("\n=== Test: MockLLMProvider ===")
    from core.mock_llm import MockLLMProvider

    # Test plan
    mock = MockLLMProvider(scenario="file_creation")
    plan_msgs = [
        {
            "content": (
                "decompose the goal. JSON array of task objects.\n"
                'Goal: Create hello_world.py that prints "Hello!"'
            )
        }
    ]
    plan = await mock.complete(plan_msgs)
    tasks = json.loads(plan)
    check("plan returns JSON array", isinstance(tasks, list))
    check("plan has 2 tasks", len(tasks) == 2, f"got {len(tasks)}")
    check("plan mentions filename", any("hello_world.py" in t["description"] for t in tasks))

    # Test act phase
    act_msgs = [
        {
            "content": (
                "Current Task: Create hello_world.py\n"
                "Available tools: write_file, read_file"
            )
        }
    ]
    action1 = json.loads(await mock.complete(act_msgs))
    check("act 1: write_file tool", action1.get("tool") == "write_file")
    check("act 1: correct filename", action1["arguments"]["file_path"] == "hello_world.py")

    action2 = json.loads(await mock.complete(act_msgs))
    check("act 2: done signal", action2.get("done") is True)

    # Test bug fix scenario
    mock2 = MockLLMProvider(scenario="bug_fix")
    bug_msgs = [{"content": "Current Task: Fix typo\nAvailable tools: write_file, read_file"}]
    a1 = json.loads(await mock2.complete(bug_msgs))
    check("bug fix act 1: read_file", a1.get("tool") == "read_file")

    a2 = json.loads(await mock2.complete(bug_msgs))
    check("bug fix act 2: write_file", a2.get("tool") == "write_file")

    a3 = json.loads(await mock2.complete(bug_msgs))
    check("bug fix act 3: done", a3.get("done") is True)


async def test_offline_mode():
    """Test offline mode (no embeddings)."""
    print("\n=== Test: Offline Mode ===")
    from memory.semantic import get_embedding_model, _embed_text

    model = get_embedding_model()
    check("embedding model is None", model is None)

    emb = _embed_text("test")
    check("embed_text returns None", emb is None)

    # Test store without embeddings
    from memory.semantic import store_embedding, query_similar

    mid = store_embedding("Python function for data processing", source="code")
    check("store returns ID", isinstance(mid, str) and len(mid) > 0)

    # Test keyword search
    results = query_similar("python data", n_results=5)
    check("keyword search finds results", len(results) > 0, f"got {len(results)}")
    check(
        "keyword search finds Python",
        any("Python" in r.text for r in results),
        f"results: {[r.text for r in results]}",
    )

    # Test multiple documents
    store_embedding("JavaScript React component tutorial", source="code")
    store_embedding("Rust memory safety ownership patterns", source="docs")

    py_results = query_similar("python data", n_results=5)
    py_texts = [r.text for r in py_results]
    check(
        "keyword filters non-matches",
        not any("JavaScript" in t for t in py_texts),
        f"got: {py_texts}",
    )


async def test_llm_service_mock():
    """Test LLMService routes to mock provider."""
    print("\n=== Test: LLMService + Mock ===")
    from core.llm_service import LLMService, LLMProvider

    service = LLMService()
    check("mock in configs", LLMProvider.MOCK in service.configs)

    from core.llm_service import Message

    messages = [Message(role="user", content="Create hello.py")]
    result = await service.complete(messages, model="mock")
    check("complete returns string", isinstance(result, str) and len(result) > 0)

    parsed = json.loads(result)
    check("result is JSON list", isinstance(parsed, list))


async def test_full_react_loop():
    """Test the full ReAct loop creates a file."""
    print("\n=== Test: Full ReAct Loop ===")
    from core.mock_llm import MockLLMProvider
    from tools.file_tools import write_file

    # Use a directory within the project (file tools sandbox)
    test_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "test_output")
    os.makedirs(test_dir, exist_ok=True)

    mock = MockLLMProvider(scenario="file_creation")

    # Plan
    plan_msgs = [
        {
            "content": (
                "decompose the goal. JSON array of task objects.\n"
                "Goal: Create hello_world.py that prints Hello"
            )
        }
    ]
    plan = json.loads(await mock.complete(plan_msgs))
    check("plan creates tasks", len(plan) > 0)

    # Act: write file
    act_msgs = [
        {
            "content": (
                f"Current Task: {plan[0]['description']}\n"
                "Available tools: write_file, read_file"
            )
        }
    ]
    action = json.loads(await mock.complete(act_msgs))
    check("act: write_file tool", action.get("tool") == "write_file")

    # Execute — write to test dir within project
    file_name = os.path.basename(action["arguments"]["file_path"])
    full_path = os.path.join(test_dir, file_name)
    result = write_file(full_path, action["arguments"]["content"])
    check("file written", result.get("success") is True, f"error: {result.get('error')}")
    check("file exists", os.path.exists(full_path))

    with open(full_path) as f:
        content = f.read()
    check("file has content", "Hello" in content)

    # Done
    action2 = json.loads(await mock.complete(act_msgs))
    check("session complete", action2.get("done") is True)

    # Cleanup
    import shutil
    shutil.rmtree(test_dir)

    print(f"\n  Created: {full_path}")
    print(f"  Content: {content!r}")


async def main():
    print("=" * 60)
    print("Mock LLM + Offline Mode E2E Tests")
    print("=" * 60)

    try:
        await test_mock_provider()
    except Exception as e:
        print(f"\n  ERROR in test_mock_provider: {e}")
        import traceback
        traceback.print_exc()

    try:
        await test_offline_mode()
    except Exception as e:
        print(f"\n  ERROR in test_offline_mode: {e}")
        import traceback
        traceback.print_exc()

    try:
        await test_llm_service_mock()
    except Exception as e:
        print(f"\n  ERROR in test_llm_service_mock: {e}")
        import traceback
        traceback.print_exc()

    try:
        await test_full_react_loop()
    except Exception as e:
        print(f"\n  ERROR in test_full_react_loop: {e}")
        import traceback
        traceback.print_exc()

    print("\n" + "=" * 60)
    print(f"Results: {PASS} passed, {FAIL} failed")
    print("=" * 60)

    return FAIL == 0


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
