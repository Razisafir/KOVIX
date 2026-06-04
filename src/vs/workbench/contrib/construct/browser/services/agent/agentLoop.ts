/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IAgentLoop, AgentLoopEvent, IPlanResult, IPlanStep } from '../../../../../../platform/construct/common/agent/agentLoop.js';
import { IAnthropicProvider, IAnthropicMessage, IAnthropicContentBlock, IAnthropicTool } from '../../../../../../platform/construct/common/llm/anthropicProvider.js';
import { IMCPProcess } from '../../../../../../platform/construct/common/mcp/mcpProcess';
import { ITerminalExecutor } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IDiffApplier } from '../../../../../../platform/construct/common/editor/diffApplier.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IConstructMemoryService } from '../../../../../../platform/construct/common/memory/constructMemory.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands';
import { IFileService } from '../../../../../../platform/files/common/files';

const MAX_ROUNDS = 15;

/**
 * Cached result of a tool execution, used to avoid double-execution
 * during the planning phase.
 */
interface IToolResultCache {
        output: string;
        isError: boolean;
}

/**
 * Tool definitions for the Anthropic API.
 */
const AGENT_TOOLS: IAnthropicTool[] = [
        {
                name: 'read_file',
                description: 'Read the contents of a file. Returns the file content as a string.',
                input_schema: {
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
                input_schema: {
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
                input_schema: {
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
                input_schema: {
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
                input_schema: {
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
                input_schema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file relative to workspace root' },
                                diff: { type: 'string' as const, description: 'Unified diff content to apply' }
                        },
                        required: ['path', 'diff']
                }
        }
];

/** Read-only tools for planning phase. */
const PLANNING_TOOLS: IAnthropicTool[] = [
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

        constructor(
                @ILogService private readonly logService: ILogService,
                @IAnthropicProvider private readonly anthropicProvider: IAnthropicProvider,
                @IMCPProcess private readonly mcpProcess: IMCPProcess,
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
                @IDiffApplier private readonly diffApplier: IDiffApplier,
                @IMemoryOrchestrator private readonly memoryOrchestrator: IMemoryOrchestrator,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ICommandService private readonly commandService: ICommandService,
                @IFileService private readonly fileService: IFileService,
        ) {
                super();
                this.logService.info('[AgentLoop] Service created');
        }

        get isRunning(): boolean {
                return this._isRunning;
        }

        async runPlanningPhase(task: string, signal?: AbortSignal): Promise<IPlanResult> {
                this.logService.info(`[AgentLoop] Planning phase started: ${task}`);

                // Ensure MCP process is connected for planning reads
                if (!this.mcpProcess.connected) {
                        await this.mcpProcess.initialize();
                }

                // Build system prompt with memory context
                const systemPrompt = await this.buildSystemPrompt(task, true);

                const conversationMessages: IAnthropicMessage[] = [
                        {
                                role: 'user',
                                content: `Analyze the current workspace and create a plan for this task: "${task}"\n\nFirst, explore the workspace to understand its structure, then list the specific steps needed. Use only read_file and list_directory tools.\n\nFormat your response as a numbered list of steps, each starting with [Read], [Create], [Edit], or [Run].`
                        }
                ];

                let fullResponse = '';

                try {
                        let roundCount = 0;

                        while (roundCount < MAX_ROUNDS) {
                                roundCount++;

                                // Tool result cache: prevents double-execution during planning.
                                // Results are cached during stream iteration and reused when
                                // building the tool_results batch for the next API call.
                                const toolResultCache = new Map<string, IToolResultCache>();

                                const assistantContent: IAnthropicContentBlock[] = [];
                                let currentText = '';
                                let stopReason = '';
                                let hadToolCalls = false;

                                // Create a NEW stream for each round with updated conversation
                                const stream = this.anthropicProvider.streamMessages(
                                        conversationMessages,
                                        PLANNING_TOOLS,
                                        signal,
                                        systemPrompt
                                );

                                for await (const event of stream) {
                                        if (signal?.aborted) {
                                                return { steps: [], summary: 'Cancelled', rawResponse: '' };
                                        }

                                        switch (event.type) {
                                                case 'token':
                                                        currentText += event.text;
                                                        fullResponse += event.text;
                                                        break;
                                                case 'tool_start':
                                                        hadToolCalls = true;
                                                        assistantContent.push({
                                                                type: 'tool_use',
                                                                id: event.toolId,
                                                                name: event.toolName,
                                                                input: {},
                                                        });
                                                        break;
                                                case 'tool_end': {
                                                        // Update the tool_use content block with the actual input
                                                        const block = assistantContent.find(
                                                                b => b.type === 'tool_use' && b.id === event.toolId
                                                        );
                                                        if (block && block.type === 'tool_use') {
                                                                block.input = event.toolInput;
                                                        }

                                                        // Execute the tool ONCE and cache the result
                                                        if (!toolResultCache.has(event.toolId)) {
                                                                const toolResult = await this.executeTool(event.toolName, event.toolInput, true);
                                                                toolResultCache.set(event.toolId, {
                                                                        output: toolResult,
                                                                        isError: toolResult.startsWith('Error:'),
                                                                });
                                                        }

                                                        // Add text prefix if any
                                                        if (currentText) {
                                                                assistantContent.unshift({ type: 'text', text: currentText });
                                                                currentText = '';
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

                                // Add remaining text as content
                                if (currentText) {
                                        assistantContent.unshift({ type: 'text', text: currentText });
                                }

                                // If there were tool calls, add assistant message + tool results and continue
                                if (hadToolCalls && stopReason === 'tool_use') {
                                        conversationMessages.push({ role: 'assistant', content: assistantContent.length > 0 ? assistantContent : [{ type: 'text', text: currentText }] });

                                        // Build tool results from cache (NOT re-executing tools)
                                        const toolResults: IAnthropicContentBlock[] = [];
                                        for (const block of assistantContent) {
                                                if (block.type === 'tool_use') {
                                                        const cached = toolResultCache.get(block.id ?? '');
                                                        if (cached) {
                                                                toolResults.push({
                                                                        type: 'tool_result',
                                                                        tool_use_id: block.id ?? '',
                                                                        content: cached.output,
                                                                });
                                                        } else {
                                                                // Fallback: should not happen, but execute once if cache miss
                                                                this.logService.warn(`[AgentLoop] Cache miss for tool ${block.id}, executing as fallback`);
                                                                const result = await this.executeTool(block.name ?? '', block.input, true);
                                                                toolResults.push({
                                                                        type: 'tool_result',
                                                                        tool_use_id: block.id ?? '',
                                                                        content: result,
                                                                });
                                                        }
                                                }
                                        }
                                        if (toolResults.length > 0) {
                                                conversationMessages.push({ role: 'user', content: toolResults });
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

                        // Build system prompt with memory context
                        const systemPrompt = await this.buildSystemPrompt(task, false);

                        const conversationMessages: IAnthropicMessage[] = [
                                {
                                        role: 'user',
                                        content: task
                                }
                        ];

                        let roundCount = 0;
                        let finalSummary = '';

                        while (roundCount < MAX_ROUNDS) {
                                roundCount++;
                                this.logService.info(`[AgentLoop] Round ${roundCount}/${MAX_ROUNDS}`);

                                const assistantContent: IAnthropicContentBlock[] = [];
                                const toolResults: { toolUseId: string; toolName: string; result: string; success: boolean; filePath?: string }[] = [];
                                let currentText = '';
                                let stopReason = '';
                                let hasToolCalls = false;

                                // Create a NEW stream for each round with updated conversation
                                const stream = this.anthropicProvider.streamMessages(
                                        conversationMessages,
                                        AGENT_TOOLS,
                                        signal,
                                        systemPrompt
                                );

                                for await (const event of stream) {
                                        if (signal?.aborted) {
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
                                                        assistantContent.push({
                                                                type: 'tool_use',
                                                                id: event.toolId,
                                                                name: event.toolName,
                                                                input: {},
                                                        });
                                                        yield { type: 'tool_start', toolId: event.toolId, toolName: event.toolName };
                                                        break;

                                                case 'tool_input':
                                                        yield { type: 'tool_executing', toolId: event.toolId, toolName: '', detail: event.text };
                                                        break;

                                                case 'tool_end': {
                                                        // Update the tool_use content block with the actual input
                                                        const block = assistantContent.find(
                                                                b => b.type === 'tool_use' && b.id === event.toolId
                                                        );
                                                        if (block && block.type === 'tool_use') {
                                                                block.input = event.toolInput ?? {};
                                                        }

                                                        yield { type: 'tool_executing', toolId: event.toolId, toolName: event.toolName, detail: 'Executing...' };

                                                        // Execute the tool immediately for real-time feedback
                                                        const toolResult = await this.executeTool(event.toolName, event.toolInput, false);
                                                        const success = !toolResult.startsWith('Error:');

                                                        yield { type: 'tool_result', toolId: event.toolId, toolName: event.toolName, result: toolResult, success };

                                                        // Track file writes
                                                        let filePath: string | undefined;
                                                        if ((event.toolName === 'write_file' || event.toolName === 'edit_file') && success) {
                                                                const toolInput = event.toolInput as Record<string, string> | null;
                                                                filePath = toolInput?.path ?? '';
                                                                if (filePath) {
                                                                        yield { type: 'file_written', filePath };
                                                                        // Refresh file explorer after writes
                                                                        this.refreshExplorer();
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

                                // Add remaining text to final summary
                                if (currentText) {
                                        finalSummary += currentText;
                                }

                                // Build the assistant message for this round
                                const roundAssistantContent: IAnthropicContentBlock[] = [];
                                if (currentText) {
                                        roundAssistantContent.push({ type: 'text', text: currentText });
                                }
                                // Add all tool_use blocks
                                for (const block of assistantContent) {
                                        if (block.type === 'tool_use') {
                                                roundAssistantContent.push(block);
                                        }
                                }

                                // If there were tool calls, add assistant + tool results to conversation
                                if (hasToolCalls && toolResults.length > 0) {
                                        conversationMessages.push({
                                                role: 'assistant',
                                                content: roundAssistantContent.length > 0 ? roundAssistantContent : [{ type: 'text', text: currentText || '(executing tools)' }]
                                        });

                                        // All tool results go in ONE user message (required by Anthropic API)
                                        const toolResultBlocks: IAnthropicContentBlock[] = toolResults.map(tr => ({
                                                type: 'tool_result' as const,
                                                tool_use_id: tr.toolUseId,
                                                content: tr.result,
                                        }));
                                        conversationMessages.push({ role: 'user', content: toolResultBlocks });
                                }

                                // If end_turn or no more tool calls, we're done
                                if (stopReason === 'end_turn' || !hasToolCalls) {
                                        break;
                                }
                        }

                        // Store task summary in memory
                        if (this.constructMemory.isInitialized && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(
                                        `Task completed: ${task}. Summary: ${finalSummary.substring(0, 500)}`,
                                        { type: 'task_summary', task }
                                ).catch(() => { /* non-critical */ });
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
                }
        }

        /**
         * Execute a tool and return the result as a string.
         */
        private async executeTool(name: string, input: unknown, readOnly: boolean): Promise<string> {
                const args = (input as Record<string, string> | null) ?? {};

                try {
                        switch (name) {
                                case 'read_file': {
                                        const path = args.path;
                                        if (!path) { return 'Error: path is required'; }
                                        const content = await this.mcpProcess.readFile(path);
                                        return content;
                                }

                                case 'write_file': {
                                        if (readOnly) { return 'Error: write_file not available during planning phase'; }
                                        const path = args.path;
                                        const content = args.content;
                                        if (!path || content === undefined) { return 'Error: path and content are required'; }
                                        await this.diffApplier.writeFile(path, content);
                                        return `File written successfully: ${path}`;
                                }

                                case 'list_directory': {
                                        const path = args.path ?? '.';
                                        const entries = await this.mcpProcess.listDirectory(path);
                                        return entries.join('\n');
                                }

                                case 'create_directory': {
                                        if (readOnly) { return 'Error: create_directory not available during planning phase'; }
                                        const path = args.path;
                                        if (!path) { return 'Error: path is required'; }
                                        await this.mcpProcess.createDirectory(path);
                                        return `Directory created: ${path}`;
                                }

                                case 'run_command': {
                                        if (readOnly) { return 'Error: run_command not available during planning phase'; }
                                        const command = args.command;
                                        if (!command) { return 'Error: command is required'; }
                                        const cwd = args.cwd;
                                        const result = await this.terminalExecutor.execute(command, cwd, 60000);
                                        let output = '';
                                        if (result.stdout) { output += result.stdout; }
                                        if (result.stderr) { output += (output ? '\n' : '') + result.stderr; }
                                        if (result.exitCode !== 0) {
                                                output += `\nExit code: ${result.exitCode}`;
                                        }
                                        return output || '(no output)';
                                }

                                case 'edit_file': {
                                        if (readOnly) { return 'Error: edit_file not available during planning phase'; }
                                        const path = args.path;
                                        const diff = args.diff;
                                        if (!path || !diff) { return 'Error: path and diff are required'; }
                                        const result = await this.diffApplier.applyDiff(path, diff);
                                        if (result.success) {
                                                return `Diff applied successfully: ${path}`;
                                        }
                                        return `Error: ${result.error}`;
                                }

                                default:
                                        return `Error: Unknown tool "${name}"`;
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

                let prompt = `You are CONSTRUCT, an expert AI coding assistant.

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
                if (this.memoryOrchestrator) {
                        try {
                                const projectId = this.workspaceContextService.getWorkspace().folders[0]?.name ?? 'default';
                                prompt = await this.memoryOrchestrator.injectContextIntoPrompt(prompt, projectId);
                        } catch (error) {
                                this.logService.warn('[AgentLoop] Memory context injection failed, using base prompt:', error instanceof Error ? error.message : String(error));
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

        override dispose(): void {
                super.dispose();
        }
}
