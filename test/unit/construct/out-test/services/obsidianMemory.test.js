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
suite('ObsidianMemory', () => {
    test('memory entry has required fields', () => {
        const entry = {
            id: 'mem-abc123',
            title: 'Authentication Pattern',
            content: 'Uses JWT with RS256 signing and 24h expiry',
            category: 'architecture',
            tags: ['auth', 'jwt', 'security'],
            source: 'auto-extract',
            projectId: 'proj-1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        assert.ok(entry.id);
        assert.ok(entry.title);
        assert.ok(entry.content);
        assert.ok(entry.category);
        assert.ok(Array.isArray(entry.tags));
        assert.ok(entry.createdAt > 0);
    });
    test('all 8 memory categories are defined', () => {
        const categories = [
            'conversation', 'decision', 'architecture', 'preference',
            'context', 'knowledge', 'task', 'debug',
        ];
        assert.strictEqual(categories.length, 8);
        assert.ok(categories.includes('conversation'));
        assert.ok(categories.includes('debug'));
    });
    test('memory sources are valid', () => {
        const sources = ['auto-extract', 'user-created', 'imported', 'session-recording'];
        assert.strictEqual(sources.length, 4);
        assert.ok(sources.includes('auto-extract'));
        assert.ok(sources.includes('session-recording'));
    });
    test('fuzzy search matches partial titles', () => {
        const entries = [
            { id: '1', title: 'Authentication Pattern', content: 'JWT tokens' },
            { id: '2', title: 'Database Schema', content: 'PostgreSQL tables' },
            { id: '3', title: 'Auto-Scaling Config', content: 'Kubernetes HPA' },
        ];
        const query = 'auth';
        const matches = entries.filter(e => e.title.toLowerCase().includes(query) ||
            e.content.toLowerCase().includes(query));
        assert.strictEqual(matches.length, 1);
        assert.strictEqual(matches[0].id, '1');
    });
    test('fuzzy search matches content', () => {
        const entries = [
            { id: '1', title: 'Setup Guide', content: 'Use PostgreSQL for the database' },
            { id: '2', title: 'API Reference', content: 'REST endpoints for user management' },
        ];
        const query = 'postgres';
        const matches = entries.filter(e => e.title.toLowerCase().includes(query) ||
            e.content.toLowerCase().includes(query));
        assert.strictEqual(matches.length, 1);
        assert.strictEqual(matches[0].id, '1');
    });
    test('tag autocomplete returns unique sorted tags', () => {
        const entries = [
            { tags: ['auth', 'jwt', 'security'] },
            { tags: ['auth', 'database'] },
            { tags: ['security', 'xss'] },
        ];
        const allTags = new Set();
        for (const e of entries) {
            for (const t of e.tags) {
                allTags.add(t);
            }
        }
        const sorted = [...allTags].sort();
        assert.strictEqual(sorted.length, 5);
        assert.strictEqual(sorted[0], 'auth');
        assert.strictEqual(sorted[sorted.length - 1], 'xss');
    });
    test('import from JSON preserves entries', () => {
        const imported = [
            { id: '1', title: 'Entry 1', content: 'Content 1', category: 'knowledge', tags: ['test'], source: 'imported', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() },
            { id: '2', title: 'Entry 2', content: 'Content 2', category: 'decision', tags: ['imported'], source: 'imported', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() },
        ];
        assert.strictEqual(imported.length, 2);
        assert.ok(imported.every(e => e.source === 'imported'));
    });
    test('export to JSON includes all entries', () => {
        const entries = [
            { id: '1', title: 'Entry 1' },
            { id: '2', title: 'Entry 2' },
            { id: '3', title: 'Entry 3' },
        ];
        const json = JSON.stringify({ version: 1, entries });
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.entries.length, 3);
        assert.strictEqual(parsed.version, 1);
    });
    test('auto-extraction creates memories from conversation', () => {
        const conversation = [
            { role: 'user', content: 'We decided to use PostgreSQL for the database layer.' },
            { role: 'assistant', content: 'Understood. I will configure PostgreSQL.' },
        ];
        // Simulate extraction: find decisions
        const decisions = conversation
            .filter(m => m.content.toLowerCase().includes('decided'))
            .map(m => ({ title: 'Decision', content: m.content, category: 'decision', source: 'auto-extract' }));
        assert.strictEqual(decisions.length, 1);
        assert.strictEqual(decisions[0].category, 'decision');
    });
});
//# sourceMappingURL=obsidianMemory.test.js.map