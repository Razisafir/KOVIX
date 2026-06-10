# Kovix Feature Gap Report
Generated: 2026-06-10

## Core User Journey Status

| Feature | Status | Files | Notes |
|---------|--------|-------|-------|
| New project / onboarding wizard | **PARTIAL** | `constructOnboarding.ts` | IDE setup wizard exists (4-step: Welcome → AI Provider → Kali WSL → Ready), but there is NO project creation wizard. The onboarding configures the IDE, not a project. No `newProject`, `createProject`, or `ProjectWizard` pattern found anywhere. |
| Idea refinement with agent | **MISSING** | — | No `IdeaRefinement`, `refine`, `PHASE_IDEA`, or `ideaPhase` concepts exist. The agent jumps directly from user input to planning. There is no conversational loop where the agent helps the user clarify and refine their idea before planning. |
| Plan generation (detailed) | **BUILT** | `platform/construct/common/agent/agentLoop.ts`, `workbench/contrib/construct/browser/services/agent/agentLoop.ts` | `runPlanningPhase()` generates `IPlanResult` with `IPlanStep[]` (index, action: Read/Create/Edit/Run, target, description). Planning uses read-only tools (read_file, list_directory) to explore the workspace first. The plan is returned for user approval. |
| Task deselection by user | **MISSING** | — | No `deselect`, `skipTask`, `excludeTask`, `selectedTasks`, or `ignoredTasks` patterns exist. The plan UI shows only "Approve" (all steps) or "Cancel" (entire plan). Users cannot individually enable/disable steps. |
| Execute button | **PARTIAL** | `constructAgentView.ts` (line ~616) | An "Approve" button triggers `runExecution(task)`. It works, but it's a binary approve/cancel with no intermediate options. There is no dedicated "Execute" button with stop-mode configuration. |
| Stop mode selection (4 modes) | **MISSING** | — | No `ExecutionMode`, `StopMode`, `EVERY_MILESTONE`, `MAJOR_MILESTONE`, `SELECTIVE`, `FULL_AUTO`, or `stopBehavior` patterns exist anywhere in the codebase. The only stop mechanism is an emergency abort button that kills the entire agent loop. |
| Autonomous execution loop | **BUILT** | `workbench/contrib/construct/browser/services/agent/agentLoop.ts` | Real agent loop with `MAX_ROUNDS=15`. Flow: LLM call → detect tool_use → execute tool → feed result back → repeat. Has error recovery (IAgentErrorRecovery), snapshot/undo (ISnapshotManager), file watching (IFileWatcherService), pending changes staging (IPendingChangesService), and security (workspaceGuard, promptSanitiser, secretRedactor). However, it's a single-shot loop — not milestone-aware or pausable. |
| Per-project memory | **BUILT** | `memory/workingMemory.ts`, `memory/episodicMemory.ts`, `memory/semanticMemory.ts`, `memory/proceduralMemory.ts`, `memory/memoryOrchestrator.ts`, `memory/vectorStore.ts`, `node/constructChatHistory.ts` | Four-layer memory architecture (Working, Episodic, Semantic, Procedural) all scoped by `projectId`. SQLite chat history at `.construct/chat-history.db` per workspace. Qdrant vector store with per-workspace collections. Memory orchestrator can query, consolidate, and inject context into prompts. |
| Universal memory (Obsidian-style) | **PARTIAL** | `memory/constructMemory.ts`, `browser/constructMemoryConfig.ts` | `IConstructMemoryService` wraps Supermemory (supermemory.ai) for cross-project persistent memory. Has addMemory, getProfile, searchMemories, getContextForTask. BUT: requires an external Supermemory API key (cloud service), disabled by default (`construct.memory.enabled: false`). Not a built-in local universal memory — it's an optional cloud add-on. |
| API key configuration (Anthropic) | **BUILT** | `security/secureKeyManager.ts`, `security/constructKeyVault.ts`, `browser/services/llm/cloudProvider.ts`, `browser/constructApiSettings.ts` | Full support. `LLMProvider` includes 'anthropic'. Keys validated for `sk-ant-` prefix. Stored in OS keychain via ISecureKeyManager. CloudProvider auto-detects Anthropic keys and routes to Anthropic Messages API (`api.anthropic.com/v1/messages`). Models: Claude Sonnet 4, Claude 3.5 Sonnet, Claude 3.5 Haiku. Retries, rate-limit handling, SSE streaming all implemented. |
| API key configuration (OpenAI) | **BUILT** | Same files as Anthropic | Full support. `LLMProvider` includes 'openai'. Keys validated for `sk-` prefix. Stored in OS keychain. CloudProvider uses OpenAI-compatible `/chat/completions` endpoint. Default model: gpt-4o-mini. Supports any OpenAI-compatible endpoint (Together AI, Groq, LM Studio, LiteLLM, custom). |

