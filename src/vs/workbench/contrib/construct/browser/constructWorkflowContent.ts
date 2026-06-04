/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { IBrowserAutomationService } from '../../../../platform/construct/common/mcp/browserAutomation.js';
import { IWorkingMemoryService } from '../../../../platform/construct/common/memory/workingMemory.js';
import { IEpisodicMemoryService } from '../../../../platform/construct/common/memory/episodicMemory.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import { IProceduralMemoryService } from '../../../../platform/construct/common/memory/proceduralMemory.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Handles postMessage communication between the Construct webview
 * and the MCP server manager / marketplace / browser automation / memory services.
 *
 * Registered handler types (41 total):
 *   MCP (17): mcp:listServers, mcp:installServer, mcp:executeTool, mcp:getHealth,
 *     mcp:startServer, mcp:stopServer, mcp:fetchCatalog, mcp:getFeatured,
 *     mcp:rateServer, mcp:uninstallServer, mcp:restartServer, mcp:listTools,
 *     mcp:listResources, mcp:readResource, mcp:installCustom,
 *     mcp:marketplace:search, mcp:marketplace:categories
 *   Browser (10): browser:createSession, browser:navigate, browser:screenshot,
 *     browser:getTree, browser:getSessions, browser:closeSession, browser:click,
 *     browser:fill, browser:evaluate, browser:compare, browser:getContext
 *   Memory (7): memory:search, memory:stats, memory:consolidate, memory:forget,
 *     memory:injectContext, memory:recordEvent, memory:storeKnowledge
 *   Supermemory (7): supermemory:initialize, supermemory:disconnect,
 *     supermemory:addMemory, supermemory:getProfile, supermemory:search,
 *     supermemory:getContext, supermemory:testConnection
 */
export class ConstructWorkflowContent extends Disposable {

        private readonly _handlers = new Map<string, (payload: any) => Promise<any>>();

        constructor(
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager,
                @IMCPMarketplace private readonly mcpMarketplace: IMCPMarketplace,
                @IBrowserAutomationService private readonly browserService: IBrowserAutomationService,
                @IWorkingMemoryService private readonly workingMemory: IWorkingMemoryService,
                @IEpisodicMemoryService private readonly episodicMemory: IEpisodicMemoryService,
                @ISemanticMemoryService private readonly semanticMemory: ISemanticMemoryService,
                @IProceduralMemoryService private readonly proceduralMemory: IProceduralMemoryService,
                @IMemoryOrchestrator private readonly memoryOrchestrator: IMemoryOrchestrator,
                @IEmbeddingService private readonly embeddingService: IEmbeddingService,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
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

                // --- Memory Architecture Handlers (Phase 19) --------------------

                this._handlers.set('memory:search', async (payload: { projectId: string; query: string; layer?: string; topK?: number }) => {
                        const result = await this.memoryOrchestrator.query({
                                projectId: payload.projectId,
                                semanticQuery: payload.query,
                                topK: payload.topK ?? 5
                        });
                        return { type: 'memory:searchResult', result };
                });

                this._handlers.set('memory:stats', async (payload: { projectId: string }) => {
                        const stats = this.memoryOrchestrator.getMemoryStats(payload.projectId);
                        return { type: 'memory:statsResult', stats };
                });

                this._handlers.set('memory:consolidate', async (payload: { projectId: string }) => {
                        await this.memoryOrchestrator.consolidate(payload.projectId);
                        const stats = this.memoryOrchestrator.getMemoryStats(payload.projectId);
                        return { type: 'memory:consolidated', stats };
                });

                this._handlers.set('memory:forget', async (payload: { projectId: string }) => {
                        await this.memoryOrchestrator.forget(payload.projectId);
                        return { type: 'memory:forgotten', projectId: payload.projectId };
                });

                this._handlers.set('memory:injectContext', async (payload: { prompt: string; projectId: string; maxTokens?: number }) => {
                        const enrichedPrompt = await this.memoryOrchestrator.injectContextIntoPrompt(
                                payload.prompt,
                                payload.projectId,
                                payload.maxTokens
                        );
                        return { type: 'memory:contextInjected', prompt: enrichedPrompt };
                });

                this._handlers.set('memory:recordEvent', async (payload: { projectId: string; action: string; outcome: string; durationMs?: number; filesAffected?: string[]; success?: boolean; agentType?: string; taskId?: string; content?: string }) => {
                        this.episodicMemory.recordEvent({
                                projectId: payload.projectId,
                                action: payload.action,
                                outcome: payload.outcome,
                                durationMs: payload.durationMs ?? 0,
                                filesAffected: payload.filesAffected ?? [],
                                success: payload.success ?? true,
                                agentType: payload.agentType,
                                taskId: payload.taskId,
                                content: payload.content ?? ''
                        });
                        return { type: 'memory:eventRecorded' };
                });

                this._handlers.set('memory:storeKnowledge', async (payload: { projectId: string; content: string; tags?: string[]; sourceFile?: string; sourceLine?: number; chunkType?: string }) => {
                        await this.semanticMemory.storeKnowledge({
                                projectId: payload.projectId,
                                content: payload.content,
                                tags: payload.tags ?? [],
                                sourceFile: payload.sourceFile,
                                sourceLine: payload.sourceLine,
                                chunkType: payload.chunkType as any,
                                embedding: []
                        });
                        return { type: 'memory:knowledgeStored' };
                });

                // --- Supermemory Handlers (Phase 19+) ---------------------------

                this._handlers.set('supermemory:initialize', async (payload: { apiKey: string }) => {
                        try {
                                await this.constructMemory.initialize(payload.apiKey);
                                return { type: 'supermemory:initialized', success: true, isInitialized: this.constructMemory.isInitialized };
                        } catch (error) {
                                return {
                                        type: 'supermemory:initialized',
                                        success: false,
                                        error: error instanceof Error ? error.message : String(error)
                                };
                        }
                });

                this._handlers.set('supermemory:disconnect', async () => {
                        this.constructMemory.disconnect();
                        return { type: 'supermemory:disconnected', isInitialized: this.constructMemory.isInitialized };
                });

                this._handlers.set('supermemory:addMemory', async (payload: { content: string; metadata?: Record<string, string | number | boolean | string[]> }) => {
                        await this.constructMemory.addMemory(payload.content, payload.metadata);
                        return { type: 'supermemory:memoryAdded', success: true };
                });

                this._handlers.set('supermemory:getProfile', async (payload?: { query?: string }) => {
                        const profile = await this.constructMemory.getProfile(payload?.query);
                        return { type: 'supermemory:profile', profile };
                });

                this._handlers.set('supermemory:search', async (payload: { query: string; searchMode?: 'memories' | 'hybrid' | 'documents'; limit?: number }) => {
                        const results = await this.constructMemory.searchMemories(
                                payload.query,
                                payload.searchMode,
                                payload.limit
                        );
                        return { type: 'supermemory:searchResults', results };
                });

                this._handlers.set('supermemory:getContext', async (payload: { task: string }) => {
                        const context = await this.constructMemory.getContextForTask(payload.task);
                        return { type: 'supermemory:contextResult', context };
                });

                this._handlers.set('supermemory:testConnection', async () => {
                        const healthy = await this.constructMemory.testConnection();
                        return { type: 'supermemory:connectionTest', healthy, isInitialized: this.constructMemory.isInitialized };
                });
        }

        /**
         * Get the list of all registered handler types (for verification).
         */
        getHandlerTypes(): string[] {
                return [...this._handlers.keys()];
        }
}
