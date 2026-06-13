// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { spawn, ChildProcess } from 'child_process';
import { ILogService } from '../../log/common/log.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IMCPProcessNodeService } from '../common/mcp/mcpProcessNode.js';
import { assertWithinWorkspace, validateToolName, validateMcpMethod } from '../common/security/workspaceGuard.js';

/**
 * JSON-RPC 2.0 request structure for MCP protocol.
 */
interface IJsonRpcRequest {
        jsonrpc: '2.0';
        id: number;
        method: string;
        params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response structure for MCP protocol.
 */
interface IJsonRpcResponse {
        jsonrpc: '2.0';
        id: number;
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
}

/**
 * Node-layer service that spawns a real MCP filesystem server and communicates
 * over stdio using JSON-RPC 2.0. This is the spec-compliant MCP implementation.
 *
 * Features:
 * - Spawns `npx -y @modelcontextprotocol/server-filesystem <rootPath>`
 * - JSON-RPC 2.0 initialization handshake
 * - Line-delimited JSON parsing from stdout
 * - 30-second timeout per request
 * - Auto-restart on crash (max 5 times, 3s backoff)
 *
 * This service runs in the CONSTRUCT IDE main process and is exposed to the
 * renderer process via IPC. The browser-layer MCPProcessService delegates
 * to this service when available, falling back to IFileService in browser mode.
 */
export class MCPProcessNodeService extends Disposable implements IMCPProcessNodeService {
        declare readonly _serviceBrand: undefined;

        private process: ChildProcess | null = null;
        private requestId = 0;
        private readonly pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
        private buffer = '';
        private initialized = false;
        private crashCount = 0;
        private readonly maxCrashes = 5;
        private readonly crashBackoffMs = 3000;
        private rootPath: string = '';
        private readonly timeoutMs = 30000;

        constructor(
                private readonly logService: ILogService,
        ) {
                super();
        }

        /**
         * Spawn the MCP filesystem server and perform the initialization handshake.
         */
        async start(rootPath: string): Promise<void> {
                // Validate path to prevent directory traversal attacks
                assertWithinWorkspace(rootPath);

                this.rootPath = rootPath;
                await this.spawnServer();
                await this.initializeHandshake();
                this.logService.info(`[MCPProcessNode] Started with root: ${rootPath}`);
        }

        /**
         * Stop the MCP server process.
         */
        async stop(): Promise<void> {
                if (this.process && !this.process.killed) {
                        this.process.kill();
                        this.process = null;
                }
                this.initialized = false;
                this.logService.info('[MCPProcessNode] Stopped');
        }

        /**
         * Send a JSON-RPC request and wait for the response.
         */
        async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
                // Validate MCP method against allowlist to prevent arbitrary RPC calls
                if (!validateMcpMethod(method)) {
                        throw new Error(`MCP method not allowed: "${method}"`);
                }

                const id = ++this.requestId;
                const request: IJsonRpcRequest = {
                        jsonrpc: '2.0',
                        id,
                        method,
                        params,
                };

                return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {
                                this.pendingRequests.delete(id);
                                reject(new Error(`MCP request timed out after ${this.timeoutMs}ms: ${method}`));
                        }, this.timeoutMs);

                        this.pendingRequests.set(id, { resolve, reject, timer });

                        if (!this.process?.stdin) {
                                this.pendingRequests.delete(id);
                                clearTimeout(timer);
                                reject(new Error('MCP server process not running'));
                                return;
                        }

