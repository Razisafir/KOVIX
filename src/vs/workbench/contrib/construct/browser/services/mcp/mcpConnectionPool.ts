/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Connection Pool
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	IMCPServerDefinition,
	MCPTransportType,
	MCPConnectionState,
	IMCPConnectionEvent,
	IMCPHealthStatus,
	MCPHealthStatus,
	MCP_MAX_CONCURRENT_SERVERS,
	MCP_HEALTH_CHECK_INTERVAL_MS,
	MCP_DEFAULT_TOOL_TIMEOUT_MS,
	MCP_MAX_RESTART_BACKOFF_MS,
	MCP_RESTART_BACKOFF_BASE_MS
} from '../../../../platform/construct/common/mcp/mcpTypes.js';

interface IConnectionEntry {
	client: any; // MCP Client instance
	transport: any; // MCP Transport instance
	definition: IMCPServerDefinition;
	state: MCPConnectionState;
	lastPing: number;
	errorCount: number;
	connectedAt?: number;
	retryCount: number;
	disposables: IDisposable[];
}

export class MCPConnectionPool extends Disposable {
	private connections = new Map<string, IConnectionEntry>();
	private readonly maxConcurrentServers = MCP_MAX_CONCURRENT_SERVERS;
	private readonly healthCheckIntervalMs = MCP_HEALTH_CHECK_INTERVAL_MS;
	private readonly defaultTimeoutMs = MCP_DEFAULT_TOOL_TIMEOUT_MS;
	private readonly maxRetryDelayMs = MCP_MAX_RESTART_BACKOFF_MS;

	private readonly _onConnectionChange = this._register(new Emitter<IMCPConnectionEvent>());
	readonly onConnectionChange: Event<IMCPConnectionEvent> = this._onConnectionChange.event;

	private readonly _onHealthUpdate = this._register(new Emitter<IMCPHealthStatus>());
	readonly onHealthUpdate: Event<IMCPHealthStatus> = this._onHealthUpdate.event;

