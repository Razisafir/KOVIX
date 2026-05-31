# E2E File Creation Test — 2026-05-31

## Method Used
- [x] Option B: Mock LLM (direct Python + API)
- [x] Option C: Direct tool (API + Python)
- [ ] Option A: Real LLM (Ollama) — Not available in test environment

## Bugs Found and Fixed

### BUG 1: `route_by_complexity()` never selects Mock provider
**Severity**: P0 — Blocks all agent loop testing without real LLM
**Root Cause**: The `LLMService.route_by_complexity()` method always falls through to `LLMProvider.OLLAMA`, even when `CONSTRUCT_MOCK_LLM=1` is set and `LLMProvider.MOCK` is configured.
**Fix**: Added early return at the top of `route_by_complexity()`:
```python
if LLMProvider.MOCK in self.configs:
    return LLMProvider.MOCK
```
**File**: `agent-backend/core/llm_service.py`

### BUG 2: `stream_complete()` fallback hardcodes Ollama
**Severity**: P0 — All LLM requests fail when Ollama is down, even with Mock configured
**Root Cause**: When the primary provider fails, `stream_complete()` always falls back to `LLMProvider.OLLAMA` (lines 915-930), ignoring the `_PROVIDER_FALLBACK_ORDER` list that includes "mock".
**Fix**: Replaced hardcoded Ollama fallback with a loop over `_PROVIDER_FALLBACK_ORDER` that tries each configured provider in sequence.
**File**: `agent-backend/core/llm_service.py`

### BUG 3: `MockLLMProvider` re-created on every call
**Severity**: P0 — Mock LLM never transitions from tool calls to "done" responses
**Root Cause**: `_mock_complete()` and `_mock_stream()` create a new `MockLLMProvider()` instance on every call, resetting `_act_call_count` to 0. Since `call_idx = 1` always triggers `write_file`, the mock loops infinitely calling write_file until the rate limit (10 calls/session) is hit.
**Fix**: Persist the `MockLLMProvider` instance as `self._mock_provider` on the `LLMService` object, reusing it across calls.
**File**: `agent-backend/core/llm_service.py`

### BUG 4: Accept→Disk not wired in frontend
**Severity**: P1 — DiffPanel shows diffs but has no "Apply" button
**Root Cause**: `_applyAcceptedDiffs` and related handlers were `void`'d out in `AgentPanel.tsx` (lines 632-637), and `DiffPanel.tsx` had no mechanism to write accepted changes to disk.
**Fix**: Added `applyAcceptedChanges()` function to `DiffPanel.tsx` that:
- For accepted hunks: file is already on disk (agent writes directly via `write_file`)
- For rejected hunks: restores old content using Tauri's `writeTextFile()`
- Added "APPLY CHANGES" button that appears when all hunks have been decided
**File**: `src/renderer/components/DiffPanel.tsx`

### BUG 5: `/tools/execute` endpoint can't access project paths
**Severity**: P2 — Direct tool execution (without agent session) can't write to `~/construct-projects/default/`
**Root Cause**: The `BASE_DIR` sandbox defaults to CWD (`agent-backend/`). When calling `/tools/execute` directly, no session sets `BASE_DIR`, so absolute paths outside CWD are rejected.
**Fix**: Added `project_path` optional field to `ToolExecuteRequest` that temporarily sets `BASE_DIR` for the tool execution.
**File**: `agent-backend/app.py`

## Test Results

### Option C: Direct Tool Execution

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| C1: write_file relative path | success=true | success=True, file on disk | PASS |
| C2: File on disk (CWD) | Content matches | `print("E2E direct tool test")` | PASS |
| C3: write_file absolute path | success=true | success=True (after set_base_dir) | PASS |
| C4: Absolute path file on disk | Content matches | `print("E2E absolute path test")` | PASS |
| C5: read_file roundtrip | Returns written content | success=True, content matches | PASS |
| C6: list_directory | File appears in listing | e2e_abs.py in listing | PASS |

