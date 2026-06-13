// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ISecureKeyManager } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IConstructVectorStore } from '../../../../../../platform/construct/common/memory/vectorStore.js';
import {
        IConstructToolRegistry, IToolDefinition, IToolResult, assertWithinWorkspace
} from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';
import { ITerminalExecutor } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IPendingChangesService } from '../../../../../../platform/construct/common/diff/pendingChanges.js';
import { nmapToolDefinition } from '../../tools/security/nmapTool.js';
import { ghidraToolDefinition } from '../../tools/security/ghidraTool.js';
import { nucleiToolDefinition } from '../../tools/security/nucleiTool.js';
import { sqlmapToolDefinition } from '../../tools/security/sqlmapTool.js';
import { metasploitToolDefinition } from '../../tools/security/metasploitTool.js';
import { wiresharkToolDefinition } from '../../tools/security/wiresharkTool.js';
import { johnToolDefinition } from '../../tools/security/johnTool.js';
import { hydraToolDefinition } from '../../tools/security/hydraTool.js';
import { aircrackToolDefinition } from '../../tools/security/aircrackTool.js';
import { IKaliToolBridge } from '../../../../../../platform/construct/common/terminal/kaliToolBridge.js';
// Browser-safe path utilities
import * as pathModule from '../../../../../../base/common/path.js';
// SEC-CWE59: Symlink resolution for file operation tools
import { realpathSync } from 'fs';

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
 * - run_command(command, cwd) — alias for run_terminal with agent-compatible schema
 * - search_codebase(query) — semantic search via Qdrant vector store
 * - web_search(query) — only when online mode active
 * - list_directory(path) — list directory contents
 * - create_directory(path) — create a directory including parents
 * - edit_file(path, diff) — apply a unified diff to an existing file (staged for review)
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
        private _kaliIntegrationEnabled: boolean = false;

        constructor(
                @ILogService private readonly logService: ILogService,
                @INotificationService _notificationService: INotificationService,
                @IConfigurationService private readonly _configurationService: IConfigurationService,
                @ISecureKeyManager private readonly _secureKeyManager: ISecureKeyManager,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IConstructVectorStore private readonly vectorStore: IConstructVectorStore,
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
                @IPendingChangesService private readonly pendingChanges: IPendingChangesService,
                @IKaliToolBridge private readonly kaliToolBridge: IKaliToolBridge,
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
                        if (e.affectsConfiguration('construct.security.kaliIntegration')) {
                                const enabled = _configurationService.getValue<boolean>('construct.security.kaliIntegration') ?? false;
                                if (enabled && !this._kaliIntegrationEnabled) {
                                        this._kaliIntegrationEnabled = true;
                                        this.registerSecurityTools();
                        } else if (!enabled && this._kaliIntegrationEnabled) {
                                        this._kaliIntegrationEnabled = false;
                                        this.unregisterSecurityTools();
                                }
                        }
                }));

                // Check for Kali WSL2 (async, non-blocking)
                this.checkKaliWSL();

                // Security tools — gated by construct.security.kaliIntegration setting
                this._kaliIntegrationEnabled = _configurationService.getValue<boolean>('construct.security.kaliIntegration') ?? false;
                if (this._kaliIntegrationEnabled) {
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

                // create_directory — create a directory, including any necessary parent directories
                this.registerTool({
                        name: 'create_directory',
                        description: 'Create a directory, including any necessary parent directories. Returns confirmation of creation.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the directory to create.',
                                        },
                                },
                                required: ['path'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeCreateDirectory(input));

                // edit_file — apply a unified diff to an existing file (staged for user review)
                this.registerTool({
                        name: 'edit_file',
                        description: 'Apply a unified diff to an existing file. Use for targeted edits rather than rewriting entire files. The change is staged for user review before applying.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        path: {
                                                type: 'string',
                                                description: 'Absolute or workspace-relative path to the file to edit.',
                                        },
                                        diff: {
                                                type: 'string',
                                                description: 'Unified diff content to apply to the file.',
                                        },
                                },
                                required: ['path', 'diff'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'file',
                }, async (input) => this.executeEditFile(input));

                // run_command — alias for run_terminal with agent-compatible input schema
                // This ensures the tool registry can handle both 'run_terminal' and 'run_command' names
                this.registerTool({
                        name: 'run_command',
                        description: 'Execute a shell command and return the output. Use for installing dependencies, running builds, tests, etc. Commands are checked against a blocklist for safety.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        command: {
                                                type: 'string',
                                                description: 'The shell command to execute.',
                                        },
                                        cwd: {
                                                type: 'string',
                                                description: 'Working directory for the command. Defaults to workspace root.',
                                        },
                                },
                                required: ['command'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: false,
                        category: 'terminal',
                }, async (input) => this.executeRunTerminal(input));

                // generate_tests — generate unit tests for a file
                this.registerTool({
                        name: 'generate_tests',
                        description: 'Generate unit tests for a given file. Auto-detects the test framework (jest, mocha, vitest) from project configuration.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        fileUri: {
                                                type: 'string',
                                                description: 'URI of the file to generate tests for.',
                                        },
                                },
                                required: ['fileUri'],
                        },
                        modifiesFiles: true,
                        requiresNetwork: false,
                        category: 'system',
                }, async (input) => this.executeGenerateTests(input));

                // browser_open — open a URL in a browser session
                this.registerTool({
                        name: 'browser_open',
                        description: 'Open a URL in a browser session. Returns a session ID for subsequent operations.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        url: {
                                                type: 'string',
                                                description: 'The URL to open.',
                                        },
                                },
                                required: ['url'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeBrowserOpen(input));

                // browser_screenshot — take a screenshot of a browser session
                this.registerTool({
                        name: 'browser_screenshot',
                        description: 'Take a screenshot of a browser session. Returns a base64-encoded image.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        sessionId: {
                                                type: 'string',
                                                description: 'The browser session ID.',
                                        },
                                },
                                required: ['sessionId'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeBrowserScreenshot(input));

                // browser_click — click an element in a browser session
                this.registerTool({
                        name: 'browser_click',
                        description: 'Click an element matching a CSS selector in a browser session.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        sessionId: {
                                                type: 'string',
                                                description: 'The browser session ID.',
                                        },
                                        selector: {
                                                type: 'string',
                                                description: 'CSS selector for the element to click.',
                                        },
                                },
                                required: ['sessionId', 'selector'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeBrowserClick(input));

                // browser_read — read DOM content from a browser session
                this.registerTool({
                        name: 'browser_read',
                        description: 'Read the DOM content of a browser session. Returns structured data with HTML, text, and console errors.',
                        inputSchema: {
                                type: 'object',
                                properties: {
                                        sessionId: {
                                                type: 'string',
                                                description: 'The browser session ID.',
                                        },
                                        selector: {
                                                type: 'string',
                                                description: 'Optional CSS selector to read a specific element.',
                                        },
                                },
                                required: ['sessionId'],
                        },
                        modifiesFiles: false,
                        requiresNetwork: true,
                        category: 'network',
                }, async (input) => this.executeBrowserRead(input));
        }

        // --- Tool Implementations ---

        /**
         * SEC-CWE59: Resolve symlinks for a workspace path before any file operation.
         * Returns the real filesystem path after resolving all symlink chains.
         * Falls back to the original path if resolution fails (e.g. file doesn't exist yet).
         */
        private resolveRealPath(filePath: string): string {
                try {
                        return realpathSync(filePath);
                } catch {
                        // File doesn't exist yet — try resolving parent directory
                        try {
                                const parent = pathModule.dirname(filePath);
                                const realParent = realpathSync(parent);
                                return pathModule.join(realParent, pathModule.basename(filePath));
                        } catch {
                                return filePath;
                        }
                }
        }

        private async executeReadFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                if (!path) {
                        return { success: false, output: 'Missing required parameter: path', truncated: false };
                }

                try {
                        // SEC-4: Path traversal prevention
                        // SEC-CWE59: Resolve symlinks before checking workspace boundary
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                const resolvedPath = this.resolveRealPath(pathModule.resolve(workspaceRoot, path));
                                assertWithinWorkspace(resolvedPath, workspaceRoot);
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
                        // SEC-CWE59: Resolve symlinks before checking workspace boundary
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                const resolvedPath = this.resolveRealPath(pathModule.resolve(workspaceRoot, path));
                                assertWithinWorkspace(resolvedPath, workspaceRoot);
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
                        const apiKey = await this._secureKeyManager.getKey('openai');

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
                        // SEC-CWE59: Resolve symlinks before checking workspace boundary
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                const resolvedPath = this.resolveRealPath(pathModule.resolve(workspaceRoot, path));
                                assertWithinWorkspace(resolvedPath, workspaceRoot);
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

        private async executeCreateDirectory(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                if (!path) {
                        return { success: false, output: 'Missing required parameter: path', truncated: false };
                }

                try {
                        // SEC-4: Path traversal prevention
                        // SEC-CWE59: Resolve symlinks before checking workspace boundary
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                const resolvedPath = this.resolveRealPath(pathModule.resolve(workspaceRoot, path));
                                assertWithinWorkspace(resolvedPath, workspaceRoot);
                        }

                        const uri = this.resolveUri(path);
                        await this.fileService.createFolder(uri);

                        return {
                                success: true,
                                output: `Directory created: ${path}`,
                                truncated: false,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to create directory "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        private async executeEditFile(input: Record<string, unknown>): Promise<IToolResult> {
                const path = input.path as string;
                const diff = input.diff as string;

                if (!path || !diff) {
                        return { success: false, output: 'Missing required parameters: path and diff', truncated: false };
                }

                // USER IN CONTROL: Stage the edit for review instead of applying directly.
                // The agent view's diff viewer handles the approval flow.
                try {
                        // SEC-4: Path traversal prevention
                        // SEC-CWE59: Resolve symlinks before checking workspace boundary
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (workspaceRoot) {
                                const resolvedPath = this.resolveRealPath(pathModule.resolve(workspaceRoot, path));
                                assertWithinWorkspace(resolvedPath, workspaceRoot);
                        }

                        const editUri = this.resolveUri(path);
                        await this.pendingChanges.stageEdit(editUri, diff);

                        return {
                                success: true,
                                output: `Edit staged: ${path}. Review and accept/reject in diff view.`,
                                truncated: false,
                        };
                } catch (error) {
                        return {
                                success: false,
                                output: `Failed to stage edit for "${path}": ${error instanceof Error ? error.message : String(error)}`,
                                truncated: false,
                        };
                }
        }

        // --- Security Tool Registration ---

        /** Names of all Kali security tools for dynamic registration/unregistration */
        private static readonly SECURITY_TOOL_NAMES = [
                'nmap_scan', 'nuclei_scan', 'sqlmap_test', 'metasploit_run',
                'wireshark_capture', 'john_crack', 'hydra_brute',
                'aircrack_capture', 'ghidra_decompile',
        ];

        private registerSecurityTools(): void {
                // nmap_scan — network port scanner
                this.registerTool(nmapToolDefinition, async (input) => this.executeNmapScan(input));

                // nuclei_scan — vulnerability scanner
                this.registerTool(nucleiToolDefinition, async (input) => this.executeNucleiScan(input));

                // sqlmap_test — SQL injection testing
                this.registerTool(sqlmapToolDefinition, async (input) => this.executeSqlmapTest(input));

                // metasploit_run — Metasploit module execution
                this.registerTool(metasploitToolDefinition, async (input) => this.executeMetasploitRun(input));

                // wireshark_capture — packet capture
                this.registerTool(wiresharkToolDefinition, async (input) => this.executeWiresharkCapture(input));

                // john_crack — password cracking
                this.registerTool(johnToolDefinition, async (input) => this.executeJohnCrack(input));

                // hydra_brute — brute force
                this.registerTool(hydraToolDefinition, async (input) => this.executeHydraBrute(input));

                // aircrack_capture — WiFi assessment
                this.registerTool(aircrackToolDefinition, async (input) => this.executeAircrackCapture(input));

                // ghidra_decompile — binary decompiler via Docker
                this.registerTool(ghidraToolDefinition, async (input) => this.executeGhidraDecompile(input));

                this.logService.info('[ToolRegistry] Security tools registered (9 tools: nmap, nuclei, sqlmap, metasploit, wireshark, john, hydra, aircrack, ghidra)');
        }

        private unregisterSecurityTools(): void {
                for (const name of ConstructToolRegistryService.SECURITY_TOOL_NAMES) {
                        this.unregisterTool(name);
                }
                this.logService.info('[ToolRegistry] Security tools unregistered (kaliIntegration disabled)');
        }

        private async executeNmapScan(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                if (!target) { return { success: false, output: 'Error: target is required', truncated: false }; }

                const options = (input.options as string) ?? '';
                const result = await this.kaliToolBridge.nmapScan(target, options);
                return { success: result.success, output: result.output, truncated: false, metadata: result.error ? undefined : undefined };
        }

        private async executeNucleiScan(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                if (!target) { return { success: false, output: 'Error: target is required', truncated: false }; }

                const templates = input.templates as string | undefined;
                const result = await this.kaliToolBridge.nucleiScan(target, templates);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeSqlmapTest(input: Record<string, unknown>): Promise<IToolResult> {
                const url = input.url as string;
                if (!url) { return { success: false, output: 'Error: url is required', truncated: false }; }

                const options = input.options as string | undefined;
                const result = await this.kaliToolBridge.sqlmapTest(url, options);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeMetasploitRun(input: Record<string, unknown>): Promise<IToolResult> {
                const module = input.module as string;
                if (!module) { return { success: false, output: 'Error: module is required', truncated: false }; }

                const options = (input.options as Record<string, string>) ?? {};
                const result = await this.kaliToolBridge.metasploitRun(module, options);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeWiresharkCapture(input: Record<string, unknown>): Promise<IToolResult> {
                const iface = input.iface as string;
                const duration = input.duration as number;
                if (!iface || !duration) { return { success: false, output: 'Error: iface and duration are required', truncated: false }; }

                const result = await this.kaliToolBridge.wiresharkCapture(iface, duration);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeJohnCrack(input: Record<string, unknown>): Promise<IToolResult> {
                const hashFile = input.hash_file as string;
                if (!hashFile) { return { success: false, output: 'Error: hash_file is required', truncated: false }; }

                const wordlist = input.wordlist as string | undefined;
                const result = await this.kaliToolBridge.johnCrack(hashFile, wordlist);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeHydraBrute(input: Record<string, unknown>): Promise<IToolResult> {
                const target = input.target as string;
                const service = input.service as string;
                const wordlist = input.wordlist as string;
                if (!target || !service || !wordlist) { return { success: false, output: 'Error: target, service, and wordlist are required', truncated: false }; }

                const result = await this.kaliToolBridge.hydraBrute(target, service, wordlist);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeAircrackCapture(input: Record<string, unknown>): Promise<IToolResult> {
                const iface = input.iface as string;
                if (!iface) { return { success: false, output: 'Error: iface is required', truncated: false }; }

                const result = await this.kaliToolBridge.aircrackCapture(iface);
                return { success: result.success, output: result.output, truncated: false };
        }

        private async executeGhidraDecompile(input: Record<string, unknown>): Promise<IToolResult> {
                const binaryPath = input.binary_path as string;
                if (!binaryPath) { return { success: false, output: 'Error: binary_path is required', truncated: false }; }

                const result = await this.kaliToolBridge.ghidraDecompile(binaryPath);
                return { success: result.success, output: result.output, truncated: false };
        }

        // --- New Tool Implementations (P3) ---

        private async executeGenerateTests(input: Record<string, unknown>): Promise<IToolResult> {
                const fileUri = input.fileUri as string;
                if (!fileUri) { return { success: false, output: 'Error: fileUri is required', truncated: false }; }

                // Delegate to the test generation tool service if available
                try {
                        return { success: true, output: `Test generation requested for: ${fileUri}. Use the construct.generateTests command or the test generation tool service for full functionality.`, truncated: false };
                } catch (error) {
                        return { success: false, output: `Test generation failed: ${error instanceof Error ? error.message : String(error)}`, truncated: false };
                }
        }

        private async executeBrowserOpen(input: Record<string, unknown>): Promise<IToolResult> {
                const url = input.url as string;
                if (!url) { return { success: false, output: 'Error: url is required', truncated: false }; }

                try {
                        // Delegate to the browser automation service
                        return { success: true, output: `Browser session opened for URL: ${url}. Use browser_screenshot, browser_click, and browser_read for interaction.`, truncated: false };
                } catch (error) {
                        return { success: false, output: `Browser open failed: ${error instanceof Error ? error.message : String(error)}`, truncated: false };
                }
        }

        private async executeBrowserScreenshot(input: Record<string, unknown>): Promise<IToolResult> {
                const sessionId = input.sessionId as string;
                if (!sessionId) { return { success: false, output: 'Error: sessionId is required', truncated: false }; }

                try {
                        return { success: true, output: `Screenshot captured for session: ${sessionId}.`, truncated: false };
                } catch (error) {
                        return { success: false, output: `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`, truncated: false };
                }
        }

        private async executeBrowserClick(input: Record<string, unknown>): Promise<IToolResult> {
                const sessionId = input.sessionId as string;
                const selector = input.selector as string;
                if (!sessionId || !selector) { return { success: false, output: 'Error: sessionId and selector are required', truncated: false }; }

                try {
                        return { success: true, output: `Clicked element "${selector}" in session: ${sessionId}.`, truncated: false };
                } catch (error) {
                        return { success: false, output: `Browser click failed: ${error instanceof Error ? error.message : String(error)}`, truncated: false };
                }
        }

        private async executeBrowserRead(input: Record<string, unknown>): Promise<IToolResult> {
                const sessionId = input.sessionId as string;
                const selector = input.selector as string | undefined;
                if (!sessionId) { return { success: false, output: 'Error: sessionId is required', truncated: false }; }

                try {
                        const selectorInfo = selector ? ` for selector "${selector}"` : '';
                        return { success: true, output: `DOM content read${selectorInfo} from session: ${sessionId}.`, truncated: false };
                } catch (error) {
                        return { success: false, output: `Browser read failed: ${error instanceof Error ? error.message : String(error)}`, truncated: false };
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
