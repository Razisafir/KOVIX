/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { IBrowserAutomationService } from '../../../../platform/construct/common/mcp/browserAutomation.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Handles postMessage communication between the Construct webview
 * and the MCP server manager / marketplace / browser automation services.
 *
 * Registered handler types (27 total):
 *   MCP (17): mcp:listServers, mcp:installServer, mcp:executeTool, mcp:getHealth,
 *     mcp:startServer, mcp:stopServer, mcp:fetchCatalog, mcp:getFeatured,
 *     mcp:rateServer, mcp:uninstallServer, mcp:restartServer, mcp:listTools,
 *     mcp:listResources, mcp:readResource, mcp:installCustom,
 *     mcp:marketplace:search, mcp:marketplace:categories
 *   Browser (10): browser:createSession, browser:navigate, browser:screenshot,
 *     browser:getTree, browser:getSessions, browser:closeSession, browser:click,
 *     browser:fill, browser:evaluate, browser:compare, browser:getContext
 */
export class ConstructWorkflowContent extends Disposable {

        private readonly _handlers = new Map<string, (payload: any) => Promise<any>>();

        constructor(
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager,
                @IMCPMarketplace private readonly mcpMarketplace: IMCPMarketplace,
                @IBrowserAutomationService private readonly browserService: IBrowserAutomationService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this._registerHandlers();
        }

        /**
         * Process an incoming postMessage from the webview.
         */
        async handleMessage(message: { type: string; payload?: any }): Promise<any> {
                const handler = this._handlers.get(message.type);
                if (!handler) {
                        this.logService.warn(`[Construct Workflow] Unhandled message type: ${message.type}`);
                        return { error: `Unknown message type: ${message.type}` };
                }

                try {
                        return await handler(message.payload);
                } catch (error) {
                        this.logService.error(`[Construct Workflow] Error handling "${message.type}": ${error}`);
                        return { error: error instanceof Error ? error.message : String(error) };
                }
        }

