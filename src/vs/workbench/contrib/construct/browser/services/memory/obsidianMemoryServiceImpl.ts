/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { IObsidianMemoryService } from '../../../../../../platform/construct/common/memory/obsidianMemoryService.js';
import {
	IObsidianMemoryEntry,
	IObsidianMemoryQuery,
	IObsidianMemoryStats,
	IObsidianMemoryStore,
	MemoryCategory,
	MemorySource,
	MEMORY_CATEGORIES,
	MEMORY_STORE_FILE,
	MEMORY_STORE_VERSION,
} from '../../../../../../platform/construct/common/memory/obsidianMemoryTypes.js';

/**
 * Directory relative to home for KOVIX data.
 */
const KOVIX_DIR = '.kovix';

/**
 * System prompt used when asking the AI to extract memories from conversation turns.
 */
const AUTO_EXTRACT_SYSTEM_PROMPT = `You are a memory extraction engine. Given a series of conversation turns between a user and an AI assistant, extract key facts, decisions, preferences, people, projects, or learnings that would be valuable to remember for future interactions.

Respond with a JSON array. Each element must have:
- "title": a short descriptive title (<=80 chars)
- "content": the fact or detail (concise, <300 chars)
- "category": one of "person", "project", "preference", "decision", "context", "learning", "reference", "conversation"
- "tags": an array of 1-5 short lowercase tags

If nothing worth remembering, return an empty array: []

Example:
[
  {"title": "John - Project Manager", "content": "John is the project manager for the KOVIX IDE project. He prefers weekly status updates via email.", "category": "person", "tags": ["john", "manager", "kovix"]},
  {"title": "User prefers TypeScript", "content": "User strongly prefers TypeScript over JavaScript for all projects", "category": "preference", "tags": ["typescript", "language", "preference"]}
]`;

/**
 * Buffered conversation turn for auto-extraction.
 */
interface IBufferedTurn {
	readonly role: 'user' | 'assistant';
	readonly content: string;
	readonly timestamp: number;
}

/**
 * Implementation of IObsidianMemoryService that persists Obsidian-like
 * memories in a local JSON file (~/.kovix/obsidian-memory.json).
 */
export class ObsidianMemoryServiceImpl extends Disposable implements IObsidianMemoryService {
	readonly _serviceBrand: undefined;

	// --- Events ---
	private readonly _onDidAddMemory = this._register(new Emitter<IObsidianMemoryEntry>());
	readonly onDidAddMemory = this._onDidAddMemory.event;
	private readonly _onDidUpdateMemory = this._register(new Emitter<IObsidianMemoryEntry>());
	readonly onDidUpdateMemory = this._onDidUpdateMemory.event;
	private readonly _onDidDeleteMemory = this._register(new Emitter<string>());
	readonly onDidDeleteMemory = this._onDidDeleteMemory.event;
	private readonly _onDidImportMemories = this._register(new Emitter<number>());
	readonly onDidImportMemories = this._onDidImportMemories.event;
	private readonly _onDidExportMemories = this._register(new Emitter<string>());
	readonly onDidExportMemories = this._onDidExportMemories.event;

	// --- State ---
	private _cachedStore: IObsidianMemoryStore | null = null;
	private _cacheLoaded = false;

	/** Conversation turn buffer per session. */
	private readonly _conversationBuffer = new Map<string, IBufferedTurn[]>();

	constructor(
		@IConstructAIService private readonly aiService: IConstructAIService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[ObsidianMemory] Service initialized');
	}

	// --- CRUD Operations -------------------------------------------------------

	async addMemory(
		title: string,
		content: string,
		category: MemoryCategory,
		tags?: string[],
		source?: MemorySource,
	): Promise<IObsidianMemoryEntry> {
		const now = Date.now();
		const entry: IObsidianMemoryEntry = {
			id: generateUuid(),
			title,
			content,
			category,
			tags: tags ?? this.autoTag(title + ' ' + content),
			createdAt: now,
			updatedAt: now,
			source: source ?? 'user-created',
		};

		const store = await this.loadStore();
		store.entries.push(entry);
		await this.saveStore(store);

		this._onDidAddMemory.fire(entry);
		this.logService.info(`[ObsidianMemory] Added: "${title}" [${category}] (${entry.id})`);
		return entry;
	}

