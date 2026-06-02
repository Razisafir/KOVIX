/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Connection Pool
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ChildProcess, spawn } from 'child_process';
import { IMCPServerConfig, MCPConnectionState, MCPHealthStatus, IMCPHealthCheck, MCP_MAX_CONCURRENT_SERVERS, MCP_HEALTH_PING_INTERVAL_MS, MCP_RESTART_BACKOFF_BASE_MS, MCP_MAX_RESTART_BACKOFF_MS } from '../../../../platform/construct/common/mcp/mcpTypes.js';

interface IPooledConnection {
        readonly name: string;
        readonly config: IMCPServerConfig;
        client: unknown | null; // MCP Client instance (typed as unknown to avoid import issues)
        transport: unknown | null; // MCP Transport instance
        process: ChildProcess | null;
        state: MCPConnectionState;
        health: IMCPHealthCheck;
        restartAttempts: number;
        lastRestartTime: number;
        healthTimer: IDisposable | null;
        restartTimer: IDisposable | null;
        tools: unknown[];
        resources: unknown[];
        prompts: unknown[];
}

export class MCPConnectionPool extends Disposable {
        private readonly _connections = new Map<string, IPooledConnection>();
        private readonly _onDidChangeConnection = this._register(new Emitter<{ serverName: string; state: MCPConnectionState }>());
        readonly onDidChangeConnection: Event<{ serverName: string; state: MCPConnectionState }> = this._onDidChangeConnection.event;

        private readonly _onDidChangeHealth = this._register(new Emitter<{ serverName: string; health: IMCPHealthCheck }>());
        readonly onDidChangeHealth: Event<{ serverName: string; health: IMCPHealthCheck }> = this._onDidChangeHealth.event;

        private readonly _onDidDiscoverTools = this._register(new Emitter<{ serverName: string; tools: unknown[] }>());
        readonly onDidDiscoverTools: Event<{ serverName: string; tools: unknown[] }> = this._onDidDiscoverTools.event;

        constructor(
                @ILogService private readonly _logService: ILogService,
        ) {
                super();
        }

        // ─── Connection Management ────────────────────────────────────────────

        get activeConnectionCount(): number {
                let count = 0;
                for (const conn of this._connections.values()) {
                        if (conn.state === MCPConnectionState.Connected || conn.state === MCPConnectionState.Connecting) {
                                count++;
                        }
                }
                return count;
        }

        canConnect(): boolean {
                return this.activeConnectionCount < MCP_MAX_CONCURRENT_SERVERS;
        }

        getConnection(name: string): IPooledConnection | undefined {
                return this._connections.get(name);
        }

        getConnectionState(name: string): MCPConnectionState {
                return this._connections.get(name)?.state ?? MCPConnectionState.Disconnected;
        }

        getHealth(name: string): IMCPHealthCheck | undefined {
                return this._connections.get(name)?.health;
        }

        getAllConnections(): ReadonlyMap<string, IPooledConnection> {
                return this._connections;
        }

        async connect(name: string, config: IMCPServerConfig): Promise<void> {
                if (this._connections.has(name)) {
                        const existing = this._connections.get(name)!;
                        if (existing.state === MCPConnectionState.Connected) {
                                this._logService.warn(`[MCP] Server "${name}" is already connected`);
                                return;
                        }
                        await this.disconnect(name);
                }

                if (!this.canConnect()) {
                        throw new Error(`Cannot connect to "${name}": maximum concurrent connections (${MCP_MAX_CONCURRENT_SERVERS}) reached. Stop another server first.`);
                }

                const connection: IPooledConnection = {
                        name,
                        config,
                        client: null,
                        transport: null,
                        process: null,
                        state: MCPConnectionState.Connecting,
                        health: {
                                status: MCPHealthStatus.Unknown,
                                latencyMs: -1,
                                lastChecked: 0,
                                consecutiveFailures: 0,
                        },
                        restartAttempts: 0,
                        lastRestartTime: 0,
                        healthTimer: null,
                        restartTimer: null,
                        tools: [],
                        resources: [],
                        prompts: [],
                };

                this._connections.set(name, connection);
                this._fireConnectionState(name, MCPConnectionState.Connecting);

                try {
                        if (config.transport === 'stdio') {
                                await this._connectStdio(connection);
                        } else if (config.transport === 'sse') {
                                await this._connectSSE(connection);
                        } else {
                                throw new Error(`Unsupported transport: ${config.transport}`);
                        }

                        connection.restartAttempts = 0;
                        this._fireConnectionState(name, MCPConnectionState.Connected);
                        this._startHealthMonitor(name);

                        // Discover tools after connection
                        await this._discoverTools(connection);

                } catch (error) {
                        this._logService.error(`[MCP] Failed to connect to "${name}": ${error}`);
                        this._fireConnectionState(name, MCPConnectionState.Error);
                        connection.health.status = MCPHealthStatus.Unhealthy;
                        connection.health.errorMessage = String(error);
                        this._updateHealth(name, connection.health);

                        // Auto-restart if enabled
                        if (config.autoRestart) {
                                this._scheduleRestart(name);
                        }

                        throw error;
                }
        }

