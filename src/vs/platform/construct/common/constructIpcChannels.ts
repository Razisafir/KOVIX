// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

/**
 * CONSTRUCT IPC Channel Constants
 *
 * All channel names MUST be defined here and imported by both main and renderer.
 * No inline string literals for channel names — compile-time safety only.
 *
 * SEC-2: Channel names use shared constants to prevent silent breakage
 * if a name changes in one place but not the other.
 */
export const CONSTRUCT_CHANNELS = {
	/** MCP filesystem server process management */
	MCP: 'constructMcp',
	/** Qdrant vector store for semantic code search */
	VECTOR_STORE: 'constructVector',
	/** SQLite chat history for persistent conversations */
	CHAT_HISTORY: 'constructChatHistory',
	/** Secure key management via OS keychain */
	SECURE_KEYS: 'constructSecureKeys',
	/** Centralized configuration service */
	CONFIG: 'constructConfig',
	/** Text embedding generation for semantic search */
	EMBEDDING: 'constructEmbedding',
	/** System notification service */
	NOTIFICATION: 'constructNotification',
	/** Filesystem event watching */
	FILE_WATCHER: 'constructFileWatcher',
	/** Terminal command execution */
	TERMINAL: 'constructTerminal',
} as const;

export type ConstructChannelName = typeof CONSTRUCT_CHANNELS[keyof typeof CONSTRUCT_CHANNELS];