	async updateMemory(
		id: string,
		updates: Partial<Pick<IObsidianMemoryEntry, 'title' | 'content' | 'category' | 'tags'>>,
	): Promise<IObsidianMemoryEntry> {
		const store = await this.loadStore();
		const index = store.entries.findIndex(e => e.id === id);
		if (index === -1) {
			throw new Error(`Memory entry not found: ${id}`);
		}

		const existing = store.entries[index];
		const updated: IObsidianMemoryEntry = {
			...existing,
			...(updates.title !== undefined && { title: updates.title }),
			...(updates.content !== undefined && { content: updates.content }),
			...(updates.category !== undefined && { category: updates.category }),
			...(updates.tags !== undefined && { tags: updates.tags }),
			updatedAt: Date.now(),
		};

		store.entries[index] = updated;
		await this.saveStore(store);

		this._onDidUpdateMemory.fire(updated);
		this.logService.info(`[ObsidianMemory] Updated: "${updated.title}" (${id})`);
		return updated;
	}

	async deleteMemory(id: string): Promise<void> {
		const store = await this.loadStore();
		const index = store.entries.findIndex(e => e.id === id);
		if (index === -1) {
			this.logService.warn(`[ObsidianMemory] Delete failed — entry not found: ${id}`);
			return;
		}

		store.entries.splice(index, 1);
		await this.saveStore(store);

		this._onDidDeleteMemory.fire(id);
		this.logService.info(`[ObsidianMemory] Deleted: ${id}`);
	}

	getMemory(id: string): IObsidianMemoryEntry | undefined {
		if (!this._cachedStore) {
			return undefined;
		}
		return this._cachedStore.entries.find(e => e.id === id);
	}

	searchMemories(query: IObsidianMemoryQuery): IObsidianMemoryEntry[] {
		// Must load synchronously from cache for this method
		const entries = this._cachedStore?.entries ?? [];

		let results = entries;

		// Category filter
		if (query.category !== undefined) {
			results = results.filter(e => e.category === query.category);
		}

		// Source filter
		if (query.source !== undefined) {
			results = results.filter(e => e.source === query.source);
		}

		// Tag filter — must match at least one tag
		if (query.tags && query.tags.length > 0) {
			const queryTagsLower = query.tags.map(t => t.toLowerCase());
			results = results.filter(e =>
				e.tags.some(et => queryTagsLower.includes(et.toLowerCase()))
			);
		}

		// Date range filter
		if (query.dateFrom !== undefined) {
			results = results.filter(e => e.createdAt >= query.dateFrom!);
		}
		if (query.dateTo !== undefined) {
			results = results.filter(e => e.createdAt <= query.dateTo!);
		}

		// Text-based fuzzy scoring
		if (query.text) {
			const textLower = query.text.toLowerCase();
			const tokens = textLower.split(/\s+/).filter(t => t.length > 1);

			const scored = results.map(entry => ({
				entry,
				score: this.computeScore(entry, textLower, tokens),
			}));

			// Filter out zero-score entries
			scored.filter(s => s.score > 0);

			// Sort by score descending
			scored.sort((a, b) => b.score - a.score);
			results = scored.map(s => s.entry);
		} else {
			// No text query — sort by most recently updated
			results = [...results].sort((a, b) => b.updatedAt - a.updatedAt);
		}

		// Apply limit
		const limit = query.limit ?? 50;
		return results.slice(0, limit);
	}

	getAllMemories(): IObsidianMemoryEntry[] {
		return this._cachedStore?.entries ?? [];
	}

	getStats(): IObsidianMemoryStats {
		const entries = this._cachedStore?.entries ?? [];

		const entriesByCategory = {} as Record<MemoryCategory, number>;
		for (const cat of MEMORY_CATEGORIES) {
			entriesByCategory[cat] = 0;
		}
		for (const entry of entries) {
			entriesByCategory[entry.category]++;
		}

		let totalSizeBytes = 0;
		try {
			totalSizeBytes = this._cachedStore
				? JSON.stringify(this._cachedStore).length * 2 // Approximate UTF-16 byte count
				: 0;
		} catch {
			// Ignore
		}

		const lastUpdated = entries.length > 0
			? Math.max(...entries.map(e => e.updatedAt))
			: 0;

		return {
			totalEntries: entries.length,
			entriesByCategory,
			totalSizeBytes,
			lastUpdated,
		};
	}

	// --- Conversation Recording & Auto-Extraction -------------------------------

