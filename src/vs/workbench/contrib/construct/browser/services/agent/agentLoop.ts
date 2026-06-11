// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_ADDITIONAL_TERMS.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IAgentLoop, AgentLoopEvent, IPlanResult, IPlanStep } from '../../../../../../platform/construct/common/agent/agentLoop.js';
import { IApprovedPlan, IMilestone, ExecutionState } from '../../../../../../platform/construct/common/agent/milestoneStateMachine.js';
import { ExecutionMode } from '../../../../../../platform/construct/common/agent/executionMode.js';
import { LoadingState, FileChangeEntry } from '../../../../../../platform/construct/common/agent/loadingState.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IChatMessage, IToolDefinition, IToolCall } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
import { IMCPProcess } from '../../../../../../platform/construct/common/mcp/mcpProcess.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { ITerminalExecutor } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IDiffApplier } from '../../../../../../platform/construct/common/editor/diffApplier.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IConstructMemoryService } from '../../../../../../platform/construct/common/memory/constructMemory.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands';
import { IFileService } from '../../../../../../platform/files/common/files';
import { URI } from '../../../../../../base/common/uri.js';
import { IAgentErrorRecovery } from '../../../../../../platform/construct/common/recovery/agentErrorRecovery.js';
import { ISnapshotManager, IRestoreResult } from '../../../../../../platform/construct/common/snapshot/snapshotManager.js';
import { IFileWatcherService } from '../../../../../../platform/construct/common/watcher/fileWatcherService.js';
// SEC-6: Prompt sanitisation to prevent injection attacks
import { PromptSanitiser } from '../../../../../../platform/construct/common/security/promptSanitiser.js';
// SEC-4: Workspace boundary validation to prevent path traversal
import { assertWithinWorkspace } from '../../../../../../platform/construct/common/security/workspaceGuard.js';
// SEC-7: Secret redaction from tool outputs
import { redactSecrets } from '../../../../../../platform/construct/common/security/secretRedactor.js';
// P0-5: In-memory staging for agent-proposed changes
import { IPendingChangesService } from '../../../../../../platform/construct/common/diff/pendingChanges.js';
import { IUniversalMemoryService } from '../../../../../../platform/construct/common/memory/universalMemoryService.js';
import { IObsidianMemoryService } from '../../../../../../platform/construct/common/memory/obsidianMemoryService.js';
import { IConstructToolRegistry } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
// H3: Prompt sanitizer for memory injection prevention
import { sanitizeMemoryContext } from '../../../../../../platform/construct/common/agent/promptSanitizer.js';
// F-F-004: Configuration service for configurable max rounds
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';

// F-F-004: MAX_ROUNDS is now configurable via construct.agent.maxRounds setting.
// The default is 15 and can be adjusted between 5-50.
// See constructApiConfig.ts for the configuration registration.

/**
 * Cached result of a tool execution, used to avoid double-execution
 * during the planning phase.
 */
interface IToolResultCache {
        output: string;
        isError: boolean;
}

/**
 * Tool definitions for the unified AI provider interface.
 */
const AGENT_TOOLS: IToolDefinition[] = [
        {
                name: 'read_file',
                description: 'Read the contents of a file. Returns the file content as a string.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' }
                        },
                        required: ['path']
                }
        },
        {
                name: 'write_file',
                description: 'Write content to a file. Creates the file and parent directories if they don\'t exist.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' },
                                content: { type: 'string' as const, description: 'Content to write to the file' }
                        },
                        required: ['path', 'content']
                }
        },
        {
                name: 'list_directory',
                description: 'List the contents of a directory. Returns file and directory names.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the directory relative to workspace root' }
                        },
                        required: ['path']
                }
        },
        {
                name: 'create_directory',
                description: 'Create a directory, including any necessary parent directories.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the directory relative to workspace root' }
                        },
                        required: ['path']
                }
        },
        {
                name: 'run_command',
                description: 'Execute a shell command and return the output. Use for installing dependencies, running builds, tests, etc.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                command: { type: 'string' as const, description: 'The shell command to execute' },
                                cwd: { type: 'string' as const, description: 'Working directory (optional, defaults to workspace root)' }
                        },
                        required: ['command']
                }
        },
        {
                name: 'edit_file',
                description: 'Apply a unified diff to an existing file. Use for targeted edits rather than rewriting entire files.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' },
                                diff: { type: 'string' as const, description: 'Unified diff content to apply' }
                        },
                        required: ['path', 'diff']
                }
        },
        {
                name: 'search_codebase',
                description: 'Search the codebase using semantic similarity. Returns the most relevant code chunks. Requires Qdrant vector store to be running.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                query: { type: 'string' as const, description: 'The search query in natural language' },
                                topK: { type: 'number' as const, description: 'Number of results to return (default 8)' }
                        },
                        required: ['query']
                }
        },
        {
                name: 'web_search',
                description: 'Search the web for information. Only available when online mode is enabled. Returns search results with URLs and snippets.',
                inputSchema: {
                        type: 'object' as const,
                        properties: {
                                query: { type: 'string' as const, description: 'The search query' },
                                num: { type: 'number' as const, description: 'Number of results to return (default 10)' }
                        },
                        required: ['query']
                }
        }
];

/** Read-only tools for planning phase. */
const PLANNING_TOOLS: IToolDefinition[] = [
        AGENT_TOOLS[0], // read_file
        AGENT_TOOLS[2], // list_directory
];

export class AgentLoopService extends Disposable implements IAgentLoop {
        readonly _serviceBrand: undefined;

        private _isRunning = false;
        private readonly _onDidStart = this._register(new Emitter<string>());
        readonly onDidStart = this._onDidStart.event;
        private readonly _onDidComplete = this._register(new Emitter<{ summary: string }>());
        readonly onDidComplete = this._onDidComplete.event;
        private readonly _onError = this._register(new Emitter<{ text: string; recoverable: boolean }>());
        readonly onError = this._onError.event;