	private healthCheckTimer: IDisposable | undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.startHealthChecks();
	}

	// ─── Health Checks ────────────────────────────────────────────────────

	private startHealthChecks(): void {
		const timer = setInterval(() => this.runHealthChecks(), this.healthCheckIntervalMs);
		this.healthCheckTimer = { dispose: () => clearInterval(timer) };
	}

	private async runHealthChecks(): Promise<void> {
		for (const [name, entry] of this.connections) {
			if (entry.state !== MCPConnectionState.Connected) { continue; }

			try {
				const pingStart = Date.now();
				if (entry.client && typeof entry.client.listTools === 'function') {
					await entry.client.listTools();
				}
				const latency = Date.now() - pingStart;
				entry.lastPing = Date.now();

				const status = entry.errorCount > 2 ? MCPHealthStatus.Degraded : MCPHealthStatus.Healthy;
				this.emitHealthUpdate(name, status, latency);
			} catch (error) {
				entry.errorCount++;
				const status = entry.errorCount > 5 ? MCPHealthStatus.Unhealthy : MCPHealthStatus.Degraded;
				this.emitHealthUpdate(name, status, undefined, error instanceof Error ? error.message : String(error));
			}
		}
	}

	// ─── Connection Management ────────────────────────────────────────────

	get activeConnectionCount(): number {
		let count = 0;
		for (const entry of this.connections.values()) {
			if (entry.state === MCPConnectionState.Connected || entry.state === MCPConnectionState.Connecting) {
				count++;
			}
		}
		return count;
	}

	canConnect(): boolean {
		return this.activeConnectionCount < this.maxConcurrentServers;
	}

	async connect(def: IMCPServerDefinition): Promise<any> {
		if (this.connections.size >= this.maxConcurrentServers && !this.connections.has(def.name)) {
			throw new Error(`Connection pool full (max ${this.maxConcurrentServers}). Stop another server first.`);
		}

		// Disconnect existing if reconnecting
		if (this.connections.has(def.name)) {
			await this.disconnect(def.name);
		}

		this.logService.info(`[MCP] Connecting to ${def.name} via ${def.transport}`);

		let transport: any;

		try {
			if (def.transport === MCPTransportType.Stdio) {
				const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
				transport = new StdioClientTransport({
					command: def.command,
					args: def.args,
					env: { ...process.env as Record<string, string>, ...def.env }
				});
			} else {
				const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
				const url = new URL(def.command); // For SSE, command is the URL
				transport = new SSEClientTransport(url);
			}
		} catch (importError) {
			this.logService.warn(`[MCP] MCP SDK import failed for ${def.name}, using raw stdio: ${importError}`);
			transport = null;
		}

		const { Client } = await import('@modelcontextprotocol/sdk/client/index.js').catch(() => ({ Client: null }));
		const client = Client ? new Client({ name: 'construct-ide', version: '1.0.0' }) : null;

		const entry: IConnectionEntry = {
			client,
			transport,
			definition: def,
			state: MCPConnectionState.Connecting,
			lastPing: Date.now(),
			errorCount: 0,
			retryCount: 0,
			disposables: []
		};

		this.connections.set(def.name, entry);
		this.emitConnectionEvent(def.name, MCPConnectionState.Connecting);

		try {
			if (client && transport) {
				await client.connect(transport);
			} else if (def.transport === MCPTransportType.Stdio) {
				// Fallback raw stdio mode when SDK unavailable
				await this.connectRawStdio(entry);
			} else {
				throw new Error(`Cannot connect to ${def.name}: MCP SDK unavailable and no fallback for ${def.transport}`);
			}

			entry.state = MCPConnectionState.Connected;
			entry.connectedAt = Date.now();
			entry.retryCount = 0;
			this.emitConnectionEvent(def.name, MCPConnectionState.Connected);
			this.emitHealthUpdate(def.name, MCPHealthStatus.Healthy);

			this.logService.info(`[MCP] Connected to ${def.name}`);
		} catch (error) {
			entry.state = MCPConnectionState.Error;
			entry.errorCount++;
			this.emitConnectionEvent(def.name, MCPConnectionState.Error, error instanceof Error ? error.message : String(error));
			this.emitHealthUpdate(def.name, MCPHealthStatus.Unhealthy, undefined, error instanceof Error ? error.message : String(error));

			this.logService.error(`[MCP] Failed to connect to ${def.name}:`, error);
			throw error;
		}

		return client;
	}

	/**
	 * Raw stdio fallback when MCP SDK is unavailable.
	 * Spawns the process and creates a minimal JSON-RPC client.
	 */
	private async connectRawStdio(entry: IConnectionEntry): Promise<void> {
		const { spawn, ChildProcess } = await import('child_process');
		const def = entry.definition;

		const childProcess: any = spawn(def.command, def.args, {
			env: { ...process.env as Record<string, string>, ...def.env },
			stdio: ['pipe', 'pipe', 'pipe']
		});

		entry.disposables.push({
			dispose: () => {
				if (childProcess && !childProcess.killed) {
					childProcess.kill('SIGTERM');
					setTimeout(() => {
						if (!childProcess.killed) { childProcess.kill('SIGKILL'); }
					}, 5000);
				}
			}
		});

		// Create a minimal client wrapper
		let messageId = 0;
		const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
		let buffer = '';

		if (childProcess.stdout) {
			childProcess.stdout.on('data', (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					if (!line.trim()) { continue; }
					try {
						const msg = JSON.parse(line);
						const p = pending.get(msg.id);
						if (p) {
							pending.delete(msg.id);
							if (msg.error) { p.reject(new Error(msg.error.message ?? 'Unknown error')); }
							else { p.resolve(msg.result); }
						}
					} catch { /* ignore non-JSON */ }
				}
			});
		}

		if (childProcess.stderr) {
			childProcess.stderr.on('data', (data: Buffer) => {
				this.logService.trace(`[MCP] stderr[${def.name}]: ${data.toString().trim()}`);
			});
		}

		entry.client = {
			callTool: (params: any) => new Promise((resolve, reject) => {
				const id = ++messageId;
				pending.set(id, { resolve, reject });
				childProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params }) + '\n');
				setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 60_000);
			}),
			listTools: () => new Promise((resolve, reject) => {
				const id = ++messageId;
				pending.set(id, { resolve, reject });
				childProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }) + '\n');
				setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 30_000);
			}),
			listResources: () => new Promise((resolve, reject) => {
				const id = ++messageId;
				pending.set(id, { resolve, reject });
				childProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'resources/list', params: {} }) + '\n');
				setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 30_000);
			}),
			readResource: (params: any) => new Promise((resolve, reject) => {
				const id = ++messageId;
				pending.set(id, { resolve, reject });
				childProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'resources/read', params }) + '\n');
				setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 30_000);
			}),
			listPrompts: () => new Promise((resolve, reject) => {
				const id = ++messageId;
				pending.set(id, { resolve, reject });
				childProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'prompts/list', params: {} }) + '\n');
				setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 30_000);
			}),
			getPrompt: (params: any) => new Promise((resolve, reject) => {
				const id = ++messageId;
				pending.set(id, { resolve, reject });
				childProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'prompts/get', params }) + '\n');
				setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Request timed out')); } }, 30_000);
			}),
			close: async () => { pending.clear(); if (!childProcess.killed) { childProcess.kill('SIGTERM'); } },
			connect: async () => { /* already connected */ }
		};
		entry.transport = null;
	}

	async disconnect(serverName: string): Promise<void> {
		const entry = this.connections.get(serverName);
		if (!entry) { return; }

		this.logService.info(`[MCP] Disconnecting ${serverName}`);

		entry.disposables.forEach(d => d.dispose());

		try { await entry.client?.close?.(); } catch (e) { this.logService.warn(`[MCP] Error closing client for ${serverName}:`, e); }
		try { await entry.transport?.close?.(); } catch (e) { this.logService.warn(`[MCP] Error closing transport for ${serverName}:`, e); }

		this.connections.delete(serverName);
		this.emitConnectionEvent(serverName, MCPConnectionState.Disconnected);
	}

	// ─── Tool Execution with Retry ────────────────────────────────────────

	async executeWithRetry<T>(
		serverName: string,
		operation: (client: any) => Promise<T>,
		timeoutMs: number = this.defaultTimeoutMs
	): Promise<T> {
		const entry = this.connections.get(serverName);
		if (!entry || entry.state !== MCPConnectionState.Connected) {
			throw new Error(`Server ${serverName} is not connected`);
		}

		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
		});

		try {
			const result = await Promise.race([operation(entry.client), timeoutPromise]);
			entry.lastPing = Date.now();
			entry.errorCount = Math.max(0, entry.errorCount - 1);
			return result;
		} catch (error) {
			entry.errorCount++;

			// Auto-restart with exponential backoff if connection dropped
			if (this.isConnectionError(error) && entry.retryCount < 5) {
				entry.retryCount++;
				const delay = Math.min(
					MCP_RESTART_BACKOFF_BASE_MS * Math.pow(2, entry.retryCount - 1),
					this.maxRetryDelayMs
				);

				this.logService.warn(`[MCP] Retrying ${serverName} in ${delay}ms (attempt ${entry.retryCount})`);
				await this.delay(delay);

				await this.reconnect(serverName);
				return this.executeWithRetry(serverName, operation, timeoutMs);
			}

			throw error;
		}
	}

	private async reconnect(serverName: string): Promise<void> {
		const entry = this.connections.get(serverName);
		if (!entry) { return; }

		this.emitConnectionEvent(serverName, MCPConnectionState.Reconnecting);

		try { await entry.client?.close?.(); } catch { /* ignore */ }
		try { await entry.transport?.close?.(); } catch { /* ignore */ }

		// Recreate transport
		const def = entry.definition;
		let transport: any;

		if (def.transport === MCPTransportType.Stdio) {
			const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
			transport = new StdioClientTransport({
				command: def.command,
				args: def.args,
				env: { ...process.env as Record<string, string>, ...def.env }
			});
		} else {
			const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
			transport = new SSEClientTransport(new URL(def.command));
		}

		entry.transport = transport;

		try {
			await entry.client.connect(transport);
			entry.state = MCPConnectionState.Connected;
			entry.connectedAt = Date.now();
			this.emitConnectionEvent(serverName, MCPConnectionState.Connected);
			this.emitHealthUpdate(serverName, MCPHealthStatus.Healthy);
		} catch (error) {
			entry.state = MCPConnectionState.Error;
			this.emitConnectionEvent(serverName, MCPConnectionState.Error, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	private isConnectionError(error: any): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return message.includes('ECONNREFUSED') ||
			message.includes('ENOTFOUND') ||
			message.includes('timeout') ||
			message.includes('closed') ||
			message.includes('disconnected');
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	// ─── Accessors ────────────────────────────────────────────────────────

	getClient(serverName: string): any | undefined {
		return this.connections.get(serverName)?.client;
	}

	getConnectionState(serverName: string): MCPConnectionState {
		return this.connections.get(serverName)?.state ?? MCPConnectionState.Disconnected;
	}

	getAllConnected(): string[] {
		return Array.from(this.connections.entries())
			.filter(([_, entry]) => entry.state === MCPConnectionState.Connected)
			.map(([name, _]) => name);
	}

	getConnectionCount(): number {
		return this.connections.size;
	}

	// ─── Event Helpers ────────────────────────────────────────────────────

	private emitConnectionEvent(name: string, state: MCPConnectionState, error?: string): void {
		this._onConnectionChange.fire({
			serverName: name,
			state,
			timestamp: Date.now(),
			error
		});
	}

	private emitHealthUpdate(name: string, status: MCPHealthStatus, latency?: number, message?: string): void {
		const entry = this.connections.get(name);
		this._onHealthUpdate.fire({
			serverName: name,
			status,
			lastPing: entry?.lastPing ?? Date.now(),
			errorCount: entry?.errorCount ?? 0,
			latencyMs: latency ?? 0,
			message
		});
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	override dispose(): void {
		this.healthCheckTimer?.dispose();
		const disconnectPromises = Array.from(this.connections.keys()).map(name => this.disconnect(name));
		Promise.all(disconnectPromises).catch(e => this.logService.error('[MCP] Error during bulk disconnect:', e));
		super.dispose();
	}
}
