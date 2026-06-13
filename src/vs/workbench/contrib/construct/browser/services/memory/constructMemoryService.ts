/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ISecureKeyManager } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IConstructMemoryService, IConstructMemoryProfile, IConstructMemoryItem, IConstructMemoryConfig, IConstructMemoryAddEvent, ConstructSearchMode } from '../../../../../../platform/construct/common/memory/constructMemory.js';

// SUPERMEMORY_API_KEY_STORAGE_KEY removed — API keys now stored via ISecureKeyManager (OS keychain)
const SUPERMEMORY_ENABLED_STORAGE_KEY = 'construct.supermemory.enabled';
const SUPERMEMORY_AUTOLEARN_STORAGE_KEY = 'construct.supermemory.autoLearn';

/**
 * In-memory representation of a Supermemory search result.
 * Used when we cannot import the actual SDK types at compile time.
 */
interface ISupermemorySearchResult {
                id: string;
                content?: string;
                chunks?: Array<{ content: string }>;
                memory?: { content: string };
                score?: number;
                containerTag?: string;
                createdAt?: number;
                metadata?: Record<string, string | number | boolean | string[]>;
}

export class ConstructMemoryService extends Disposable implements IConstructMemoryService {
                readonly _serviceBrand: undefined;

                private client: any | null = null;
                private _isInitialized = false;
                private _config: IConstructMemoryConfig;
                private containerTag: string;

                private readonly _onDidAddMemory = this._register(new Emitter<IConstructMemoryAddEvent>());
                readonly onDidAddMemory = this._onDidAddMemory.event;

                private readonly _onDidChangeInitialization = this._register(new Emitter<boolean>());
                readonly onDidChangeInitialization = this._onDidChangeInitialization.event;

                get isInitialized(): boolean {
                                return this._isInitialized;
                }

                get config(): IConstructMemoryConfig {
                                return this._config;
                }