---

## What's Missing (Needs to be Built)

### 1. Project Creation Wizard (Step 1 — Critical)
**Current state**: The onboarding wizard (`constructOnboarding.ts`) only configures the IDE (AI provider, Kali WSL). There is no concept of a "project" in the Construct system. The agent just operates on whatever workspace is open.

**What needs to be built**:
- A `ProjectWizard` or `NewProjectFlow` that guides users through creating a new project
- Project metadata storage (name, description, tech stack, goals)
- A `.construct/project.json` file per project storing project-level config
- Integration with the session service to scope sessions to projects
- A project list/dashboard view to switch between projects

**Files to create**: `platform/construct/common/project/constructProjectService.ts`, `workbench/contrib/construct/browser/constructProjectWizard.ts`

### 2. Idea Refinement Phase (Step 2 — Critical)
**Current state**: The user types a task and it goes directly to `runPlanningPhase()`. There is no conversational loop to help the user clarify their idea.

**What needs to be built**:
- A `PHASE_IDEA` state in the execution flow (before planning)
- An `IdeaRefinementService` that runs a multi-turn conversation to help the user flesh out their idea
- A structured output format for the refined idea (scope, constraints, success criteria)
- UI for the refinement conversation (separate from the plan view)
- Auto-transition from idea refinement → plan generation

**Files to create**: `platform/construct/common/agent/ideaRefinement.ts`, `workbench/contrib/construct/browser/services/agent/ideaRefinementService.ts`

### 3. Task Deselection / Selective Approval (Step 4 — High)
**Current state**: The plan is shown with a binary "Approve / Cancel" choice. Users cannot individually select or deselect steps.

**What needs to be built**:
- A `selectedSteps` / `excludedSteps` mechanism in `IPlanResult` or a new `IApprovedPlan` type
- UI with checkboxes next to each plan step (default: all checked)
- A way to pass the filtered step list to the execution phase
- The agent loop needs to respect the excluded steps — either by skipping them or by incorporating the exclusion into the system prompt

**Files to modify**: `platform/construct/common/agent/agentLoop.ts` (IPlanResult), `workbench/contrib/construct/browser/constructAgentView.ts` (renderPlan method)

### 4. Stop Mode Selection (Step 6 — High)
**Current state**: No stop modes exist. The only control is an emergency abort button.

**What needs to be built**:
- An `ExecutionMode` enum: `EVERY_MILESTONE`, `MAJOR_MILESTONE`, `SELECTIVE`, `FULL_AUTO`
- A `Milestone` concept — the agent needs to define what constitutes a milestone during execution
- A stop-mode selection UI that appears after plan approval (before execution starts)
- Pause/resume logic in the agent loop that checks stop conditions between steps
- For `SELECTIVE` mode: a UI for users to pick which milestones to stop at
- State persistence so the agent can resume from a paused milestone without losing context

**Files to create**: `platform/construct/common/agent/executionMode.ts`, `workbench/contrib/construct/browser/constructStopModePicker.ts`

**Files to modify**: `workbench/contrib/construct/browser/services/agent/agentLoop.ts` (add milestone checkpoints and pause logic)

### 5. Milestone-Based Execution (Step 7 enhancement — High)
**Current state**: The agent loop runs as a single continuous process from start to completion (or abort). It cannot pause at milestones.

**What needs to be built**:
- A `Milestone` interface with ID, name, description, step indices
- The agent should identify milestones during the planning phase (or auto-detect from plan structure)
- The execution loop should yield `milestone_reached` events
- A state machine: `running` → `paused_at_milestone` → `resumed` → `running`
- Context preservation at each milestone (snapshot the full conversation state)

**Files to modify**: `platform/construct/common/agent/agentLoop.ts` (add milestone events), `workbench/contrib/construct/browser/services/agent/agentLoop.ts` (add pause/resume/milestone logic)

