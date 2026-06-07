/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IConstructMemoryContextService = createDecorator<IConstructMemoryContextService>('construct.memoryContextService');

/**
 * IConstructMemoryContextService — orchestrates workspace memory for agent context injection.
 *
 * On workspace open:
 * 1. Walks workspace files and chunks them (512-token windows, 64-token overlap)
 * 2. Embeds each chunk using the active provider's embedding model
 * 3. Stores embeddings in Qdrant (localhost:6333)
 * 4. Stores raw chat history in SQLite via better-sqlite3
 *
 * On each agent message:
 * 1. Embeds the user query
 * 2. Retrieves top-8 relevant chunks from Qdrant
 * 3. Injects as a system context block before the user message
 *
 * Graceful degradation:
 * - If Qdrant is not running: skip memory, warn user once
 * - If SQLite is not available: chat history is session-only
 * - If embedding fails: use pseudo-embeddings for basic functionality
 */
export interface IConstructMemoryContextService {
	readonly _serviceBrand: undefined;

	/**
	 * Initialize the memory context service for the given workspace.
	 * Sets up both the vector store (Qdrant) and chat history (SQLite).
	 *
	 * @param workspaceRoot The workspace root path.
	 * @returns True if at least the chat history is available.
	 */
	initialize(workspaceRoot: string): Promise<boolean>;

	/**
	 * Index the workspace files into the vector store.
	 * Called on workspace open and when files change.
	 *
	 * @param workspaceRoot The workspace root path.
	 * @param onProgress Optional progress callback.
	 */
	indexWorkspace(workspaceRoot: string, onProgress?: (indexed: number, total: number) => void): Promise<void>;

	/**
	 * Index a single file into the vector store.
	 * Called by the file watcher when a file changes.
	 *
	 * @param filePath Absolute path to the file.
	 */
	indexFile(filePath: string): Promise<void>;

	/**
	 * Remove a file from the vector store.
	 * Called by the file watcher when a file is deleted.
	 *
	 * @param filePath Absolute path to the file.
	 */
	removeFile(filePath: string): Promise<void>;

	/**
	 * Build a context block for the given user query.
	 * Searches Qdrant for relevant workspace chunks and formats
	 * them as a system context block to prepend to the conversation.
	 *
	 * @param query The user's query text.
	 * @param topK Number of chunks to retrieve (default 8).
	 * @returns A formatted context string, or empty string if no relevant context found.
	 */
	buildContextBlock(query: string, topK?: number): Promise<string>;

	/**
	 * Save a user message to chat history.
	 */
	saveUserMessage(sessionId: string, content: string): Promise<void>;

	/**
	 * Save an assistant message to chat history.
	 */
	saveAssistantMessage(sessionId: string, content: string, toolCalls?: string): Promise<void>;

	/**
	 * Get the current chat session ID.
	 */
	getCurrentSessionId(): Promise<string>;

	/**
	 * Get chat history for the current session.
	 */
	getCurrentSessionHistory(): Promise<Array<{ role: string; content: string }>>;

	/**
	 * Whether the vector store is connected.
	 */
	isVectorStoreConnected(): boolean;

	/**
	 * Whether the chat history database is available.
	 */
	isChatHistoryAvailable(): boolean;
}
