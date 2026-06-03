/*---------------------------------------------------------------------------------------------
 *  Construct IDE — MCP Process Service
 *  MVP: Real stdio-based MCP server management with JSON-RPC
 *
 *  - child_process.spawn() for MCP servers (filesystem, etc.)
 *  - JSON-RPC over stdio: line-delimited JSON
 *  - Methods: initialize, tools/list, tools/call
 *  - Request/response correlation via id field
 *  - Timeout: 30s default per call
 *  - Process lifecycle: kill on disconnect, restart on crash (max 3 retries)
 *  - Error handling: spawn failure, JSON parse error, method not found
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';

import {
        IMCPProcessService,
        MCPServerConfig,
        MCPServerState,
        MCPTool,
        MCPResource,
        MCPToolResult,
        MCPResourceContent,
        MCPServerStatus,
} from '../../../../../platform/construct/common/mcpProcess.js';

// ── Constants ─────────────────────────────────────────────────

const STORAGE_KEY = 'construct.mcp.servers';
const JSONRPC_VERSION = '2.0';
const DEFAULT_TIMEOUT = 30000;
const MAX_RESTART_RETRIES = 3;

// ── JSON-RPC Types ────────────────────────────────────────────

interface JSONRPCRequest {
        jsonrpc: '2.0';
        id: number;
        method: string;
        params?: any;
}

// JSONRPCResponse type is used implicitly by the output buffer processing

interface JSONRPCNotification {
        jsonrpc: '2.0';
        method: string;
        params?: any;
}

// ── Per-Server Client ─────────────────────────────────────────

class MCPServerClient extends Disposable {
        private _nextId = 1;
        private _pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
        private _tools: MCPTool[] = [];
        private _resources: MCPResource[] = [];
        private _state: MCPServerState = 'stopped';
        private _lastError?: string;
        private _startTime?: number;
        private _childProcess: any = undefined;
        private _outputBuffer = '';
        private _restartCount = 0;

        constructor(
                private readonly _config: MCPServerConfig,
                private readonly logService: ILogService,
                private readonly _onError: (serverId: string, error: string) => void,
                private readonly _onStateChange: (serverId: string, state: MCPServerState) => void,
                private readonly _onToolsDiscovered: (serverId: string, tools: MCPTool[]) => void,
        ) {
                super();
        }

        get id(): string { return this._config.id; }
        get name(): string { return this._config.name; }
        get state(): MCPServerState { return this._state; }
        get tools(): MCPTool[] { return this._tools; }
        get resources(): MCPResource[] { return this._resources; }
        get lastError(): string | undefined { return this._lastError; }
        get pid(): number | undefined { return this._childProcess?.pid; }
        get uptime(): number | undefined { return this._startTime ? Date.now() - this._startTime : undefined; }

        async start(): Promise<void> {
                if (this._state === 'running' || this._state === 'starting') {
                        return;
                }

                this._setState('starting');

                try {
                        // In browser context, child_process is not available
                        // We use a simulated spawn that communicates via window.postMessage or similar
                        const { spawn } = await this._getSpawn();
                        if (!spawn) {
                                throw new Error('child_process.spawn not available in this environment. MCP servers require desktop mode.');
                        }

                        const childEnv = { ...process.env as Record<string, string>, ...this._config.env };
                        this._childProcess = spawn(this._config.command, this._config.args, {
                                env: childEnv,
                                stdio: ['pipe', 'pipe', 'pipe'],
                        });

                        if (!this._childProcess.pid) {
                                throw new Error(`Failed to spawn MCP server: ${this._config.command}`);
                        }

                        this.logService.info(`[MCPProcess] Spawned server "${this.name}" (PID: ${this._childProcess.pid})`);

                        // Handle stdout — line-delimited JSON-RPC
                        this._childProcess.stdout?.on('data', (data: Buffer) => {
                                this._outputBuffer += data.toString('utf-8');
                                this._processOutputBuffer();
                        });

                        // Handle stderr — logging only
                        this._childProcess.stderr?.on('data', (data: Buffer) => {
                                this.logService.trace(`[MCPProcess] stderr (${this.name}): ${data.toString('utf-8').trim()}`);
                        });

                        // Handle process exit
                        this._childProcess.on('exit', (code: number | null, signal: string | null) => {
                                this.logService.info(`[MCPProcess] Server "${this.name}" exited (code=${code}, signal=${signal})`);
                                if (this._state === 'running') {
                                        this._setState('stopped');
                                        // Auto-restart on crash
                                        if (this._restartCount < MAX_RESTART_RETRIES) {
                                                this._restartCount++;
                                                this.logService.info(`[MCPProcess] Auto-restarting "${this.name}" (attempt ${this._restartCount}/${MAX_RESTART_RETRIES})`);
                                                setTimeout(() => this.start(), 2000);
                                        } else {
                                                this._onError(this.id, `Server crashed after ${MAX_RESTART_RETRIES} restart attempts`);
                                        }
                                }
                        });

                        this._childProcess.on('error', (err: Error) => {
                                this.logService.error(`[MCPProcess] Process error for "${this.name}":`, err);
                                this._lastError = err.message;
                                this._setState('error');
                                this._onError(this.id, err.message);
                        });

                        // Send initialize request
                        const initResult = await this._sendRequest('initialize', {
                                protocolVersion: '2024-11-05',
                                capabilities: {},
                                clientInfo: { name: 'Construct IDE', version: '0.1.0' },
                        });

                        this.logService.info(`[MCPProcess] Server "${this.name}" initialized: ${JSON.stringify(initResult?.serverInfo)}`);

                        // Send initialized notification
                        this._sendNotification('notifications/initialized', {});

                        // Discover tools
                        await this._discoverTools();

                        this._startTime = Date.now();
                        this._setState('running');
                        this._restartCount = 0;

                } catch (error) {
                        this._lastError = (error as Error).message;
                        this._setState('error');
                        this._onError(this.id, this._lastError);
                        throw error;
                }
        }

        async stop(): Promise<void> {
                if (this._state === 'stopped') return;

                this._setState('stopping');

                try {
                        // Reject all pending requests
                        for (const [_id, pending] of this._pendingRequests) {
                                clearTimeout(pending.timer);
                                pending.reject(new Error('Server shutting down'));
                        }
                        this._pendingRequests.clear();

                        // Kill the process
                        if (this._childProcess) {
                                this._childProcess.kill('SIGTERM');
                                // Force kill after 5s
                                setTimeout(() => {
                                        try { this._childProcess?.kill('SIGKILL'); } catch { /* already dead */ }
                                }, 5000);
                                this._childProcess = undefined;
                        }
                } catch (error) {
                        this.logService.warn(`[MCPProcess] Error stopping server "${this.name}":`, error);
                }

                this._startTime = undefined;
                this._setState('stopped');
        }

        async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
                const startTime = Date.now();

                try {
                        const result = await this._sendRequest('tools/call', {
                                name: toolName,
                                arguments: args,
                        }, this._config.timeout);

                        const content = this._extractContent(result);
                        const isError = result?.isError === true;

                        return {
                                success: !isError,
                                content,
                                error: isError ? content : undefined,
                                isError,
                                duration: Date.now() - startTime,
                        };
                } catch (error) {
                        return {
                                success: false,
                                content: (error as Error).message,
                                error: (error as Error).message,
                                isError: true,
                                duration: Date.now() - startTime,
                        };
                }
        }

        async readResource(uri: string): Promise<MCPResourceContent[]> {
                const result = await this._sendRequest('resources/read', { uri });
                return result?.contents ?? [];
        }

        private async _discoverTools(): Promise<void> {
                try {
                        const result = await this._sendRequest('tools/list', {});
                        const tools: MCPTool[] = (result?.tools ?? []).map((t: any) => ({
                                name: t.name,
                                description: t.description ?? '',
                                inputSchema: t.inputSchema ?? {},
                                serverId: this.id,
                        }));
                        this._tools = tools;
                        this._onToolsDiscovered(this.id, tools);
                        this.logService.info(`[MCPProcess] Discovered ${tools.length} tools from "${this.name}"`);
                } catch (error) {
                        this.logService.warn(`[MCPProcess] Failed to discover tools from "${this.name}":`, error);
                }
        }

        private _sendRequest(method: string, params: any, timeout?: number): Promise<any> {
                return new Promise((resolve, reject) => {
                        const id = this._nextId++;
                        const request: JSONRPCRequest = { jsonrpc: JSONRPC_VERSION, id, method, params };

                        const timer = setTimeout(() => {
                                this._pendingRequests.delete(id);
                                reject(new Error(`Request timeout: ${method} (id=${id})`));
                        }, timeout ?? DEFAULT_TIMEOUT);

                        this._pendingRequests.set(id, { resolve, reject, timer });

                        const message = JSON.stringify(request) + '\n';
                        try {
                                this._childProcess?.stdin?.write(message);
                        } catch (error) {
                                clearTimeout(timer);
                                this._pendingRequests.delete(id);
                                reject(new Error(`Failed to send request: ${(error as Error).message}`));
                        }
                });
        }

        private _sendNotification(method: string, params: any): void {
                const notification: JSONRPCNotification = { jsonrpc: JSONRPC_VERSION, method, params };
                const message = JSON.stringify(notification) + '\n';
                try {
                        this._childProcess?.stdin?.write(message);
                } catch (error) {
                        this.logService.warn(`[MCPProcess] Failed to send notification: ${(error as Error).message}`);
                }
        }

        private _processOutputBuffer(): void {
                const lines = this._outputBuffer.split('\n');
                this._outputBuffer = lines.pop() ?? ''; // Keep incomplete line

                for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        try {
                                const message = JSON.parse(trimmed);

                                if (message.id !== undefined && message.id !== null) {
                                        // Response
                                        const pending = this._pendingRequests.get(message.id);
                                        if (pending) {
                                                clearTimeout(pending.timer);
                                                this._pendingRequests.delete(message.id);
                                                if (message.error) {
                                                        pending.reject(new Error(message.error.message ?? 'JSON-RPC error'));
                                                } else {
                                                        pending.resolve(message.result);
                                                }
                                        }
                                } else if (message.method) {
                                        // Notification from server
                                        this.logService.trace(`[MCPProcess] Notification from "${this.name}": ${message.method}`);
                                }
                        } catch (error) {
                                this.logService.trace(`[MCPProcess] Failed to parse JSON-RPC message: ${trimmed.slice(0, 100)}`);
                        }
                }
        }

        private _extractContent(result: any): string {
                if (typeof result === 'string') return result;
                if (result?.content) {
                        if (Array.isArray(result.content)) {
                                return result.content.map((c: any) => {
                                        if (typeof c === 'string') return c;
                                        if (c.type === 'text') return c.text;
                                        return JSON.stringify(c);
                                }).join('\n');
                        }
                        if (typeof result.content === 'string') return result.content;
                }
                return JSON.stringify(result);
        }

        private _setState(state: MCPServerState): void {
                if (this._state !== state) {
                        this._state = state;
                        this._onStateChange(this.id, state);
                }
        }

        private async _getSpawn(): Promise<{ spawn: any }> {
                try {
                        // Try to dynamically import child_process
                        const cp = await import('child_process');
                        return { spawn: cp.spawn };
                } catch {
                        this.logService.warn('[MCPProcess] child_process not available — MCP servers require desktop mode');
                        return { spawn: null };
                }
        }

        override dispose(): void {
                this.stop();
                super.dispose();
        }
}

