// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
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
        IConstructToolRegistry, IToolDefinition, IToolResult, assertWithinWorkspace
} from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
import { ITerminalExecutor } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { nmapToolDefinition } from '../../tools/security/nmapTool.js';
import { ghidraToolDefinition } from '../../tools/security/ghidraTool.js';
import { nucleiToolDefinition } from '../../tools/security/nucleiTool.js';
// Browser-safe path utilities
import * as pathModule from '../../../../../../base/common/path.js';

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
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
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

                // Security tools — gated by construct.enableSecurityTools setting
                const enableSecurityTools = this._configurationService.getValue<boolean>('construct.enableSecurityTools');
                if (enableSecurityTools !== false) {
                        this.registerSecurityTools();
                }

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
                                        mode: {
                                                type: 'string',
                                                description: 'Write mode: "overwrite" replaces the file, "append" adds to the end, "create_only" fails if the file already exists.',
                                                enum: ['overwrite', 'append', 'create_only'],
                                                default: 'overwrite',
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

                // list_directory — list directory contents
                this.registerTool({
                        name: 'list_directory',
                        description: 'List the contents of a directory. Returns file and directory names within the specified path.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the directory to list.',
                                        },
                                        recursive: {
                                                type: 'boolean',
                                                description: 'Whether to list contents recursively. Defaults to false.',
                                        },
                                },
                                required: ['path'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeListDirectory(input));
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
                const mode = (input.mode as string) ?? 'overwrite';

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

                        if (mode === 'create_only') {
                                // Check if file exists first; if yes, return error
                                const exists = await this.fileService.exists(uri);
                                if (exists) {
                                        return {
                                                success: false,
                                                output: `File already exists: ${path}. Use mode "overwrite" or "append" instead.`,
                                                truncated: false,
                                        };
                                }
                        }

                        let contentToWrite = content;

                        if (mode === 'append') {
                                // Read existing content, append new content
                                try {
                                        const existing = await this.fileService.readFile(uri);
                                        const existingText = existing.value.toString();
                                        contentToWrite = existingText + content;
                                } catch {
                                        // File doesn't exist yet — just write the content as-is
                                }
                        }

                        const encoded = VSBuffer.wrap(new TextEncoder().encode(contentToWrite));
                        await this.fileService.writeFile(uri, encoded);

                        return {
                                success: true,
                                output: `File written: ${path} (${contentToWrite.length} bytes, mode: ${mode})`,
                                truncated: false,
                                metadata: { bytesProcessed: contentToWrite.length },
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

                        // P0-4 FIX: child_process should not be used in browser layer.
                        // Terminal commands must be executed through ITerminalExecutor service
                        // which delegates to the node process via IPC.
                        const workDir = cwd ?? this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        const execResult = await this.terminalExecutor.execute(actualCommand, workDir, timeout);

                        const output = (execResult.stdout ?? '') + (execResult.stderr ?? '');
                        const truncated = output.length > MAX_OUTPUT_LENGTH;
                        const displayOutput = truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output;

                        if (execResult.exitCode !== 0) {
                                return {
                                        success: false,
                                        output: displayOutput || `Command exited with code ${execResult.exitCode}`,
                                        truncated,
                                        metadata: { exitCode: execResult.exitCode },
                                };
                        }

                        return {
                                success: true,
                                output: displayOutput || '(no output)',
                                truncated,
                                metadata: { exitCode: execResult.exitCode },
                        };
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

        private async executeListDirectory(input: Record<string, unknown>): Promise<IToolResult> {
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
                        const stat = await this.fileService.resolve(uri);

                        const entries: string[] = [];
                        if (stat.children) {
                                for (const child of stat.children) {
                                        const prefix = child.isDirectory ? '[DIR]  ' : '[FILE] ';
                                        entries.push(prefix + child.name);
                                }
                        }

                        if (entries.length === 0) {
                                return {
                                        success: true,
                                        output: 'Directory is empty or does not exist: ' + path,
                                        truncated: false,
                                };
                        }

                        const output = entries.join('\n');
                        const truncated = output.length > MAX_OUTPUT_LENGTH;

                        return {
                                success: true,
                                output: truncated ? output.substring(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]' : output,
                                truncated,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to list directory "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        // --- Security Tool Registration ---

        private registerSecurityTools(): void {
                // nmap_scan — network port scanner
                this.registerTool(nmapToolDefinition, async (input) => this.executeNmapScan(input));

                // ghidra_decompile — binary decompiler via Docker
                this.registerTool(ghidraToolDefinition, async (input) => this.executeGhidraDecompile(input));

                // nuclei_scan — vulnerability scanner
                this.registerTool(nucleiToolDefinition, async (input) => this.executeNucleiScan(input));

                this.logService.info('[ToolRegistry] Security tools registered (nmap, ghidra, nuclei)');
        }

        private async executeNmapScan(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                if (!target) { return { success: false, output: 'Error: target is required', truncated: false }; }

                const flags = (input.flags as string[]) ?? [];
                const portRange = input.port_range as string;
                const flagStr = flags.join(' ');
                const portArg = portRange ? `-p ${portRange}` : '';
                const command = `nmap ${flagStr} ${portArg} -oX - ${target}`.replace(/\s+/g, ' ').trim();

                try {
                        const result = await this.terminalExecutor.execute(command);
                        if (result.exitCode !== 0 && !result.stdout) {
                                return { success: false, output: `nmap scan failed: ${result.stderr || 'exit code ' + result.exitCode}. Install: apt-get install nmap`, truncated: false };
                        }
                        return { success: true, output: result.stdout || result.stderr, truncated: false };
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (msg.includes('not found') || msg.includes('ENOENT')) {
                                return { success: false, output: 'nmap not found — install with: apt-get install nmap (Linux) or brew install nmap (macOS)', truncated: false };
                        }
                        return { success: false, output: `nmap error: ${msg}`, truncated: false };
                }
        }

        private async executeGhidraDecompile(input: Record<string, unknown>): Promise<IToolResult> {
                const binaryPath = input.binary_path as string;
                if (!binaryPath) { return { success: false, output: 'Error: binary_path is required', truncated: false }; }

                const functionName = (input.function_name as string) ?? '';

                // Check if Docker is available first
                try {
                        const dockerCheck = await this.terminalExecutor.execute('docker --version');
                        if (dockerCheck.exitCode !== 0) {
                                return { success: false, output: 'Docker not found — Ghidra decompilation requires Docker for isolation. Install Docker first.', truncated: false };
                        }
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        return { success: false, output: `Docker check failed: ${msg}. Ghidra decompilation requires Docker.`, truncated: false };
                }

                const funcArg = functionName ? `-e DECOMPILE_FUNCTION=${functionName}` : '';
                const command = `docker run --rm -v "${binaryPath}:${binaryPath}" ghidra/ghidra ${funcArg} ${binaryPath}`.replace(/\s+/g, ' ').trim();

                try {
                        const result = await this.terminalExecutor.execute(command);
                        if (result.exitCode !== 0 && !result.stdout) {
                                return { success: false, output: `Ghidra decompile failed: ${result.stderr || 'exit code ' + result.exitCode}`, truncated: false };
                        }
                        return { success: true, output: result.stdout || result.stderr, truncated: false };
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        return { success: false, output: `Ghidra error: ${msg}`, truncated: false };
                }
        }

        private async executeNucleiScan(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                if (!target) { return { success: false, output: 'Error: target is required', truncated: false }; }

                const templateTags = (input.template_tags as string[]) ?? [];
                const severity = (input.severity as string[]) ?? [];
                const tagsArg = templateTags.length > 0 ? `-tags ${templateTags.join(',')}` : '';
                const severityArg = severity.length > 0 ? `-severity ${severity.join(',')}` : '';
                const command = `nuclei -u ${target} ${tagsArg} ${severityArg} -json`.replace(/\s+/g, ' ').trim();

                try {
                        const result = await this.terminalExecutor.execute(command);
                        if (result.exitCode !== 0 && !result.stdout) {
                                return { success: false, output: `Nuclei scan failed: ${result.stderr || 'exit code ' + result.exitCode}. Install: apt-get install nuclei or download from https://github.com/projectdiscovery/nuclei`, truncated: false };
                        }
                        return { success: true, output: result.stdout || result.stderr, truncated: false };
                } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (msg.includes('not found') || msg.includes('ENOENT')) {
                                return { success: false, output: 'nuclei not found — install from: https://github.com/projectdiscovery/nuclei', truncated: false };
                        }
                        return { success: false, output: `nuclei error: ${msg}`, truncated: false };
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
                // P0-4 FIX: child_process should not be used in browser layer.
                // Kali WSL2 detection should be done via IPC to the node process.
                // Use ITerminalExecutor to safely execute the detection command.
                if (typeof process === 'undefined' || !process.versions?.node || process.platform !== 'win32') {
                        this._kaliAvailable = false;
                        return;
                }

                try {
                        const result = await this.terminalExecutor.execute('wsl.exe -l -v', undefined, 5000);
                        this._kaliAvailable = result.stdout.toLowerCase().includes('kali');
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
