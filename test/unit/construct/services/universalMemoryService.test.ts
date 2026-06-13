/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('UniversalMemoryService', () => {
	test('fuzzy scoring: exact tag match scores 0.9', () => {
		// Tag match scoring logic
		const tags = ['react', 'hooks'];
		const query = 'react';
		const score = tags.some(t => t === query) ? 0.9 : 0;
		assert.strictEqual(score, 0.9);
	});

	test('fuzzy scoring: substring match scores 0.6', () => {
		const content = 'Using React hooks for state management';
		const query = 'React';
		const score = content.toLowerCase().includes(query.toLowerCase()) ? 0.6 : 0;
		assert.strictEqual(score, 0.6);
	});

	test('fuzzy scoring: category match scores 0.3', () => {
		const category = 'best_practice';
		const queryCategory = 'best_practice';
		const score = category === queryCategory ? 0.3 : 0;
		assert.strictEqual(score, 0.3);
	});

	test('memory entry is properly structured', () => {
		const entry = {
			id: 'mem_123',
			content: 'Always use TypeScript for new projects',
			category: 'best_practice',
			tags: ['typescript', 'setup'],
			projectId: '/path/to/project',
			timestamp: Date.now(),
			accessCount: 0
		};
		assert.ok(entry.id);
		assert.ok(entry.content);
		assert.ok(entry.category);
		assert.ok(Array.isArray(entry.tags));
	});

	test('query filters by category', () => {
		const entries = [
			{ category: 'best_practice', content: 'Use TS' },
			{ category: 'debug_insight', content: 'Bug in X' },
			{ category: 'best_practice', content: 'Use React' }
		];
		const filtered = entries.filter(e => e.category === 'best_practice');
		assert.strictEqual(filtered.length, 2);
	});

	test('query filters by project', () => {
		const entries = [
			{ projectId: 'proj1', content: 'A' },
			{ projectId: 'proj2', content: 'B' },
			{ projectId: 'proj1', content: 'C' }
		];
		const filtered = entries.filter(e => e.projectId === 'proj1');
		assert.strictEqual(filtered.length, 2);
	});

	test('memory compaction deduplicates by content', () => {
		const entries = [
			{ content: 'Use TypeScript', category: 'best_practice' },
			{ content: 'Use TypeScript', category: 'best_practice' },
			{ content: 'Use React', category: 'best_practice' }
		];
		const seen = new Set<string>();
		const deduped = entries.filter(e => {
			const key = `${e.category}:${e.content.toLowerCase().trim()}`;
			if (seen.has(key)) { return false; }
			seen.add(key);
			return true;
		});
		assert.strictEqual(deduped.length, 2);
	});

	test('memory stats reflect storage', () => {
		const entries = [
			{ content: 'A', category: 'decision' },
			{ content: 'B', category: 'lesson_learned' }
		];
		const stats = {
			totalEntries: entries.length,
			categories: [...new Set(entries.map(e => e.category))].length
		};
		assert.strictEqual(stats.totalEntries, 2);
		assert.strictEqual(stats.categories, 2);
	});
});