### 6. Built-In Universal Memory (Step 8 enhancement — Medium)
**Current state**: Universal memory requires an external Supermemory API key and is disabled by default. There's no built-in local universal memory.

**What needs to be built**:
- A local universal memory store (e.g., a global SQLite database in the user's home directory, not scoped to a single project)
- Cross-project memory indexing and search
- An Obsidian-style knowledge graph where memories from all projects are interconnected
- Fallback: when Supermemory is unavailable, use the local store
- A universal memory browser/management UI

**Files to create**: `platform/construct/common/memory/universalMemory.ts`, `node/constructUniversalMemory.ts`, `workbench/contrib/construct/browser/constructUniversalMemoryView.ts`

### 7. Session Resume Across Restarts (Medium)
**Current state**: The `IConstructSessionService` interface exists with session persistence, but the agent view does not currently load previous sessions on startup. The comment in `constructSessionService.ts` says "P1 FIX: Currently, conversations are lost when the agent panel closes."

**What needs to be built**:
- Auto-save conversation state to the chat history database during execution
- On agent panel open, load the most recent session
- A session list UI for switching between past conversations
- Restore full context (including plan state, execution state) from saved session

**Files to modify**: `workbench/contrib/construct/browser/constructAgentView.ts`, `platform/construct/node/constructChatHistory.ts`

---

## What's Working

### Agent Core (Production-Quality)
- **Real agent loop** with 15-round max, tool execution, streaming output
- **Planning phase** that reads workspace before making changes
- **8 tools**: read_file, write_file, list_directory, create_directory, run_command, edit_file, search_codebase, web_search
- **Error recovery**: IAgentErrorRecovery classifies errors and attempts retry/skip/abort
- **Snapshot/undo**: ISnapshotManager creates pre-task snapshots, `undoLastTask()` restores them
- **File watching**: Real-time file tree diff during execution
- **Pending changes**: In-memory staging before applying diffs
- **Security**: Workspace boundary validation, prompt sanitisation, secret redaction

### AI Provider System (Multi-Backend)
- **3 provider types**: Ollama (local GPU), Xenova (in-process CPU), Cloud (API)
- **Auto-selection**: Ollama → Xenova → Cloud priority
- **Anthropic support**: Native Messages API with SSE streaming, Claude Sonnet 4 / 3.5 Sonnet / 3.5 Haiku
- **OpenAI support**: Chat completions API with streaming, gpt-4o / gpt-4o-mini
- **OpenAI-compatible**: Together AI, Groq, LM Studio, LiteLLM, custom endpoints
- **Rate limiting**: Retry with exponential backoff for 429/529/5xx errors
- **Unified interface**: All providers implement IConstructAIProvider with unified streaming events

### API Key Management (Secure)
- **OS keychain storage** via VS Code SecretStorage
- **Key validation**: Anthropic (sk-ant-*), OpenAI (sk-*), Ollama (none), LiteLLM/custom (non-empty)
- **Masked display**: Keys shown as "sk-ant-...XXXX" in UI
- **Connection testing**: Health check with latency measurement and model listing
- **Provider switching**: Quick-pick UI for switching between providers
- **Multiple providers**: Can store keys for all 5 provider types simultaneously

### Memory System (4-Layer Architecture)
- **Working memory**: Short-term context window, token budget tracking, context pruning
- **Episodic memory**: Records actions/outcomes per project, session summaries
- **Semantic memory**: Embedding-based knowledge with source file tracking
- **Procedural memory**: Learned patterns with success/failure counts
- **Memory orchestrator**: Unified query, consolidation, context injection into prompts
- **Supermemory integration**: Cloud-based persistent memory (optional, requires API key)

### Infrastructure
- **Qdrant vector store**: Per-workspace semantic search with 512-token chunking
- **SQLite chat history**: Per-workspace `.construct/chat-history.db` with WAL mode
- **MCP (Model Context Protocol)**: Process management, server manager, marketplace, connection pool
- **Security tools**: nmap, nuclei, Ghidra (for security-focused workflows)
- **Kali WSL2 integration**: Terminal profile for Windows security tools
- **Custom theme**: `theme-kovix` extension with `construct-dark-color-theme.json`
- **Telemetry**: ConstructTelemetryService for usage tracking
- **Notifications**: Custom notification service for agent events

---

## Recommended Build Order

### Phase 1: Core User Journey (Must-Have for Launch)

1. **Project Creation Wizard** — Without projects, the entire user journey has no starting point. This is the foundation. Build the `IConstructProjectService` interface and a simple project creation flow that stores metadata in `.construct/project.json`.

2. **Idea Refinement Phase** — This is the key differentiator from generic AI coding tools. Build `IdeaRefinementService` as a multi-turn conversation loop that runs before `runPlanningPhase()`. The refined idea becomes the input to planning.

3. **Task Deselection** — Extend `IPlanResult` with selected/excluded steps. Add checkboxes to `renderPlan()` in `constructAgentView.ts`. Pass the filtered plan to execution. This is a UI-heavy change with minimal backend impact.

4. **Stop Mode Selection** — Define the `ExecutionMode` enum. Build a stop-mode picker UI that appears between plan approval and execution start. This requires the milestone concept (next item).

5. **Milestone-Based Execution** — Extend the agent loop to identify milestones from the plan and emit `milestone_reached` events. Add pause/resume state machine. This is the most complex build item — the agent loop needs to be refactored from a single-shot run to a pausable state machine.

### Phase 2: Memory & Persistence (Important for Retention)

6. **Session Resume** — Wire up `IConstructSessionService` and `IConstructChatHistory` so conversations survive panel closes and IDE restarts. Load previous session on panel open.

7. **Built-In Universal Memory** — Build a local universal memory store (SQLite in user home) as a fallback for when Supermemory is unavailable. This makes cross-project memory work without requiring a cloud service.

### Phase 3: Polish (Nice-to-Have)

8. **Milestone Resume UI** — When the agent pauses at a milestone, show a rich UI with: what was done, what's next, options to continue/modify/stop.

9. **Project Dashboard** — A view showing all projects, their status, recent activity, and quick-access to resume work.

10. **Universal Memory Browser** — An Obsidian-style knowledge graph UI for browsing and managing cross-project memories.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                    CURRENT STATE                         │
│                                                         │
│  Onboarding ──► Chat Input ──► Plan ──► Approve/Cancel  │
│  (IDE setup)    (direct)      (read)   (binary choice)  │
│                                      │                  │
│                                      ▼                  │
│                              Execute (full auto)        │
│                              Stop = abort only          │
│                              Memory = per-project       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    TARGET STATE                          │
│                                                         │
│  New Project ──► Idea ──► Refined ──► Plan ──► Select  │
│  Wizard        Input     Idea       (detailed)  Steps   │
│                                                    │    │
│                                                    ▼    │
│                                          Pick Stop Mode │
│                                          (4 options)    │
│                                               │         │
│                                               ▼         │
│                                    Execute (milestone-   │
│                                    aware, pausable,      │
│                                    context-preserving)   │
│                                               │         │
│                                               ▼         │
│                                    Memory (per-project   │
│                                    + universal local)    │
└─────────────────────────────────────────────────────────┘
```

---

## File Count Summary

| Directory | TypeScript Files | Purpose |
|-----------|-----------------|---------|
| `platform/construct/common/` | 30 | Core interfaces and service definitions |
| `platform/construct/electron-sandbox/` | 9 | Electron sandbox service proxies |
| `platform/construct/node/` | 10 | Node.js service implementations |
| `workbench/contrib/construct/browser/` | 8 | UI panels and configuration |
| `workbench/contrib/construct/browser/services/` | 28 | Service implementations |
| `workbench/contrib/construct/browser/tools/security/` | 3 | Security tools (nmap, nuclei, ghidra) |
| `extensions/theme-kovix/` | 0 (3 total) | Theme extension |
| **Total** | **88 TypeScript files** | |

---

## Key Risk: The Agent Loop Is Not a State Machine

The most critical architectural gap is that `AgentLoopService.run()` is a single async generator function. It cannot be paused at milestones because it's designed as a fire-and-forget loop. Converting it to a pausable state machine is the single biggest engineering effort required before launch. This affects:

- The plan/execute flow in `constructAgentView.ts`
- The agent loop in both `platform/construct/common/agent/agentLoop.ts` and `workbench/contrib/construct/browser/services/agent/agentLoop.ts`
- The `IPlanStep` / `IPlanResult` types (need milestone metadata)
- The progress panel (needs pause/resume UI states)
- The snapshot manager (needs to snapshot at milestones, not just at task start)
