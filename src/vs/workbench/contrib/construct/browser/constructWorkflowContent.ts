/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Workflow Content & Webview Handlers
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { MCPServerCategory } from '../../../../platform/construct/common/mcp/mcpTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Handles postMessage communication between the Construct webview
 * and the MCP server manager / marketplace services.
 */
export class ConstructWorkflowContent extends Disposable {

        private readonly _handlers = new Map<string, (payload: any) => Promise<any>>();

        constructor(
                @IMCPServerManager private readonly _serverManager: IMCPServerManager,
                @IMCPMarketplace private readonly _marketplace: IMCPMarketplace,
                @ILogService private readonly _logService: ILogService,
        ) {
                super();
                this._registerHandlers();
        }

        /**
         * Process an incoming postMessage from the webview.
         * Returns a response object or undefined.
         */
        async handleMessage(message: { type: string; payload?: any }): Promise<any> {
                const handler = this._handlers.get(message.type);
                if (!handler) {
                        this._logService.warn(`[Construct Workflow] Unhandled message type: ${message.type}`);
                        return { error: `Unknown message type: ${message.type}` };
                }

                try {
                        return await handler(message.payload);
                } catch (error) {
                        this._logService.error(`[Construct Workflow] Error handling "${message.type}": ${error}`);
                        return { error: String(error) };
                }
        }

        private _registerHandlers(): void {
                // ─── MCP Server Handlers ───────────────────────────────────────

                this._handlers.set('mcp:listServers', async () => {
                        const servers = this._serverManager.listInstalledServers();
                        const serverStates = servers.map(server => ({
                                config: server,
                                state: this._serverManager.getConnectionState(server.name),
                                health: this._serverManager.getServerHealth(server.name),
                        }));
                        return { servers: serverStates };
                });

                this._handlers.set('mcp:installServer', async (payload: { entryId: string }) => {
                        await this._marketplace.installFromMarketplace(payload.entryId);
                        return { success: true, entryId: payload.entryId };
                });

                this._handlers.set('mcp:executeTool', async (payload: {
                        serverName: string;
                        toolName: string;
                        args: Record<string, unknown>;
                        timeoutMs?: number;
                }) => {
                        const result = await this._serverManager.executeTool(
                                payload.serverName,
                                payload.toolName,
                                payload.args,
                                payload.timeoutMs,
                        );
                        return result;
                });

                this._handlers.set('mcp:getHealth', async (payload: { serverName: string }) => {
                        const health = this._serverManager.getServerHealth(payload.serverName);
                        const state = this._serverManager.getConnectionState(payload.serverName);
                        return { health, state };
                });

                this._handlers.set('mcp:startServer', async (payload: { name: string }) => {
                        await this._serverManager.startServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:stopServer', async (payload: { name: string }) => {
                        await this._serverManager.stopServer(payload.name);
                        return { success: true, name: payload.name };
                });

                // ─── MCP Marketplace Handlers ──────────────────────────────────

                this._handlers.set('mcp:fetchCatalog', async (payload?: { query?: string; category?: string }) => {
                        if (payload?.query) {
                                const results = await this._marketplace.searchCatalog(payload.query);
                                return { entries: results };
                        }
                        if (payload?.category) {
                                const results = await this._marketplace.getServerByCategory(payload.category as MCPServerCategory);
                                return { entries: results };
                        }
                        const catalog = await this._marketplace.fetchCatalog();
                        return { entries: catalog };
                });

                this._handlers.set('mcp:getFeatured', async () => {
                        const featured = await this._marketplace.getFeaturedServers();
                        return { entries: featured };
                });

                this._handlers.set('mcp:rateServer', async (payload: { entryId: string; rating: number }) => {
                        await this._marketplace.rateServer(payload.entryId, payload.rating);
                        return { success: true };
                });

                this._handlers.set('mcp:uninstallServer', async (payload: { name: string }) => {
                        await this._serverManager.uninstallServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:restartServer', async (payload: { name: string }) => {
                        await this._serverManager.restartServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:listTools', async (payload: { serverName: string }) => {
                        const tools = await this._serverManager.listTools(payload.serverName);
                        return { tools };
                });

                this._handlers.set('mcp:listResources', async (payload: { serverName: string }) => {
                        const resources = await this._serverManager.listResources(payload.serverName);
                        return { resources };
                });

                this._handlers.set('mcp:readResource', async (payload: { serverName: string; uri: string }) => {
                        const result = await this._serverManager.readResource(payload.serverName, payload.uri);
                        return result;
                });

                this._handlers.set('mcp:installCustom', async (payload: { config: any }) => {
                        await this._serverManager.installServer(payload.config);
                        return { success: true, name: payload.config.name };
                });
        }

        /**
         * Get the list of all registered handler types (for verification).
         */
        getHandlerTypes(): string[] {
                return [...this._handlers.keys()];
        }
}