                        const message = JSON.stringify(request) + '\n';
                        this.process.stdin.write(message);
                });
        }

        /**
         * Call a tool on the MCP server.
         */
        async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
                // Validate tool name against allowlist to prevent arbitrary tool execution
                if (!validateToolName(name)) {
                        throw new Error(`MCP tool not allowed: "${name}"`);
                }

                return this.sendRequest('tools/call', {
                        name,
                        arguments: args,
                });
        }

        /**
         * List available tools on the MCP server.
         */
        async listTools(): Promise<unknown> {
                return this.sendRequest('tools/list');
        }

        get isRunning(): boolean {
                return this.process !== null && !this.process.killed;
        }

        get isInitialized(): boolean {
                return this.initialized;
        }

        /**
         * Build a minimal, safe environment for MCP child processes.
         * Only passes essential system variables — NEVER spreads the full process.env
         * to prevent leaking host secrets (API keys, DB URLs, tokens) to child processes.
         */
        private static readonly SAFE_ENV_KEYS = [
                'PATH', 'HOME', 'USER', 'TEMP', 'TMPDIR',
                'SYSTEMROOT', 'COMSPEC', 'PROGRAMFILES', 'APPDATA',
                'NODE_PATH', 'NPM_CONFIG_PREFIX',
        ];

        private buildSafeEnv(): Record<string, string> {
                const env: Record<string, string> = {};
                for (const key of MCPProcessNodeService.SAFE_ENV_KEYS) {
                        const value = process.env[key];
                        if (value !== undefined) {
                                env[key] = value;
                        }
                }
                return env;
        }

        private async spawnServer(): Promise<void> {
                // Resolve npx relative to the current Node.js executable
                const nodeDir = process.execPath.substring(0, process.execPath.lastIndexOf('/'));
                const npxPath = `${nodeDir}/npx`;
                const safeEnv = this.buildSafeEnv();

                this.logService.info(`[MCPProcessNode] Spawning MCP filesystem server: ${npxPath} -y @modelcontextprotocol/server-filesystem ${this.rootPath}`);

                try {
                        this.process = spawn(npxPath, ['-y', '@modelcontextprotocol/server-filesystem', this.rootPath], {
                                stdio: ['pipe', 'pipe', 'pipe'],
                                env: safeEnv,
                        });
                } catch {
                        // Fallback: try bare npx
                        this.logService.warn('[MCPProcessNode] npx not found at resolved path, falling back to bare npx');
                        this.process = spawn('npx', ['-y', '@modelcontextprotocol/server-filesystem', this.rootPath], {
                                stdio: ['pipe', 'pipe', 'pipe'],
                                env: safeEnv,
                        });
                }

                this.process.stdout?.on('data', (data: Buffer) => {
                        this.handleStdout(data.toString());
                });

                this.process.stderr?.on('data', (data: Buffer) => {
                        this.logService.debug(`[MCPProcessNode] stderr: ${data.toString().trim()}`);
                });

                this.process.on('exit', (code, signal) => {
                        this.logService.warn(`[MCPProcessNode] Process exited with code=${code}, signal=${signal}`);
                        this.initialized = false;
                        this.handleCrash();
                });

                this.process.on('error', (err) => {
                        this.logService.error(`[MCPProcessNode] Process error: ${err.message}`);
                        this.initialized = false;
                });

                // Wait a bit for the server to start
                await new Promise<void>(resolve => setTimeout(resolve, 2000));
        }

        private async initializeHandshake(): Promise<void> {
                try {
                        await this.sendRequest('initialize', {
                                protocolVersion: '2024-11-05',
                                capabilities: {},
                                clientInfo: {
                                        name: 'kovix',
                                        version: '1.0.0',
                                },
                        });

                        // Send initialized notification
                        if (this.process?.stdin) {
                                const notification = JSON.stringify({
                                        jsonrpc: '2.0',
                                        method: 'notifications/initialized',
                                }) + '\n';
                                this.process.stdin.write(notification);
                        }

                        this.initialized = true;
                        this.crashCount = 0; // Reset on successful init
                        this.logService.info('[MCPProcessNode] Initialization handshake complete');
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[MCPProcessNode] Initialization failed: ${msg}`);
                        throw error;
                }
        }

        private handleStdout(data: string): void {
                this.buffer += data;

                // Parse line-delimited JSON
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() ?? ''; // Keep incomplete line

                for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) { continue; }

                        try {
                                const response = JSON.parse(trimmed) as IJsonRpcResponse;

                                // Match response to pending request by ID
                                const pending = this.pendingRequests.get(response.id);
                                if (pending) {
                                        clearTimeout(pending.timer);
                                        this.pendingRequests.delete(response.id);

                                        if (response.error) {
                                                pending.reject(new Error(`MCP error [${response.error.code}]: ${response.error.message}`));
                                        } else {
                                                pending.resolve(response.result);
                                        }
                                }
                        } catch {
                                // Not a valid JSON-RPC response -- skip
                        }
                }
        }

        private async handleCrash(): Promise<void> {
                if (this.crashCount >= this.maxCrashes) {
                        this.logService.error(`[MCPProcessNode] Max crash count (${this.maxCrashes}) reached. Not restarting.`);
                        return;
                }

                this.crashCount++;
                this.logService.warn(`[MCPProcessNode] Crash ${this.crashCount}/${this.maxCrashes}. Restarting in ${this.crashBackoffMs}ms...`);

                // Clean up old process
                this.process = null;

                // Wait with backoff
                await new Promise<void>(resolve => setTimeout(resolve, this.crashBackoffMs));

                // Restart
                try {
                        await this.spawnServer();
                        await this.initializeHandshake();
                } catch (error) {
                        this.logService.error(`[MCPProcessNode] Restart failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        public override dispose(): void {
                // Reject all pending requests
                for (const [id, pending] of this.pendingRequests) {
                        clearTimeout(pending.timer);
                        pending.reject(new Error('MCP service disposed'));
                        this.pendingRequests.delete(id);
                }

                // Kill the process
                if (this.process && !this.process.killed) {
                        this.process.kill();
                        this.process = null;
                }

                this.initialized = false;
                super.dispose();
        }
}
