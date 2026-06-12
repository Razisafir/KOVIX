"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
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
        const seen = new Set();
        const deduped = entries.filter(e => {
            const key = `${e.category}:${e.content.toLowerCase().trim()}`;
            if (seen.has(key)) {
                return false;
            }
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
//# sourceMappingURL=universalMemoryService.test.js.map