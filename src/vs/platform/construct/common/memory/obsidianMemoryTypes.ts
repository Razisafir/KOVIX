// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

/**
 * An entry in the Obsidian-like memory store.
 * Each entry represents a persistent, editable memory that the agent can
 * reference across sessions and chats.
 */
export interface IObsidianMemoryEntry {
	readonly id: string;
	readonly title: string;
	readonly content: string;
	readonly category: MemoryCategory;
	readonly tags: string[];
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly source: MemorySource;
	readonly metadata?: Record<string, unknown>;
}

/**
 * Categories for organising memories in the Obsidian-like store.
 */
export type MemoryCategory =
	| 'person'
	| 'project'
	| 'preference'
	| 'decision'
	| 'context'
	| 'learning'
	| 'reference'
	| 'conversation';

/**
 * How a memory entry was created.
 */
export type MemorySource =
	| 'auto-extract'
	| 'user-created'
	| 'imported'
	| 'session-recording';

/**
 * Query parameters for searching the Obsidian memory store.
 */
export interface IObsidianMemoryQuery {
	text?: string;
	category?: MemoryCategory;
	tags?: string[];
	source?: MemorySource;
	dateFrom?: number;
	dateTo?: number;
	limit?: number;
}

/**
 * Statistics about the Obsidian memory store.
 */
export interface IObsidianMemoryStats {
	totalEntries: number;
	entriesByCategory: Record<MemoryCategory, number>;
	totalSizeBytes: number;
	lastUpdated: number;
}

/**
 * All valid memory categories in display order.
 */
export const MEMORY_CATEGORIES: MemoryCategory[] = [
	'person',
	'project',
	'preference',
	'decision',
	'context',
	'learning',
	'reference',
	'conversation',
];

/**
 * Human-readable labels for each category.
 */
export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
	person: 'People',
	project: 'Projects',
	preference: 'Preferences',
	decision: 'Decisions',
	context: 'Context',
	learning: 'Learning',
	reference: 'Reference',
	conversation: 'Conversations',
};

/**
 * File name for the persistent JSON store.
 * Stored at ~/.kovix/obsidian-memory.json
 */
export const MEMORY_STORE_FILE = 'obsidian-memory.json';

/**
 * File format version for future migrations.
 */
export const MEMORY_STORE_VERSION = 1;

/**
 * On-disk format of the Obsidian memory store.
 */
export interface IObsidianMemoryStore {
	readonly version: typeof MEMORY_STORE_VERSION;
	entries: IObsidianMemoryEntry[];
}
