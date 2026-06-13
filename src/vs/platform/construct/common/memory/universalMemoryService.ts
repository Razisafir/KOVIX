/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IUniversalMemoryEntry, IUniversalMemoryQuery } from './universalMemoryTypes.js';

export const IUniversalMemoryService = createDecorator<IUniversalMemoryService>('universalMemoryService');

/**
 * Service for the universal cross-project memory system.
 *
 * This is the local, always-available alternative to Supermemory.ai.
 * It stores learnings from every project in a global SQLite database
 * at ~/.kovix/universal-memory.db, searchable from any project.
 *
 * When Ollama embeddings are available, it uses semantic search.
 * Otherwise, it falls back to FTS5 full-text search.
 */
export interface IUniversalMemoryService {
	readonly _serviceBrand: undefined;

	/**
	 * Add a memory entry (called automatically after milestone completions).
	 */
	addMemory(entry: Omit<IUniversalMemoryEntry, 'id' | 'createdAt'>): Promise<IUniversalMemoryEntry>;

	/**
	 * Search memories semantically (uses embeddings if available, FTS5 fallback).
	 */
	searchMemories(query: IUniversalMemoryQuery): Promise<IUniversalMemoryEntry[]>;

	/**
	 * Get all memories for a specific project.
	 */
	getProjectMemories(projectId: string): Promise<IUniversalMemoryEntry[]>;

	/**
	 * Get memories relevant to the current task (called before planning).
	 * Returns a formatted context string for injection into the LLM system prompt.
	 */
	getContextForTask(taskDescription: string, currentProjectId: string): Promise<string>;

	/**
	 * Delete a memory by ID.
	 */
	deleteMemory(id: string): Promise<void>;

	/**
	 * Get total memory count.
	 */
	getMemoryCount(): Promise<number>;

	/**
	 * Export all memories as JSON (for backup).
	 */
	exportMemories(): Promise<string>;
}
