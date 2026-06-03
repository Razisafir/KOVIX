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
import { IEnhancedAgentOrchestrator } from '../../../../platform/construct/common/orchestration/agentOrchestrator.js';
import { ISkillsMarketplace } from '../../../../platform/construct/common/skills/skillsMarketplace.js';
import { ISkillsRegistry } from '../../../../platform/construct/common/skills/skillsRegistry.js';
import { IVisualAgentManager } from '../../../../platform/construct/common/visual/visualAgentManager.js';
import { ICodebaseIndexer } from '../../../../platform/construct/common/indexing/codebaseIndexer.js';
import { ITelemetryService } from '../../../../platform/construct/common/telemetry/telemetryService.js';
import { IDataPipeline } from '../../../../platform/construct/common/telemetry/dataPipeline.js';
import { ITimelineService } from '../../../../platform/construct/common/timeline/timelineService.js';
import { ICollaborationService } from '../../../../platform/construct/common/collaboration/collaborationService.js';
import { CollaborationRole } from '../../../../platform/construct/common/collaboration/collaborationTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Handles postMessage communication between the Construct webview
 * and the MCP server manager / marketplace / browser automation / memory services.
 *
 * Registered handler types (55 total):
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
 *   Orchestrator (8): orchestrator:createPlan, orchestrator:execute, orchestrator:pause,
 *     orchestrator:resume, orchestrator:status, orchestrator:setMode,
 *     orchestrator:approveMilestone, orchestrator:cancelAgent
 *   Skills (13): skills:search, skills:categories, skills:featured, skills:category,
 *     skills:install, skills:uninstall, skills:installed, skills:detail,
 *     skills:rate, skills:execute, skills:suggest, skills:register, skills:refresh
 *   Visual (8): visual:create3DScene, visual:addObject, visual:exportScene,
 *     visual:loadFigma, visual:extractStyles, visual:generateComponents,
 *     visual:takePreview, visual:compare
 *   Indexer (10): indexer:search, indexer:structure, indexer:dependencies,
 *     indexer:status, indexer:start, indexer:reindex, indexer:watch,
 *     indexer:stopWatch, indexer:symbolSearch, indexer:crossRef
 *   Telemetry (10): telemetry:getTier, telemetry:setTier, telemetry:getStatus,
 *     telemetry:getBuffer, telemetry:clearBuffer, telemetry:exportData,
 *     telemetry:deleteData, telemetry:getPrivacyReport, telemetry:recordEvent,
 *     telemetry:flush
 *   Timeline (13): timeline:getTimeline, timeline:getMilestones, timeline:getStats,
 *     timeline:getHistory, timeline:export, timeline:zoom, timeline:selectAgent,
 *     timeline:selectMilestone, timeline:approveMilestone, timeline:rejectMilestone,
 *     timeline:skipMilestone, timeline:subscribe, timeline:unsubscribe
 *   Collaboration (12): collab:createSession, collab:joinSession, collab:leaveSession,
 *     collab:endSession, collab:invite, collab:getSession, collab:getMessages,
 *     collab:sendMessage, collab:updateCursor, collab:shareAgent,
 *     collab:getPermissions, collab:setPermission
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
                @IEnhancedAgentOrchestrator private readonly agentOrchestrator: IEnhancedAgentOrchestrator,
                @ISkillsMarketplace private readonly skillsMarketplace: ISkillsMarketplace,
                @ISkillsRegistry private readonly skillsRegistry: ISkillsRegistry,
                @IVisualAgentManager private readonly visualAgentManager: IVisualAgentManager,
                @ICodebaseIndexer private readonly codebaseIndexer: ICodebaseIndexer,
                @ITelemetryService private readonly telemetryService: ITelemetryService,
                @IDataPipeline private readonly dataPipeline: IDataPipeline,
                @ITimelineService private readonly timelineService: ITimelineService,
                @ICollaborationService private readonly collaborationService: ICollaborationService,
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

                // --- Multi-Agent Orchestration Handlers (Phase 20) --------------------

                this._handlers.set('orchestrator:createPlan', async (payload: { goal: string; mode?: string }) => {
                        const mode = payload.mode as any ?? 'milestone';
                        const plan = await this.agentOrchestrator.createExecutionPlan(payload.goal, mode);
                        return { type: 'orchestrator:planCreated', plan };
                });

                this._handlers.set('orchestrator:execute', async (payload: { planId: string }) => {
                        const plan = this.agentOrchestrator.getExecutionStatus(payload.planId);
                        if (plan) {
                                try {
                                        await this.agentOrchestrator.executePlan(plan);
                                        return { type: 'orchestrator:executed', planId: plan.id };
                                } catch (error) {
                                        return { type: 'orchestrator:executed', planId: plan.id, error: error instanceof Error ? error.message : String(error) };
                                }
                        }
                        return { type: 'orchestrator:executed', planId: payload.planId, error: 'Plan not found' };
                });

                this._handlers.set('orchestrator:pause', async (payload: { planId: string }) => {
                        this.agentOrchestrator.pauseExecution(payload.planId);
                        return { type: 'orchestrator:paused', planId: payload.planId };
                });

                this._handlers.set('orchestrator:resume', async (payload: { planId: string }) => {
                        this.agentOrchestrator.resumeExecution(payload.planId);
                        return { type: 'orchestrator:resumed', planId: payload.planId };
                });

                this._handlers.set('orchestrator:status', async (payload: { planId: string }) => {
                        const plan = this.agentOrchestrator.getExecutionStatus(payload.planId);
                        return { type: 'orchestrator:statusResult', plan };
                });

                this._handlers.set('orchestrator:setMode', async (payload: { mode: string }) => {
                        // Mode is set at plan creation time, this acknowledges the setting
                        return { type: 'orchestrator:modeSet', mode: payload.mode };
                });

                this._handlers.set('orchestrator:approveMilestone', async (payload: { planId: string; milestoneId: string }) => {
                        this.agentOrchestrator.approveMilestone(payload.planId, payload.milestoneId);
                        return { type: 'orchestrator:milestoneApproved', milestoneId: payload.milestoneId };
                });

                this._handlers.set('orchestrator:cancelAgent', async (payload: { agentId: string }) => {
                        this.agentOrchestrator.cancelAgent(payload.agentId);
                        return { type: 'orchestrator:agentCancelled', agentId: payload.agentId };
                });

                // --- Skills Marketplace Handlers (Phase 21) --------------------------

                this._handlers.set('skills:search', async (payload: { query: string; category?: string; sortBy?: string; limit?: number; offset?: number }) => {
                        const result = await this.skillsMarketplace.searchCatalog({
                                text: payload.query,
                                category: payload.category as any,
                                sortBy: (payload.sortBy as any) ?? 'relevance',
                                limit: payload.limit ?? 50,
                                offset: payload.offset ?? 0
                        });
                        return { type: 'skills:searchResult', skills: result.skills, total: result.total };
                });

                this._handlers.set('skills:categories', async () => {
                        const categories = await this.skillsMarketplace.getAllCategories();
                        return { type: 'skills:categoriesResult', categories };
                });

                this._handlers.set('skills:featured', async () => {
                        const skills = await this.skillsMarketplace.getFeaturedSkills();
                        return { type: 'skills:featuredResult', skills };
                });

                this._handlers.set('skills:category', async (payload: { category: string }) => {
                        const skills = await this.skillsMarketplace.getSkillsByCategory(payload.category as any);
                        return { type: 'skills:categoryResult', skills };
                });

                this._handlers.set('skills:install', async (payload: { skillId: string }) => {
                        await this.skillsMarketplace.installSkill(payload.skillId);
                        return { type: 'skills:installed', skillId: payload.skillId };
                });

                this._handlers.set('skills:uninstall', async (payload: { skillId: string }) => {
                        await this.skillsMarketplace.uninstallSkill(payload.skillId);
                        return { type: 'skills:uninstalled', skillId: payload.skillId };
                });

                this._handlers.set('skills:installed', async () => {
                        const skills = this.skillsMarketplace.getInstalledSkills();
                        return { type: 'skills:installedResult', skills };
                });

                this._handlers.set('skills:detail', async (payload: { skillId: string }) => {
                        const skill = await this.skillsMarketplace.getSkillById(payload.skillId);
                        return { type: 'skills:detailResult', skill };
                });

                this._handlers.set('skills:rate', async (payload: { skillId: string; rating: number; comment?: string }) => {
                        await this.skillsMarketplace.rateSkill(payload.skillId, payload.rating, payload.comment);
                        return { type: 'skills:rated', skillId: payload.skillId, rating: payload.rating };
                });

                this._handlers.set('skills:execute', async (payload: { skillId: string; variables: Record<string, string>; projectId: string; projectPath: string }) => {
                        try {
                                const result = await this.skillsRegistry.executeSkill(payload.skillId, {
                                        projectId: payload.projectId,
                                        projectPath: payload.projectPath,
                                        variables: payload.variables,
                                        skillId: payload.skillId,
                                        stepIndex: 0,
                                        outputs: {},
                                        errors: [],
                                        startTime: Date.now()
                                });
                                return { type: 'skills:executed', result };
                        } catch (error) {
                                return { type: 'skills:executed', error: error instanceof Error ? error.message : String(error) };
                        }
                });

                this._handlers.set('skills:suggest', async (payload: { projectPath: string }) => {
                        const skills = await this.skillsRegistry.suggestSkillsForProject(payload.projectPath);
                        return { type: 'skills:suggested', skills };
                });

                this._handlers.set('skills:register', async (payload: { skill: any }) => {
                        const validation = this.skillsRegistry.validateSkill(payload.skill);
                        if (validation.valid) {
                                this.skillsRegistry.registerSkill(payload.skill);
                                return { type: 'skills:registered', skillId: payload.skill.id };
                        } else {
                                return { type: 'skills:registered', error: validation.errors.join('; ') };
                        }
                });

                this._handlers.set('skills:refresh', async () => {
                        await this.skillsMarketplace.refreshCatalog();
                        return { type: 'skills:refreshed' };
                });

                // --- Visual / 3D Creation Agent Handlers (Phase 22) --------------------

                this._handlers.set('visual:create3DScene', async (payload: { name: string; projectId?: string }) => {
                        const scene = await this.visualAgentManager.create3DScene(payload.name, payload.projectId);
                        return { type: 'visual:sceneCreated', scene };
                });

                this._handlers.set('visual:addObject', async (payload: { sceneId: string; object: any }) => {
                        await this.visualAgentManager.addObject(payload.sceneId, payload.object);
                        const scene = this.visualAgentManager.getScene(payload.sceneId);
                        return { type: 'visual:objectAdded', scene };
                });

                this._handlers.set('visual:exportScene', async (payload: { sceneId: string; format: 'gltf' | 'obj' | 'fbx' }) => {
                        const result = await this.visualAgentManager.exportScene(payload.sceneId, payload.format ?? 'gltf');
                        return { type: 'visual:sceneExported', result, format: payload.format ?? 'gltf' };
                });

                this._handlers.set('visual:loadFigma', async (payload: { fileId: string }) => {
                        const design = await this.visualAgentManager.loadFigmaDesign(payload.fileId);
                        return { type: 'visual:figmaLoaded', design };
                });

                this._handlers.set('visual:extractStyles', async (payload: { design: any }) => {
                        const styles = await this.visualAgentManager.extractStyles(payload.design);
                        return { type: 'visual:stylesExtracted', styles };
                });

                this._handlers.set('visual:generateComponents', async (payload: { design: any }) => {
                        const filePaths = await this.visualAgentManager.generateReactComponents(payload.design);
                        return { type: 'visual:componentsGenerated', filePaths };
                });

                this._handlers.set('visual:takePreview', async (payload: { sessionId: string }) => {
                        const preview = await this.visualAgentManager.takeVisualPreview(payload.sessionId);
                        return { type: 'visual:previewTaken', preview };
                });

                this._handlers.set('visual:compare', async (payload: { beforeId: string; afterId: string }) => {
                        const diff = await this.visualAgentManager.compareVisuals(payload.beforeId, payload.afterId);
                        return { type: 'visual:compared', diff };
                });

                // --- Codebase Indexing Handlers (Phase 23) ----------------------------

                this._handlers.set('indexer:search', async (payload: { query: string; projectId: string; language?: string; fileType?: string; directory?: string; symbolType?: string; topK?: number; semantic?: boolean }) => {
                        const results = await this.codebaseIndexer.search({
                                query: payload.query,
                                projectId: payload.projectId,
                                language: payload.language,
                                fileType: payload.fileType,
                                directory: payload.directory,
                                symbolType: payload.symbolType as any,
                                topK: payload.topK,
                                semantic: payload.semantic
                        });
                        return { type: 'indexer:searchResult', results };
                });

                this._handlers.set('indexer:structure', async (payload: { filePath: string; projectId: string }) => {
                        const structure = this.codebaseIndexer.getFileStructure(payload.filePath, payload.projectId);
                        return { type: 'indexer:structureResult', structure };
                });

                this._handlers.set('indexer:dependencies', async (payload: { projectId: string }) => {
                        const graph = this.codebaseIndexer.getDependencyGraph(payload.projectId);
                        return { type: 'indexer:dependenciesResult', graph };
                });

                this._handlers.set('indexer:status', async (payload: { projectId: string }) => {
                        const status = this.codebaseIndexer.getIndexStatus(payload.projectId);
                        return { type: 'indexer:statusResult', status };
                });

                this._handlers.set('indexer:start', async (payload: { rootPath: string; projectId: string }) => {
                        await this.codebaseIndexer.indexProject(payload.rootPath, payload.projectId);
                        return { type: 'indexer:started', projectId: payload.projectId };
                });

                this._handlers.set('indexer:reindex', async (payload: { rootPath: string; projectId: string }) => {
                        await this.codebaseIndexer.reindexProject(payload.rootPath, payload.projectId);
                        return { type: 'indexer:reindexed', projectId: payload.projectId };
                });

                this._handlers.set('indexer:watch', async (payload: { projectId: string }) => {
                        this.codebaseIndexer.watchProject(payload.projectId);
                        return { type: 'indexer:watching', projectId: payload.projectId };
                });

                this._handlers.set('indexer:stopWatch', async (payload: { projectId: string }) => {
                        this.codebaseIndexer.stopWatching(payload.projectId);
                        return { type: 'indexer:stopped', projectId: payload.projectId };
                });

                this._handlers.set('indexer:symbolSearch', async (payload: { symbol: string; projectId: string }) => {
                        const results = await this.codebaseIndexer.searchBySymbol(payload.symbol, payload.projectId);
                        return { type: 'indexer:symbolResult', results };
                });

                this._handlers.set('indexer:crossRef', async (payload: { symbol: string; file: string; projectId: string }) => {
                        const results = await this.codebaseIndexer.findReferences(payload.symbol, payload.file, payload.projectId);
                        return { type: 'indexer:crossRefResult', results };
                });

                // --- Telemetry & Data Pipeline Handlers (Phase 24) ----------------------

                this._handlers.set('telemetry:getTier', async () => {
                        const tier = this.telemetryService.getCurrentTier();
                        return { type: 'telemetry:tierResult', tier };
                });

                this._handlers.set('telemetry:setTier', async (payload: { tier: 'free' | 'paid' | 'enterprise' }) => {
                        this.telemetryService.setTier(payload.tier);
                        return { type: 'telemetry:tierSet', tier: payload.tier };
                });

                this._handlers.set('telemetry:getStatus', async () => {
                        const enabled = this.telemetryService.isCollectionEnabled();
                        const eventCount = this.telemetryService.getEventCount();
                        return { type: 'telemetry:statusResult', enabled, eventCount };
                });

                this._handlers.set('telemetry:getBuffer', async () => {
                        const buffer = this.telemetryService.getLocalBuffer();
                        return { type: 'telemetry:bufferResult', events: buffer };
                });

                this._handlers.set('telemetry:clearBuffer', async () => {
                        this.telemetryService.clearBuffer();
                        return { type: 'telemetry:bufferCleared' };
                });

                this._handlers.set('telemetry:exportData', async () => {
                        const data = await this.telemetryService.exportUserData();
                        return { type: 'telemetry:exportResult', data };
                });

                this._handlers.set('telemetry:deleteData', async () => {
                        await this.telemetryService.deleteUserData();
                        return { type: 'telemetry:deleted' };
                });

                this._handlers.set('telemetry:getPrivacyReport', async () => {
                        const report = this.telemetryService.getPrivacyReport();
                        return { type: 'telemetry:privacyReport', report };
                });

                this._handlers.set('telemetry:recordEvent', async (payload: { type: number; data: object }) => {
                        this.telemetryService.recordEvent(payload.type, payload.data);
                        return { type: 'telemetry:eventRecorded' };
                });

                this._handlers.set('telemetry:flush', async () => {
                        await this.telemetryService.flush();
                        return { type: 'telemetry:flushed' };
                });

                // --- Timeline Handlers (Phase 25) -----------------------------------

                this._handlers.set('timeline:getTimeline', async (payload: { planId: string }) => {
                        const entries = this.timelineService.getTimeline(payload.planId);
                        return { type: 'timeline:timelineResult', entries };
                });

                this._handlers.set('timeline:getMilestones', async (payload: { planId: string }) => {
                        const milestones = this.timelineService.getMilestones(payload.planId);
                        return { type: 'timeline:milestonesResult', milestones };
                });

                this._handlers.set('timeline:getStats', async (payload: { planId: string }) => {
                        const stats = this.timelineService.getStats(payload.planId);
                        return { type: 'timeline:statsResult', stats };
                });

                this._handlers.set('timeline:getHistory', async () => {
                        const history = this.timelineService.getHistory();
                        return { type: 'timeline:historyResult', history };
                });

                this._handlers.set('timeline:export', async (payload: { planId: string; format: 'json' | 'csv' | 'png' }) => {
                        const data = await this.timelineService.exportTimeline(payload.planId, payload.format ?? 'json');
                        return { type: 'timeline:exportResult', data, format: payload.format ?? 'json' };
                });

                this._handlers.set('timeline:zoom', async (payload: { planId: string; level: number }) => {
                        this.timelineService.setZoom(payload.planId, payload.level);
                        return { type: 'timeline:zoomSet', planId: payload.planId, level: payload.level };
                });

                this._handlers.set('timeline:selectAgent', async (payload: { agentId: string }) => {
                        this.timelineService.selectAgent(payload.agentId);
                        return { type: 'timeline:agentSelected', agentId: payload.agentId };
                });

                this._handlers.set('timeline:selectMilestone', async (payload: { milestoneId: string }) => {
                        this.timelineService.selectMilestone(payload.milestoneId);
                        return { type: 'timeline:milestoneSelected', milestoneId: payload.milestoneId };
                });

                this._handlers.set('timeline:approveMilestone', async (payload: { milestoneId: string }) => {
                        this.timelineService.updateMilestoneStatus(payload.milestoneId, 2); // MilestoneStatus.Approved
                        return { type: 'timeline:milestoneApproved', milestoneId: payload.milestoneId };
                });

                this._handlers.set('timeline:rejectMilestone', async (payload: { milestoneId: string }) => {
                        this.timelineService.updateMilestoneStatus(payload.milestoneId, 3); // MilestoneStatus.Rejected
                        return { type: 'timeline:milestoneRejected', milestoneId: payload.milestoneId };
                });

                this._handlers.set('timeline:skipMilestone', async (payload: { milestoneId: string }) => {
                        this.timelineService.updateMilestoneStatus(payload.milestoneId, 4); // MilestoneStatus.Skipped
                        return { type: 'timeline:milestoneSkipped', milestoneId: payload.milestoneId };
                });

                this._handlers.set('timeline:subscribe', async (payload: { planId: string }) => {
                        this.timelineService.subscribeToPlan(payload.planId);
                        return { type: 'timeline:subscribed', planId: payload.planId };
                });

                this._handlers.set('timeline:unsubscribe', async (payload: { planId: string }) => {
                        this.timelineService.unsubscribeFromPlan(payload.planId);
                        return { type: 'timeline:unsubscribed', planId: payload.planId };
                });

                // --- Collaboration Handlers (Phase 26) ---------------------------------

                this._handlers.set('collab:createSession', async (payload: { projectPath: string }) => {
                        const session = await this.collaborationService.createSession(payload.projectPath);
                        return { type: 'collab:sessionCreated', session };
                });

                this._handlers.set('collab:joinSession', async (payload: { sessionId: string; userInfo: { name: string; color: string } }) => {
                        const session = await this.collaborationService.joinSession(payload.sessionId, payload.userInfo);
                        return { type: 'collab:sessionJoined', session };
                });

                this._handlers.set('collab:leaveSession', async (payload: { sessionId: string }) => {
                        await this.collaborationService.leaveSession(payload.sessionId);
                        return { type: 'collab:sessionLeft', sessionId: payload.sessionId };
                });

                this._handlers.set('collab:endSession', async (payload: { sessionId: string }) => {
                        await this.collaborationService.endSession(payload.sessionId);
                        return { type: 'collab:sessionEnded', sessionId: payload.sessionId };
                });

                this._handlers.set('collab:invite', async (payload: { sessionId: string; email: string; role: string }) => {
                        const inviteRole = payload.role === 'owner' ? CollaborationRole.Owner : payload.role === 'viewer' ? CollaborationRole.Viewer : CollaborationRole.Editor;
                        await this.collaborationService.inviteUser(payload.sessionId, payload.email, inviteRole);
                        return { type: 'collab:invited', email: payload.email };
                });

                this._handlers.set('collab:getSession', async (payload: { sessionId: string }) => {
                        const session = this.collaborationService.getSession(payload.sessionId);
                        return { type: 'collab:sessionResult', session };
                });

                this._handlers.set('collab:getMessages', async (payload: { sessionId: string; limit?: number }) => {
                        const messages = this.collaborationService.getMessages(payload.sessionId, payload.limit);
                        return { type: 'collab:messagesResult', messages };
                });

                this._handlers.set('collab:sendMessage', async (payload: { sessionId: string; content: string; threadId?: string }) => {
                        this.collaborationService.sendMessage(payload.sessionId, payload.content, payload.threadId);
                        return { type: 'collab:messageSent' };
                });

                this._handlers.set('collab:updateCursor', async (payload: { sessionId: string; position: { file: string; line: number; column: number } }) => {
                        this.collaborationService.updateCursor(payload.sessionId, payload.position);
                        return { type: 'collab:cursorUpdated' };
                });

                this._handlers.set('collab:shareAgent', async (payload: { sessionId: string; agentId: string; userIds?: string[] }) => {
                        this.collaborationService.shareAgent(payload.sessionId, payload.agentId, payload.userIds);
                        return { type: 'collab:agentShared', agentId: payload.agentId };
                });

                this._handlers.set('collab:getPermissions', async (payload: { sessionId: string }) => {
                        const permissions = this.collaborationService.getPermissions(payload.sessionId);
                        return { type: 'collab:permissionsResult', permissions };
                });

                this._handlers.set('collab:setPermission', async (payload: { sessionId: string; userId: string; role: string }) => {
                        const permRole = payload.role === 'owner' ? CollaborationRole.Owner : payload.role === 'viewer' ? CollaborationRole.Viewer : CollaborationRole.Editor;
                        this.collaborationService.setPermission(payload.sessionId, payload.userId, permRole);
                        return { type: 'collab:permissionSet', userId: payload.userId, role: payload.role };
                });
        }

        /**
         * Get the list of all registered handler types (for verification).
         */
        getHandlerTypes(): string[] {
                return [...this._handlers.keys()];
        }
}
