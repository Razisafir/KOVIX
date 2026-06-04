/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import {
        IMemoryQuery,
        IMemorySearchResult,
        IMemoryStats,
        MemoryLayer,
        IMemoryEntry,
        IWorkingMemoryEntry,
        IEpisodicMemoryEntry,
        ISemanticMemoryEntry,
        IProceduralMemoryEntry
} from '../../../../platform/construct/common/memory/memoryTypes.js';
import { IWorkingMemoryService } from '../../../../platform/construct/common/memory/workingMemory.js';
import { IEpisodicMemoryService } from '../../../../platform/construct/common/memory/episodicMemory.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import { IProceduralMemoryService } from '../../../../platform/construct/common/memory/proceduralMemory.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';

const DEFAULT_MAX_TOKENS = 4000;
const TOKEN_PER_CHAR = 0.25;

export class MemoryOrchestratorService extends Disposable implements IMemoryOrchestrator {
        readonly _serviceBrand: undefined;

        private readonly _onDidConsolidate = this._register(new Emitter<{ projectId: string; stats: IMemoryStats }>());
        readonly onDidConsolidate = this._onDidConsolidate.event;

        private readonly _onDidForget = this._register(new Emitter<{ projectId: string }>());
        readonly onDidForget = this._onDidForget.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IWorkingMemoryService private readonly workingMemory: IWorkingMemoryService,
                @IEpisodicMemoryService private readonly episodicMemory: IEpisodicMemoryService,
                @ISemanticMemoryService private readonly semanticMemory: ISemanticMemoryService,
                @IProceduralMemoryService private readonly proceduralMemory: IProceduralMemoryService,
                @IEmbeddingService private readonly embeddingService: IEmbeddingService,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService
        ) {
                super();
                this.logService.info('[MemoryOrchestrator] Initialized with Supermemory integration');
        }

        async query(query: IMemoryQuery): Promise<IMemorySearchResult> {
                const startTime = Date.now();
                const results: IMemoryEntry[] = [];
                const scores: number[] = [];

                const layers = query.layer ? [query.layer] : [MemoryLayer.Working, MemoryLayer.Episodic, MemoryLayer.Semantic, MemoryLayer.Procedural];

                for (const layer of layers) {
                        try {
                                const layerResults = await this.queryLayer(layer, query);
                                results.push(...layerResults.entries);
                                scores.push(...layerResults.relevanceScores);
                        } catch (error) {
                                this.logService.warn(`[MemoryOrchestrator] Layer ${layer} query failed:`, error);
                        }
                }

                const combined = results.map((entry, i) => ({ entry, score: scores[i] ?? 0 }));
                combined.sort((a, b) => b.score - a.score);

                const topK = query.topK ?? 10;
                const filtered = combined.slice(0, topK);

                return {
                        entries: filtered.map(c => c.entry),
                        total: filtered.length,
                        relevanceScores: filtered.map(c => c.score),
                        queryTimeMs: Date.now() - startTime
                };
        }

        private async queryLayer(layer: MemoryLayer, query: IMemoryQuery): Promise<IMemorySearchResult> {
                const projectId = query.projectId;
                if (!projectId) {
                        return { entries: [], total: 0, relevanceScores: [], queryTimeMs: 0 };
                }

                switch (layer) {
                        case MemoryLayer.Working: {
                                const ctx = this.workingMemory.getCurrentContext(projectId);
                                if (!ctx) { return { entries: [], total: 0, relevanceScores: [], queryTimeMs: 0 }; }
                                return {
                                        entries: [{ ...ctx, relevanceScore: 1.0 }],
                                        total: 1,
                                        relevanceScores: [1.0],
                                        queryTimeMs: 0
                                };
                        }

                        case MemoryLayer.Episodic: {
                                if (query.semanticQuery) {
                                        const events = this.episodicMemory.searchEvents(projectId, query.semanticQuery);
                                        return {
                                                entries: events,
                                                total: events.length,
                                                relevanceScores: events.map(() => 0.8),
                                                queryTimeMs: 0
                                        };
                                }

                                if (query.timeRange) {
                                        const events = this.episodicMemory.getEventsByTimeRange(
                                                projectId,
                                                query.timeRange.start,
                                                query.timeRange.end
                                        );
                                        return {
                                                entries: events,
                                                total: events.length,
                                                relevanceScores: events.map(() => 0.7),
                                                queryTimeMs: 0
                                        };
                                }

                                const events = this.episodicMemory.getRecentEvents(projectId, query.topK ?? 10);
                                return {
                                        entries: events,
                                        total: events.length,
                                        relevanceScores: events.map((_, i) => 0.9 - i * 0.05),
                                        queryTimeMs: 0
                                };
                        }

                        case MemoryLayer.Semantic: {
                                if (query.semanticQuery) {
                                        return await this.semanticMemory.searchKnowledge(projectId, query.semanticQuery, query.topK);
                                }

                                if (query.embedding) {
                                        return await this.semanticMemory.searchByEmbedding(projectId, query.embedding, query.topK);
                                }

                                const all = this.semanticMemory.getAllKnowledge(projectId).slice(0, query.topK ?? 10);
                                return {
                                        entries: all,
                                        total: all.length,
                                        relevanceScores: all.map(() => 0.6),
                                        queryTimeMs: 0
                                };
                        }

                        case MemoryLayer.Procedural: {
                                const patterns = query.semanticQuery
                                        ? this.proceduralMemory.getPatternsForContext(projectId, query.semanticQuery)
                                        : this.proceduralMemory.getPatternLeaderboard(projectId);

                                return {
                                        entries: patterns.slice(0, query.topK ?? 10),
                                        total: patterns.length,
                                        relevanceScores: patterns.map(p => (p as IProceduralMemoryEntry).successCount / Math.max((p as IProceduralMemoryEntry).totalAttempts, 1)),
                                        queryTimeMs: 0
                                };
                        }

                        default:
                                return { entries: [], total: 0, relevanceScores: [], queryTimeMs: 0 };
                }
        }

        async consolidate(projectId: string): Promise<void> {
                this.logService.info(`[MemoryOrchestrator] Consolidating memory for ${projectId}...`);

                const now = Date.now();
                const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
                const oldEvents = this.episodicMemory.getEventsByTimeRange(projectId, 0, oneWeekAgo);

                if (oldEvents.length > 0) {
                        const summary = this.summarizeEvents(oldEvents);
                        await this.semanticMemory.storeKnowledge({
                                projectId,
                                content: summary,
                                tags: ['auto-consolidated', 'episodic-summary'],
                                embedding: []
                        });

                        // Sync consolidation summary to Supermemory if enabled
                        if (this.constructMemory.isInitialized && this.constructMemory.config.autoLearn) {
                                await this.constructMemory.addMemory(summary, {
                                        type: 'consolidation',
                                        projectId,
                                        tags: 'auto-consolidated,episodic-summary'
                                });
                        }
                }

                const successfulEvents = oldEvents.filter(e => e.success);
                if (successfulEvents.length > 0) {
                        await this.proceduralMemory.extractPatternsFromEpisodes(
                                projectId,
                                successfulEvents.map(e => `${e.action}: ${e.outcome}`)
                        );
                }

                const ctx = this.workingMemory.getCurrentContext(projectId);
                if (ctx && ctx.tokensUsed > ctx.tokenBudget * 0.8) {
                        this.workingMemory.pruneContext(projectId, ctx.tokenBudget * 0.6);
                }

                const stats = this.getMemoryStats(projectId);
                this._onDidConsolidate.fire({ projectId, stats });

                this.logService.info(`[MemoryOrchestrator] Consolidation complete for ${projectId}`);
        }

        async forget(projectId: string): Promise<void> {
                this.logService.info(`[MemoryOrchestrator] Forgetting all memory for ${projectId}...`);

                this.workingMemory.clearContext(projectId);

                const allKnowledge = this.semanticMemory.getAllKnowledge(projectId);
                for (const k of allKnowledge) {
                        this.semanticMemory.deleteKnowledge(projectId, k.id);
                }

                this._onDidForget.fire({ projectId });
                this.logService.info(`[MemoryOrchestrator] All memory forgotten for ${projectId}`);
        }

        getMemoryStats(projectId: string): IMemoryStats {
                const working = this.workingMemory.getCurrentContext(projectId) ? 1 : 0;
                const episodic = this.episodicMemory.getRecentEvents(projectId, 999999).length;
                const semantic = this.semanticMemory.getAllKnowledge(projectId).length;
                const procedural = this.proceduralMemory.getPatternLeaderboard(projectId).length;

                return {
                        totalEntries: working + episodic + semantic + procedural,
                        entriesByLayer: {
                                [MemoryLayer.Working]: working,
                                [MemoryLayer.Episodic]: episodic,
                                [MemoryLayer.Semantic]: semantic,
                                [MemoryLayer.Procedural]: procedural
                        },
                        storageUsedBytes: 0,
                        lastConsolidation: 0,
                        avgQueryTimeMs: 0
                };
        }

        async injectContextIntoPrompt(prompt: string, projectId: string, maxTokens: number = DEFAULT_MAX_TOKENS): Promise<string> {
                const parts: string[] = [];

                // If Supermemory is enabled and initialized, get persistent context first
                if (this.constructMemory.isInitialized && this.constructMemory.config.enabled) {
                        try {
                                const supermemoryContext = await this.constructMemory.getContextForTask(prompt);
                                if (supermemoryContext) {
                                        parts.push(supermemoryContext);
                                }
                        } catch (error) {
                                this.logService.warn('[MemoryOrchestrator] Supermemory context retrieval failed, falling back to local:', error);
                        }
                }

                // Also get local four-layer context
                const relevantContext = await this.getRelevantContext(projectId, prompt, 5);
                const contextTokens = this.estimateTokens(relevantContext);
                const promptTokens = this.estimateTokens(prompt);
                const existingTokens = this.estimateTokens(parts.join('\n'));
                const availableTokens = maxTokens - promptTokens - existingTokens;

                let injectedContext: string;
                if (contextTokens <= availableTokens) {
                        injectedContext = relevantContext;
                } else if (availableTokens > 0) {
                        const ratio = availableTokens / contextTokens;
                        const charLimit = Math.floor(relevantContext.length * ratio);
                        injectedContext = relevantContext.substring(0, charLimit);
                } else {
                        injectedContext = '';
                }

                if (injectedContext) {
                        parts.push('## Project Context');
                        parts.push(injectedContext);
                }

                parts.push('');
                parts.push('## User Request');
                parts.push(prompt);

                return parts.join('\n');
        }

        async getRelevantContext(projectId: string, query: string, maxResults: number = 5): Promise<string> {
                const queryResult = await this.query({
                        projectId,
                        semanticQuery: query,
                        topK: maxResults,
                        minRelevance: 0.5
                });

                const parts: string[] = [];

                // Working memory (current session)
                const working = queryResult.entries.find(e => e.layer === MemoryLayer.Working) as IWorkingMemoryEntry | undefined;
                if (working) {
                        parts.push('Current Context:');
                        if (working.activeFiles.length > 0) {
                                parts.push(`- Active files: ${working.activeFiles.join(', ')}`);
                        }
                        if (working.conversationHistory.length > 0) {
                                parts.push(`- Recent conversation: ${working.conversationHistory.slice(-3).join('; ')}`);
                        }
                        parts.push('');
                }

                // Episodic (recent actions)
                const episodic = queryResult.entries.filter(e => e.layer === MemoryLayer.Episodic) as IEpisodicMemoryEntry[];
                if (episodic.length > 0) {
                        parts.push('Recent Actions:');
                        for (const e of episodic.slice(0, 3)) {
                                parts.push(`- ${e.action}: ${e.outcome} (${e.success ? 'success' : 'failure'})`);
                        }
                        parts.push('');
                }

                // Semantic (knowledge)
                const semantic = queryResult.entries.filter(e => e.layer === MemoryLayer.Semantic) as ISemanticMemoryEntry[];
                if (semantic.length > 0) {
                        parts.push('Relevant Knowledge:');
                        for (const s of semantic) {
                                parts.push(`- ${s.content.substring(0, 200)}${s.content.length > 200 ? '...' : ''}`);
                        }
                        parts.push('');
                }

                // Procedural (patterns)
                const procedural = queryResult.entries.filter(e => e.layer === MemoryLayer.Procedural) as IProceduralMemoryEntry[];
                if (procedural.length > 0) {
                        parts.push('Known Patterns:');
                        for (const p of procedural.slice(0, 2)) {
                                const successRate = p.totalAttempts > 0 ? (p.successCount / p.totalAttempts * 100).toFixed(0) : '0';
                                parts.push(`- ${p.pattern} (success rate: ${successRate}%, ${p.totalAttempts} attempts)`);
                        }
                        parts.push('');
                }

                return parts.join('\n');
        }

        // --- Private Helpers -------------------------------------------------------

        private summarizeEvents(events: IEpisodicMemoryEntry[]): string {
                const actionTypes = new Map<string, number>();
                const filesTouched = new Set<string>();
                let totalDuration = 0;
                let successes = 0;

                for (const e of events) {
                        actionTypes.set(e.action, (actionTypes.get(e.action) ?? 0) + 1);
                        for (const f of e.filesAffected) { filesTouched.add(f); }
                        totalDuration += e.durationMs;
                        if (e.success) { successes++; }
                }

                const parts: string[] = [];
                parts.push(`Over the past period, ${events.length} actions were performed across ${filesTouched.size} files.`);
                parts.push(`${successes} succeeded, ${events.length - successes} failed.`);
                parts.push(`Total time: ${(totalDuration / 1000).toFixed(0)}s.`);
                parts.push('Common actions: ' + Array.from(actionTypes.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([action, count]) => `${action}(${count})`)
                        .join(', '));

                return parts.join(' ');
        }

        private estimateTokens(text: string): number {
                return Math.ceil(text.length * TOKEN_PER_CHAR);
        }

        override dispose(): void {
                super.dispose();
        }
}