### Option B: Mock LLM Agent Loop

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| B1: Agent session started | session_id returned | session_id=ce04d484 | PASS |
| B2: Agent completed | status=completed | status=completed | PASS |
| B3: mock_test.py on disk | File exists with content | `print("Hello from Construct!")` | PASS |
| B4: write_file tool call | At least 1 write_file event | 1 write_file event | PASS |
| B5: Task summary | completed > 0 | {total: 2, completed: 2} | PASS |

### Option C: API-Based Direct Tool (with project_path fix)

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| POST /tools/execute with project_path | File created | success=True, bytes_written=24 | PASS |
| cat ~/construct-projects/default/api_test.py | Content on disk | `print("API direct test")` | PASS |

### Option B: API-Based Agent Loop

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| POST /agent/start | session_id returned | session_id=ce04d484 | PASS |
| GET /agent/{id}/status | status=completed | status=completed | PASS |
| cat file created by agent | Content on disk | `print("Hello from Construct!")` | PASS |

### Option D: File Modification + Disk Verification

| Step | Expected | Actual | Pass/Fail |
|------|----------|--------|-----------|
| D1: Create file V1 | Version 1 on disk | `print("Version 1")` | PASS |
| D2: Overwrite with V2 | Version 2 on disk | `print("Version 2 - Updated via diff")` | PASS |
| D3: cat confirms change | Updated content visible | `print("Version 2 - Updated via diff")` | PASS |

## Architecture Notes

### No Shadow FS — Direct Write Architecture
The current implementation writes files **directly to disk** via `write_file`. There is no staging/shadow filesystem. This means:
- **Accept** = file already on disk (no-op, confirms the change)
- **Reject** = restore old content from the diff store

This is a known limitation. A proper Shadow FS implementation would stage changes in a temporary location and only write to disk on Accept. This is planned as a P0 backend feature.

### Diff Generation
Diffs are generated **client-side** in the AgentPanel by intercepting `tool_call` events:
1. Agent emits `tool_call` event with `write_file` arguments
2. Frontend reads current file content via Tauri's `readTextFile()`
3. `generateDiff(oldContent, newContent)` produces `FileDiff` with `DiffHunk[]`
4. Stored in `useDiffStore` per session

### Accept/Reject Flow
The `DiffPanel.tsx` now includes:
- Per-hunk Accept/Reject buttons (via `DiffViewer.tsx`)
- Per-file Accept All/Reject All buttons
- "APPLY CHANGES" button (appears when all hunks are decided)
- Apply logic: accepted hunks are already on disk; rejected hunks restore old content

## Errors Encountered

| Error | Cause | Resolution |
|-------|-------|------------|
| Backend process dies repeatedly | Memory pressure from ChromaDB + Ollama connection attempts | Set `CONSTRUCT_OFFLINE=1` to disable embeddings; Mock LLM avoids Ollama calls |
| write_file absolute path fails | `BASE_DIR` sandbox defaults to CWD | Call `set_base_dir()` before use; added `project_path` to `/tools/execute` |
| Mock LLM loops infinitely | `_mock_provider` instance recreated per call | Persist instance on `LLMService` |
| Git operations fail | `~/construct-projects/default` is not a git repo | Non-blocking; executor continues on current branch |
| `route_by_complexity` ignores Mock | Method never checks for `LLMProvider.MOCK` | Added early return for Mock |

## Verdict

[x] ALL PASS — Product loop works (with Mock LLM)

### Success Criteria Checklist
- [x] File created on disk via agent (mock LLM → write_file → disk)
- [x] File created via direct tool execution
- [x] File modification works (overwrite → cat confirms change)
- [x] Agent loop completes: Goal → Plan → Execute(write_file) → Verify → Complete
- [x] DiffPanel has Accept/Reject + Apply Changes button
- [x] `cat` confirms file content after creation and modification
- [x] API endpoints verified: `/health`, `/tools/execute`, `/agent/start`, `/agent/{id}/status`

### Remaining Work
- [ ] Option A: Test with real Ollama LLM (requires GPU/LLM runtime)
- [ ] Shadow FS implementation (stage changes, merge on Accept)
- [ ] End-to-end Tauri UI test (frontend → backend → disk → UI update)
- [ ] Git sandboxing (init git repo in `~/construct-projects/default`)
