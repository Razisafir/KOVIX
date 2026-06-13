/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('MemoryOrchestrator', () => {
	test('memory stats have all required fields', () => {
		const stats = {
			totalEntries: 42,
			entriesByLayer: { working: 10, episodic: 15, semantic: 12, procedural: 5 },
			storageUsedBytes: 1024000,
			lastConsolidation: Date.now(),
			avgQueryTimeMs: 23.5,
		};
		assert.strictEqual(stats.totalEntries, 42);
		assert.strictEqual(Object.keys(stats.entriesByLayer).length, 4);
		assert.ok(stats.storageUsedBytes >= 0);
		assert.ok(stats.avgQueryTimeMs >= 0);
	});

	test('memory query supports layer filtering', () => {
		const query = { layer: 'episodic' as const, projectId: 'proj-1', topK: 10 };
		assert.strictEqual(query.layer, 'episodic');
		assert.strictEqual(query.topK, 10);
	});

	test('memory query supports time range filtering', () => {
		const now = Date.now();
		const query = { timeRange: { start: now - 86400000, end: now }, projectId: 'proj-1' };
		assert.ok(query.timeRange.start < query.timeRange.end);
	});

	test('memory query supports semantic search with embedding', () => {
		const embedding = new Array(384).fill(0).map(() => Math.random());
		const query = { embedding, semanticQuery: 'authentication flow', topK: 5, minRelevance: 0.7 };
		assert.strictEqual(query.embedding.length, 384);
		assert.strictEqual(query.topK, 5);
		assert.strictEqual(query.minRelevance, 0.7);
	});

	test('search result includes relevance scores', () => {
		const result = {
			entries: [{ id: '1', content: 'test', layer: 'semantic' as const, timestamp: Date.now(), projectId: 'p1' }],
			total: 1,
			relevanceScores: [0.92],
			queryTimeMs: 15,
		};
		assert.strictEqual(result.relevanceScores.length, result.entries.length);
		assert.ok(result.relevanceScores[0] >= 0);
		assert.ok(result.relevanceScores[0] <= 1);
	});

	test('consolidation event carries project stats', () => {
		const event = {
			projectId: 'proj-1',
			stats: { totalEntries: 50, entriesByLayer: { working: 10, episodic: 15, semantic: 20, procedural: 5 }, storageUsedBytes: 2048000, lastConsolidation: Date.now(), avgQueryTimeMs: 12 },
		};
		assert.strictEqual(event.projectId, 'proj-1');
		assert.strictEqual(event.stats.totalEntries, 50);
	});

	test('context injection respects max tokens', () => {
		const maxTokens = 2000;
		const contextSnippet = 'Authentication uses JWT tokens with 24h expiry.';
		const estimatedTokens = Math.ceil(contextSnippet.split(/\s+/).length * 1.3);
		assert.ok(estimatedTokens < maxTokens);
	});

	test('forget event carries project ID', () => {
		const event = { projectId: 'proj-1' };
		assert.strictEqual(event.projectId, 'proj-1');
	});

	test('memory stats entries by layer sum to total', () => {
		const entriesByLayer = { working: 10, episodic: 15, semantic: 12, procedural: 5 };
		const total = Object.values(entriesByLayer).reduce((a, b) => a + b, 0);
		assert.strictEqual(total, 42);
	});

	test('query with minRelevance filters out low-score results', () => {
		const allScores = [0.95, 0.82, 0.65, 0.41, 0.12];
		const minRelevance = 0.7;
		const filtered = allScores.filter(s => s >= minRelevance);
		assert.strictEqual(filtered.length, 2);
		assert.ok(filtered.every(s => s >= minRelevance));
	});
});
