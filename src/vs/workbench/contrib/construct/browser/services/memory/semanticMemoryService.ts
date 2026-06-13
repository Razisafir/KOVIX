// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ISemanticMemoryService } from '../../../../../../platform/construct/common/memory/semanticMemory.js';
import { ISemanticMemoryEntry, IMemorySearchResult, MemoryLayer } from '../../../../../../platform/construct/common/memory/memoryTypes';
import { IEmbeddingService } from '../../../../../../platform/construct/common/memory/embeddingService.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import * as path from '../../../../../../base/common/path.js';

// TODO(v1.1): Replace with Qdrant vector store for proper semantic search
export class SemanticMemoryService extends Disposable implements ISemanticMemoryService {
        readonly _serviceBrand: undefined;

        private entries = new Map<string, ISemanticMemoryEntry[]>();
        private _persistTimeout: ReturnType<typeof setTimeout> | undefined;

        private readonly _onDidStoreKnowledge = this._register(new Emitter<ISemanticMemoryEntry>());
        readonly onDidStoreKnowledge = this._onDidStoreKnowledge.event;

        private readonly _onDidDeleteKnowledge = this._register(new Emitter<{ projectId: string; id: string }>());
        readonly onDidDeleteKnowledge = this._onDidDeleteKnowledge.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IEmbeddingService private readonly embeddingService: IEmbeddingService,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
        ) {
                super();
                this.logService.info('[SemanticMemory] Initialized with in-memory storage');
                this.loadFromDisk();
        }

        async storeKnowledge(entry: Omit<ISemanticMemoryEntry, 'id' | 'layer' | 'timestamp'>): Promise<void> {
                const now = Date.now();
                const id = `semantic-${entry.projectId}-${now}-${Math.random().toString(36).slice(2, 8)}`;

                let embedding = entry.embedding;
                if (!embedding || embedding.length === 0) {
                        embedding = await this.embeddingService.embed(entry.content);
                }

                const fullEntry: ISemanticMemoryEntry = {
                        ...entry,
                        id,
                        layer: MemoryLayer.Semantic,
                        timestamp: now,
                        embedding
                };

                const projectEntries = this.entries.get(entry.projectId) ?? [];
                projectEntries.push(fullEntry);
                this.entries.set(entry.projectId, projectEntries);

                this._onDidStoreKnowledge.fire(fullEntry);
                this.logService.info(`[SemanticMemory] Stored knowledge: ${id}`);

                this.debouncedPersist();
        }

        async searchKnowledge(projectId: string, query: string, topK: number = 5): Promise<IMemorySearchResult> {
                const startTime = Date.now();
                const queryEmbedding = await this.embeddingService.embed(query);

                const projectEntries = this.entries.get(projectId) ?? [];
                const scored = projectEntries.map(entry => ({
                        entry,
                        score: this.cosineSimilarity(queryEmbedding, entry.embedding)
                }));

                scored.sort((a, b) => b.score - a.score);
                const top = scored.slice(0, topK);

                return {
                        entries: top.map(s => ({ ...s.entry, relevanceScore: s.score })),
                        total: top.length,
                        relevanceScores: top.map(s => s.score),
                        queryTimeMs: Date.now() - startTime
                };
        }

        async searchByEmbedding(projectId: string, embedding: number[], topK: number = 5): Promise<IMemorySearchResult> {
                const startTime = Date.now();

                const projectEntries = this.entries.get(projectId) ?? [];
                const scored = projectEntries.map(entry => ({
                        entry,
                        score: this.cosineSimilarity(embedding, entry.embedding)
                }));

                scored.sort((a, b) => b.score - a.score);
                const top = scored.slice(0, topK);

                return {
                        entries: top.map(s => ({ ...s.entry, relevanceScore: s.score })),
                        total: top.length,
                        relevanceScores: top.map(s => s.score),
                        queryTimeMs: Date.now() - startTime
                };
        }

        getKnowledgeByTag(projectId: string, tag: string): ISemanticMemoryEntry[] {
                const entries = this.entries.get(projectId) ?? [];
                return entries.filter(e => e.tags.includes(tag));
        }

        deleteKnowledge(projectId: string, id: string): void {
                const entries = this.entries.get(projectId) ?? [];
                const filtered = entries.filter(e => e.id !== id);
                this.entries.set(projectId, filtered);
                this._onDidDeleteKnowledge.fire({ projectId, id });

                this.debouncedPersist();
        }

        getAllKnowledge(projectId: string): ISemanticMemoryEntry[] {
                return this.entries.get(projectId) ?? [];
        }

        // --- Private Helpers -------------------------------------------------------

        private cosineSimilarity(a: number[], b: number[]): number {
                let dotProduct = 0;
                let normA = 0;
                let normB = 0;

                for (let i = 0; i < a.length; i++) {
                        dotProduct += a[i] * b[i];
                        normA += a[i] * a[i];
                        normB += b[i] * b[i];
                }

                return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
        }

        // --- Disk Persistence -------------------------------------------------------
        // TODO(v1.1): Replace with Qdrant vector store for proper semantic search

        private debouncedPersist(): void {
                if (this._persistTimeout) {
                        clearTimeout(this._persistTimeout);
                }
                this._persistTimeout = setTimeout(() => this.persistToDisk(), 500);
        }

        private async persistToDisk(): Promise<void> {
                try {
                        const data = JSON.stringify(Array.from(this.entries.entries()));
                        const storagePath = this.getStoragePath();
                        await this.fileService.writeFile(storagePath, VSBuffer.fromString(data));
                } catch (e) {
                        this.logService.warn('[SemanticMemory] Failed to persist:', e);
                }
        }

        private async loadFromDisk(): Promise<void> {
                try {
                        const storagePath = this.getStoragePath();
                        const content = await this.fileService.readFile(storagePath);
                        const entries = JSON.parse(content.value.toString());
                        this.entries = new Map(entries);
                } catch (e) {
                        /* first run, no file yet */
                }
        }

        private getStoragePath(): URI {
                const workspace = this.workspaceContextService.getWorkspace();
                const root = workspace.folders[0]?.uri.fsPath || '';
                return URI.file(path.join(root, '.kovix', 'memory', 'semantic', 'store.json'));
        }

        override dispose(): void {
                if (this._persistTimeout) {
                        clearTimeout(this._persistTimeout);
                }
                this.entries.clear();
                super.dispose();
        }
}
