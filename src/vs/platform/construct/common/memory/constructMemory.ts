/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

export const IConstructMemoryService = createDecorator<IConstructMemoryService>('construct.constructMemory');

/**
 * Represents a memory item retrieved from Supermemory.
 */
export interface IConstructMemoryItem {
	readonly id: string;
	readonly content: string;
	readonly containerTag: string;
	readonly createdAt: number;
	readonly metadata?: Record<string, string | number | boolean | string[]>;
	readonly score?: number;
}

/**
 * User profile data from Supermemory, containing static (long-term)
 * and dynamic (recent activity) facts.
 */
export interface IConstructMemoryProfile {
	readonly static: string[];
	readonly dynamic: string[];
}

/**
 * Search mode for Supermemory queries.
 * - 'memories': Low-latency conversational memory search
 * - 'hybrid': Combines memory + document RAG search
 * - 'documents': Document/chunk search only
 */
export type ConstructSearchMode = 'memories' | 'hybrid' | 'documents';

/**
 * Configuration for the Construct memory service.
 */
export interface IConstructMemoryConfig {
	/** Whether Supermemory persistence is enabled (vs local-only mode) */
	readonly enabled: boolean;
	/** Whether to auto-extract memories from conversations */
	readonly autoLearn: boolean;
}

/**
 * Event emitted when a memory is added.
 */
export interface IConstructMemoryAddEvent {
	readonly content: string;
	readonly containerTag: string;
	readonly metadata?: Record<string, string | number | boolean | string[]>;
}

/**
 * Service that wraps Supermemory with VS Code-specific logic for persistent
 * memory that survives reloads, learns from conversations, and provides
 * intelligent context retrieval for the Construct agent.
 *
 * When Supermemory is not initialized or unavailable, falls back to the
 * existing in-memory four-layer architecture.
 */
export interface IConstructMemoryService extends IDisposable {
	readonly _serviceBrand: undefined;

	/** Whether the Supermemory client is initialized and connected */
	readonly isInitialized: boolean;

	/** Current configuration */
	readonly config: IConstructMemoryConfig;

	/** Fired when a memory is successfully added */
	readonly onDidAddMemory: Event<IConstructMemoryAddEvent>;

	/** Fired when initialization state changes */
	readonly onDidChangeInitialization: Event<boolean>;

	/**
	 * Initialize the Supermemory client with an API key.
	 * Validates the key by making a test profile call.
	 * Stores the key in SecretStorage for persistence.
	 */
	initialize(apiKey: string): Promise<void>;

	/**
	 * Disconnect from Supermemory and clear the client.
	 * Does not remove the stored API key.
	 */
	disconnect(): void;

	/**
	 * Store a memory in Supermemory.
	 * @param content The fact or information to store
	 * @param metadata Optional metadata (type, toolName, taskId, etc.)
	 */
	addMemory(content: string, metadata?: Record<string, string | number | boolean | string[]>): Promise<void>;

	/**
	 * Get the user profile from Supermemory.
	 * Returns static facts (long-term) and dynamic context (recent activity).
	 * @param query Optional query to bias the profile results
	 */
	getProfile(query?: string): Promise<IConstructMemoryProfile>;

	/**
	 * Search memories in Supermemory.
	 * @param query Search query string
	 * @param searchMode Search mode: memories, hybrid, or documents
	 * @param limit Maximum results to return
	 */
	searchMemories(query: string, searchMode?: ConstructSearchMode, limit?: number): Promise<IConstructMemoryItem[]>;

	/**
	 * Get formatted context string for injection into LLM system prompts.
	 * This is the primary method called by the agent loop to inject memory context.
	 * @param task The current task/query to find relevant context for
	 */
	getContextForTask(task: string): Promise<string>;

	/**
	 * Update configuration (enabled, autoLearn).
	 */
	updateConfig(config: Partial<IConstructMemoryConfig>): void;

	/**
	 * Test the connection to Supermemory by making a profile call.
	 * Returns true if the connection is healthy.
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Forget (delete) a specific memory by ID.
	 */
	forgetMemory(memoryId: string): Promise<void>;

	/**
	 * Get recent memories for display in the memory panel.
	 * @param limit Maximum number of memories to return
	 */
	getRecentMemories(limit?: number): Promise<IConstructMemoryItem[]>;
}
