/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Server Manager Service
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import {
	IMCPServerDefinition,
	IMCPTool,
	IMCPResource,
	IMCPPrompt,
	IMCPHealthStatus,
	IMCPConnectionEvent,
	IMCPExecutionResult,
	IMCPResourceResult,
	MCPConnectionState,
	MCPHealthStatus,
	MCPTransportType,
	MCP_RESOURCE_CACHE_TTL_MS
} from '../../../../platform/construct/common/mcp/mcpTypes.js';
import { MCPConnectionPool } from './mcpConnectionPool.js';
import { MCPServerRegistry } from './mcpServerRegistry.js';

// Resource cache with TTL
interface ICachedResource {
	content: string;
	mimeType: string;
	timestamp: number;
}

export class MCPServerManagerService extends Disposable implements IMCPServerManager {
	declare readonly _serviceBrand: undefined;

	private connectionPool: MCPConnectionPool;
	private registry: MCPServerRegistry;
	private resourceCache = new Map<string, ICachedResource>();
	private readonly cacheTTLMs = MCP_RESOURCE_CACHE_TTL_MS;

	private readonly _onDidChangeConnection = this._register(new Emitter<IMCPConnectionEvent>());
	readonly onDidChangeConnection: Event<IMCPConnectionEvent> = this._onDidChangeConnection.event;

	private readonly _onDidDiscoverTools = this._register(new Emitter<IMCPTool[]>());
	readonly onDidDiscoverTools: Event<IMCPTool[]> = this._onDidDiscoverTools.event;

	private readonly _onDidDiscoverResources = this._register(new Emitter<IMCPResource[]>());
	readonly onDidDiscoverResources: Event<IMCPResource[]> = this._onDidDiscoverResources.event;

	private readonly _onDidDiscoverPrompts = this._register(new Emitter<IMCPPrompt[]>());
	readonly onDidDiscoverPrompts: Event<IMCPPrompt[]> = this._onDidDiscoverPrompts.event;

	private readonly _onDidUpdateHealth = this._register(new Emitter<IMCPHealthStatus>());
	readonly onDidUpdateHealth: Event<IMCPHealthStatus> = this._onDidUpdateHealth.event;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.connectionPool = this._register(instantiationService.createInstance(MCPConnectionPool));
		this.registry = this._register(instantiationService.createInstance(MCPServerRegistry));