        async disconnect(name: string): Promise<void> {
                const connection = this._connections.get(name);
                if (!connection) {
                        return;
                }

                this._fireConnectionState(name, MCPConnectionState.Stopping);

                // Cancel timers
                connection.healthTimer?.dispose();
                connection.healthTimer = null;
                connection.restartTimer?.dispose();
                connection.restartTimer = null;

                try {
                        // Close the MCP client if it exists
                        if (connection.client && typeof (connection.client as any).close === 'function') {
                                await (connection.client as any).close();
                        }

                        // Close the transport if it exists
                        if (connection.transport && typeof (connection.transport as any).close === 'function') {
                                await (connection.transport as any).close();
                        }
                } catch (error) {
                        this._logService.warn(`[MCP] Error closing transport for "${name}": ${error}`);
                }

                // Kill the child process if stdio
                if (connection.process && !connection.process.killed) {
                        try {
                                connection.process.kill('SIGTERM');
                                // Give it 5 seconds to exit gracefully
                                const timeout = setTimeout(() => {
                                        if (connection.process && !connection.process.killed) {
                                                connection.process.kill('SIGKILL');
                                        }
                                }, 5000);
                                connection.process.on('exit', () => clearTimeout(timeout));
                        } catch (error) {
                                this._logService.warn(`[MCP] Error killing process for "${name}": ${error}`);
                        }
                        connection.process = null;
                }

                connection.client = null;
                connection.transport = null;
                connection.state = MCPConnectionState.Disconnected;
                connection.tools = [];
                connection.resources = [];
                connection.prompts = [];

                this._fireConnectionState(name, MCPConnectionState.Disconnected);
        }

        async disconnectAll(): Promise<void> {
                const names = [...this._connections.keys()];
                await Promise.allSettled(names.map(n => this.disconnect(n)));
        }

        // ─── Tool Execution ───────────────────────────────────────────────────

        async executeTool(name: string, toolName: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
                const connection = this._connections.get(name);
                if (!connection || !connection.client) {
                        throw new Error(`Server "${name}" is not connected`);
                }
                if (connection.state !== MCPConnectionState.Connected) {
                        throw new Error(`Server "${name}" is not in connected state (state: ${connection.state})`);
                }

                const client = connection.client as any;
                const startTime = Date.now();

                return new Promise<unknown>((resolve, reject) => {
                        const timer = setTimeout(() => {
                                reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
                        }, timeoutMs);

                        client.callTool({ name: toolName, arguments: args })
                                .then((result: any) => {
                                        clearTimeout(timer);
                                        const executionTimeMs = Date.now() - startTime;
                                        this._logService.trace(`[MCP] Tool "${toolName}" on "${name}" completed in ${executionTimeMs}ms`);
                                        resolve(result);
                                })
                                .catch((error: any) => {
                                        clearTimeout(timer);
                                        reject(error);
                                });
                });
        }

        // ─── Resource Reading ─────────────────────────────────────────────────

        async readResource(name: string, uri: string): Promise<unknown> {
                const connection = this._connections.get(name);
                if (!connection || !connection.client) {
                        throw new Error(`Server "${name}" is not connected`);
                }
                const client = connection.client as any;
                return client.readResource({ uri });
        }

        // ─── List Operations ──────────────────────────────────────────────────

        async listTools(name: string): Promise<unknown[]> {
                const connection = this._connections.get(name);
                if (!connection || !connection.client) {
                        throw new Error(`Server "${name}" is not connected`);
                }
                const client = connection.client as any;
                const result = await client.listTools();
                connection.tools = result?.tools ?? [];
                return connection.tools;
        }

