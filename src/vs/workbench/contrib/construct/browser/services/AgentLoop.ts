/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Agent Loop Service
 *  MVP: Single coder agent with tool execution loop
 *
 *  - Input: user goal (string), available tools (from MCP), abort signal
 *  - Loop (max 10 rounds):
 *    1. Build messages array: system prompt + user goal + previous tool results
 *    2. Call AnthropicProvider.sendMessageStream()
 *    3. Parse streaming response: text tokens → yield to UI, tool use → collect
 *    4. If no tool calls → done, yield final text
 *    5. If tool calls → execute each via MCPProcess/TerminalExecutor/DiffApplier
 *    6. Append tool results to messages, loop
 *  - System prompt with step-by-step instructions
 *  - Yield events: token, tool_start, tool_done, done, error
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAnthropicProviderService, AnthropicMessage, AnthropicContentBlock, AnthropicToolDef } from '../../../../../platform/construct/common/anthropicProvider.js';
import { IMCPProcessService } from '../../../../../platform/construct/common/mcpProcess.js';
import { ITerminalExecutorService } from '../../../../../platform/construct/common/terminalExecutor.js';
import { IDiffApplierService } from '../../../../../platform/construct/common/diffApplier.js';
import { IProjectMemoryService, MemoryType } from '../../../../../platform/construct/common/projectMemory.js';

import {
        IAgentLoopService,
        AgentLoopState,
        AgentLoopResult,
        AgentMessage,
        ToolCallInfo,
        ToolCallEvent,
        ToolResultEvent,
} from '../../../../../platform/construct/common/agentLoop.js';

// ── Constants ─────────────────────────────────────────────────

const MAX_LOOP_ITERATIONS = 10;
const SYSTEM_PROMPT = `You are an expert software engineer called Construct. You can read files, write files, edit files, list directories, and run terminal commands. Always think step by step.

When editing files, provide the complete old content and new content so the diff can be applied precisely.

Available tools:
- read_file: Read a file's contents (params: { path: string })
- write_file: Write content to a file, creating it if needed (params: { path: string, content: string })
- edit_file: Replace specific content in a file (params: { path: string, old_content: string, new_content: string })
- list_directory: List files in a directory (params: { path: string })
- run_command: Execute a terminal command (params: { command: string, cwd?: string })

Rules:
1. Always read a file before editing it
2. Provide precise old_content/new_content for edits — no approximate matches
3. Run terminal commands one at a time and check the output
4. If a command fails, analyze the error before retrying
5. After making changes, verify they work by reading the file or running tests
6. Never run destructive commands (rm -rf /, sudo, etc.)
7. When creating new files, provide the complete file content`;

// ── Tool Definitions ──────────────────────────────────────────

const CONSTRUCT_TOOLS: AnthropicToolDef[] = [
        {
                name: 'read_file',
                description: 'Read the contents of a file at the given path. Returns the full file content as a string.',
                input_schema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file to read' },
                        },
                        required: ['path'],
                },
        },
        {
                name: 'write_file',
                description: 'Write content to a file, creating it if it does not exist. Overwrites any existing content.',
                input_schema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file to write' },
                                content: { type: 'string' as const, description: 'Content to write to the file' },
                        },
                        required: ['path', 'content'],
                },
        },
        {
                name: 'edit_file',
                description: 'Replace specific content in a file. Provide the exact old content to find and the new content to replace it with.',
                input_schema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the file to edit' },
                                old_content: { type: 'string' as const, description: 'Exact content to find and replace' },
                                new_content: { type: 'string' as const, description: 'Content to replace the old content with' },
                        },
                        required: ['path', 'old_content', 'new_content'],
                },
        },
        {
                name: 'list_directory',
                description: 'List files and directories at the given path. Returns names and types.',
                input_schema: {
                        type: 'object' as const,
                        properties: {
                                path: { type: 'string' as const, description: 'Path to the directory to list' },
                        },
                        required: ['path'],
                },
        },
        {
                name: 'run_command',
                description: 'Execute a terminal command and return the output. Commands run in bash with a 60-second timeout.',
                input_schema: {
                        type: 'object' as const,
                        properties: {
                                command: { type: 'string' as const, description: 'The command to execute' },
                                cwd: { type: 'string' as const, description: 'Working directory for the command (optional)' },
                        },
                        required: ['command'],
                },
        },
];

// ══════════════════════════════════════════════════════════════
// AgentLoopService
// ══════════════════════════════════════════════════════════════

export class AgentLoopService extends Disposable implements IAgentLoopService {
        declare readonly _serviceBrand: undefined;

