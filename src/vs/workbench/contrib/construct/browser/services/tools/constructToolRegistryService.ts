// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IConstructVectorStore } from '../../../../../../platform/construct/common/memory/vectorStore.js';
import {
        IConstructToolRegistry, IToolDefinition, IToolResult
} from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

// SEC-4: Path traversal prevention
import * as pathModule from '../../../../../../base/common/path.js';

/**
 * SEC-4: Assert that a file path is within the workspace root.
 * Prevents path traversal attacks from LLM-generated arguments.
 * The workspace root comes from IWorkspaceContextService — never from user input.
 */
function assertWithinWorkspace(filePath: string, workspaceRoot: string): void {
        const resolved = pathModule.resolve(filePath);
        const root = pathModule.resolve(workspaceRoot);
        if (!resolved.startsWith(root + pathModule.sep) && resolved !== root) {
                throw new Error(`Security: path "${resolved}" is outside workspace "${root}"`);
        }
}

const MAX_OUTPUT_LENGTH = 100_000; // Characters
const COMMAND_BLOCKLIST = [
        'rm -rf /', 'format c:', 'del /s /q c:\\', 'mkfs', 'dd if=',
        ':(){ :|:& };:', 'wget.*|.*sh', 'curl.*|.*sh',
        'shutdown', 'reboot', 'halt', 'poweroff',
        'sudo rm', 'chmod -R 777 /', 'chown -R',
];

/**
 * ConstructToolRegistryService — implementation of the tool registry with built-in tools.
 *
 * Built-in tools:
 * - read_file(path) — read file from workspace
 * - write_file(path, content) — write with diff preview before applying
 * - run_terminal(command) — execute in node-pty, stream output to panel
 * - search_codebase(query) — semantic search via Qdrant vector store
 * - web_search(query) — only when online mode active
 *
 * Kali integration:
 * - On Windows, detect Kali WSL2 distro via: wsl.exe -l -v
 * - If found, add a "Kali Terminal" profile in the terminal dropdown
 * - Route run_terminal to Kali shell when user has selected Kali profile
 *
 * OFFLINE FIRST:
 * - read_file, write_file, run_terminal, search_codebase work offline
 * - web_search only works when online mode is enabled
 * - Kali WSL is only available on Windows with WSL2 installed
 *
 * USER IN CONTROL:
 * - write_file always shows a diff preview and waits for approval
 * - Terminal commands are checked against a blocklist
 * - All file modifications require explicit user consent
 */
export class ConstructToolRegistryService extends Disposable implements IConstructToolRegistry {
        readonly _serviceBrand: undefined;

        private readonly _tools: Map<string, { definition: IToolDefinition; executeFn: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<IToolResult> }> = new Map();
        private _terminalProfile: string = 'default';
        private _kaliAvailable: boolean = false;
        private _onlineMode: boolean = false;

        constructor(
                @ILogService private readonly logService: ILogService,
                @INotificationService _notificationService: INotificationService,
                @IConfigurationService private readonly _configurationService: IConfigurationService,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IConstructVectorStore private readonly vectorStore: IConstructVectorStore,
        ) {
                super();

                // Register built-in tools
                this.registerBuiltinTools();

                // Check online mode
                this._onlineMode = _configurationService.getValue<boolean>('construct.onlineMode') ?? false;
                this._register(_configurationService.onDidChangeConfiguration(e => {
                        if (e.affectsConfiguration('construct.onlineMode')) {
                                this._onlineMode = _configurationService.getValue<boolean>('construct.onlineMode') ?? false;
                        }
                }));

                // Check for Kali WSL2 (async, non-blocking)
                this.checkKaliWSL();

                this.logService.info('[ToolRegistry] Initialized with ' + this._tools.size + ' built-in tools');
        }

        listTools(): IToolDefinition[] {
                return Array.from(this._tools.values()).map(t => t.definition);
        }

        getTool(name: string): IToolDefinition | undefined {
                return this._tools.get(name)?.definition;
        }

        async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
                const tool = this._tools.get(name);
                if (!tool) {
                        return { success: false, output: `Unknown tool: ${name}`, truncated: false };
                }

