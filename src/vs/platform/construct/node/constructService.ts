// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConstructService } from '../common/construct.js';
import { IMCPProcessNodeService } from '../common/mcp/mcpProcessNode.js';
import { MCPProcessNodeService } from './mcpProcessNode.js';
import { IConstructVectorStore } from '../common/memory/vectorStore.js';
import { ConstructVectorStoreService } from './constructVectorStore.js';
import { IConstructChatHistory } from '../common/memory/vectorStore.js';
import { ConstructChatHistoryService } from './constructChatHistory.js';
import { IConstructConfigService } from '../common/config/constructConfigService.js';
import { ConstructConfigService } from './constructConfigService.js';
import { ISecureKeyManager } from '../common/security/secureKeyManager.js';
import { SecureKeyNodeService } from './constructSecureKeyService.js';
import { IConstructNotificationService } from '../common/notification/constructNotificationService.js';
import { ConstructNotificationNodeService } from './constructNotificationService.js';
import { IEmbeddingService } from '../common/memory/embeddingService.js';
import { EmbeddingNodeService } from './constructEmbeddingService.js';
import { IFileWatcherService } from '../common/watcher/fileWatcherService.js';
import { FileWatcherNodeService } from './constructFileWatcherService.js';
import { ITerminalExecutor } from '../common/terminal/terminalExecutor.js';
import { TerminalNodeService } from './constructTerminalService.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions';

class ConstructService implements IConstructService {
	declare readonly _serviceBrand: undefined;

	async start(): Promise<void> {
		// Python backend removed — all AI capabilities are now handled
		// natively by the TypeScript agent loop + ConstructToolRegistryService.
	}

	getPort(): number { return 0; }

	async stop(): Promise<void> {
		// No-op: no external process to stop
	}
}

registerSingleton(IConstructService, ConstructService, InstantiationType.Eager);

// Register the MCP node service for IPC exposure to the renderer.
// The browser-layer MCPProcessService will attempt to use this service
// via IPC when running in desktop mode. In browser-only mode (vscode.dev),
// it falls back to IFileService.
registerSingleton(IMCPProcessNodeService, MCPProcessNodeService, InstantiationType.Delayed);

// --- Phase 3: Memory & Context Services (Node layer) ---
// Qdrant-backed vector store for workspace file chunk embeddings
registerSingleton(IConstructVectorStore, ConstructVectorStoreService, InstantiationType.Delayed);
// SQLite-backed chat history for persistent conversation storage
registerSingleton(IConstructChatHistory, ConstructChatHistoryService, InstantiationType.Delayed);

// --- Config Service (P0: Single source of config truth) ---
registerSingleton(IConstructConfigService, ConstructConfigService, InstantiationType.Delayed);

// --- Secure Key Node Service (P0: OS keychain access) ---
registerSingleton(ISecureKeyManager, SecureKeyNodeService, InstantiationType.Delayed);

// --- Notification Service ---
registerSingleton(IConstructNotificationService, ConstructNotificationNodeService, InstantiationType.Delayed);

// --- Embedding Service (P1: text embeddings for semantic search) ---
registerSingleton(IEmbeddingService, EmbeddingNodeService, InstantiationType.Delayed);

// --- File Watcher Service (P2: reliable filesystem events) ---
registerSingleton(IFileWatcherService, FileWatcherNodeService, InstantiationType.Delayed);

// --- Terminal Execution Service (P0-4: replaces browser child_process) ---
registerSingleton(ITerminalExecutor, TerminalNodeService, InstantiationType.Delayed);
