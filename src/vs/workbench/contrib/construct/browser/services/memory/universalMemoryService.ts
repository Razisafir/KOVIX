// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IUniversalMemoryService } from '../../../../../../platform/construct/common/memory/universalMemoryService.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IConstructMemoryService } from '../../../../../../platform/construct/common/memory/constructMemory.js';
import {
        UniversalMemoryCategory,
        IUniversalMemoryEntry,
        IUniversalMemoryQuery,
        IUniversalMemoryStats,
        IUniversalMemoryStore
} from '../../../../../../platform/construct/common/memory/universalMemoryTypes.js';

/**
 * Path to the universal memory storage file relative to the user home directory.
 */
const UNIVERSAL_MEMORY_DIR = '.kovix';
const UNIVERSAL_MEMORY_FILENAME = 'universal-memory.json';

/**
 * Minimum relevance score for a memory to be included in query results.
 */
const DEFAULT_MIN_SCORE = 0.2;

/**
 * Maximum age (in ms) for zero-access entries during compaction (90 days).
 */
const STALE_ENTRY_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Maximum number of context entries returned by getContextForTask.
 */
const DEFAULT_CONTEXT_LIMIT = 8;

/**
 * System prompt used when asking the AI to extract reusable memories from a completed task.
 */
const AUTO_EXTRACT_SYSTEM_PROMPT = `You are a memory extraction engine. Given a task description and its summary, extract reusable facts, patterns, conventions, or error solutions that would help with future tasks.

Respond with a JSON array. Each element must have:
- "content": the fact or pattern (concise, <200 chars)
- "category": one of "preference", "pattern", "convention", "architecture", "tool_usage", "project_context", "error_solution"
- "tags": an array of 1-3 short lowercase tags

If nothing worth remembering, return an empty array: []

Example:
[
  {"content": "User prefers 2-space indentation for TypeScript", "category": "preference", "tags": ["typescript", "indent"]},
  {"content": "Module not found errors often fixed by clearing node_modules and reinstalling", "category": "error_solution", "tags": ["node", "npm"]}
]`;

/**
 * Implementation of IUniversalMemoryService that persists universal,
 * cross-project memory in a local JSON file with optional Supermemory
 * write-through for cloud sync.
 */
export class UniversalMemoryService extends Disposable implements IUniversalMemoryService {
        readonly _serviceBrand: undefined;

        private _cachedStore: IUniversalMemoryStore | null = null;
        private _cacheLoaded = false;

        constructor(
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IConstructMemoryService private readonly memoryService: IConstructMemoryService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[UniversalMemory] Service initialized');
        }

        // --- Public API -----------------------------------------------------------

        async addMemory(content: string, category: string, tags?: string[]): Promise<IUniversalMemoryEntry> {
                const now = Date.now();
                const entry: IUniversalMemoryEntry = {
                        id: generateUuid(),
                        content,
                        category: this.parseCategory(category),
                        tags: tags ?? this.autoTag(content),
                        createdAt: now,
                        lastAccessedAt: now,
                        accessCount: 0,
                };

                const store = await this.loadStore();
                store.entries.push(entry);
                await this.saveStore(store);

                // Optional write-through to Supermemory
                this.writeThroughToSupermemory(entry).catch(err => {
                        this.logService.debug('[UniversalMemory] Supermemory write-through failed (non-critical):', err);
                });

                this.logService.info(`[UniversalMemory] Added entry: ${entry.id} [${entry.category}] "${content.substring(0, 60)}..."`);
                return entry;
        }