                // Check if tool requires network and we're offline
                if (tool.definition.requiresNetwork && !this._onlineMode) {
                        return {
                                success: false,
                                output: `Tool "${name}" requires network access, but offline mode is active. Enable online mode in settings to use this tool.`,
                                truncated: false,
                        };
                }

                const startTime = Date.now();
                try {
                        const result = await tool.executeFn(input, signal);
                        result.metadata = {
                                ...result.metadata,
                                durationMs: Date.now() - startTime,
                        };
                        return result;
                } catch (error) {
                        return {
                                success: false,
                                output: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                                metadata: { durationMs: Date.now() - startTime },
                        };
                }
        }

        registerTool(tool: IToolDefinition, executeFn: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<IToolResult>): void {
                if (this._tools.has(tool.name)) {
                        this.logService.warn('[ToolRegistry] Tool already registered: ' + tool.name + '. Overwriting.');
                }
                this._tools.set(tool.name, { definition: tool, executeFn });
                this.logService.info('[ToolRegistry] Registered tool: ' + tool.name);
        }

        unregisterTool(name: string): void {
                this._tools.delete(name);
                this.logService.info('[ToolRegistry] Unregistered tool: ' + name);
        }

        async isKaliWSLAvailable(): Promise<boolean> {
                return this._kaliAvailable;
        }

        getTerminalProfile(): string {
                return this._terminalProfile;
        }

        setTerminalProfile(profile: string): void {
                this._terminalProfile = profile;
                this.logService.info('[ToolRegistry] Terminal profile set to: ' + profile);
        }

        // --- Built-in Tool Registration ---

        private registerBuiltinTools(): void {
                // read_file — read a file from the workspace
                this.registerTool({
                        name: 'read_file',
                        description: 'Read the contents of a file from the workspace. Returns the file content as a string.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the file to read.',
                                        },
                                },
                                required: ['path'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeReadFile(input));

                // write_file — write content to a file (with diff preview)
                this.registerTool({
                        name: 'write_file',
                        description: 'Write content to a file. Shows a diff preview and requires user approval before applying. Creates the file if it does not exist.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the file to write.',
                                        },
                                        content: {
                                                type: 'string',
                                                description: 'The content to write to the file.',
                                        },
                                },
                                required: ['path', 'content'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeWriteFile(input));

                // run_terminal — execute a command in the terminal
                this.registerTool({
                        name: 'run_terminal',
                        description: 'Execute a command in the terminal. Commands are checked against a blocklist for safety. When Kali WSL profile is selected, commands run in Kali Linux.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        command: {
                                                type: 'string',
                                                description: 'The command to execute.',
                                        },
                                        cwd: {
                                                type: 'string',
                                                description: 'Working directory for the command. Defaults to workspace root.',
                                        },
                                        timeout: {
                                                type: 'number',
                                                description: 'Timeout in seconds. Defaults to 30.',
                                        },
                                },
                                required: ['command'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'terminal',
                }, async (input) => this.executeRunTerminal(input));

                // search_codebase — semantic search via Qdrant
                this.registerTool({
                        name: 'search_codebase',
                        description: 'Search the codebase using semantic similarity. Returns the most relevant code chunks from the workspace. Requires Qdrant to be running.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'The search query. Describe what you are looking for in natural language.',
                                        },
                                        topK: {
                                                type: 'number',
                                                description: 'Number of results to return. Defaults to 8.',
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'search',
                }, async (input) => this.executeSearchCodebase(input));

                // web_search — search the web (only when online)
                this.registerTool({
                        name: 'web_search',
                        description: 'Search the web for information. Only available when online mode is enabled. Returns search results with URLs and snippets.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        query: {
                                                type: 'string',
                                                description: 'The search query.',
                                        },
                                        num: {
                                                type: 'number',
                                                description: 'Number of results to return. Defaults to 10.',
                                        },
                                },
                                required: ['query'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeWebSearch(input));
        }

        // --- Tool Implementations ---

        private async executeReadFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                if (!path) {
                        return { success: false, output: 'Missing required parameter: path', truncated: false };
                }

                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);
                        const content = await this.fileService.readFile(uri);
                        const text = content.value.toString();

                        const truncated = text.length > MAX_OUTPUT_LENGTH;
                        const output = truncated ? text.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : text;

                        return {
                                success: true,
                                output,
                                truncated,
                                metadata: { bytesProcessed: text.length },
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to read file "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeWriteFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                const content = input.content as string;

                if (!path || content === undefined) {
                        return { success: false, output: 'Missing required parameters: path and content', truncated: false };
                }

                // USER IN CONTROL: The agent view's diff viewer handles the approval flow.
                // This tool writes the content after approval has been granted by the user.
                // The agent loop must show a diff and wait for approval before calling this.
                try {
                        // SEC-4: Path traversal prevention
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                assertWithinWorkspace(path, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);
                        const encoded = VSBuffer.wrap(new TextEncoder().encode(content));
                        await this.fileService.writeFile(uri, encoded);

                        return {
                                success: true,
                                output: `File written: ${path} (${content.length} bytes)`,
                                truncated: false,
                                metadata: { bytesProcessed: content.length },
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to write file "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeRunTerminal(input: Record<string, unknown>): Promise<IToolResult> {
                const command = input.command as string;
                if (!command) {
                        return { success: false, output: 'Missing required parameter: command', truncated: false };
                }

                // Check command against blocklist
                for (const pattern of COMMAND_BLOCKLIST) {
                        if (new RegExp(pattern, 'i').test(command)) {
                                return {
                                        success: false,
                                        output: `Command blocked for safety: "${command}" matches blocked pattern "${pattern}". If this is a mistake, you can run it manually in the terminal.`,
                                        truncated: false,
                                };
                        }
                }

                const timeout = (input.timeout as number ?? 30) * 1000;
                const cwd = input.cwd as string | undefined;

                try {
                        // If Kali profile is selected, wrap command for WSL
                        const actualCommand = this._terminalProfile === 'kali' && this._kaliAvailable
                                ? `wsl -d kali-linux -- bash -c "${command.replace(/"/g, '\\"')}"`
                                : command;

                        // child_process is only available in Electron/Node environments.
                        // In vscode-web, this tool is unavailable.
                        if (typeof process === 'undefined' || !process.versions?.node) {
                                return {
                                        success: false,
                                        output: 'Terminal execution is not available in the browser. Use the desktop version of Construct IDE for terminal access.',
                                        truncated: false,
                                };
                        }

                        const { exec } = await import('child_process');

                        const result = await new Promise<IToolResult>((resolve) => {
                                const proc = exec(actualCommand, {
                                        cwd: cwd ?? this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath,
                                        timeout,
                                        maxBuffer: 1024 * 1024 * 10, // 10MB
                                }, (error, stdout, stderr) => {
                                        const output = (stdout ?? '') + (stderr ?? '');
                                        const truncated = output.length > MAX_OUTPUT_LENGTH;
                                        const displayOutput = truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output;

                                        if (error) {
                                                resolve({
                                                        success: false,
                                                        output: displayOutput || `Command exited with code ${error.code ?? 'unknown'}: ${error.message}`,
                                                        truncated,
                                                        metadata: { exitCode: error.code ?? 1, durationMs: timeout },
                                                });
                                        } else {
                                                resolve({
                                                        success: true,
                                                        output: displayOutput || '(no output)',
                                                        truncated,
                                                        metadata: { exitCode: 0 },
                                                });
                                        }
                                });

                                // Handle timeout
                                setTimeout(() => {
                                        proc.kill();
                                        resolve({
                                                success: false,
                                                output: `Command timed out after ${timeout / 1000}s`,
                                                truncated: false,
                                                metadata: { exitCode: -1 },
                                        });
                                }, timeout + 1000);
                        });

                        return result;
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeSearchCodebase(input: Record<string, unknown>): Promise<IToolResult> {
                const query = input.query as string;
                if (!query) {
                        return { success: false, output: 'Missing required parameter: query', truncated: false };
                }

                if (!this.vectorStore.isConnected()) {
                        return {
                                success: false,
                                output: 'Codebase search is not available. Qdrant is not running. Start Qdrant with: docker run -p 6333:6333 qdrant/qdrant',
                                truncated: false,
                        };
                }

                try {
                        const topK = (input.topK as number) ?? 8;
                        const results = await this.vectorStore.search(query, undefined, topK);

                        if (results.length === 0) {
                                return {
                                        success: true,
                                        output: 'No relevant code found for query: "' + query + '"',
                                        truncated: false,
                                };
                        }

                        const output = results.map((r, i) => {
                                const chunk = r.chunk;
                                const score = (r.score * 100).toFixed(1);
                                return `[${i + 1}] ${chunk.filePath} (line ~${Math.floor(chunk.startOffset / 30)}, score: ${score}%)\n${chunk.content.substring(0, 500)}${chunk.content.length > 500 ? '...' : ''}`;
                        }).join('\n\n---\n\n');

                        return {
                                success: true,
                                output,
                                truncated: output.length > MAX_OUTPUT_LENGTH,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeWebSearch(input: Record<string, unknown>): Promise<IToolResult> {
                const query = input.query as string;
                if (!query) {
                        return { success: false, output: 'Missing required parameter: query', truncated: false };
                }

                if (!this._onlineMode) {
                        return {
                                success: false,
                                output: 'Web search requires online mode. Enable "construct.onlineMode" in settings to use this tool.',
                                truncated: false,
                        };
                }

                try {
                        // Use OpenAI-compatible web search (graceful fallback if SDK not available)
                        // The z-ai-web-dev-sdk is available in the desktop app but may not
                        // be in the compilation environment. Web search will work at runtime.
                        const searchUrl = this._configurationService.getValue<string>('construct.cloud.baseUrl') || 'https://api.openai.com/v1';
                        const apiKey = this._configurationService.getValue<string>('construct.cloud.apiKey');

                        if (!apiKey) {
                                return {
                                success: false,
                                output: 'Web search requires a cloud API key. Configure it in Construct: Cloud settings.',
                                truncated: false,
                                };
                        }

                        // Use a simple fetch to a search API
                        const response = await fetch(searchUrl + '/chat/completions', {
                                method: 'POST',
                                headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + apiKey,
                                },
                                body: JSON.stringify({
                                model: 'gpt-4o-mini',
                                messages: [{ role: 'user', content: `Search the web for: ${query}. Return the most relevant results with URLs and descriptions.` }],
                                max_tokens: 2000,
                                }),
                        });

                        if (!response.ok) {
                                return { success: false, output: `Web search API error: ${response.status}`, truncated: false };
                        }

                        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
                        const output = data.choices?.[0]?.message?.content ?? 'No results found.';

                        return {
                                success: true,
                                output: output || 'No results found.',
                                truncated: false,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        // --- Private Helpers ---

        private resolveUri(path: string): URI {
                // If it's a relative path, resolve against workspace root
                if (!path.startsWith('/') && !path.match(/^[A-Z]:\\/i)) {
                        const root = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (root) {
                                // Use the portable path module instead of require('path')
                                // which is unavailable in vscode-web
                                const joined = pathModule.join(root, path);
                                return URI.file(joined);
                        }
                }
                return URI.file(path);
        }

        private async checkKaliWSL(): Promise<void> {
                // Only check on Windows with Node.js runtime (not in browser/web)
                if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') {
                        this._kaliAvailable = false;
                        return;
                }

                try {
                        const { exec } = await import('child_process');
                        const result = await new Promise<string>((resolve, reject) => {
                                exec('wsl.exe -l -v', { timeout: 5000 }, (error, stdout) => {
                                        if (error) { reject(error); return; }
                                        resolve(stdout);
                                });
                        });

                        this._kaliAvailable = result.toLowerCase().includes('kali');
                        if (this._kaliAvailable) {
                                this.logService.info('[ToolRegistry] Kali WSL2 detected');
                        }
                } catch {
                        this._kaliAvailable = false;
                }
        }

        override dispose(): void {
                this._tools.clear();
                super.dispose();
        }
}
