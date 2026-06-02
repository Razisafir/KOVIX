/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Server Manager Service
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import {
        IMCPServerConfig, IMCPTool, IMCPResource, IMCPPrompt,
        MCPConnectionState, IMCPHealthCheck, IMCPToolExecutionResult,
        IMCPResourceReadResult, MCP_DEFAULT_TOOL_TIMEOUT_MS, MCP_RESOURCE_CACHE_TTL_MS
} from '../../../../platform/construct/common/mcp/mcpTypes.js';
import { MCPConnectionPool } from './mcpConnectionPool.js';
import { MCPServerRegistry } from './mcpServerRegistry.js';

interface IResourceCacheEntry {
        result: IMCPResourceReadResult;
        expiresAt: number;
}

export class MCPServerManagerService extends Disposable implements IMCPServerManager {
        declare readonly _serviceBrand: undefined;

        private readonly _pool: MCPConnectionPool;
        private readonly _registry: MCPServerRegistry;
        private readonly _resourceCache = new Map<string, IResourceCacheEntry>();
        private readonly _cacheCleanupTimer: IDisposable;

        private readonly _onDidChangeConnection = this._register(new Emitter<{ serverName: string; state: MCPConnectionState }>());
        readonly onDidChangeConnection: Event<{ serverName: string; state: MCPConnectionState }> = this._onDidChangeConnection.event;

        private readonly _onDidDiscoverTools = this._register(new Emitter<{ serverName: string; tools: IMCPTool[] }>());
        readonly onDidDiscoverTools: Event<{ serverName: string; tools: IMCPTool[] }> = this._onDidDiscoverTools.event;

        private readonly _onDidChangeHealth = this._register(new Emitter<{ serverName: string; health: IMCPHealthCheck }>());
        readonly onDidChangeHealth: Event<{ serverName: string; health: IMCPHealthCheck }> = this._onDidChangeHealth.event;

        constructor(
                @ILogService private readonly _logService: ILogService,
        ) {
                super();

                this._pool = this._register(new MCPConnectionPool(_logService));
                this._registry = this._register(new MCPServerRegistry(
                        // These will be injected at the contribution layer; using any for now
                        // since this constructor is called via DI
                        (null as any), // IConfigurationService
                        (null as any), // ISecretStorageService
                        _logService,
                ));

                // Forward pool events
                this._register(this._pool.onDidChangeConnection(e => this._onDidChangeConnection.fire(e)));
                this._register(this._pool.onDidDiscoverTools(e => {
                        const tools = e.tools as IMCPTool[];
                        this._onDidDiscoverTools.fire({ serverName: e.serverName, tools });
                }));
                this._register(this._pool.onDidChangeHealth(e => this._onDidChangeHealth.fire(e)));

                // Resource cache cleanup every minute
                this._cacheCleanupTimer = {
                        dispose: () => clearInterval(
                                setInterval(() => this._cleanResourceCache(), 60_000)
                        ),
                };
        }

        // ─── Server Lifecycle ─────────────────────────────────────────────────

        async discoverServers(): Promise<IMCPServerConfig[]> {
                this._logService.info('[MCP Manager] Discovering available MCP servers');
                await this._registry.ensureLoaded();
                return this._registry.getAllServers();
        }

        async installServer(config: IMCPServerConfig): Promise<void> {
                this._logService.info(`[MCP Manager] Installing server "${config.name}"`);

                // Validate the config
                if (!config.name || config.name.trim().length === 0) {
                        throw new Error('Server name is required');
                }
                if (this._registry.hasServer(config.name)) {
                        throw new Error(`Server "${config.name}" is already installed`);
                }

                await this._registry.registerServer(config);
                this._logService.info(`[MCP Manager] Server "${config.name}" installed successfully`);
        }

        async uninstallServer(name: string): Promise<void> {
                this._logService.info(`[MCP Manager] Uninstalling server "${name}"`);

                // Stop the server first if running
                const state = this._pool.getConnectionState(name);
                if (state !== MCPConnectionState.Disconnected) {
                        await this.stopServer(name);
                }

                await this._registry.unregisterServer(name);
                this._logService.info(`[MCP Manager] Server "${name}" uninstalled successfully`);
        }

        async startServer(name: string): Promise<void> {
                this._logService.info(`[MCP Manager] Starting server "${name}"`);

                await this._registry.ensureLoaded();
                const config = this._registry.getServer(name);
                if (!config) {
                        throw new Error(`Server "${name}" is not installed. Install it first.`);
                }

                if (!config.enabled) {
                        throw new Error(`Server "${name}" is disabled. Enable it before starting.`);
                }

                await this._pool.connect(name, config);
                this._logService.info(`[MCP Manager] Server "${name}" started successfully`);
        }

        async stopServer(name: string): Promise<void> {
                this._logService.info(`[MCP Manager] Stopping server "${name}"`);
                await this._pool.disconnect(name);
                this._clearResourceCacheForServer(name);
                this._logService.info(`[MCP Manager] Server "${name}" stopped successfully`);
        }

        async restartServer(name: string): Promise<void> {
                this._logService.info(`[MCP Manager] Restarting server "${name}"`);

                const config = this._registry.getServer(name);
                if (!config) {
                        throw new Error(`Server "${name}" is not installed`);
                }

                await this.stopServer(name);
                await this.startServer(name);
                this._logService.info(`[MCP Manager] Server "${name}" restarted successfully`);
        }

        listInstalledServers(): IMCPServerConfig[] {
                return this._registry.getAllServers();
        }

        getConnectionState(name: string): MCPConnectionState {
                return this._pool.getConnectionState(name);
        }