        private _state: AgentLoopState = 'idle';
        private _conversationHistory: AnthropicMessage[] = [];
        private _agentMessages: AgentMessage[] = [];
        private _abortController: AbortController | null = null;
        private _workingDirectory: string = '';

        private readonly _onStateChange = this._register(new Emitter<AgentLoopState>());
        readonly onStateChange = this._onStateChange.event;

        private readonly _onMessage = this._register(new Emitter<AgentMessage>());
        readonly onMessage = this._onMessage.event;

        private readonly _onToolCall = this._register(new Emitter<ToolCallEvent>());
        readonly onToolCall = this._onToolCall.event;

        private readonly _onToolResult = this._register(new Emitter<ToolResultEvent>());
        readonly onToolResult = this._onToolResult.event;

        constructor(
                @IAnthropicProviderService private readonly anthropicProvider: IAnthropicProviderService,
                @IMCPProcessService private readonly mcpProcess: IMCPProcessService,
                @ITerminalExecutorService private readonly terminalExecutor: ITerminalExecutorService,
                @IDiffApplierService private readonly diffApplier: IDiffApplierService,
                @IProjectMemoryService private readonly projectMemory: IProjectMemoryService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[AgentLoop] Initialized');
        }

        async processMessage(message: string): Promise<AgentLoopResult> {
                if (this._state !== 'idle') {
                        return {
                                response: '',
                                toolCallsMade: 0,
                                tokensUsed: 0,
                                stoppedEarly: false,
                                error: 'Agent is already processing a message',
                        };
                }

                this._abortController = new AbortController();
                this._setState('thinking');
                let totalToolCalls = 0;
                let totalTokens = 0;

                try {
                        // Add user message to conversation
                        const userMsg: AnthropicMessage = { role: 'user', content: message };
                        this._conversationHistory.push(userMsg);
                        this._addAgentMessage('user', message);

                        // Store in project memory
                        this.projectMemory.store(MemoryType.ExecutionHistory, 'conversation', message);

                        // Main agent loop
                        for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
                                if (this._abortController.signal.aborted) {
                                        this._setState('cancelled');
                                        return {
                                                response: 'Cancelled by user',
                                                toolCallsMade: totalToolCalls,
                                                tokensUsed: totalTokens,
                                                stoppedEarly: true,
                                                error: 'Cancelled',
                                        };
                                }

                                this._setState('thinking');

                                // Call Anthropic API with streaming
                                let fullText = '';
                                const toolCalls: { id: string; name: string; input: any }[] = [];

                                try {
                                        const stream = this.anthropicProvider.sendMessageStream(
                                                this._conversationHistory,
                                                {
                                                        systemPrompt: SYSTEM_PROMPT,
                                                        tools: CONSTRUCT_TOOLS,
                                                        abortSignal: this._abortController.signal,
                                                },
                                        );

                                        for await (const chunk of stream) {
                                                if (chunk.type === 'text' && chunk.text) {
                                                        fullText += chunk.text;
                                                        // Emit partial message for real-time UI updates
                                                } else if (chunk.type === 'tool_use' && chunk.toolUse) {
                                                        toolCalls.push(chunk.toolUse);
                                                } else if (chunk.type === 'error') {
                                                        this._setState('error');
                                                        return {
                                                                response: fullText,
                                                                toolCallsMade: totalToolCalls,
                                                                tokensUsed: totalTokens,
                                                                stoppedEarly: true,
                                                                error: chunk.error,
                                                        };
                                                }
                                        }
                                } catch (error) {
                                        this._setState('error');
                                        const errorMsg = (error as Error).message;
                                        this._addAgentMessage('assistant', `Error: ${errorMsg}`);
                                        return {
                                                response: fullText,
                                                toolCallsMade: totalToolCalls,
                                                tokensUsed: totalTokens,
                                                stoppedEarly: true,
                                                error: errorMsg,
                                        };
                                }

                                // If no tool calls, agent is done
                                if (toolCalls.length === 0) {
                                        this._addAgentMessage('assistant', fullText);
                                        this.projectMemory.store(MemoryType.ExecutionHistory, 'conversation', fullText);

                                        this._setState('idle');
                                        return {
                                                response: fullText,
                                                toolCallsMade: totalToolCalls,
                                                tokensUsed: totalTokens,
                                                stoppedEarly: false,
                                        };
                                }

                                // Process tool calls
                                this._setState('executing_tool');
                                totalToolCalls += toolCalls.length;

                                // Build assistant message with tool_use blocks
                                const assistantContent: AnthropicContentBlock[] = [];
                                if (fullText) {
                                        assistantContent.push({ type: 'text', text: fullText });
                                }
                                for (const tc of toolCalls) {
                                        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
                                }
                                this._conversationHistory.push({ role: 'assistant', content: assistantContent });

                                // Execute each tool call and collect results
                                const toolResults: AnthropicContentBlock[] = [];
                                for (const tc of toolCalls) {
                                        if (this._abortController.signal.aborted) {
                                                this._setState('cancelled');
                                                break;
                                        }

                                        this._onToolCall.fire({ id: tc.id, name: tc.name, input: tc.input });
                                        const startTime = Date.now();

                                        const result = await this._executeTool(tc.name, tc.input);
                                        const durationMs = Date.now() - startTime;

                                        this._onToolResult.fire({
                                                id: tc.id,
                                                name: tc.name,
                                                success: result.success,
                                                output: result.output,
                                                durationMs,
                                        });

                                        toolResults.push({
                                                type: 'tool_result',
                                                tool_use_id: tc.id,
                                                content: result.output,
                                        });
                                }

                                // Add tool results to conversation
                                this._conversationHistory.push({ role: 'user', content: toolResults });
                        }

                        // Max iterations reached
                        this._setState('idle');
                        return {
                                response: 'Maximum iteration limit reached. The task may not be fully complete.',
                                toolCallsMade: totalToolCalls,
                                tokensUsed: totalTokens,
                                stoppedEarly: true,
                                error: 'Max iterations reached',
                        };

                } finally {
                        this._abortController = null;
                        if (this._state !== 'idle') {
                                this._setState('idle');
                        }
                }
        }

        cancel(): void {
                if (this._abortController && !this._abortController.signal.aborted) {
                        this._abortController.abort();
                        this._setState('cancelled');
                        this.logService.info('[AgentLoop] Cancelled by user');
                }
        }

        getState(): AgentLoopState {
                return this._state;
        }

        getConversationHistory(): AgentMessage[] {
                return [...this._agentMessages];
        }

        setWorkingDirectory(dir: string): void {
                this._workingDirectory = dir;
        }

        // ── Tool Execution ────────────────────────────────────────

        private async _executeTool(name: string, input: any): Promise<{ success: boolean; output: string }> {
                try {
                        switch (name) {
                                case 'read_file': {
                                        const content = await this.diffApplier.readFile(input.path);
                                        return { success: true, output: content };
                                }
                                case 'write_file': {
                                        const result = await this.diffApplier.writeFile(input.path, input.content);
                                        return { success: result.success, output: result.success ? `File written: ${input.path}` : `Failed: ${result.error}` };
                                }
                                case 'edit_file': {
                                        const result = await this.diffApplier.applyDiff(input.path, input.old_content, input.new_content);
                                        return { success: result.success, output: result.success ? `File edited: ${input.path} (+${result.linesAdded}/-${result.linesRemoved})` : `Failed: ${result.error}` };
                                }
                                case 'list_directory': {
                                        const result = await this.terminalExecutor.execute(`ls -la "${input.path}"`, this._workingDirectory, 10000);
                                        return { success: result.success, output: result.stdout || result.stderr };
                                }
                                case 'run_command': {
                                        const result = await this.terminalExecutor.execute(input.command, input.cwd ?? this._workingDirectory);
                                        const output = result.stdout + (result.stderr ? '\n' + result.stderr : '');
                                        return { success: result.success, output: result.timedOut ? `Command timed out after ${result.duration}ms\n${output}` : output };
                                }
                                default: {
                                        // Try MCP tools
                                        const mcpTools = this.mcpProcess.getAllTools();
                                        const mcpTool = mcpTools.find(t => t.name === name);
                                        if (mcpTool) {
                                                const result = await this.mcpProcess.callTool(mcpTool.serverId, name, input);
                                                return { success: result.success, output: result.content };
                                        }
                                        return { success: false, output: `Unknown tool: ${name}` };
                                }
                        }
                } catch (error) {
                        return { success: false, output: `Tool execution error: ${(error as Error).message}` };
                }
        }

        // ── Private Helpers ───────────────────────────────────────

        private _setState(state: AgentLoopState): void {
                if (this._state !== state) {
                        this._state = state;
                        this._onStateChange.fire(state);
                }
        }

        private _addAgentMessage(role: 'user' | 'assistant', content: string, toolCalls?: ToolCallInfo[]): void {
                const msg: AgentMessage = { role, content, timestamp: Date.now(), toolCalls };
                this._agentMessages.push(msg);
                this._onMessage.fire(msg);
        }
}