                constructor(
                                @ILogService private readonly logService: ILogService,
                                @IStorageService private readonly storageService: IStorageService,
                                @IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
                                @IConfigurationService private readonly configurationService: IConfigurationService,
                                @ISecureKeyManager private readonly secureKeyManager: ISecureKeyManager,
                ) {
                                super();

                                // Generate container tag from workspace name or custom config
                                const customTag = this.configurationService.getValue<string>('construct.memory.containerTag');
                                if (customTag) {
                                                this.containerTag = customTag;
                                } else {
                                                const workspaceName = this.workspaceContext.getWorkspace().folders[0]?.name ?? 'default';
                                                this.containerTag = `construct-${workspaceName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
                                }

                                // Load config from CONSTRUCT IDE settings first, fall back to storage
                                const enabled = this.configurationService.getValue<boolean>('construct.memory.enabled')
                                                ?? this.storageService.getBoolean(SUPERMEMORY_ENABLED_STORAGE_KEY, StorageScope.WORKSPACE, false);
                                const autoLearn = this.configurationService.getValue<boolean>('construct.memory.autoLearn')
                                                ?? this.storageService.getBoolean(SUPERMEMORY_AUTOLEARN_STORAGE_KEY, StorageScope.WORKSPACE, true);
                                this._config = { enabled, autoLearn };

                                // Listen for configuration changes
                                this._register(this.configurationService.onDidChangeConfiguration((e: any) => {
                                                if (e.affectsConfiguration('construct.memory')) {
                                                                this.onConfigurationChanged();
                                                }
                                }));

                                // Try to auto-initialize if we have a stored API key
                                this.tryAutoInitialize();

                                this.logService.info(`[ConstructMemory] Initialized with containerTag: ${this.containerTag}, enabled: ${enabled}`);
                }

                private onConfigurationChanged(): void {
                                const newEnabled = this.configurationService.getValue<boolean>('construct.memory.enabled');
                                const newAutoLearn = this.configurationService.getValue<boolean>('construct.memory.autoLearn');
                                const newContainerTag = this.configurationService.getValue<string>('construct.memory.containerTag');

                                const configUpdate: Partial<IConstructMemoryConfig> = {};
                                if (newEnabled !== undefined) { (configUpdate as Record<string, boolean>).enabled = newEnabled; }
                                if (newAutoLearn !== undefined) { (configUpdate as Record<string, boolean>).autoLearn = newAutoLearn; }

                                this.updateConfig(configUpdate);

                                if (newContainerTag && newContainerTag !== this.containerTag) {
                                                this.containerTag = newContainerTag;
                                                this.logService.info(`[ConstructMemory] Container tag changed to: ${this.containerTag}`);
                                }
                }

                private async tryAutoInitialize(): Promise<void> {
                                const storedKey = await this.secureKeyManager.getKey('supermemory');
                                if (storedKey && this._config.enabled) {
                                                try {
                                                                await this.initialize(storedKey);
                                                                this.logService.info('[ConstructMemory] Auto-initialized from stored API key');
                                                } catch (error) {
                                                                this.logService.warn('[ConstructMemory] Auto-initialization failed:', error);
                                                }
                                }
                }

                async initialize(apiKey: string): Promise<void> {
                                try {
                                                // Dynamically import Supermemory to avoid bundling issues
                                                const supermemoryModule = await import('supermemory');
                                                const Supermemory = supermemoryModule.default ?? supermemoryModule.Supermemory;

                                                this.client = new Supermemory({ apiKey });

                                                // Test the connection with a profile call
                                                await this.client.profile({
                                                                containerTag: this.containerTag,
                                                });

                                                // Store the key securely in the OS keychain (NOT plaintext IStorageService)
                                                await this.secureKeyManager.setKey('supermemory', apiKey);

                                                this._isInitialized = true;
                                                this._onDidChangeInitialization.fire(true);
                                                this.logService.info('[ConstructMemory] Successfully initialized and connected');
                                } catch (error) {
                                                this._isInitialized = false;
                                                this._onDidChangeInitialization.fire(false);
                                                this.client = null;

                                                const errorMessage = error instanceof Error ? error.message : String(error);
                                                this.logService.error(`[ConstructMemory] Initialization failed: ${errorMessage}`);
                                                throw new Error(`Failed to initialize Supermemory: ${errorMessage}`);
                                }
                }

                disconnect(): void {
                                this.client = null;
                                this._isInitialized = false;
                                this._onDidChangeInitialization.fire(false);
                                this.logService.info('[ConstructMemory] Disconnected');
                }

                async addMemory(content: string, metadata?: Record<string, string | number | boolean | string[]>): Promise<void> {
                                if (!this.client || !this._config.enabled) {
                                                this.logService.debug('[ConstructMemory] Skipping addMemory -- not initialized or not enabled');
                                                return;
                                }

                                try {
                                                await this.client.add({
                                                                content,
                                                                containerTag: this.containerTag,
                                                                metadata: {
                                                                                ...metadata,
                                                                                timestamp: Date.now(),
                                                                                workspace: this.containerTag
                                                                }
                                                });

                                                this._onDidAddMemory.fire({
                                                                content,
                                                                containerTag: this.containerTag,
                                                                metadata
                                                });

                                                this.logService.info(`[ConstructMemory] Added memory: ${content.substring(0, 80)}...`);
                                } catch (error) {
                                                this.logService.error('[ConstructMemory] Failed to add memory:', error);
                                                // Don't throw -- memory addition is non-critical and shouldn't break the agent loop
                                }
                }

                async getProfile(query?: string): Promise<IConstructMemoryProfile> {
                                if (!this.client || !this._config.enabled) {
                                                return { static: [], dynamic: [] };
                                }

                                try {
                                                const result = await this.client.profile({
                                                                containerTag: this.containerTag,
                                                                q: query
                                                });

                                                return {
                                                                static: result.profile?.static ?? [],
                                                                dynamic: result.profile?.dynamic ?? []
                                                };
                                } catch (error) {
                                                this.logService.warn('[ConstructMemory] Failed to get profile:', error);
                                                return { static: [], dynamic: [] };
                                }
                }

                async searchMemories(query: string, searchMode: ConstructSearchMode = 'hybrid', limit: number = 10): Promise<IConstructMemoryItem[]> {
                                if (!this.client || !this._config.enabled) {
                                                return [];
                                }

                                try {
                                                const result = await this.client.search.memories({
                                                                q: query,
                                                                containerTag: this.containerTag,
                                                                searchMode,
                                                                limit
                                                });

                                                const items: IConstructMemoryItem[] = [];

                                                if (result.results && Array.isArray(result.results)) {
                                                                for (const r of result.results) {
                                                                                const sr = r as ISupermemorySearchResult;
                                                                                // Extract content from either memory or chunk format
                                                                                let content = '';
                                                                                if (sr.memory && typeof sr.memory === 'object' && 'content' in sr.memory) {
                                                                                                content = sr.memory.content;
                                                                                } else if (sr.chunks && Array.isArray(sr.chunks) && sr.chunks.length > 0) {
                                                                                                content = sr.chunks.map((c: { content: string }) => c.content).join('\n');
                                                                                } else if (typeof sr.content === 'string') {
                                                                                                content = sr.content;
                                                                                }

                                                                                items.push({
                                                                                                id: sr.id ?? `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                                                                                content,
                                                                                                containerTag: sr.containerTag ?? this.containerTag,
                                                                                                createdAt: sr.createdAt ?? Date.now(),
                                                                                                metadata: sr.metadata,
                                                                                                score: sr.score
                                                                                });
                                                                }
                                                }

                                                return items;
                                } catch (error) {
                                                this.logService.warn('[ConstructMemory] Search failed:', error);
                                                return [];
                                }
                }

                async getContextForTask(task: string): Promise<string> {
                                if (!this.client || !this._config.enabled) {
                                                return '';
                                }

                                try {
                                                const profile = await this.getProfile(task);
                                                const memories = await this.searchMemories(task, 'hybrid', 5);

                                                const parts: string[] = [];

                                                // User Profile Section
                                                if (profile.static.length > 0 || profile.dynamic.length > 0) {
                                                                parts.push('## User Context');

                                                                if (profile.static.length > 0) {
                                                                                parts.push('### Preferences & Facts');
                                                                                for (const fact of profile.static) {
                                                                                                parts.push(`- ${fact}`);
                                                                                }
                                                                                parts.push('');
                                                                }

                                                                if (profile.dynamic.length > 0) {
                                                                                parts.push('### Recent Activity');
                                                                                for (const activity of profile.dynamic) {
                                                                                                parts.push(`- ${activity}`);
                                                                                }
                                                                                parts.push('');
                                                                }
                                                }

                                                // Relevant Memories Section
                                                if (memories.length > 0) {
                                                                parts.push('### Relevant Memories');
                                                                for (const m of memories.slice(0, 5)) {
                                                                                const truncated = m.content.length > 200
                                                                                                ? m.content.substring(0, 200) + '...'
                                                                                                : m.content;
                                                                                parts.push(`- ${truncated}`);
                                                                }
                                                                parts.push('');
                                                }

                                                return parts.join('\n');
                                } catch (error) {
                                                this.logService.warn('[ConstructMemory] Failed to get context for task:', error);
                                                return '';
                                }
                }

                async updateConfig(config: Partial<IConstructMemoryConfig>): Promise<void> {
                                if (config.enabled !== undefined) {
                                                this._config = { ...this._config, enabled: config.enabled };
                                                this.storageService.store(SUPERMEMORY_ENABLED_STORAGE_KEY, config.enabled, StorageScope.WORKSPACE, StorageTarget.USER);
                                }
                                if (config.autoLearn !== undefined) {
                                                this._config = { ...this._config, autoLearn: config.autoLearn };
                                                this.storageService.store(SUPERMEMORY_AUTOLEARN_STORAGE_KEY, config.autoLearn, StorageScope.WORKSPACE, StorageTarget.USER);
                                }

                                // If enabling and we have a key but no client, try to initialize
                                if (config.enabled && !this._isInitialized) {
                                                const storedKey = await this.secureKeyManager.getKey('supermemory');
                                                if (storedKey) {
                                                                this.initialize(storedKey).catch(err => {
                                                                                this.logService.warn('[ConstructMemory] Failed to initialize on config change:', err);
                                                                });
                                                }
                                }

                                // If disabling, disconnect
                                if (config.enabled === false && this._isInitialized) {
                                                this.disconnect();
                                }

                                this.logService.info(`[ConstructMemory] Config updated: enabled=${this._config.enabled}, autoLearn=${this._config.autoLearn}`);
                }

                async testConnection(): Promise<boolean> {
                                if (!this.client) {
                                                return false;
                                }

                                try {
                                                await this.client.profile({
                                                                containerTag: this.containerTag,
                                                });
                                                return true;
                                } catch {
                                                return false;
                                }
                }

                async forgetMemory(memoryId: string): Promise<void> {
                                if (!this.client) {
                                                return;
                                }

                                try {
                                                await this.client.memories.forget({ id: memoryId });
                                                this.logService.info(`[ConstructMemory] Forgot memory: ${memoryId}`);
                                } catch (error) {
                                                this.logService.error('[ConstructMemory] Failed to forget memory:', error);
                                                throw error;
                                }
                }

                async getRecentMemories(limit: number = 20): Promise<IConstructMemoryItem[]> {
                                if (!this.client || !this._config.enabled) {
                                                return [];
                                }

                                try {
                                                // Use a broad search to get recent items, sorted by recency
                                                const result = await this.client.search.memories({
                                                                q: '*',  // Broad query to get all
                                                                containerTag: this.containerTag,
                                                                searchMode: 'memories',
                                                                limit
                                                });

                                                const items: IConstructMemoryItem[] = [];

                                                if (result.results && Array.isArray(result.results)) {
                                                                for (const r of result.results) {
                                                                                const sr = r as ISupermemorySearchResult;
                                                                                let content = '';
                                                                                if (sr.memory && typeof sr.memory === 'object' && 'content' in sr.memory) {
                                                                                                content = sr.memory.content;
                                                                                } else if (typeof sr.content === 'string') {
                                                                                                content = sr.content;
                                                                                }

                                                                                items.push({
                                                                                                id: sr.id ?? `memory-${Date.now()}`,
                                                                                                content,
                                                                                                containerTag: sr.containerTag ?? this.containerTag,
                                                                                                createdAt: sr.createdAt ?? Date.now(),
                                                                                                metadata: sr.metadata,
                                                                                                score: sr.score
                                                                                });
                                                                }
                                                }

                                                return items;
                                } catch (error) {
                                                this.logService.warn('[ConstructMemory] Failed to get recent memories:', error);
                                                return [];
                                }
                }

                override dispose(): void {
                                this.client = null;
                                super.dispose();
                }
}