        // ─── Tool Execution ───────────────────────────────────────────────────

        async executeTool(serverName: string, toolName: string, args: Record<string, unknown>, timeoutMs: number = MCP_DEFAULT_TOOL_TIMEOUT_MS): Promise<IMCPToolExecutionResult> {
                const startTime = Date.now();
                this._logService.info(`[MCP Manager] Executing tool "${toolName}" on server "${serverName}" with timeout ${timeoutMs}ms`);

                try {
                        const state = this._pool.getConnectionState(serverName);
                        if (state !== MCPConnectionState.Connected) {
                                throw new Error(`Server "${serverName}" is not connected (state: ${state})`);
                        }

                        const result = await this._pool.executeTool(serverName, toolName, args, timeoutMs);
                        const executionTimeMs = Date.now() - startTime;

                        this._logService.info(`[MCP Manager] Tool "${toolName}" completed in ${executionTimeMs}ms`);

                        return {
                                success: true,
                                data: result,
                                executionTimeMs,
                                toolName,
                                serverName,
                        };
                } catch (error) {
                        const executionTimeMs = Date.now() - startTime;
                        const errorMessage = error instanceof Error ? error.message : String(error);

                        this._logService.error(`[MCP Manager] Tool "${toolName}" failed: ${errorMessage}`);

                        // Classify the error
                        const isTimeout = errorMessage.includes('timed out') || errorMessage.includes('timeout');
                        const isConnection = errorMessage.includes('not connected') || errorMessage.includes('connection');

                        return {
                                success: false,
                                data: null,
                                error: isTimeout ? `TIMEOUT: ${errorMessage}` : isConnection ? `CONNECTION: ${errorMessage}` : `TOOL: ${errorMessage}`,
                                executionTimeMs,
                                toolName,
                                serverName,
                        };
                }
        }

        async listTools(serverName: string): Promise<IMCPTool[]> {
                this._logService.trace(`[MCP Manager] Listing tools for server "${serverName}"`);

                try {
                        const tools = await this._pool.listTools(serverName);
                        return tools as IMCPTool[];
                } catch (error) {
                        this._logService.error(`[MCP Manager] Failed to list tools for "${serverName}": ${error}`);
                        throw error;
                }
        }

        // ─── Resource Access ──────────────────────────────────────────────────

        async readResource(serverName: string, uri: string): Promise<IMCPResourceReadResult> {
                const cacheKey = `${serverName}:${uri}`;
                const cached = this._resourceCache.get(cacheKey);

                // Return from cache if still valid
                if (cached && cached.expiresAt > Date.now()) {
                        this._logService.trace(`[MCP Manager] Resource cache hit: ${uri} on "${serverName}"`);
                        return { ...cached.result, cached: true };
                }

                this._logService.info(`[MCP Manager] Reading resource "${uri}" from server "${serverName}"`);

                try {
                        const result = await this._pool.readResource(serverName, uri) as any;
                        const readResult: IMCPResourceReadResult = {
                                uri,
                                mimeType: result?.mimeType,
                                text: typeof result?.text === 'string' ? result.text : JSON.stringify(result),
                                blob: result?.blob,
                                cached: false,
                                serverName,
                        };

                        // Cache with 5-minute TTL
                        this._resourceCache.set(cacheKey, {
                                result: readResult,
                                expiresAt: Date.now() + MCP_RESOURCE_CACHE_TTL_MS,
                        });

                        return readResult;
                } catch (error) {
                        this._logService.error(`[MCP Manager] Failed to read resource "${uri}" from "${serverName}": ${error}`);
                        throw error;
                }
        }

        async listResources(serverName: string): Promise<IMCPResource[]> {
                this._logService.trace(`[MCP Manager] Listing resources for server "${serverName}"`);

                try {
                        const resources = await this._pool.listResources(serverName);
                        return resources as IMCPResource[];
                } catch (error) {
                        this._logService.error(`[MCP Manager] Failed to list resources for "${serverName}": ${error}`);
                        throw error;
                }
        }

        // ─── Prompts ──────────────────────────────────────────────────────────

        async listPrompts(serverName: string): Promise<IMCPPrompt[]> {
                this._logService.trace(`[MCP Manager] Listing prompts for server "${serverName}"`);

                try {
                        const prompts = await this._pool.listPrompts(serverName);
                        return prompts as IMCPPrompt[];
                } catch (error) {
                        this._logService.error(`[MCP Manager] Failed to list prompts for "${serverName}": ${error}`);
                        throw error;
                }
        }

        // ─── Health Monitoring ────────────────────────────────────────────────

        getServerHealth(name: string): IMCPHealthCheck | undefined {
                return this._pool.getHealth(name);
        }

        // ─── Resource Cache Management ────────────────────────────────────────

        private _clearResourceCacheForServer(serverName: string): void {
                for (const key of this._resourceCache.keys()) {
                        if (key.startsWith(`${serverName}:`)) {
                                this._resourceCache.delete(key);
                        }
                }
        }

        private _cleanResourceCache(): void {
                const now = Date.now();
                let expired = 0;
                for (const [key, entry] of this._resourceCache) {
                        if (entry.expiresAt <= now) {
                                this._resourceCache.delete(key);
                                expired++;
                        }
                }
                if (expired > 0) {
                        this._logService.trace(`[MCP Manager] Cleaned ${expired} expired resource cache entries`);
                }
        }

        // ─── Lifecycle ────────────────────────────────────────────────────────

        override dispose(): void {
                this._cacheCleanupTimer.dispose();
                this._resourceCache.clear();
                this._pool.disconnectAll().catch(() => { });
                super.dispose();
        }
}