        async query(query: IUniversalMemoryQuery): Promise<IUniversalMemoryEntry[]> {
                const store = await this.loadStore();
                let entries = store.entries;

                // Category filter
                if (query.category !== undefined) {
                        entries = entries.filter(e => e.category === query.category);
                }

                // Tag filter — must match at least one tag
                if (query.tags && query.tags.length > 0) {
                        const queryTagsLower = query.tags.map(t => t.toLowerCase());
                        entries = entries.filter(e =>
                                e.tags.some(et => queryTagsLower.includes(et.toLowerCase()))
                        );
                }

                // Text-based fuzzy scoring
                if (query.text) {
                        const textLower = query.text.toLowerCase();
                        const words = textLower.split(/\s+/).filter(w => w.length > 1);

                        for (const entry of entries) {
                                entry.score = this.computeScore(entry, textLower, words);
                        }

                        // Filter by minimum score
                        const minScore = query.minScore ?? DEFAULT_MIN_SCORE;
                        entries = entries.filter(e => (e.score ?? 0) >= minScore);

                        // Sort by score descending
                        entries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
                } else {
                        // No text query — sort by last accessed
                        entries.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
                }

                // Apply limit
                const limit = query.limit ?? 20;
                const results = entries.slice(0, limit);

                // Update access metadata for returned entries
                await this.updateAccessMetadata(results);

                return results;
        }

        async getContextForTask(task: string, limit?: number): Promise<string> {
                const effectiveLimit = limit ?? DEFAULT_CONTEXT_LIMIT;
                const results = await this.query({
                        text: task,
                        limit: effectiveLimit,
                        minScore: 0.25,
                });

                if (results.length === 0) {
                        return '';
                }

                const lines: string[] = ['## Universal Memory (Cross-Project)', ''];

                for (const entry of results) {
                        const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
                        const category = entry.category;
                        lines.push(`- (${category}${tags}) ${entry.content}`);
                }

                lines.push('');
                return lines.join('\n');
        }

        async autoExtractFromTask(task: string, summary: string): Promise<void> {
                if (!this.aiService.activeProvider) {
                        this.logService.debug('[UniversalMemory] Skipping auto-extract — no AI provider available');
                        return;
                }

                try {
                        const userMessage = `Task: ${task}\n\nSummary:\n${summary}`;
                        const messages = [
                                { role: 'system' as const, content: AUTO_EXTRACT_SYSTEM_PROMPT },
                                { role: 'user' as const, content: userMessage },
                        ];

                        let fullResponse = '';
                        const stream = this.aiService.chat(messages, []);
                        for await (const event of stream) {
                                if (event.type === 'token') {
                                        fullResponse += event.text;
                                }
                        }

                        if (!fullResponse.trim()) {
                                this.logService.debug('[UniversalMemory] AI returned empty extraction response');
                                return;
                        }

                        // Parse the JSON array from the response
                        const extracted = this.parseExtractionResponse(fullResponse);

                        for (const item of extracted) {
                                await this.addMemory(item.content, item.category, item.tags);
                        }

                        this.logService.info(`[UniversalMemory] Auto-extracted ${extracted.length} memories from task`);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.warn(`[UniversalMemory] Auto-extract failed (non-critical): ${msg}`);
                }
        }

        async removeMemory(id: string): Promise<void> {
                const store = await this.loadStore();
                const index = store.entries.findIndex(e => e.id === id);
                if (index === -1) {
                        this.logService.warn(`[UniversalMemory] Remove failed — entry not found: ${id}`);
                        return;
                }

                store.entries.splice(index, 1);
                await this.saveStore(store);
                this.logService.info(`[UniversalMemory] Removed entry: ${id}`);
        }

        async getStats(): Promise<IUniversalMemoryStats> {
                const store = await this.loadStore();

                const entriesByCategory = {} as Record<UniversalMemoryCategory, number>;
                for (const cat of Object.values(UniversalMemoryCategory)) {
                        entriesByCategory[cat] = 0;
                }
                for (const entry of store.entries) {
                        entriesByCategory[entry.category]++;
                }

                const sorted = [...store.entries].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
                const recentEntries = sorted.slice(0, 10);

                let storageSizeBytes = 0;
                try {
                        const fs = await this.getFs();
                        const filePath = await this.getStorageFilePath();
                        if (fs && filePath) {
                                const stat = await fs.promises.stat(filePath);
                                storageSizeBytes = stat.size;
                        }
                } catch {
                        // File may not exist yet — that's fine
                }

                return {
                        totalEntries: store.entries.length,
                        entriesByCategory,
                        recentEntries,
                        storageSizeBytes,
                };
        }

