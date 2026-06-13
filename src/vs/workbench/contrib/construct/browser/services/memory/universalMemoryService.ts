// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IUniversalMemoryService } from '../../../../../../platform/construct/common/memory/universalMemoryService.js';
import { IUniversalMemoryEntry, IUniversalMemoryQuery } from '../../../../../../platform/construct/common/memory/universalMemoryTypes.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';

/**
 * Browser-side implementation of IUniversalMemoryService.
 *
 * Uses a JSON file (~/.kovix/universal-memory.json) for storage via IFileService.
 * This works in both browser and electron contexts. The storage is keyed
 * by project ID, and all memories are in a single file for cross-project search.
 *
 * Future improvement: migrate to SQLite via IPC (node layer) for better
 * performance with large memory stores and FTS5 support.
 */
export class UniversalMemoryService extends Disposable implements IUniversalMemoryService {

        declare readonly _serviceBrand: undefined;

        private readonly _storagePath: URI;
        private _cache: IUniversalMemoryEntry[] | null = null;
        private _saveTimeout: ReturnType<typeof setTimeout> | null = null;

        constructor(
                @IFileService private readonly fileService: IFileService,
                @IEnvironmentService private readonly _environmentService: IEnvironmentService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();

                const kovixDir = URI.joinPath((this._environmentService as INativeEnvironmentService).userHome, '.kovix');
                this._storagePath = URI.joinPath(kovixDir, 'universal-memory.json');

                // Ensure directory exists
                this._ensureDir(kovixDir);
        }

        async addMemory(entry: Omit<IUniversalMemoryEntry, 'id' | 'createdAt'>): Promise<IUniversalMemoryEntry> {
                const memories = await this._load();
                const newEntry: IUniversalMemoryEntry = {
                        ...entry,
                        id: crypto.randomUUID(),
                        createdAt: Date.now(),
                };
                memories.push(newEntry);
                await this._save(memories);
                this.logService.info(`[UniversalMemory] Added memory: ${newEntry.type} from ${newEntry.projectName}`);
                return newEntry;
        }

        async searchMemories(query: IUniversalMemoryQuery): Promise<IUniversalMemoryEntry[]> {
                const memories = await this._load();
                const limit = query.limit ?? 10;

                let results = memories;

                // Filter by project if specified
                if (query.projectId) {
                        results = results.filter(m => m.projectId === query.projectId);
                }

                // Filter by type if specified
                if (query.types && query.types.length > 0) {
                        results = results.filter(m => query.types!.includes(m.type));
                }

                // Simple text search (FTS fallback)
                const queryLower = query.query.toLowerCase();
                const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

                if (queryTerms.length > 0) {
                        results = results.map(m => {
                                const contentLower = m.content.toLowerCase();
                                const tagsLower = m.tags.join(' ').toLowerCase();
                                // Combined text used for future full-text search improvements

                                let score = 0;
                                for (const term of queryTerms) {
                                        const contentMatches = (contentLower.match(new RegExp(term, 'g')) ?? []).length;
                                        const tagMatches = (tagsLower.match(new RegExp(term, 'g')) ?? []).length;
                                        score += contentMatches * 2 + tagMatches * 3;
                                }

                                return { ...m, relevanceScore: score };
                        }).filter(m => (m.relevanceScore ?? 0) > 0);
                }

                // Sort by relevance score (descending), then by recency
                results.sort((a, b) => {
                        const scoreDiff = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
                        if (scoreDiff !== 0) { return scoreDiff; }
                        return b.createdAt - a.createdAt;
                });

                return results.slice(0, limit);
        }

        async getProjectMemories(projectId: string): Promise<IUniversalMemoryEntry[]> {
                const memories = await this._load();
                return memories.filter(m => m.projectId === projectId);
        }

        async getContextForTask(taskDescription: string, currentProjectId: string): Promise<string> {
                const results = await this.searchMemories({
                        query: taskDescription,
                        projectId: currentProjectId,
                        limit: 5,
                });

                // Also get cross-project results
                const crossProjectResults = await this.searchMemories({
                        query: taskDescription,
                        limit: 5,
                });

                // Combine and deduplicate
                const seen = new Set<string>();
                const allResults: IUniversalMemoryEntry[] = [];

                for (const r of [...results, ...crossProjectResults]) {
                        if (!seen.has(r.id)) {
                                seen.add(r.id);
                                allResults.push(r);
                        }
                }

                if (allResults.length === 0) {
                        return '';
                }

                const lines = allResults.slice(0, 8).map(r =>
                        `- [${r.type}] (${r.projectName}): ${r.content}`
                );
                return `## Relevant learnings from previous projects:\n${lines.join('\n')}`;
        }

        async deleteMemory(id: string): Promise<void> {
                const memories = await this._load();
                const filtered = memories.filter(m => m.id !== id);
                await this._save(filtered);
        }

        async getMemoryCount(): Promise<number> {
                const memories = await this._load();
                return memories.length;
        }

        async exportMemories(): Promise<string> {
                const memories = await this._load();
                return JSON.stringify({ version: 1, memories }, null, 2);
        }

        private async _load(): Promise<IUniversalMemoryEntry[]> {
                if (this._cache) { return this._cache; }

                try {
                        const exists = await this.fileService.exists(this._storagePath);
                        if (!exists) {
                                this._cache = [];
                                return [];
                        }

                        const content = await this.fileService.readFile(this._storagePath);
                        const data = JSON.parse(content.value.toString());

                        if (data && Array.isArray(data.memories)) {
                                this._cache = data.memories;
                        } else if (Array.isArray(data)) {
                                this._cache = data;
                        } else {
                                this._cache = [];
                        }
                } catch (error) {
                        this.logService.warn('[UniversalMemory] Failed to load, starting fresh:', error instanceof Error ? error.message : String(error));
                        this._cache = [];
                }

                return this._cache ?? [];
        }

        private async _save(memories: IUniversalMemoryEntry[]): Promise<void> {
                this._cache = memories;

                // Debounce saves to avoid excessive writes
                if (this._saveTimeout) {
                        clearTimeout(this._saveTimeout);
                }

                return new Promise((resolve) => {
                        this._saveTimeout = setTimeout(async () => {
                                try {
                                        const data = JSON.stringify({ version: 1, memories });
                                        await this.fileService.writeFile(this._storagePath, VSBuffer.wrap(new TextEncoder().encode(data)));
                                } catch (error) {
                                        this.logService.error('[UniversalMemory] Failed to save:', error instanceof Error ? error.message : String(error));
                                }
                                resolve();
                        }, 500);
                });
        }

        private async _ensureDir(dirUri: URI): Promise<void> {
                try {
                        const exists = await this.fileService.exists(dirUri);
                        if (!exists) {
                                await this.fileService.createFolder(dirUri);
                        }
                } catch {
                        // Directory may already exist from project service
                }
        }

        override dispose(): void {
                if (this._saveTimeout) {
                        clearTimeout(this._saveTimeout);
                }
                super.dispose();
        }
}