        async listResources(name: string): Promise<unknown[]> {
                const connection = this._connections.get(name);
                if (!connection || !connection.client) {
                        throw new Error(`Server "${name}" is not connected`);
                }
                const client = connection.client as any;
                const result = await client.listResources();
                connection.resources = result?.resources ?? [];
                return connection.resources;
        }

        async listPrompts(name: string): Promise<unknown[]> {
                const connection = this._connections.get(name);
                if (!connection || !connection.client) {
                        throw new Error(`Server "${name}" is not connected`);
                }
                const client = connection.client as any;
                const result = await client.listPrompts();
                connection.prompts = result?.prompts ?? [];
                return connection.prompts;
        }

        // ─── Private: Connection Methods ──────────────────────────────────────

        private async _connectStdio(connection: IPooledConnection): Promise<void> {
                const { config, name } = connection;

                if (!config.command) {
                        throw new Error(`Stdio server "${name}" requires a "command" in its config`);
                }

                this._logService.info(`[MCP] Starting stdio server "${name}": ${config.command} ${(config.args ?? []).join(' ')}`);

                // Spawn the child process with proper cleanup on dispose
                const childProcess = spawn(config.command, config.args ?? [], {
                        env: { ...process.env as Record<string, string>, ...config.env },
                        stdio: ['pipe', 'pipe', 'pipe'],
                        cwd: config.env?.cwd,
                });

                connection.process = childProcess;

                // Set up cleanup handlers
                childProcess.on('error', (error) => {
                        this._logService.error(`[MCP] Process error for "${name}": ${error.message}`);
                        this._handleConnectionError(name, error);
                });

                childProcess.on('exit', (code, signal) => {
                        this._logService.info(`[MCP] Process for "${name}" exited with code ${code}, signal ${signal}`);
                        if (connection.state === MCPConnectionState.Connected) {
                                this._handleConnectionError(name, new Error(`Process exited unexpectedly with code ${code}`));
                        }
                });

                // Log stderr output
                if (childProcess.stderr) {
                        childProcess.stderr.on('data', (data: Buffer) => {
                                this._logService.trace(`[MCP] stderr[${name}]: ${data.toString().trim()}`);
                        });
                }

                // Create the MCP SDK stdio transport and client
                try {
                        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
                        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

                        const transport = new StdioClientTransport({
                                command: config.command,
                                args: config.args,
                                env: { ...process.env as Record<string, string>, ...config.env },
                        });

                        // Close the spawned process since the SDK will spawn its own
                        if (childProcess && !childProcess.killed) {
                                childProcess.kill('SIGTERM');
                        }
                        connection.process = null;

                        const client = new Client(
                                { name: 'construct-ide', version: '1.0.0' },
                                { capabilities: {} }
                        );

                        await client.connect(transport);

                        connection.client = client;
                        connection.transport = transport;

                        // Track the SDK's child process via transport
                        const pid = (transport as any).pid;
                        if (pid) {
                                this._logService.info(`[MCP] Stdio server "${name}" started with PID ${pid}`);
                        }
                } catch (importError) {
                        // If MCP SDK is not available, fall back to raw process management
                        this._logService.warn(`[MCP] MCP SDK import failed for "${name}", using raw process mode: ${importError}`);
                        connection.client = this._createRawStdioClient(connection);
                        connection.transport = null;
                }
        }

        private async _connectSSE(connection: IPooledConnection): Promise<void> {
                const { config, name } = connection;

                if (!config.url) {
                        throw new Error(`SSE server "${name}" requires a "url" in its config`);
                }

                this._logService.info(`[MCP] Connecting to SSE server "${name}" at ${config.url}`);

                try {
                        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
                        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

                        const url = new URL(config.url);
                        const transport = new SSEClientTransport(url);
                        const client = new Client(
                                { name: 'construct-ide', version: '1.0.0' },
                                { capabilities: {} }
                        );

                        await client.connect(transport);

                        connection.client = client;
                        connection.transport = transport;
                } catch (importError) {
                        this._logService.warn(`[MCP] MCP SDK import failed for SSE "${name}": ${importError}`);
                        throw new Error(`Failed to connect SSE server "${name}": ${importError}`);
                }
        }