        async compact(): Promise<number> {
                const store = await this.loadStore();
                const originalCount = store.entries.length;
                const now = Date.now();

                // Step 1: Remove exact content duplicates (keep the one with higher accessCount)
                const seen = new Map<string, IUniversalMemoryEntry>();
                for (const entry of store.entries) {
                        const key = `${entry.category}:${entry.content.trim().toLowerCase()}`;
                        const existing = seen.get(key);
                        if (!existing || entry.accessCount > existing.accessCount) {
                                seen.set(key, entry);
                        }
                }

                // Step 2: Remove entries with accessCount=0 older than 90 days
                const filtered: IUniversalMemoryEntry[] = [];
                for (const entry of seen.values()) {
                        if (entry.accessCount === 0 && (now - entry.createdAt) > STALE_ENTRY_AGE_MS) {
                                continue; // Drop stale zero-access entry
                        }
                        filtered.push(entry);
                }

                store.entries = filtered;
                await this.saveStore(store);

                const removedCount = originalCount - filtered.length;
                if (removedCount > 0) {
                        this.logService.info(`[UniversalMemory] Compacted: removed ${removedCount} entries (${originalCount} → ${filtered.length})`);
                } else {
                        this.logService.debug('[UniversalMemory] Compacted: no entries removed');
                }

                return removedCount;
        }

        // --- Private: Fuzzy Scoring -----------------------------------------------

        private computeScore(entry: IUniversalMemoryEntry, textLower: string, words: string[]): number {
                let maxScore = 0;

                // Tag exact match: 0.9
                for (const tag of entry.tags) {
                        if (textLower.includes(tag.toLowerCase())) {
                                maxScore = Math.max(maxScore, 0.9);
                                break;
                        }
                }

                // Substring match in content: 0.6
                const contentLower = entry.content.toLowerCase();
                if (contentLower.includes(textLower)) {
                        maxScore = Math.max(maxScore, 0.6);
                } else {
                        // Partial word match bonus: scale by fraction of matching words
                        const matchingWords = words.filter(w => contentLower.includes(w)).length;
                        if (matchingWords > 0 && words.length > 0) {
                                const wordScore = 0.6 * (matchingWords / words.length);
                                maxScore = Math.max(maxScore, wordScore);
                        }
                }

                // Category match: 0.3
                if (textLower.includes(entry.category)) {
                        maxScore = Math.max(maxScore, 0.3);
                }

                return maxScore;
        }

        // --- Private: Storage I/O -------------------------------------------------

        private async loadStore(): Promise<IUniversalMemoryStore> {
                if (this._cacheLoaded && this._cachedStore) {
                        return this._cachedStore;
                }

                try {
                        const fs = await this.getFs();
                        const filePath = await this.getStorageFilePath();

                        if (fs && filePath) {
                                const data = await fs.promises.readFile(filePath, 'utf-8');
                                const parsed = JSON.parse(data) as IUniversalMemoryStore;

                                if (parsed.version === 1 && Array.isArray(parsed.entries)) {
                                        this._cachedStore = parsed;
                                        this._cacheLoaded = true;
                                        return this._cachedStore;
                                }
                        }
                } catch {
                        // File doesn't exist or is corrupt — start fresh
                }

                this._cachedStore = { version: 1, entries: [] };
                this._cacheLoaded = true;
                return this._cachedStore;
        }

        private async saveStore(store: IUniversalMemoryStore): Promise<void> {
                const fs = await this.getFs();
                const filePath = await this.getStorageFilePath();

                if (!fs || !filePath) {
                        this.logService.warn('[UniversalMemory] Cannot save — filesystem not available (likely browser environment)');
                        // Still update the in-memory cache
                        this._cachedStore = store;
                        return;
                }

                // Ensure directory exists
                const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                try {
                        await fs.promises.mkdir(dir, { recursive: true });
                } catch {
                        // Directory may already exist
                }

                // Atomic write: write to temp file, then rename
                const tempPath = filePath + '.tmp';
                const data = JSON.stringify(store, null, '\t');

                await fs.promises.writeFile(tempPath, data, 'utf-8');
                await fs.promises.rename(tempPath, filePath);

                this._cachedStore = store;
        }