        private readonly _onLoadingStateChange = this._register(new Emitter<LoadingState>());
        readonly onLoadingStateChange = this._onLoadingStateChange.event;

        private readonly _onFileChange = this._register(new Emitter<FileChangeEntry>());
        readonly onFileChange = this._onFileChange.event;

        private readonly _onDidMilestoneEvent = this._register(new Emitter<AgentLoopEvent>());
        readonly onDidMilestoneEvent = this._onDidMilestoneEvent.event;

        /** H2: Multi-turn conversation history preserved across run() calls. */
        private _conversationHistory: IChatMessage[] = [];

        /** Active snapshot ID for the current task (for undo support). */
        private _activeSnapshotId: string | null = null;

        /** Milestone execution state. */
        private _executionState: ExecutionState = ExecutionState.Idle;
        private _currentMilestone: IMilestone | null = null;
        private _approvedPlan: IApprovedPlan | null = null;
        private _executionConfig: { mode: ExecutionMode; selectedMilestoneIds?: string[] } | null = null;
        private _milestoneResumeResolver: (() => void) | null = null;
        private _currentPlanContext: string | null = null;
        get currentPlanContext(): string | null {
                return this._currentPlanContext;
        }
        private _completedMilestoneIds: Set<string> = new Set();

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IMCPProcess private readonly mcpProcess: IMCPProcess,
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
                @IDiffApplier private readonly diffApplier: IDiffApplier,
                @IMemoryOrchestrator private readonly memoryOrchestrator: IMemoryOrchestrator,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ICommandService private readonly commandService: ICommandService,
                @IFileService private readonly fileService: IFileService,
                @IAgentErrorRecovery private readonly errorRecovery: IAgentErrorRecovery,
                @ISnapshotManager private readonly snapshotManager: ISnapshotManager,
                @IFileWatcherService private readonly fileWatcher: IFileWatcherService,
                @IPendingChangesService private readonly pendingChanges: IPendingChangesService,
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager,
                @IUniversalMemoryService private readonly universalMemory: IUniversalMemoryService,
                @IObsidianMemoryService private readonly obsidianMemory: IObsidianMemoryService,
                @IConstructToolRegistry private readonly toolRegistry: IConstructToolRegistry,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                this.logService.info('[AgentLoop] Service created with error recovery, snapshots, file watcher, pending changes, universal memory, obsidian memory, tool registry, and config service');
        }

        // F-F-004: Read max rounds from configuration
        private get maxRounds(): number {
                return this.configurationService.getValue<number>('construct.agent.maxRounds') || 15;
        }

        get isRunning(): boolean {
                return this._isRunning;
        }

        get executionState(): ExecutionState {
                return this._executionState;
        }

        get currentMilestone(): IMilestone | null {
                return this._currentMilestone;
        }

        /**
         * H2: Clear the multi-turn conversation history.
         * Called when the user starts a new chat session.
         */
        clearConversationHistory(): void {
                this._conversationHistory = [];
                this.logService.info('[AgentLoop] Conversation history cleared');
        }

        async runPlanningPhase(task: string, signal?: AbortSignal): Promise<IPlanResult> {
                this.logService.info(`[AgentLoop] Planning phase started: ${task}`);

                // Ensure MCP process is connected for planning reads
                if (!this.mcpProcess.connected) {
                        await this.mcpProcess.initialize();
                }

                // Build system prompt with memory context
                const systemPrompt = await this.buildSystemPrompt(task, true);

                const conversationMessages: IChatMessage[] = [
                        {
                                role: 'user',
                                content: `Analyze the current workspace and create a plan for this task: "${task}"\n\nFirst, explore the workspace to understand its structure, then list the specific steps needed. Use only read_file and list_directory tools.\n\nFormat your response as a numbered list of steps, each starting with [Read], [Create], [Edit], or [Run].`
                        }
                ];

                let fullResponse = '';

                try {
                        let roundCount = 0;

                        while (roundCount < this.maxRounds) {
                                roundCount++;

                                // Tool result cache: prevents double-execution during planning.
                                // Results are cached during stream iteration and reused when
                                // building the tool result messages for the next API call.
                                const toolResultCache = new Map<string, IToolResultCache>();

                                const assistantToolCalls: IToolCall[] = [];
                                let currentText = '';
                                let stopReason = '';
                                let hadToolCalls = false;

                                // Create a NEW stream for each round with updated conversation
                                // Create a timeout controller (60s per LLM call)
                                const timeoutController = new AbortController();
                                const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);
                                // Chain user's abort signal with the timeout
                                if (signal) {
                                        signal.addEventListener('abort', () => timeoutController.abort());
                                }

                                const stream = this.aiService.chat(
                                        conversationMessages,
                                        this.getAllPlanningTools(),
                                        { signal: timeoutController.signal, systemPrompt }
                                );

                                for await (const event of stream) {
                                        if (signal?.aborted) {
                                                clearTimeout(timeoutId);
                                                return { steps: [], summary: 'Cancelled', rawResponse: '' };
                                        }

                                        switch (event.type) {
                                                case 'token':
                                                        currentText += event.text;
                                                        fullResponse += event.text;
                                                        break;
                                                case 'tool_start':
                                                        hadToolCalls = true;
                                                        assistantToolCalls.push({
                                                                id: event.toolId,
                                                                name: event.toolName,
                                                                arguments: '{}',
                                                        });
                                                        break;
                                                case 'tool_end': {
                                                        // Update the tool call with the actual arguments
                                                        const toolCall = assistantToolCalls.find(
                                                                tc => tc.id === event.toolId
                                                        );
                                                        if (toolCall) {
                                                                toolCall.arguments = JSON.stringify(event.toolInput);
                                                        }

                                                        // Execute the tool ONCE and cache the result
                                                        if (!toolResultCache.has(event.toolId)) {
                                                                                                const toolResult = await this.executeTool(event.toolName, event.toolInput, true, signal);
                                                                toolResultCache.set(event.toolId, {
                                                                        output: toolResult,
                                                                        isError: toolResult.startsWith('Error:'),
                                                                });
                                                        }
                                                        break;
                                                }
                                                case 'done':
                                                        stopReason = event.stopReason;
                                                        break;
                                                case 'error':
                                                        throw new Error(event.text);
                                        }
                                }

                                clearTimeout(timeoutId);

                                // If there were tool calls, add assistant message + tool result messages and continue
                                if (hadToolCalls && stopReason === 'tool_use') {
                                        conversationMessages.push({
                                                role: 'assistant',
                                                content: currentText || '',
                                                toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined
                                        });

                                        // Build tool result messages from cache (NOT re-executing tools)
                                        for (const toolCall of assistantToolCalls) {
                                                const cached = toolResultCache.get(toolCall.id);
                                                if (cached) {
                                                        conversationMessages.push({
                                                                role: 'tool',
                                                                content: cached.output,
                                                                toolCallId: toolCall.id,
                                                        });
                                                } else {
                                                        // Fallback: should not happen, but execute once if cache miss
                                                        this.logService.warn(`[AgentLoop] Cache miss for tool ${toolCall.id}, executing as fallback`);
                                                        let input: any;
                                                        try {
                                                                input = JSON.parse(toolCall.arguments);
                                                        } catch (parseError) {
                                                                conversationMessages.push({
                                                                        role: 'tool',
                                                                        content: `Error: Your tool call produced invalid JSON. Please fix and try again. Error: ${parseError instanceof Error ? parseError.message : String(parseError)}`
                                                                });
                                                                roundCount++;
                                                                continue;
                                                        }
                                                        const result = await this.executeTool(toolCall.name, input, true, signal);
                                                        conversationMessages.push({
                                                                role: 'tool',
                                                                content: result,
                                                                toolCallId: toolCall.id,
                                                        });
                                                }
                                        }
                                        continue;
                                }

                                // End turn -- planning complete
                                break;
                        }

                        // Parse the plan from the response
                        const steps = this.parsePlan(fullResponse);

                        return {
                                steps,
                                summary: fullResponse,
                                rawResponse: fullResponse,
                        };
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[AgentLoop] Planning error: ${msg}`);
                        throw error;
                }
        }

        async *run(task: string, signal?: AbortSignal): AsyncGenerator<AgentLoopEvent> {
                if (this._isRunning) {
                        yield { type: 'error', text: 'Agent loop is already running.', recoverable: false };
                        return;
                }

                this._isRunning = true;
                this._onDidStart.fire(task);
                this.logService.info(`[AgentLoop] Execution started: ${task}`);

                try {
                        // Ensure MCP process is connected
                        if (!this.mcpProcess.connected) {
                                await this.mcpProcess.initialize();
                        }

                        // Create snapshot before task execution (for undo support)
                        const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '.';
                        try {
                                const snapshot = await this.snapshotManager.createSnapshot(workspacePath, task);
                                this._activeSnapshotId = snapshot.id;
                                this.logService.info(`[AgentLoop] Snapshot created: ${snapshot.id} (strategy: ${snapshot.strategy})`);
                        } catch (snapErr) {
                                this.logService.warn('[AgentLoop] Snapshot creation failed (non-blocking):', snapErr instanceof Error ? snapErr.message : String(snapErr));
                        }

                        // Start file watcher for real-time refresh
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                        if (workspaceRoot && !this.fileWatcher.isWatching) {
                                this.fileWatcher.startWatching(workspaceRoot);
                        }

                        // Build system prompt with memory context
                        const systemPrompt = await this.buildSystemPrompt(task, false);

                        // Record conversation turn in Obsidian memory
                        const sessionId = `agent-${Date.now()}`;
                        this.obsidianMemory.recordConversationTurn(sessionId, 'user', task);

                        // H2: Prepend conversation history so multi-turn context is preserved
                        const conversationMessages: IChatMessage[] = [
                                ...this._conversationHistory,
                                {
                                        role: 'user',
                                        content: task
                                }
                        ];

                        let roundCount = 0;
                        let finalSummary = '';

                        while (roundCount < this.maxRounds) {
                                roundCount++;
                                this.logService.info(`[AgentLoop] Round ${roundCount}/${this.maxRounds}`);

                                const assistantToolCalls: IToolCall[] = [];
                                const toolResults: { toolUseId: string; toolName: string; result: string; success: boolean; filePath?: string }[] = [];
                                let currentText = '';
                                let stopReason = '';
                                let hasToolCalls = false;

                                // Create a NEW stream for each round with updated conversation
                                // Create a timeout controller (60s per LLM call)
                                const timeoutController = new AbortController();
                                const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);
                                // Chain user's abort signal with the timeout
                                if (signal) {
                                        signal.addEventListener('abort', () => timeoutController.abort());
                                }

                                const stream = this.aiService.chat(
                                        conversationMessages,
                                        this.getAllTools(),
                                        { signal: timeoutController.signal, systemPrompt }
                                );

                                for await (const event of stream) {
                                        if (signal?.aborted) {
                                                clearTimeout(timeoutId);
                                                yield { type: 'error', text: '[STOP] Stopped by user', recoverable: false };
                                                this._isRunning = false;
                                                return;
                                        }

                                        switch (event.type) {
                                                case 'token':
                                                        currentText += event.text;
                                                        yield { type: 'token', text: event.text };
                                                        break;

                                                case 'tool_start':
                                                        hasToolCalls = true;
                                                        assistantToolCalls.push({
                                                                id: event.toolId,
                                                                name: event.toolName,
                                                                arguments: '{}',
                                                        });
                                                        yield { type: 'tool_start', toolId: event.toolId, toolName: event.toolName };
                                                        break;

                                                case 'tool_input':
                                                        yield { type: 'tool_executing', toolId: event.toolId, toolName: '', detail: event.text };
                                                        break;

                                                case 'tool_end': {
                                                        // Update the tool call with the actual arguments
                                                        const toolCall = assistantToolCalls.find(
                                                                tc => tc.id === event.toolId
                                                        );
                                                        if (toolCall) {
                                                                toolCall.arguments = JSON.stringify(event.toolInput ?? {});
                                                        }

                                                        yield { type: 'tool_executing', toolId: event.toolId, toolName: event.toolName, detail: 'Executing...' };

                                                        // Execute the tool with error recovery
                                                        let toolResult = await this.executeTool(event.toolName, event.toolInput, false, signal);
                                                        let success = !toolResult.startsWith('Error:');

                                                        // Error recovery: if tool failed, attempt recovery
                                                        if (!success && this.errorRecovery) {
                                                                const stepError = this.errorRecovery.classifyError(
                                                                        event.toolName,
                                                                        event.toolInput,
                                                                        toolResult,
                                                                        undefined,
                                                                        undefined
                                                                );
                                                                this.logService.info(`[AgentLoop] Step error classified: ${stepError.errorType} for tool ${event.toolName}`);

                                                                const recoveryResult = await this.errorRecovery.attemptRecovery(stepError);
                                                                if (recoveryResult.strategy === 'retry' && !recoveryResult.success) {
                                                                        // Inject error context into conversation for the next LLM call
                                                                        const errorContext = this.errorRecovery.buildErrorContext(stepError, [toolResult]);
                                                                        this.logService.info(`[AgentLoop] Injecting error context for retry: ${stepError.errorType}`);
                                                                        // The error context will be included in the next tool result message
                                                                        toolResult = `${toolResult}\n\n${errorContext}`;
                                                                } else if (recoveryResult.strategy === 'abort') {
                                                                        yield { type: 'error', text: `Step failed and user chose to abort: ${stepError.message}`, recoverable: false };
                                                                        this._isRunning = false;
                                                                        return;
                                                                }
                                                                // 'skip' strategy: continue with remaining steps
                                                        }

                                                        yield { type: 'tool_result', toolId: event.toolId, toolName: event.toolName, result: toolResult, success };

                                                        // Track file writes for snapshot + file watcher
                                                        let filePath: string | undefined;
                                                        if ((event.toolName === 'write_file' || event.toolName === 'edit_file') && success) {
                                                                const toolInput = event.toolInput as Record<string, string> | null;
                                                                filePath = toolInput?.path ?? '';
                                                                if (filePath) {
                                                                        yield { type: 'file_written', filePath };

                                                                        // Track in snapshot for undo support
                                                                        if (this._activeSnapshotId) {
                                                                                try {
                                                                                        const exists = await this.diffApplier.exists(filePath);
                                                                                        if (exists) {
                                                                                                this.snapshotManager.trackFileModified(this._activeSnapshotId, filePath);
                                                                                        } else {
                                                                                                this.snapshotManager.trackFileCreated(this._activeSnapshotId, filePath);
                                                                                        }
                                                                                } catch {
                                                                                        // Snapshot tracking is non-critical
                                                                                        this.snapshotManager.trackFileCreated(this._activeSnapshotId, filePath);
                                                                                }
                                                                        }

                                                                        // Notify file watcher for real-time tree refresh
                                                                        const fileUri = URI.file(filePath);
                                                                        this.fileWatcher.notifyAgentFileCreated(fileUri);
                                                                }
                                                        }

                                                        // Store tool result for batching
                                                        toolResults.push({
                                                                toolUseId: event.toolId,
                                                                toolName: event.toolName,
                                                                result: toolResult,
                                                                success,
                                                                filePath,
                                                        });

                                                        // Store in memory
                                                        if (this.constructMemory.isInitialized && this.constructMemory.config.autoLearn) {
                                                                this.constructMemory.addMemory(
                                                                        `Tool ${event.toolName}: ${JSON.stringify(event.toolInput)} -> ${success ? 'Success' : 'Failed'}`,
                                                                        { type: 'tool_result', toolName: event.toolName, taskId: task }
                                                                ).catch(() => { /* non-critical */ });
                                                        }
                                                        break;
                                                }

                                                case 'done':
                                                        stopReason = event.stopReason;
                                                        break;

                                                case 'error':
                                                        yield { type: 'error', text: event.text, recoverable: true };
                                                        break;
                                        }
                                }

                                clearTimeout(timeoutId);

                                // Add remaining text to final summary
                                if (currentText) {
                                        finalSummary += currentText;
                                }

                                // If there were tool calls, add assistant + tool results to conversation
                                if (hasToolCalls && toolResults.length > 0) {
                                        conversationMessages.push({
                                                role: 'assistant',
                                                content: currentText || '(executing tools)',
                                                toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined
                                        });

                                        // Each tool result is a separate message in the unified format
                                        for (const tr of toolResults) {
                                                conversationMessages.push({
                                                        role: 'tool',
                                                        content: tr.result,
                                                        toolCallId: tr.toolUseId,
                                                });
                                        }
                                }

                                // If end_turn or no more tool calls, we're done
                                if (stopReason === 'end_turn' || !hasToolCalls) {
                                        // H2: Append user message and assistant response to conversation history
                                        this._conversationHistory.push({ role: 'user', content: task });
                                        this._conversationHistory.push({ role: 'assistant', content: currentText || finalSummary || 'Task completed.' });

                                        // H2: Cap conversation history at 50 messages, keeping first system message if any
                                        const MAX_HISTORY = 50;
                                        if (this._conversationHistory.length > MAX_HISTORY) {
                                                const firstMsg = this._conversationHistory[0];
                                                const isSystem = firstMsg?.role === 'system';
                                                if (isSystem) {
                                                        // Keep the system message + most recent (MAX_HISTORY - 1) messages
                                                        this._conversationHistory = [
                                                                firstMsg,
                                                                ...this._conversationHistory.slice(-(MAX_HISTORY - 1))
                                                        ];
                                                } else {
                                                        this._conversationHistory = this._conversationHistory.slice(-MAX_HISTORY);
                                                }
                                        }
                                        break;
                                }
                        }

                        if (roundCount >= this.maxRounds) {
                                yield { type: 'error', text: `Maximum rounds (${this.maxRounds}) reached — task may be incomplete. Consider increasing the limit in settings.`, recoverable: true } as AgentLoopEvent;
                        }

                        // Store task summary in memory
                        if (this.constructMemory.isInitialized && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(
                                        `Task completed: ${task}. Summary: ${finalSummary.substring(0, 500)}`,
                                        { type: 'task_summary', task }
                                ).catch(() => { /* non-critical */ });
                        }

                        // Auto-extract universal memory from completed task
                        if (this.universalMemory && finalSummary) {
                                this.universalMemory.autoExtractFromTask(task, finalSummary.substring(0, 500)).catch(() => { /* non-critical */ });
                        }

                        // Record assistant turn and auto-extract from Obsidian memory
                        if (finalSummary) {
                                this.obsidianMemory.recordConversationTurn(sessionId, 'assistant', finalSummary.substring(0, 500));
                                this.obsidianMemory.autoExtractFromConversation(sessionId).catch(() => { /* non-critical */ });
                        }

                        yield { type: 'complete', summary: finalSummary || 'Task completed.' };
                        this._onDidComplete.fire({ summary: finalSummary });
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[AgentLoop] Error: ${msg}`);
                        this._onError.fire({ text: msg, recoverable: false });
                        yield { type: 'error', text: msg, recoverable: false };
                } finally {
                        this._isRunning = false;
                        this._activeSnapshotId = null;
                }
        }

        /**
         * Run the planning phase with a pre-refined idea description.
         * The refined idea provides more detail than a raw prompt.
         */
        async runPlanningPhaseWithIdea(refinedDescription: string, signal?: AbortSignal): Promise<IPlanResult> {
                this.logService.info(`[AgentLoop] Planning phase started with refined idea: ${refinedDescription.substring(0, 100)}...`);
                const task = `Based on the following refined specification, analyze the workspace and create a detailed implementation plan:\n\n${refinedDescription}`;
                return this.runPlanningPhase(task, signal);
        }

        /**
         * Run execution with an approved plan, supporting milestone-based pausing.
         */
        async *runWithApprovedPlan(approvedPlan: IApprovedPlan, signal?: AbortSignal): AsyncGenerator<AgentLoopEvent> {
                const selectedSteps = approvedPlan.steps.filter(s => s.selected);
                if (selectedSteps.length === 0) {
                        yield { type: 'error', text: 'No steps selected for execution.', recoverable: false };
                        return;
                }

                const taskDescription = selectedSteps.map(s => `${s.action}: ${s.target}`).join('\n');
                const enhancedTask = `${approvedPlan.task}\n\nExecute these specific steps:\n${taskDescription}`;

                yield* this.run(enhancedTask, signal);
        }

        /**
         * @deprecated Use runWithApprovedPlan() instead which yields events via AsyncGenerator.
         * startExecution() runs in the background without yielding and may be removed in a future version.
         *
         * Start milestone-aware execution from an approved plan.
         */
        startExecution(approvedPlan: IApprovedPlan, signal?: AbortSignal): void {
                this._approvedPlan = approvedPlan;
                this._executionConfig = {
                        mode: approvedPlan.executionMode as ExecutionMode,
                };
                this._completedMilestoneIds = new Set();
                this._executionState = ExecutionState.Executing;
                this._currentPlanContext = approvedPlan.task;

                // Run the execution in the background
                const runAsync = async () => {
                        try {
                                const selectedSteps = approvedPlan.steps.filter(s => s.selected);
                                const taskDescription = selectedSteps.map(s => `${s.action}: ${s.target}`).join('\n');
                                const enhancedTask = `${approvedPlan.task}\n\nExecute these specific steps:\n${taskDescription}`;

                                const stream = this.run(enhancedTask, signal);
                                for await (const event of stream) {
                                        // Check for milestone pauses
                                        if (event.type === 'tool_result' && event.success) {
                                                const shouldPause = this.shouldPauseAtMilestone(event);
                                                if (shouldPause && this._currentMilestone) {
                                                        this._executionState = ExecutionState.PausedAtMilestone;
                                                        this._onDidMilestoneEvent.fire({ type: 'milestone_paused', milestone: this._currentMilestone } as AgentLoopEvent);
                                                        // Wait for resume
                                                        await this._waitForResume();
                                                }
                                        }
                                }
                                this._executionState = ExecutionState.Complete;
                        } catch (error) {
                                this._executionState = ExecutionState.Error;
                        }
                };
                runAsync().catch(err => { this._executionState = ExecutionState.Error; this._onError.fire({ text: err instanceof Error ? err.message : String(err), recoverable: false }); this.logService.error('[AgentLoop] startExecution failed:', err); });
        }

        /**
         * Reset the execution state to Idle and clear the current milestone.
         * Called by the VIEW after processing a terminal state (Complete/Error).
         */
        resetState(): void {
                this._executionState = ExecutionState.Idle;
                this._currentMilestone = null;
        }

        /**
         * Resume from the current milestone pause.
         */
        resumeFromMilestone(): void {
                if (this._milestoneResumeResolver) {
                        this._executionState = ExecutionState.Executing;
                        const milestone = this._currentMilestone;
                        this._milestoneResumeResolver();
                        this._milestoneResumeResolver = null;
                        if (milestone) {
                                this._completedMilestoneIds.add(milestone.id);
                        }
                        this._currentMilestone = null;
                }
        }

        /**
         * Skip the current milestone and move to the next.
         */
        skipCurrentMilestone(): void {
                if (this._milestoneResumeResolver) {
                        this._executionState = ExecutionState.Executing;
                        const milestone = this._currentMilestone;
                        this._milestoneResumeResolver();
                        this._milestoneResumeResolver = null;
                        if (milestone) {
                                this._completedMilestoneIds.add(milestone.id);
                        }
                        this._currentMilestone = null;
                }
        }

        /**
         * Wait for the user to resume from a milestone pause.
         */
        private _waitForResume(): Promise<void> {
                return new Promise<void>((resolve) => {
                        this._milestoneResumeResolver = resolve;
                });
        }

        /**
         * Check if the agent should pause at a milestone based on the execution mode.
         */
        private shouldPauseAtMilestone(event: { type: string; toolId?: string; toolName?: string }): boolean {
                if (!this._executionConfig || !this._approvedPlan) {
                        return false;
                }

                const milestones = this._approvedPlan.milestones;
                if (!milestones || milestones.length === 0) {
                        return false;
                }

                const mode = this._executionConfig.mode;

                // Full auto: never pause
                if (mode === ExecutionMode.FullAuto) {
                        return false;
                }

                // Find the next uncompleted milestone
                const nextMilestone = milestones.find(m => !this._completedMilestoneIds.has(m.id) && !m.completed);
                if (!nextMilestone) {
                        return false;
                }

                // Set current milestone if not already set
                if (!this._currentMilestone || this._currentMilestone.id !== nextMilestone.id) {
                        this._currentMilestone = nextMilestone;
                }

                switch (mode) {
                        case ExecutionMode.EveryMilestone:
                                return true;
                        case ExecutionMode.MajorMilestone:
                                return nextMilestone.isMajor;
                        case ExecutionMode.Selective:
                                return this._executionConfig.selectedMilestoneIds?.includes(nextMilestone.id) ?? false;
                        default:
                                return false;
                }
        }

        /**
         * Extract milestones from a plan's steps.
         * Groups consecutive steps into milestones, marking major ones
         * at natural boundaries (e.g., after file creation steps).
         */
        extractMilestonesFromPlan(steps: IPlanStep[]): IMilestone[] {
                if (steps.length === 0) {
                        return [];
                }

                const milestones: IMilestone[] = [];
                let currentGroup: number[] = [];
                let milestoneIndex = 0;

                for (let i = 0; i < steps.length; i++) {
                        currentGroup.push(i);

                        // Create a milestone boundary after every 3-5 steps,
                        // or when the action type changes to a different category
                        const isNaturalBoundary =
                                currentGroup.length >= 3 &&
                                (i === steps.length - 1 ||
                                        (steps[i].action === 'Run' && steps[i + 1]?.action !== 'Run') ||
                                        (steps[i].action === 'Create' && steps[i + 1]?.action !== 'Create') ||
                                        currentGroup.length >= 5);

                        if (isNaturalBoundary) {
                                const firstStep = steps[currentGroup[0]];
                                const lastStep = steps[currentGroup[currentGroup.length - 1]];
                                const isMajor = currentGroup.some(idx =>
                                        steps[idx].action === 'Create' || steps[idx].action === 'Run'
                                );

                                milestones.push({
                                        id: `milestone-${milestoneIndex}`,
                                        name: `${firstStep.action}: ${firstStep.target}${currentGroup.length > 1 ? ` -> ${lastStep.target}` : ''}`,
                                        description: `Steps ${currentGroup[0] + 1}-${currentGroup[currentGroup.length - 1] + 1}`,
                                        index: milestoneIndex,
                                        isMajor,
                                        stepIndices: [...currentGroup],
                                        completed: false,
                                });

                                currentGroup = [];
                                milestoneIndex++;
                        }
                }

                // Handle remaining steps
                if (currentGroup.length > 0) {
                        const firstStep = steps[currentGroup[0]];
                        milestones.push({
                                id: `milestone-${milestoneIndex}`,
                                name: `${firstStep.action}: ${firstStep.target}`,
                                description: `Steps ${currentGroup[0] + 1}-${currentGroup[currentGroup.length - 1] + 1}`,
                                index: milestoneIndex,
                                isMajor: currentGroup.some(idx =>
                                        steps[idx].action === 'Create' || steps[idx].action === 'Run'
                                ),
                                stepIndices: [...currentGroup],
                                completed: false,
                        });
                }

                return milestones;
        }

        /**
         * Undo the last agent task by restoring the most recent snapshot.
         * Reverts all file changes made during the last task.
         */
        async undoLastTask(): Promise<IRestoreResult | null> {
                const snapshots = this.snapshotManager.getAllSnapshots();
                const lastSnapshot = snapshots.find(s => s.status === 'active');
                if (!lastSnapshot) {
                        this.logService.info('[AgentLoop] No active snapshot to undo');
                        return null;
                }

                this.logService.info(`[AgentLoop] Undoing task: ${lastSnapshot.taskDescription} (snapshot: ${lastSnapshot.id})`);
                const result = await this.snapshotManager.restoreSnapshot(lastSnapshot.id);
                this.refreshExplorer();
                return result;
        }

        /**
         * Execute a tool and return the result as a string.
         */
        private async executeTool(name: string, input: unknown, readOnly: boolean, signal?: AbortSignal): Promise<string> {
                const args = (input as Record<string, string> | null) ?? {};

                // Try tool registry first
                try {
                        const registryTool = this.toolRegistry?.getTool(name);
                        if (registryTool) {
                                const result = await this.toolRegistry.execute(name, args as Record<string, unknown>, signal);
                                if (result.success) {
                                        return result.output;
                                } else {
                                        return `Error: ${result.output}`;
                                }
                        }
                } catch {
                        // Fall through to hardcoded implementation
                }

                try {
                        switch (name) {
                                case 'read_file': {
                                        const path = args.path;
                                        if (!path) { return 'Error: path is required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        const content = await this.mcpProcess.readFile(path);
                                        // SEC-6: Sanitise file content before injecting into LLM context
                                        return PromptSanitiser.sanitise(content);
                                }

                                case 'write_file': {
                                        if (readOnly) { return 'Error: write_file not available during planning phase'; }
                                        const path = args.path;
                                        const content = args.content;
                                        if (!path || content === undefined) { return 'Error: path and content are required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        // P0-5 FIX: Stage in memory, don't write to disk directly
                                        const writeUri = URI.file(path);
                                        await this.pendingChanges.stageFile(writeUri, content);
                                        return `File change staged: ${path}. Review and accept/reject in diff view.`;
                                }

                                case 'list_directory': {
                                        const path = args.path ?? '.';
                                        // SEC-4: Validate path is within workspace (allow '.' as CWD)
                                        if (path !== '.') {
                                                assertWithinWorkspace(path, this.workspaceContextService);
                                        }
                                        const entries = await this.mcpProcess.listDirectory(path);
                                        // SEC-6: Sanitise directory listing before injecting into LLM context
                                        return PromptSanitiser.sanitise(entries.join('\n'));
                                }

                                case 'create_directory': {
                                        if (readOnly) { return 'Error: create_directory not available during planning phase'; }
                                        const path = args.path;
                                        if (!path) { return 'Error: path is required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        await this.mcpProcess.createDirectory(path);
                                        return `Directory created: ${path}`;
                                }

                                case 'run_command': {
                                        if (readOnly) { return 'Error: run_command not available during planning phase'; }
                                        const command = args.command;
                                        if (!command) { return 'Error: command is required'; }
                                        const cwd = args.cwd;
                                        const result = await this.terminalExecutor.execute(command, cwd, 60000, signal);
                                        let output = '';
                                        if (result.stdout) { output += result.stdout; }
                                        if (result.stderr) { output += (output ? '\n' : '') + result.stderr; }
                                        if (result.exitCode !== 0) {
                                                output += `\nExit code: ${result.exitCode}`;
                                        }
                                        // SEC-6: Sanitise command output to prevent injection
                                        // SEC-7: Redact any secrets from command output
                                        return PromptSanitiser.sanitise(redactSecrets(output || '(no output)'));
                                }

                                case 'edit_file': {
                                        if (readOnly) { return 'Error: edit_file not available during planning phase'; }
                                        const path = args.path;
                                        const diff = args.diff;
                                        if (!path || !diff) { return 'Error: path and diff are required'; }
                                        // SEC-4: Validate path is within workspace
                                        assertWithinWorkspace(path, this.workspaceContextService);
                                        // P0-5 FIX: Stage in memory, don't apply diff directly
                                        const editUri = URI.file(path);
                                        await this.pendingChanges.stageEdit(editUri, diff);
                                        return `Edit staged: ${path}. Review and accept/reject in diff view.`;
                                }

                                case 'search_codebase': {
                                        const query = args.query;
                                        if (!query) { return 'Error: query is required'; }
                                        // Delegate to the tool registry which has vector store access
                                        try {
                                                // Use command service to execute via the registry
                                                const toolResult = await this.commandService.executeCommand('construct.executeTool', 'search_codebase', { query, topK: args.topK ?? 8 });
                                                const raw = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                                                // SEC-6: Sanitise search results to prevent injection
                                                return PromptSanitiser.sanitise(raw);
                                        } catch {
                                                return 'Error: Codebase search unavailable. Qdrant may not be running.';
                                        }
                                }

                                case 'web_search': {
                                        const query = args.query;
                                        if (!query) { return 'Error: query is required'; }
                                        // Delegate to the tool registry which handles online mode
                                        try {
                                                const toolResult = await this.commandService.executeCommand('construct.executeTool', 'web_search', { query, num: args.num ?? 10 });
                                                const raw = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                                                // SEC-6: Sanitise web search results to prevent injection
                                                // SEC-7: Redact secrets from web content
                                                return PromptSanitiser.sanitise(redactSecrets(raw));
                                        } catch {
                                                return 'Error: Web search unavailable. Enable online mode in settings.';
                                        }
                                }

                                default: {
                                        // BUG 7 FIX: Check if this is an MCP tool call (format: serverName__toolName)
                                        // Split only on the FIRST __ to handle tool names that contain __
                                        const separatorIndex = name.indexOf('__');
                                        if (separatorIndex !== -1) {
                                                const serverName = name.slice(0, separatorIndex);
                                                const toolName = name.slice(separatorIndex + 2);
                                                try {
                                                        const result = await this.mcpServerManager.executeTool(serverName, toolName, args, signal);
                                                        const raw = typeof result === 'string' ? result : JSON.stringify(result);
                                                        // SEC-6: Sanitise MCP tool output to prevent injection
                                                        // SEC-7: Redact secrets from MCP output
                                                        return PromptSanitiser.sanitise(redactSecrets(raw));
                                                } catch (err: unknown) {
                                                        return 'Error: MCP tool ' + name + ' failed: ' + (err instanceof Error ? err.message : String(err));
                                                }
                                        }
                                        return 'Error: Unknown tool: ' + name;
                                }
                        }
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        return `Error: ${msg}`;
                }
        }

        /**
         * Build the system prompt with memory context injected.
         * Calls memoryOrchestrator.injectContextIntoPrompt() to include
         * Supermemory persistent context and local four-layer memory.
         */
        private async buildSystemPrompt(task: string, planningOnly: boolean): Promise<string> {
                const workspacePath = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '.';
                const date = new Date().toISOString().split('T')[0];

                const mode = planningOnly ? 'PLANNING MODE -- use only read_file and list_directory to explore the workspace. Do NOT make any changes.' : '';

                let prompt = `You are Kovix, an expert AI coding assistant.

${mode}

Working directory: ${workspacePath}
Current date: ${date}

Guidelines:
- Always read relevant existing files before making changes
- Write complete, working code -- never truncate with "// ... rest of file"
- Prefer running commands over asking the user to run them
- After writing files, verify by reading them back
- Keep the user informed with brief status messages
- If task requires installing dependencies, do it
- Always think about what could go wrong and handle it`;

                // Inject memory context from MemoryOrchestrator (Supermemory + local layers)
                // SEC-6: Sanitise memory context before injection to prevent prompt injection
                if (this.memoryOrchestrator) {
                        try {
                                const projectId = this.workspaceContextService.getWorkspace().folders[0]?.name ?? 'default';
                                prompt = await this.memoryOrchestrator.injectContextIntoPrompt(prompt, projectId);
                                // H3: Sanitize memory-injected prompt to prevent injection attacks
                                prompt = sanitizeMemoryContext(prompt);
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Memory context injection failed, using base prompt:', error instanceof Error ? error.message : String(error));
                        }
                }

                // Inject universal memory context (cross-project knowledge)
                if (this.universalMemory) {
                        try {
                                const universalContext = await this.universalMemory.getContextForTask(task, 5);
                                if (universalContext) {
                                        // H3: Sanitize universal memory context before appending
                                        const sanitizedContext = sanitizeMemoryContext(universalContext);
                                        prompt += `\n\n[Universal Knowledge]\n${sanitizedContext}`;
                                }
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Universal memory context injection failed:', error instanceof Error ? error.message : String(error));
                        }
                }

                // Inject Obsidian memory context (persistent, editable memories)
                if (this.obsidianMemory) {
                        try {
                                const obsidianContext = this.obsidianMemory.getRelevantContext(task, 5);
                                if (obsidianContext) {
                                        // H3: Sanitize Obsidian memory context before appending
                                        const sanitizedContext = sanitizeMemoryContext(obsidianContext);
                                        prompt += `\n\n${sanitizedContext}`;
                                }
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Obsidian memory context injection failed:', error instanceof Error ? error.message : String(error));
                        }
                }

                return prompt;
        }

        /**
         * Parse a plan from the LLM's text response.
         */
        private parsePlan(response: string): IPlanStep[] {
                const steps: IPlanStep[] = [];
                const lines = response.split('\n');

                let stepIndex = 0;
                for (const line of lines) {
                        // Match lines like "1. [Read] src/App.tsx" or "[Create] new-file.tsx"
                        const match = line.match(/^\s*\d+\.?\s*\[(Read|Create|Edit|Run)\]\s*(.+)/i);
                        if (match) {
                                const action = (match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()) as IPlanStep['action'];
                                const target = match[2].trim();
                                steps.push({
                                        index: stepIndex++,
                                        action,
                                        target,
                                        description: line.trim(),
                                });
                        }
                }

                // If no structured steps found, create a generic plan
                if (steps.length === 0) {
                        steps.push({
                                index: 0,
                                action: 'Read',
                                target: 'workspace',
                                description: response.substring(0, 200),
                        });
                }

                return steps;
        }

        /**
         * Refresh the file explorer after file writes.
         * Uses multiple fallback strategies for reliability across contexts.
         */
        private async refreshExplorer(): Promise<void> {
                try {
                        // Primary: CONSTRUCT IDE command
                        await this.commandService.executeCommand('workbench.files.action.refreshFilesExplorer');
                } catch {
                        // Fallback: stat the workspace root to trigger file watcher
                        try {
                                const rootUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (rootUri) {
                                        await this.fileService.stat(rootUri);
                                }
                        } catch {
                                // Non-critical -- file explorer will refresh eventually via watchers
                        }
                }
        }

        /**
         * Merge hardcoded core tool definitions with any tools from the registry.
         * Registry tools that share a name with a core tool are skipped to avoid
         * duplicates (the core definition takes precedence for the LLM schema;
         * execution still routes through the registry via executeTool()).
         */
        private getAllTools(): IToolDefinition[] {
                const coreTools = AGENT_TOOLS;
                const registryTools = this.toolRegistry?.listTools() ?? [];
                const coreNames = new Set(coreTools.map(t => t.name));
                const extraTools: IToolDefinition[] = registryTools
                        .filter(t => !coreNames.has(t.name))
                        .map(t => ({
                                name: t.name,
                                description: t.description,
                                inputSchema: {
                                        type: 'object' as const,
                                        properties: t.inputSchema.properties as Record<string, unknown>,
                                        required: t.inputSchema.required,
                                },
                        }));
                return [...coreTools, ...extraTools];
        }

        /**
         * Get planning-phase tools (read-only) plus any read-only registry tools.
         */
        private getAllPlanningTools(): IToolDefinition[] {
                const corePlanning = PLANNING_TOOLS;
                const registryTools = this.toolRegistry?.listTools() ?? [];
                const coreNames = new Set(corePlanning.map(t => t.name));
                // Only include registry tools that don't modify files for planning
                const extraReadOnly: IToolDefinition[] = registryTools
                        .filter(t => !coreNames.has(t.name) && !t.modifiesFiles)
                        .map(t => ({
                                name: t.name,
                                description: t.description,
                                inputSchema: {
                                        type: 'object' as const,
                                        properties: t.inputSchema.properties as Record<string, unknown>,
                                        required: t.inputSchema.required,
                                },
                        }));
                return [...corePlanning, ...extraReadOnly];
        }

        override dispose(): void {
                super.dispose();
        }
}