		// Forward events from connection pool
		this._register(this.connectionPool.onConnectionChange(e => this._onDidChangeConnection.fire(e)));
		this._register(this.connectionPool.onHealthUpdate(e => this._onDidUpdateHealth.fire(e)));
	}

	// ─── Discovery & Lifecycle ────────────────────────────────────────────

	async discoverServers(): Promise<IMCPServerDefinition[]> {
		const servers = this.registry.getAllServers();
		const discovered = await this.autoDiscoverCommonServers();

		// Merge, preferring registry entries
		const merged = new Map<string, IMCPServerDefinition>();
		for (const s of discovered) { merged.set(s.name, s); }
		for (const s of servers) { merged.set(s.name, s); }

		return Array.from(merged.values());
	}

	private async autoDiscoverCommonServers(): Promise<IMCPServerDefinition[]> {
		const common: IMCPServerDefinition[] = [];

		const checks = [
			{ name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], categories: ['filesystem'] },
			{ name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], categories: ['source-control'] },
			{ name: 'sqlite', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite'], categories: ['database'] },
			{ name: 'fetch', command: 'uvx', args: ['mcp-server-fetch'], categories: ['search'] },
		];

		for (const check of checks) {
			try {
				const { execSync } = await import('child_process');
				execSync(`which ${check.command.split(' ')[0]}`, { stdio: 'ignore' });
				common.push({
					name: check.name,
					command: check.command,
					args: check.args,
					env: {},
					transport: MCPTransportType.Stdio,
					categories: check.categories,
					description: `Auto-discovered ${check.name} MCP server`,
					isBuiltin: true
				});
			} catch {
				// Not available in PATH
			}
		}

		return common;
	}

	async installServer(def: IMCPServerDefinition): Promise<void> {
		this.logService.info(`[MCP Manager] Installing server ${def.name}`);
		await this.registry.addServer(def);

		// Auto-start builtins
		if (def.isBuiltin) {
			try { await this.startServer(def.name); } catch (e) {
				this.logService.warn(`[MCP Manager] Auto-start failed for ${def.name}:`, e);
			}
		}
	}

	async uninstallServer(name: string): Promise<void> {
		this.logService.info(`[MCP Manager] Uninstalling server ${name}`);
		await this.stopServer(name);
		await this.registry.removeServer(name);

		// Clear resource cache for this server
		for (const key of this.resourceCache.keys()) {
			if (key.startsWith(`${name}:`)) {
				this.resourceCache.delete(key);
			}
		}
	}

	async startServer(name: string): Promise<void> {
		const def = await this.registry.getServer(name);
		if (!def) {
			throw new Error(`Server ${name} not found in registry`);
		}

		this.logService.info(`[MCP Manager] Starting server ${name}`);

		try {
			await this.connectionPool.connect(def);
			await this.discoverCapabilities(name);
		} catch (error) {
			this.logService.error(`[MCP Manager] Failed to start ${name}:`, error);
			throw error;
		}
	}

	async stopServer(name: string): Promise<void> {
		this.logService.info(`[MCP Manager] Stopping server ${name}`);
		await this.connectionPool.disconnect(name);
	}

	async restartServer(name: string): Promise<void> {
		await this.stopServer(name);
		await this.delay(1000);
		await this.startServer(name);
	}

	listInstalledServers(): IMCPServerDefinition[] {
		return this.registry.getAllServers();
	}

	getServerHealth(name: string): IMCPHealthStatus {
		const state = this.connectionPool.getConnectionState(name);
		let status: MCPHealthStatus;

		switch (state) {
			case MCPConnectionState.Connected:
				status = MCPHealthStatus.Healthy;
				break;
			case MCPConnectionState.Connecting:
			case MCPConnectionState.Reconnecting:
				status = MCPHealthStatus.Unknown;
				break;
			case MCPConnectionState.Error:
				status = MCPHealthStatus.Unhealthy;
				break;
			default:
				status = MCPHealthStatus.Unknown;
		}

		return {
			serverName: name,
			status,
			lastPing: Date.now(),
			errorCount: 0,
			latencyMs: 0
		};
	}

	// ─── Tool Execution ───────────────────────────────────────────────────

	async executeTool(serverName: string, toolName: string, args: any): Promise<IMCPExecutionResult> {
		const startTime = Date.now();
		this.logService.info(`[MCP Manager] Executing tool ${toolName} on ${serverName}`);

		try {
			const result = await this.connectionPool.executeWithRetry(
				serverName,
				async (client: any) => {
					return await client.callTool({
						name: toolName,
						arguments: args
					});
				}
			);

			const duration = Date.now() - startTime;

			return {
				success: true,
				data: result,
				durationMs: duration,
				toolName,
				serverName
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			this.logService.error(`[MCP Manager] Tool execution failed:`, error);

			return {
				success: false,
				error: errorMessage,
				durationMs: duration,
				toolName,
				serverName
			};
		}
	}

	async listTools(serverName?: string): Promise<IMCPTool[]> {
		if (serverName) {
			const client = this.connectionPool.getClient(serverName);
			if (!client) { return []; }

			try {
				const result = await this.connectionPool.executeWithRetry(
					serverName,
					async (c: any) => await c.listTools()
				);

				return result.tools?.map((t: any) => ({
					name: t.name,
					description: t.description ?? '',
					inputSchema: t.inputSchema ?? {},
					serverName
				})) ?? [];
			} catch (e) {
				this.logService.warn(`[MCP Manager] Failed to list tools for ${serverName}:`, e);
				return [];
			}
		}

		// List tools from all connected servers
		const allTools: IMCPTool[] = [];
		for (const name of this.connectionPool.getAllConnected()) {
			try {
				const tools = await this.listTools(name);
				allTools.push(...tools);
			} catch (e) {
				this.logService.warn(`[MCP Manager] Failed to list tools for ${name}:`, e);
			}
		}
		return allTools;
	}

	// ─── Resource Access ──────────────────────────────────────────────────

	async readResource(serverName: string, uri: string): Promise<IMCPResourceResult> {
		const cacheKey = `${serverName}:${uri}`;
		const cached = this.resourceCache.get(cacheKey);

		if (cached && (Date.now() - cached.timestamp) < this.cacheTTLMs) {
			return {
				success: true,
				content: cached.content,
				mimeType: cached.mimeType,
				serverName,
				uri
			};
		}

		try {
			const result = await this.connectionPool.executeWithRetry(
				serverName,
				async (client: any) => await client.readResource({ uri })
			);

			const content = result.contents?.[0]?.text ?? '';
			const mimeType = result.contents?.[0]?.mimeType ?? 'text/plain';

			this.resourceCache.set(cacheKey, {
				content,
				mimeType,
				timestamp: Date.now()
			});

			return {
				success: true,
				content,
				mimeType,
				serverName,
				uri
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				serverName,
				uri
			};
		}
	}

	async listResources(serverName?: string): Promise<IMCPResource[]> {
		if (serverName) {
			const client = this.connectionPool.getClient(serverName);
			if (!client) { return []; }

			try {
				const result = await this.connectionPool.executeWithRetry(
					serverName,
					async (c: any) => await c.listResources()
				);

				return result.resources?.map((r: any) => ({
					uri: r.uri,
					mimeType: r.mimeType ?? 'text/plain',
					name: r.name,
					description: r.description ?? '',
					serverName
				})) ?? [];
			} catch (e) {
				this.logService.warn(`[MCP Manager] Failed to list resources for ${serverName}:`, e);
				return [];
			}
		}

		const allResources: IMCPResource[] = [];
		for (const name of this.connectionPool.getAllConnected()) {
			try {
				const resources = await this.listResources(name);
				allResources.push(...resources);
			} catch (e) {
				this.logService.warn(`[MCP Manager] Failed to list resources for ${name}:`, e);
			}
		}
		return allResources;
	}

	// ─── Prompts ──────────────────────────────────────────────────────────

	async listPrompts(serverName?: string): Promise<IMCPPrompt[]> {
		if (serverName) {
			const client = this.connectionPool.getClient(serverName);
			if (!client) { return []; }

			try {
				const result = await this.connectionPool.executeWithRetry(
					serverName,
					async (c: any) => await c.listPrompts()
				);

				return result.prompts?.map((p: any) => ({
					name: p.name,
					description: p.description ?? '',
					arguments: p.arguments,
					serverName
				})) ?? [];
			} catch (e) {
				this.logService.warn(`[MCP Manager] Failed to list prompts for ${serverName}:`, e);
				return [];
			}
		}

		const allPrompts: IMCPPrompt[] = [];
		for (const name of this.connectionPool.getAllConnected()) {
			try {
				const prompts = await this.listPrompts(name);
				allPrompts.push(...prompts);
			} catch (e) {
				this.logService.warn(`[MCP Manager] Failed to list prompts for ${name}:`, e);
			}
		}
		return allPrompts;
	}

	async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<string> {
		const result = await this.connectionPool.executeWithRetry(
			serverName,
			async (client: any) => await client.getPrompt({ name: promptName, arguments: args })
		);

		return result.messages?.map((m: any) => m.content?.text ?? '').join('\n') ?? '';
	}

	// ─── Bulk Operations ──────────────────────────────────────────────────

	async startAllServers(): Promise<void> {
		const servers = this.registry.getAllServers();
		for (const server of servers) {
			try {
				await this.startServer(server.name);
			} catch (e) {
				this.logService.error(`[MCP Manager] Auto-start failed for ${server.name}:`, e);
			}
		}
	}

	async stopAllServers(): Promise<void> {
		const connected = this.connectionPool.getAllConnected();
		for (const name of connected) {
			await this.stopServer(name);
		}
	}

	getServerStatus(name: string): string {
		return this.connectionPool.getConnectionState(name);
	}

	// ─── Private Helpers ──────────────────────────────────────────────────

	private async discoverCapabilities(serverName: string): Promise<void> {
		try {
			const tools = await this.listTools(serverName);
			this._onDidDiscoverTools.fire(tools);
		} catch (e) {
			this.logService.warn(`[MCP Manager] Failed to discover tools for ${serverName}:`, e);
		}

		try {
			const resources = await this.listResources(serverName);
			this._onDidDiscoverResources.fire(resources);
		} catch (e) {
			this.logService.warn(`[MCP Manager] Failed to discover resources for ${serverName}:`, e);
		}

		try {
			const prompts = await this.listPrompts(serverName);
			this._onDidDiscoverPrompts.fire(prompts);
		} catch (e) {
			this.logService.warn(`[MCP Manager] Failed to discover prompts for ${serverName}:`, e);
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	override dispose(): void {
		this.stopAllServers().catch(e => this.logService.error('[MCP Manager] Error stopping all servers:', e));
		super.dispose();
	}
}