        private async getStorageFilePath(): Promise<string | null> {
                try {
                        const os = await import('os');
                        const home = os.homedir();
                        return `${home}/${UNIVERSAL_MEMORY_DIR}/${UNIVERSAL_MEMORY_FILENAME}`;
                } catch {
                        return null;
                }
        }

        private async getFs(): Promise<typeof import('fs') | null> {
                try {
                        return await import('fs');
                } catch {
                        return null;
                }
        }

        // --- Private: Helpers -----------------------------------------------------

        private parseCategory(category: string): UniversalMemoryCategory {
                const normalized = category.toLowerCase().trim();
                if (Object.values(UniversalMemoryCategory).includes(normalized as UniversalMemoryCategory)) {
                        return normalized as UniversalMemoryCategory;
                }
                // Default fallback
                this.logService.debug(`[UniversalMemory] Unknown category "${category}", defaulting to "pattern"`);
                return UniversalMemoryCategory.Pattern;
        }

        private autoTag(content: string): string[] {
                const tags: string[] = [];
                const lower = content.toLowerCase();

                // Extract meaningful words (>4 chars) as auto-tags, up to 3
                const words = lower.match(/\b[a-z]{5,}\b/g) ?? [];
                const stopWords = new Set(['which', 'their', 'about', 'would', 'there', 'these', 'other', 'should', 'could', 'after', 'those', 'being', 'where']);
                const filtered = words.filter(w => !stopWords.has(w));

                // Take the most frequent words
                const freq = new Map<string, number>();
                for (const w of filtered) {
                        freq.set(w, (freq.get(w) ?? 0) + 1);
                }
                const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

                for (const [word] of sorted.slice(0, 3)) {
                        tags.push(word);
                }

                return tags;
        }

        private async updateAccessMetadata(entries: IUniversalMemoryEntry[]): Promise<void> {
                if (entries.length === 0) {
                        return;
                }

                const store = await this.loadStore();
                const now = Date.now();
                const entryIds = new Set(entries.map(e => e.id));

                for (const entry of store.entries) {
                        if (entryIds.has(entry.id)) {
                                (entry as { lastAccessedAt: number }).lastAccessedAt = now;
                                (entry as { accessCount: number }).accessCount++;
                        }
                }

                await this.saveStore(store);
        }

        private parseExtractionResponse(response: string): Array<{ content: string; category: string; tags: string[] }> {
                try {
                        // Try to extract JSON array from the response (may have markdown fences)
                        let jsonStr = response.trim();
                        const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
                        if (fenceMatch) {
                                jsonStr = fenceMatch[1];
                        }

                        const parsed = JSON.parse(jsonStr);
                        if (!Array.isArray(parsed)) {
                                this.logService.warn('[UniversalMemory] Auto-extract response is not an array');
                                return [];
                        }

                        return parsed.filter((item: any) =>
                                typeof item?.content === 'string' &&
                                typeof item?.category === 'string' &&
                                Array.isArray(item?.tags)
                        );
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.warn(`[UniversalMemory] Failed to parse extraction response: ${msg}`);
                        return [];
                }
        }

        private async writeThroughToSupermemory(entry: IUniversalMemoryEntry): Promise<void> {
                if (!this.memoryService.isInitialized) {
                        return;
                }

                try {
                        await this.memoryService.addMemory(
                                `[${entry.category}] ${entry.content}`,
                                {
                                        source: 'universal-memory',
                                        category: entry.category,
                                        tags: entry.tags,
                                        originId: entry.id,
                                }
                        );
                        this.logService.debug(`[UniversalMemory] Write-through to Supermemory: ${entry.id}`);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.debug(`[UniversalMemory] Supermemory write-through failed for ${entry.id}: ${msg}`);
                }
        }

        override dispose(): void {
                this._cachedStore = null;
                this._cacheLoaded = false;
                super.dispose();
        }
}
