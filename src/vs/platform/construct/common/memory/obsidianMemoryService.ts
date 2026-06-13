/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IObsidianMemoryEntry, IObsidianMemoryQuery, IObsidianMemoryStats, MemoryCategory } from './obsidianMemoryTypes.js';

export const IObsidianMemoryService = createDecorator<IObsidianMemoryService>('construct.obsidianMemory');

/**
 * Obsidian-like persistent memory service for the KOVIX AI IDE.
 *
 * Provides a visual, editable, persistent memory store that the agent
 * can reference across all sessions and chats. Inspired by Obsidian's
 * approach to personal knowledge management.
 *
 * Storage: ~/.kovix/obsidian-memory.json (local JSON file)
 */
export interface IObsidianMemoryService {
	readonly _serviceBrand: undefined;

	// --- Events ---
	readonly onDidAddMemory: Event<IObsidianMemoryEntry>;
	readonly onDidUpdateMemory: Event<IObsidianMemoryEntry>;
	readonly onDidDeleteMemory: Event<string>;
	readonly onDidImportMemories: Event<number>;
	readonly onDidExportMemories: Event<string>;

	// --- CRUD ---
	addMemory(title: string, content: string, category: MemoryCategory, tags?: string[], source?: IObsidianMemoryEntry['source']): Promise<IObsidianMemoryEntry>;
	updateMemory(id: string, updates: Partial<Pick<IObsidianMemoryEntry, 'title' | 'content' | 'category' | 'tags'>>): Promise<IObsidianMemoryEntry>;
	deleteMemory(id: string): Promise<void>;
	getMemory(id: string): IObsidianMemoryEntry | undefined;
	searchMemories(query: IObsidianMemoryQuery): IObsidianMemoryEntry[];
	getAllMemories(): IObsidianMemoryEntry[];
	getStats(): IObsidianMemoryStats;

	// --- Auto-record from conversations ---
	recordConversationTurn(sessionId: string, role: 'user' | 'assistant', content: string): void;
	autoExtractFromConversation(sessionId: string): Promise<number>;

	// --- Import / Export ---
	exportToJson(): Promise<string>;
	exportToMarkdown(): Promise<string>;
	importFromJson(jsonString: string): Promise<number>;
	importFromMarkdown(markdownString: string): Promise<number>;

	// --- Context for agent ---
	getRelevantContext(query: string, limit?: number): string;
}