	recordConversationTurn(sessionId: string, role: 'user' | 'assistant', content: string): void {
		let buffer = this._conversationBuffer.get(sessionId);
		if (!buffer) {
			buffer = [];
			this._conversationBuffer.set(sessionId, buffer);
		}

		buffer.push({
			role,
			content,
			timestamp: Date.now(),
		});

		// Keep buffer size reasonable (max 40 turns per session)
		if (buffer.length > 40) {
			buffer.splice(0, buffer.length - 40);
		}

		this.logService.debug(`[ObsidianMemory] Buffered ${role} turn for session ${sessionId} (buffer: ${buffer.length})`);
	}

	async autoExtractFromConversation(sessionId: string): Promise<number> {
		const buffer = this._conversationBuffer.get(sessionId);
		if (!buffer || buffer.length === 0) {
			this.logService.debug(`[ObsidianMemory] No buffered turns for session ${sessionId}`);
			return 0;
		}

		if (!this.aiService.activeProvider) {
			this.logService.debug('[ObsidianMemory] Skipping auto-extract — no AI provider available');
			return 0;
		}

		try {
			// Format the conversation turns for the extraction prompt
			const turnsText = buffer
				.map(t => `[${t.role.toUpperCase()}]: ${t.content}`)
				.join('\n\n');

			const userMessage = `Extract key memories from the following conversation:\n\n${turnsText}`;

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
				this.logService.debug('[ObsidianMemory] AI returned empty extraction response');
				return 0;
			}

			const extracted = this.parseExtractionResponse(fullResponse);
			let addedCount = 0;

			for (const item of extracted) {
				// Check for duplicates by title+category
				const store = await this.loadStore();
				const isDuplicate = store.entries.some(
					e => e.title.toLowerCase() === item.title.toLowerCase() && e.category === item.category
				);
				if (isDuplicate) {
					this.logService.debug(`[ObsidianMemory] Skipping duplicate: "${item.title}" [${item.category}]`);
					continue;
				}

				await this.addMemory(item.title, item.content, item.category, item.tags, 'auto-extract');
				addedCount++;
			}

			// Clear the buffer after successful extraction
			this._conversationBuffer.delete(sessionId);

			this.logService.info(`[ObsidianMemory] Auto-extracted ${addedCount} memories from session ${sessionId}`);
			return addedCount;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[ObsidianMemory] Auto-extract failed (non-critical): ${msg}`);
			return 0;
		}
	}

	// --- Import / Export --------------------------------------------------------

	async exportToJson(): Promise<string> {
		const store = await this.loadStore();
		const json = JSON.stringify(store, null, '\t');
		this._onDidExportMemories.fire('json');
		this.logService.info(`[ObsidianMemory] Exported ${store.entries.length} entries as JSON`);
		return json;
	}

	async exportToMarkdown(): Promise<string> {
		const store = await this.loadStore();
		const lines: string[] = [];

		for (const entry of store.entries) {
			// YAML frontmatter
			lines.push('---');
			lines.push(`title: "${entry.title.replace(/"/g, '\\"')}"`);
			lines.push(`category: ${entry.category}`);
			lines.push(`tags: [${entry.tags.map(t => `"${t}"`).join(', ')}]`);
			lines.push(`source: ${entry.source}`);
			lines.push(`created: ${new Date(entry.createdAt).toISOString()}`);
			lines.push(`updated: ${new Date(entry.updatedAt).toISOString()}`);
			lines.push(`id: ${entry.id}`);
			if (entry.metadata) {
				lines.push(`metadata: ${JSON.stringify(entry.metadata)}`);
			}
			lines.push('---');
			lines.push('');
			lines.push(`# ${entry.title}`);
			lines.push('');
			lines.push(entry.content);
			lines.push('');
			lines.push('---');
			lines.push('');
		}

		this._onDidExportMemories.fire('markdown');
		this.logService.info(`[ObsidianMemory] Exported ${store.entries.length} entries as Markdown`);
		return lines.join('\n');
	}

	async importFromJson(jsonString: string): Promise<number> {
		try {
			const parsed = JSON.parse(jsonString);
			const entries: IObsidianMemoryEntry[] = Array.isArray(parsed)
				? parsed
				: parsed?.entries ?? [];

			const store = await this.loadStore();
			let importedCount = 0;

			for (const raw of entries) {
				if (!this.isValidEntry(raw)) {
					continue;
				}

				// Skip duplicates by title+category
				const isDuplicate = store.entries.some(
					e => e.title.toLowerCase() === raw.title.toLowerCase() && e.category === raw.category
				);
				if (isDuplicate) {
					continue;
				}

				const entry: IObsidianMemoryEntry = {
					id: raw.id ?? generateUuid(),
					title: raw.title,
					content: raw.content,
					category: raw.category,
					tags: raw.tags ?? [],
					createdAt: raw.createdAt ?? Date.now(),
					updatedAt: raw.updatedAt ?? Date.now(),
					source: 'imported' as MemorySource,
					metadata: raw.metadata,
				};

				store.entries.push(entry);
				importedCount++;
			}

			if (importedCount > 0) {
				await this.saveStore(store);
				this._onDidImportMemories.fire(importedCount);
			}

			this.logService.info(`[ObsidianMemory] Imported ${importedCount} entries from JSON`);
			return importedCount;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logService.error(`[ObsidianMemory] JSON import failed: ${msg}`);
			throw new Error(`Failed to import JSON: ${msg}`);
		}
	}

	async importFromMarkdown(markdownString: string): Promise<number> {
		const store = await this.loadStore();
		let importedCount = 0;

		// Split by frontmatter blocks
		const blocks = markdownString.split(/^---\s*$/m).filter(b => b.trim().length > 0);

		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i].trim();

			// Try to parse as YAML frontmatter + content
			const frontmatterMatch = block.match(/^([\s\S]*?)\n\n([\s\S]*)$/);
			if (!frontmatterMatch) {
				continue;
			}

			const frontmatter = frontmatterMatch[1];
			const body = frontmatterMatch[2];

			try {
				const parsed = this.parseYamlFrontmatter(frontmatter);
				if (!parsed.title || !parsed.category) {
					continue;
				}

				// Validate category
				if (!MEMORY_CATEGORIES.includes(parsed.category as MemoryCategory)) {
					continue;
				}

				// Skip duplicates
				const isDuplicate = store.entries.some(
					e => e.title.toLowerCase() === parsed.title.toLowerCase() && e.category === parsed.category
				);
				if (isDuplicate) {
					continue;
				}

				// Extract content from body (remove the title heading)
				let content = body.trim();
				const titleLine = `# ${parsed.title}`;
				if (content.startsWith(titleLine)) {
					content = content.substring(titleLine.length).trim();
				}

				const entry: IObsidianMemoryEntry = {
					id: parsed.id ?? generateUuid(),
					title: parsed.title,
					content,
					category: parsed.category as MemoryCategory,
					tags: parsed.tags ?? [],
					createdAt: parsed.created ? new Date(parsed.created).getTime() : Date.now(),
					updatedAt: parsed.updated ? new Date(parsed.updated).getTime() : Date.now(),
					source: 'imported' as MemorySource,
					metadata: parsed.metadata,
				};

				store.entries.push(entry);
				importedCount++;
			} catch {
				// Skip unparseable blocks
				continue;
			}
		}

		if (importedCount > 0) {
			await this.saveStore(store);
			this._onDidImportMemories.fire(importedCount);
		}

		this.logService.info(`[ObsidianMemory] Imported ${importedCount} entries from Markdown`);
		return importedCount;
	}

	// --- Context for Agent ------------------------------------------------------

	getRelevantContext(query: string, limit?: number): string {
		const effectiveLimit = limit ?? 5;
		const results = this.searchMemories({
			text: query,
			limit: effectiveLimit,
		});

		if (results.length === 0) {
			return '';
		}

		const lines: string[] = ['## Obsidian Memory (Persistent)', ''];

		for (const entry of results) {
			const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
			lines.push(`### ${entry.title} (${entry.category}${tags})`);
			lines.push(entry.content);
			lines.push('');
		}

		return lines.join('\n');
	}

	// --- Private: Fuzzy Scoring -------------------------------------------------

	private computeScore(entry: IObsidianMemoryEntry, textLower: string, tokens: string[]): number {
		let score = 0;

		// Title exact substring match: 1.0
		const titleLower = entry.title.toLowerCase();
		if (titleLower.includes(textLower)) {
			score = Math.max(score, 1.0);
		} else {
			// Title partial word match: scale by fraction of matching tokens
			const titleMatches = tokens.filter(t => titleLower.includes(t)).length;
			if (titleMatches > 0 && tokens.length > 0) {
				score = Math.max(score, 0.8 * (titleMatches / tokens.length));
			}
		}

		// Tag exact match: 0.9
		for (const tag of entry.tags) {
			if (textLower.includes(tag.toLowerCase())) {
				score = Math.max(score, 0.9);
				break;
			}
		}

		// Content substring match: 0.6
		const contentLower = entry.content.toLowerCase();
		if (contentLower.includes(textLower)) {
			score = Math.max(score, 0.6);
		} else {
			// Content partial word match
			const contentMatches = tokens.filter(t => contentLower.includes(t)).length;
			if (contentMatches > 0 && tokens.length > 0) {
				score = Math.max(score, 0.5 * (contentMatches / tokens.length));
			}
		}

		// Category match: 0.3
		if (textLower.includes(entry.category)) {
			score = Math.max(score, 0.3);
		}

		return score;
	}

	// --- Private: Storage I/O ---------------------------------------------------

	private async loadStore(): Promise<IObsidianMemoryStore> {
		if (this._cacheLoaded && this._cachedStore) {
			return this._cachedStore;
		}

		try {
			const fs = await this.getFs();
			const filePath = await this.getStorageFilePath();

			if (fs && filePath) {
				const data = await fs.promises.readFile(filePath, 'utf-8');
				const parsed = JSON.parse(data) as IObsidianMemoryStore;

				if (parsed.version === MEMORY_STORE_VERSION && Array.isArray(parsed.entries)) {
					this._cachedStore = parsed;
					this._cacheLoaded = true;
					return this._cachedStore;
				}
			}
		} catch {
			// File doesn't exist or is corrupt — start fresh
		}

		this._cachedStore = { version: MEMORY_STORE_VERSION, entries: [] };
		this._cacheLoaded = true;
		return this._cachedStore;
	}

	private async saveStore(store: IObsidianMemoryStore): Promise<void> {
		const fs = await this.getFs();
		const filePath = await this.getStorageFilePath();

		if (!fs || !filePath) {
			this.logService.warn('[ObsidianMemory] Cannot save — filesystem not available (likely browser environment)');
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
			return `${home}/${KOVIX_DIR}/${MEMORY_STORE_FILE}`;
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

	// --- Private: Helpers -------------------------------------------------------

	private autoTag(text: string): string[] {
		const tags: string[] = [];
		const lower = text.toLowerCase();

		const words = lower.match(/\b[a-z]{4,}\b/g) ?? [];
		const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'they', 'their', 'about', 'would', 'there', 'these', 'other', 'should', 'could', 'after', 'those', 'being', 'where', 'which', 'when', 'what', 'some', 'into', 'than', 'more', 'also']);
		const filtered = words.filter(w => !stopWords.has(w));

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

	private isValidEntry(raw: any): raw is IObsidianMemoryEntry {
		return raw
			&& typeof raw.title === 'string'
			&& typeof raw.content === 'string'
			&& typeof raw.category === 'string'
			&& MEMORY_CATEGORIES.includes(raw.category);
	}

	private parseExtractionResponse(response: string): Array<{ title: string; content: string; category: MemoryCategory; tags: string[] }> {
		try {
			let jsonStr = response.trim();
			const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
			if (fenceMatch) {
				jsonStr = fenceMatch[1];
			}

			const parsed = JSON.parse(jsonStr);
			if (!Array.isArray(parsed)) {
				this.logService.warn('[ObsidianMemory] Auto-extract response is not an array');
				return [];
			}

			return parsed.filter((item: any) =>
				typeof item?.title === 'string' &&
				typeof item?.content === 'string' &&
				typeof item?.category === 'string' &&
				MEMORY_CATEGORIES.includes(item.category) &&
				Array.isArray(item?.tags)
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[ObsidianMemory] Failed to parse extraction response: ${msg}`);
			return [];
		}
	}

	private parseYamlFrontmatter(yaml: string): Record<string, any> {
		const result: Record<string, any> = {};
		const lines = yaml.split('\n');

		for (const line of lines) {
			const match = line.match(/^(\w+):\s*(.*)$/);
			if (!match) {
				continue;
			}

			const [, key, value] = match;
			const trimmed = value.trim();

			// Parse different value types
			if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
				// Array (tags)
				try {
					result[key] = JSON.parse(trimmed.replace(/"/g, '"'));
				} catch {
					result[key] = trimmed.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
				}
			} else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
				result[key] = trimmed.slice(1, -1).replace(/\\"/g, '"');
			} else if (trimmed === 'true') {
				result[key] = true;
			} else if (trimmed === 'false') {
				result[key] = false;
			} else if (!isNaN(Number(trimmed))) {
				result[key] = Number(trimmed);
			} else {
				result[key] = trimmed;
			}
		}

		return result;
	}

	override dispose(): void {
		this._cachedStore = null;
		this._cacheLoaded = false;
		this._conversationBuffer.clear();
		super.dispose();
	}
}