// ══════════════════════════════════════════════════════════════
// MCPProcessService — Main Service
// ══════════════════════════════════════════════════════════════

export class MCPProcessService extends Disposable implements IMCPProcessService {
        declare readonly _serviceBrand: undefined;

        private readonly _clients = new Map<string, MCPServerClient>();
        private readonly _serverConfigs = new Map<string, MCPServerConfig>();

        private readonly _onDidChangeServerState = this._register(new Emitter<{ serverId: string; state: MCPServerState }>());
        readonly onDidChangeServerState = this._onDidChangeServerState.event;

        private readonly _onDidDiscoverTools = this._register(new Emitter<{ serverId: string; tools: MCPTool[] }>());
        readonly onDidDiscoverTools = this._onDidDiscoverTools.event;

        private readonly _onDidServerError = this._register(new Emitter<{ serverId: string; error: string }>());
        readonly onDidServerError = this._onDidServerError.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
        ) {
                super();

                // Load saved server configs
                this._loadServerConfigs();
                this.logService.info('[MCPProcess] Initialized');
        }

        async startServer(config: MCPServerConfig): Promise<void> {
                // Stop existing server with same ID
                const existing = this._clients.get(config.id);
                if (existing) {
                        await existing.stop();
                        existing.dispose();
                }

                this._serverConfigs.set(config.id, config);
                this._saveServerConfigs();

                const client = new MCPServerClient(
                        config,
                        this.logService,
                        (serverId, error) => this._onDidServerError.fire({ serverId, error }),
                        (serverId, state) => this._onDidChangeServerState.fire({ serverId, state }),
                        (serverId, tools) => this._onDidDiscoverTools.fire({ serverId, tools }),
                );

                this._clients.set(config.id, client);

                await client.start();
        }

        async stopServer(serverId: string): Promise<void> {
                const client = this._clients.get(serverId);
                if (client) {
                        await client.stop();
                }
        }

        async restartServer(serverId: string): Promise<void> {
                const config = this._serverConfigs.get(serverId);
                if (config) {
                        await this.stopServer(serverId);
                        await this.startServer(config);
                }
        }

        async stopAllServers(): Promise<void> {
                const stops: Promise<void>[] = [];
                for (const client of this._clients.values()) {
                        stops.push(client.stop());
                }
                await Promise.all(stops);
        }

        getAllTools(): MCPTool[] {
                const tools: MCPTool[] = [];
                for (const client of this._clients.values()) {
                        tools.push(...client.tools);
                }
                return tools;
        }

        getAllResources(): MCPResource[] {
                const resources: MCPResource[] = [];
                for (const client of this._clients.values()) {
                        resources.push(...client.resources);
                }
                return resources;
        }

        getToolsForServer(serverId: string): MCPTool[] {
                return this._clients.get(serverId)?.tools ?? [];
        }

        async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
                const client = this._clients.get(serverId);
                if (!client) {
                        return { success: false, content: `Server ${serverId} not found`, error: `Server ${serverId} not found`, isError: true, duration: 0 };
                }
                return client.callTool(toolName, args);
        }

        async readResource(serverId: string, uri: string): Promise<MCPResourceContent[]> {
                const client = this._clients.get(serverId);
                if (!client) { return []; }
                return client.readResource(uri);
        }

        getServerStatus(serverId: string): MCPServerStatus | undefined {
                const client = this._clients.get(serverId);
                if (!client) return undefined;
                return {
                        id: client.id,
                        name: client.name,
                        state: client.state,
                        toolCount: client.tools.length,
                        lastError: client.lastError,
                        pid: client.pid,
                        uptime: client.uptime,
                };
        }

        getAllServerStatuses(): MCPServerStatus[] {
                const statuses: MCPServerStatus[] = [];
                for (const client of this._clients.values()) {
                        statuses.push({
                                id: client.id,
                                name: client.name,
                                state: client.state,
                                toolCount: client.tools.length,
                                lastError: client.lastError,
                                pid: client.pid,
                                uptime: client.uptime,
                        });
                }
                return statuses;
        }

        getServers(): MCPServerConfig[] {
                return Array.from(this._serverConfigs.values());
        }

        addServer(config: MCPServerConfig): void {
                this._serverConfigs.set(config.id, config);
                this._saveServerConfigs();
        }

        async removeServer(serverId: string): Promise<void> {
                await this.stopServer(serverId);
                const client = this._clients.get(serverId);
                if (client) {
                        client.dispose();
                        this._clients.delete(serverId);
                }
                this._serverConfigs.delete(serverId);
                this._saveServerConfigs();
        }

        override dispose(): void {
                this.stopAllServers();
                for (const client of this._clients.values()) {
                        client.dispose();
                }
                this._clients.clear();
                super.dispose();
        }

        // ── Private Helpers ───────────────────────────────────────

        private _loadServerConfigs(): void {
                try {
                        const saved = this.storageService.get(STORAGE_KEY, StorageScope.PROFILE, undefined);
                        if (saved) {
                                const configs: MCPServerConfig[] = JSON.parse(saved);
                                for (const config of configs) {
                                        this._serverConfigs.set(config.id, config);
                                }
                        }
                } catch (err) {
                        this.logService.warn('[MCPProcess] Failed to load server configs:', err);
                }

                // Add default filesystem server if none configured
                if (this._serverConfigs.size === 0) {
                        this._serverConfigs.set('filesystem', {
                                id: 'filesystem',
                                name: 'Filesystem',
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
                                enabled: true,
                                autoStart: false,
                        });
                }
        }

        private _saveServerConfigs(): void {
                try {
                        const configs = Array.from(this._serverConfigs.values());
                        this.storageService.store(STORAGE_KEY, JSON.stringify(configs), StorageScope.PROFILE, StorageTarget.MACHINE);
                } catch (err) {
                        this.logService.warn('[MCPProcess] Failed to save server configs:', err);
                }
        }
}