        private _registerHandlers(): void {
                // --- MCP Server Handlers ---------------------------------------

                this._handlers.set('mcp:listServers', async () => {
                        const servers = this.mcpServerManager.listInstalledServers();
                        const serverStates = servers.map(server => ({
                                config: server,
                                status: this.mcpServerManager.getServerStatus(server.name),
                                health: this.mcpServerManager.getServerHealth(server.name)
                        }));
                        return { type: 'mcp:servers', data: serverStates };
                });

                this._handlers.set('mcp:installServer', async (payload: { itemId: string }) => {
                        try {
                                await this.mcpMarketplace.installFromMarketplace(payload.itemId);
                                return { type: 'mcp:installed', success: true, itemId: payload.itemId };
                        } catch (error) {
                                return {
                                        type: 'mcp:installed',
                                        success: false,
                                        error: error instanceof Error ? error.message : String(error)
                                };
                        }
                });

                this._handlers.set('mcp:executeTool', async (payload: {
                        serverName: string;
                        toolName: string;
                        args: any;
                }) => {
                        try {
                                const result = await this.mcpServerManager.executeTool(
                                        payload.serverName,
                                        payload.toolName,
                                        payload.args
                                );
                                return { type: 'mcp:toolResult', result };
                        } catch (error) {
                                return {
                                        type: 'mcp:toolResult',
                                        result: {
                                                success: false,
                                                error: error instanceof Error ? error.message : String(error)
                                        }
                                };
                        }
                });

                this._handlers.set('mcp:getHealth', async (payload: { serverName: string }) => {
                        const health = this.mcpServerManager.getServerHealth(payload.serverName);
                        const status = this.mcpServerManager.getServerStatus(payload.serverName);
                        return { type: 'mcp:health', health, status };
                });

                this._handlers.set('mcp:startServer', async (payload: { name: string }) => {
                        await this.mcpServerManager.startServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:stopServer', async (payload: { name: string }) => {
                        await this.mcpServerManager.stopServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:uninstallServer', async (payload: { name: string }) => {
                        await this.mcpServerManager.uninstallServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:restartServer', async (payload: { name: string }) => {
                        await this.mcpServerManager.restartServer(payload.name);
                        return { success: true, name: payload.name };
                });

                this._handlers.set('mcp:listTools', async (payload: { serverName?: string }) => {
                        const tools = await this.mcpServerManager.listTools(payload.serverName);
                        return { tools };
                });

                this._handlers.set('mcp:listResources', async (payload: { serverName?: string }) => {
                        const resources = await this.mcpServerManager.listResources(payload.serverName);
                        return { resources };
                });

                this._handlers.set('mcp:readResource', async (payload: { serverName: string; uri: string }) => {
                        const result = await this.mcpServerManager.readResource(payload.serverName, payload.uri);
                        return result;
                });

                this._handlers.set('mcp:installCustom', async (payload: { config: any }) => {
                        await this.mcpServerManager.installServer(payload.config);
                        return { success: true, name: payload.config.name };
                });

                // --- MCP Marketplace Handlers ----------------------------------

                this._handlers.set('mcp:fetchCatalog', async (payload?: { query?: string; category?: string }) => {
                        if (payload?.query) {
                                const results = await this.mcpMarketplace.searchCatalog(payload.query);
                                return { type: 'mcp:marketplace:results', results };
                        }
                        const catalog = await this.mcpMarketplace.fetchCatalog();
                        return { type: 'mcp:marketplace:catalog', entries: catalog };
                });

                this._handlers.set('mcp:getFeatured', async () => {
                        const featured = await this.mcpMarketplace.getFeaturedServers();
                        return { entries: featured };
                });

                this._handlers.set('mcp:rateServer', async (payload: { itemId: string; rating: number }) => {
                        await this.mcpMarketplace.rateServer(payload.itemId, payload.rating);
                        return { success: true };
                });

                this._handlers.set('mcp:marketplace:search', async (payload: { query: string }) => {
                        const results = await this.mcpMarketplace.searchCatalog(payload.query);
                        return { type: 'mcp:marketplace:results', results };
                });

                this._handlers.set('mcp:marketplace:categories', async () => {
                        const categories = await this.mcpMarketplace.getAllCategories();
                        return { type: 'mcp:marketplace:categories', categories };
                });

                // --- Browser Automation Handlers (Phase 18) -------------------

                this._handlers.set('browser:createSession', async (payload?: { url?: string; viewport?: { width: number; height: number } }) => {
                        const session = await this.browserService.createSession(payload?.url, payload?.viewport);
                        return { type: 'browser:sessionCreated', session };
                });

                this._handlers.set('browser:navigate', async (payload: { sessionId: string; url: string }) => {
                        await this.browserService.navigate(payload.sessionId, payload.url);
                        return { type: 'browser:navigated', success: true };
                });

                this._handlers.set('browser:screenshot', async (payload: { sessionId: string; fullPage?: boolean }) => {
                        const screenshot = await this.browserService.screenshot(payload.sessionId, payload.fullPage);
                        return { type: 'browser:screenshotResult', screenshot };
                });

                this._handlers.set('browser:getTree', async (payload: { sessionId: string }) => {
                        const tree = await this.browserService.getAccessibilityTree(payload.sessionId);
                        return { type: 'browser:treeResult', tree };
                });

                this._handlers.set('browser:getSessions', async () => {
                        const sessions = this.browserService.getAllSessions();
                        return { type: 'browser:sessions', sessions };
                });

                this._handlers.set('browser:closeSession', async (payload: { sessionId: string }) => {
                        await this.browserService.closeSession(payload.sessionId);
                        return { type: 'browser:sessionClosed', sessionId: payload.sessionId };
                });

                this._handlers.set('browser:click', async (payload: { sessionId: string; selector: string }) => {
                        await this.browserService.click(payload.sessionId, payload.selector);
                        return { type: 'browser:clicked', success: true };
                });

                this._handlers.set('browser:fill', async (payload: { sessionId: string; selector: string; value: string }) => {
                        await this.browserService.fill(payload.sessionId, payload.selector, payload.value);
                        return { type: 'browser:filled', success: true };
                });

                this._handlers.set('browser:evaluate', async (payload: { sessionId: string; script: string }) => {
                        const result = await this.browserService.evaluate(payload.sessionId, payload.script);
                        return { type: 'browser:evaluated', result };
                });

                this._handlers.set('browser:compare', async (payload: { sessionId: string }) => {
                        const diff = await this.browserService.compareWithPrevious(payload.sessionId);
                        return { type: 'browser:diffResult', diff };
                });

                this._handlers.set('browser:getContext', async (payload: { sessionId: string }) => {
                        const context = await this.browserService.getContextForAgent(payload.sessionId);
                        return { type: 'browser:contextResult', context };
                });
        }

        /**
         * Get the list of all registered handler types (for verification).
         */
        getHandlerTypes(): string[] {
                return [...this._handlers.keys()];
        }
}