        /**
         * Creates a minimal client-like wrapper for raw stdio processes
         * when the MCP SDK cannot be imported.
         */
        private _createRawStdioClient(connection: IPooledConnection): any {
                const proc = connection.process;
                if (!proc || !proc.stdin || !proc.stdout) {
                        throw new Error('Cannot create raw stdio client: process streams not available');
                }

                let messageId = 0;
                const pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
                let buffer = '';

                proc.stdout!.on('data', (data: Buffer) => {
                        buffer += data.toString();
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';

                        for (const line of lines) {
                                if (!line.trim()) { continue; }
                                try {
                                        const message = JSON.parse(line);
                                        const pending = pendingRequests.get(message.id);
                                        if (pending) {
                                                pendingRequests.delete(message.id);
                                                if (message.error) {
                                                        pending.reject(new Error(message.error.message ?? 'Unknown error'));
                                                } else {
                                                        pending.resolve(message.result);
                                                }
                                        }
                                } catch {
                                        // Not a JSON line, ignore
                                }
                        }
                });

                return {
                        callTool: (params: { name: string; arguments: Record<string, unknown> }) => {
                                return new Promise((resolve, reject) => {
                                        const id = ++messageId;
                                        pendingRequests.set(id, { resolve, reject });
                                        const request = {
                                                jsonrpc: '2.0',
                                                id,
                                                method: 'tools/call',
                                                params,
                                        };
                                        proc.stdin!.write(JSON.stringify(request) + '\n');

                                        // Timeout handled by caller
                                        setTimeout(() => {
                                                if (pendingRequests.has(id)) {
                                                        pendingRequests.delete(id);
                                                        reject(new Error('Request timed out'));
                                                }
                                        }, 60_000);
                                });
                        },
                        listTools: () => {
                                return new Promise((resolve, reject) => {
                                        const id = ++messageId;
                                        pendingRequests.set(id, { resolve, reject });
                                        const request = {
                                                jsonrpc: '2.0',
                                                id,
                                                method: 'tools/list',
                                                params: {},
                                        };
                                        proc.stdin!.write(JSON.stringify(request) + '\n');

                                        setTimeout(() => {
                                                if (pendingRequests.has(id)) {
                                                        pendingRequests.delete(id);
                                                        reject(new Error('Request timed out'));
                                                }
                                        }, 30_000);
                                });
                        },
                        listResources: () => {
                                return new Promise((resolve, reject) => {
                                        const id = ++messageId;
                                        pendingRequests.set(id, { resolve, reject });
                                        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'resources/list', params: {} }) + '\n');
                                        setTimeout(() => {
                                                if (pendingRequests.has(id)) {
                                                        pendingRequests.delete(id);
                                                        reject(new Error('Request timed out'));
                                                }
                                        }, 30_000);
                                });
                        },
                        readResource: (params: { uri: string }) => {
                                return new Promise((resolve, reject) => {
                                        const id = ++messageId;
                                        pendingRequests.set(id, { resolve, reject });
                                        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'resources/read', params }) + '\n');
                                        setTimeout(() => {
                                                if (pendingRequests.has(id)) {
                                                        pendingRequests.delete(id);
                                                        reject(new Error('Request timed out'));
                                                }
                                        }, 30_000);
                                });
                        },
                        listPrompts: () => {
                                return new Promise((resolve, reject) => {
                                        const id = ++messageId;
                                        pendingRequests.set(id, { resolve, reject });
                                        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'prompts/list', params: {} }) + '\n');
                                        setTimeout(() => {
                                                if (pendingRequests.has(id)) {
                                                        pendingRequests.delete(id);
                                                        reject(new Error('Request timed out'));
                                                }
                                        }, 30_000);
                                });
                        },
                        close: async () => {
                                pendingRequests.clear();
                                if (proc && !proc.killed) {
                                        proc.kill('SIGTERM');
                                }
                        },
                        connect: async () => { /* already connected */ },
                };
        }

        // ─── Private: Tool Discovery ──────────────────────────────────────────

        private async _discoverTools(connection: IPooledConnection): Promise<void> {
                try {
                        if (connection.client && typeof (connection.client as any).listTools === 'function') {
                                const result = await this.listTools(connection.name);
                                connection.tools = result;
                                this._onDidDiscoverTools.fire({ serverName: connection.name, tools: result });
                        }
                } catch (error) {
                        this._logService.warn(`[MCP] Failed to discover tools for "${connection.name}": ${error}`);
                }
        }

        // ─── Private: Health Monitoring ───────────────────────────────────────

        private _startHealthMonitor(name: string): void {
                const connection = this._connections.get(name);
                if (!connection) { return; }

                connection.healthTimer?.dispose();

                const interval = setInterval(() => {
                        this._performHealthCheck(name).catch(error => {
                                this._logService.trace(`[MCP] Health check failed for "${name}": ${error}`);
                        });
                }, MCP_HEALTH_PING_INTERVAL_MS);

                connection.healthTimer = {
                        dispose: () => clearInterval(interval),
                };
        }

        private async _performHealthCheck(name: string): Promise<void> {
                const connection = this._connections.get(name);
                if (!connection || connection.state !== MCPConnectionState.Connected) { return; }

                const startTime = Date.now();
                const previousHealth = { ...connection.health };

                try {
                        // Try listing tools as a health check
                        if (connection.client && typeof (connection.client as any).listTools === 'function') {
                                await (connection.client as any).listTools();
                        }

                        const latencyMs = Date.now() - startTime;
                        connection.health = {
                                status: latencyMs < 1000 ? MCPHealthStatus.Healthy : MCPHealthStatus.Degraded,
                                latencyMs,
                                lastChecked: Date.now(),
                                consecutiveFailures: 0,
                        };
                } catch (error) {
                        connection.health = {
                                status: MCPHealthStatus.Unhealthy,
                                latencyMs: -1,
                                lastChecked: Date.now(),
                                consecutiveFailures: previousHealth.consecutiveFailures + 1,
                                errorMessage: String(error),
                        };
                }

                this._updateHealth(name, connection.health);
        }

        private _updateHealth(name: string, health: IMCPHealthCheck): void {
                this._onDidChangeHealth.fire({ serverName: name, health });
        }

        // ─── Private: Auto-Restart with Exponential Backoff ───────────────────

        private _scheduleRestart(name: string): void {
                const connection = this._connections.get(name);
                if (!connection) { return; }

                connection.restartTimer?.dispose();

                const backoffMs = Math.min(
                        MCP_RESTART_BACKOFF_BASE_MS * Math.pow(2, connection.restartAttempts),
                        MCP_MAX_RESTART_BACKOFF_MS
                );

                this._logService.info(`[MCP] Scheduling restart for "${name}" in ${backoffMs}ms (attempt ${connection.restartAttempts + 1})`);

                const timer = setTimeout(async () => {
                        connection.restartAttempts++;
                        connection.lastRestartTime = Date.now();
                        try {
                                await this.disconnect(name);
                                await this.connect(name, connection.config);
                        } catch (error) {
                                this._logService.error(`[MCP] Auto-restart failed for "${name}": ${error}`);
                        }
                }, backoffMs);

                connection.restartTimer = {
                        dispose: () => clearTimeout(timer),
                };
        }

        private _handleConnectionError(name: string, error: Error): void {
                const connection = this._connections.get(name);
                if (!connection) { return; }

                if (connection.state === MCPConnectionState.Connected || connection.state === MCPConnectionState.Connecting) {
                        this._fireConnectionState(name, MCPConnectionState.Error);
                        connection.health.status = MCPHealthStatus.Unhealthy;
                        connection.health.errorMessage = error.message;
                        this._updateHealth(name, connection.health);

                        if (connection.config.autoRestart) {
                                this._scheduleRestart(name);
                        }
                }
        }

        private _fireConnectionState(name: string, state: MCPConnectionState): void {
                const connection = this._connections.get(name);
                if (connection) {
                        connection.state = state;
                }
                this._onDidChangeConnection.fire({ serverName: name, state });
        }

        // ─── Lifecycle ────────────────────────────────────────────────────────

        override dispose(): void {
                for (const connection of this._connections.values()) {
                        connection.healthTimer?.dispose();
                        connection.restartTimer?.dispose();
                        if (connection.process && !connection.process.killed) {
                                connection.process.kill('SIGKILL');
                        }
                        if (connection.client && typeof (connection.client as any).close === 'function') {
                                (connection.client as any).close().catch(() => { });
                        }
                        if (connection.transport && typeof (connection.transport as any).close === 'function') {
                                (connection.transport as any).close().catch(() => { });
                        }
                }
                this._connections.clear();
                super.dispose();
        }
}
