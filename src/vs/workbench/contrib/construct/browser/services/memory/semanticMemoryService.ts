/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import { ISemanticMemoryEntry, IMemorySearchResult, MemoryLayer } from '../../../../platform/construct/common/memory/memoryTypes.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';

const COLLECTION_PREFIX = 'construct_memory_';

export class SemanticMemoryService extends Disposable implements ISemanticMemoryService {
	readonly _serviceBrand: undefined;

	private entries = new Map<string, ISemanticMemoryEntry[]>();

	private readonly _onDidStoreKnowledge = this._register(new Emitter<ISemanticMemoryEntry>());
	readonly onDidStoreKnowledge = this._onDidStoreKnowledge.event;

	private readonly _onDidDeleteKnowledge = this._register(new Emitter<{ projectId: string; id: string }>());
	readonly onDidDeleteKnowledge = this._onDidDeleteKnowledge.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEmbeddingService private readonly embeddingService: IEmbeddingService
	) {
		super();
		this.logService.info('[SemanticMemory] Initialized with in-memory storage');
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

	override dispose(): void {
		this.entries.clear();
		super.dispose();
	}
}
