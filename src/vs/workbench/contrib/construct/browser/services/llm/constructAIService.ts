// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import {
        IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
        IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
        IToolDefinition, ProviderStatus
} from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { ISecureKeyManager } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { OllamaProvider } from './ollamaProvider.js';
import { XenovaProvider } from './xenovaProvider.js';
import { CloudProvider } from './cloudProvider.js';

const STORAGE_KEY_PREFERRED_PROVIDER = 'construct.preferredProvider';

/**
 * ConstructAIService — the unified AI service that auto-selects the best provider.
 *
 * This service orchestrates three AI providers:
 * 1. OllamaProvider — local inference via Ollama (preferred)
 * 2. XenovaProvider — in-process ONNX models (offline fallback)
 * 3. CloudProvider — optional OpenAI-compatible API (last resort)
 *
 * At startup, it checks each provider in priority order and selects the
 * first one that reports ProviderStatus.Available. If the user has
 * explicitly chosen a provider via settings, that preference is honored.
 *
 * OFFLINE FIRST: Ollama and Xenova are preferred over Cloud.
 * The status bar shows whether the active provider is local or cloud.
 *
 * Graceful degradation:
 * - If no provider is available, chat() yields an error event with
 *   instructions for the user to install Ollama or configure a cloud key.
 * - Provider status is continuously monitored; if a provider goes down,
 *   auto-select switches to the next available one.
 */
export class ConstructAIService extends Disposable implements IConstructAIService {
        readonly _serviceBrand: undefined;

        private readonly _providers: Map<AIProviderType, IConstructAIProvider> = new Map();
        private _activeProvider: IConstructAIProvider | undefined;

        /** H8: Active stream controller for in-flight request abort on provider switch. */
        private _activeStreamController: AbortController | null = null;

        private readonly _onDidChangeActiveProvider = this._register(new Emitter<AIProviderType>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;
        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @INotificationService private readonly notificationService: INotificationService,
                @IConfigurationService configurationService: IConfigurationService,
                @IStorageService private readonly storageService: IStorageService,
                @ISecureKeyManager private readonly _keyManager: ISecureKeyManager,
        ) {
                super();

                // Instantiate all providers
                const ollama = new OllamaProvider(logService, configurationService);
                const xenova = new XenovaProvider(logService, configurationService);
                const cloud = new CloudProvider(logService, configurationService, this._keyManager);

                this._providers.set('ollama', ollama);
                this._providers.set('xenova', xenova);
                this._providers.set('cloud', cloud);

                // Listen for provider status changes
                for (const [type, provider] of this._providers) {
                        this._register(provider.onDidChangeStatus(() => {
                                this.logService.info('[ConstructAIService] Provider ' + type + ' status changed to: ' + provider.checkStatus());
                        }));
                        this._register(provider.onDidChangeActiveModel((model) => {
                                if (provider === this._activeProvider) {
                                        this._onDidChangeActiveModel.fire(model);
                                }
                        }));
                }

                this.logService.info('[ConstructAIService] Initialized with 3 providers (ollama, xenova, cloud)');
        }

        get activeProvider(): IConstructAIProvider | undefined {
                return this._activeProvider;
        }

        get activeProviderType(): AIProviderType | undefined {
                return this._activeProvider?.providerType;
        }

        async autoSelectProvider(): Promise<IConstructAIProvider | undefined> {
                // Check if user has a preferred provider
                const preferred = this.storageService.get(STORAGE_KEY_PREFERRED_PROVIDER, 0 /* StorageScope.APPLICATION */);
                if (preferred) {
                        const preferredProvider = this._providers.get(preferred as AIProviderType);
                        if (preferredProvider) {
                                const status = await preferredProvider.checkStatus();
                                if (status === ProviderStatus.Available) {
                                        this._setActiveProvider(preferred as AIProviderType);
                                        return this._activeProvider;
                                }
                        }
                }

                // Auto-select in priority order: Ollama > Xenova > Cloud
                const priorityOrder: AIProviderType[] = ['ollama', 'xenova', 'cloud'];

                for (const type of priorityOrder) {
                        const provider = this._providers.get(type);
                        if (!provider) { continue; }

                        this.logService.info('[ConstructAIService] Checking provider: ' + type);
                        const status = await provider.checkStatus();

                        if (status === ProviderStatus.Available) {
                                this._setActiveProvider(type);
                                this.logService.info('[ConstructAIService] Auto-selected provider: ' + type);
                                return this._activeProvider;
                        }

                        this.logService.info('[ConstructAIService] Provider ' + type + ' not available (status: ' + status + ')');
                }

                // No provider available
                this.logService.warn('[ConstructAIService] No AI provider available. User needs to install Ollama or configure a cloud API key.');
                this.notificationService.warn(
                        'CONSTRUCT: No AI provider available. Install Ollama (ollama.ai) or configure a cloud API key in settings.'
                );
                return undefined;
        }

        async switchProvider(providerType: AIProviderType): Promise<boolean> {
                // H8: Abort any in-flight stream before switching providers
                if (this._activeStreamController) {
                        this.logService.info('[ConstructAIService] Aborting in-flight stream before provider switch');
                        this._activeStreamController.abort();
                        this._activeStreamController = null;
                }

                const provider = this._providers.get(providerType);
                if (!provider) {
                        this.logService.warn('[ConstructAIService] Unknown provider type: ' + providerType);
                        return false;
                }

                const status = await provider.checkStatus();
                if (status !== ProviderStatus.Available) {
                        this.logService.warn('[ConstructAIService] Provider ' + providerType + ' is not available (status: ' + status + ')');
                        if (providerType === 'xenova' && status === ProviderStatus.Unreachable) {
                                this.notificationService.warn(
                                        'Xenova (in-process AI) is unavailable because Electron sandbox blocks Web Workers. ' +
                                        'To use local AI: install Ollama (https://ollama.ai) or configure a cloud provider. ' +
                                        'Cloud providers (Anthropic, OpenAI) are not affected by this limitation.'
                                );
                        } else {
                                this.notificationService.warn(
                                        'CONSTRUCT: ' + providerType.charAt(0).toUpperCase() + providerType.slice(1) + ' provider is not available. Status: ' + status
                                );
                        }
                        return false;
                }

                // Save preference
                this.storageService.store(STORAGE_KEY_PREFERRED_PROVIDER, providerType, 0 /* StorageScope.APPLICATION */, 1 /* StorageTarget.MACHINE */);
                this._setActiveProvider(providerType);
                this.logService.info('[ConstructAIService] Switched to provider: ' + providerType);
                return true;
        }

        async getAllProviderStatuses(): Promise<Map<AIProviderType, ProviderStatus>> {
                const statuses = new Map<AIProviderType, ProviderStatus>();
                for (const [type, provider] of this._providers) {
                        statuses.set(type, await provider.checkStatus());
                }
                return statuses;
        }

        getProvider(type: AIProviderType): IConstructAIProvider | undefined {
                return this._providers.get(type);
        }

        async *chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                if (!this._activeProvider) {
                        yield {
                                type: 'error',
                                text: 'No AI provider available. Please install Ollama (https://ollama.ai) or configure a cloud API key in CONSTRUCT settings.',
                        };
                        return;
                }

                // H8: Create an AbortController for this stream and store it
                const streamController = new AbortController();
                this._activeStreamController = streamController;

                // Merge the caller's signal with our stream controller
                const mergedOptions: IChatOptions = { ...options };
                if (options?.signal) {
                        options.signal.addEventListener('abort', () => streamController.abort());
                }
                mergedOptions.signal = streamController.signal;

                try {
                        yield* this._activeProvider.chat(messages, tools, mergedOptions);
                } finally {
                        if (this._activeStreamController === streamController) {
                                this._activeStreamController = null;
                        }
                }
        }

        async complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                if (!this._activeProvider) {
                        return { text: '', finished: true };
                }
                return this._activeProvider.complete(prefix, suffix, options);
        }

        async listModels(): Promise<IModelInfo[]> {
                if (!this._activeProvider) {
                        return [];
                }
                return this._activeProvider.listModels();
        }

        getActiveModel(): IModelInfo | undefined {
                return this._activeProvider?.getActiveModel();
        }

        async setActiveModel(modelId: string): Promise<boolean> {
                if (!this._activeProvider) {
                        return false;
                }
                return this._activeProvider.setActiveModel(modelId);
        }

        isOffline(): boolean {
                return this._activeProvider?.isOffline() ?? false;
        }

        // --- Private helpers ---

        private _setActiveProvider(type: AIProviderType): void {
                // Bug 4 fix: Abort any in-flight stream before switching providers
                if (this._activeStreamController) {
                        this._activeStreamController.abort();
                        this._activeStreamController = null;
                }

                this._activeProvider = this._providers.get(type);
                this._onDidChangeActiveProvider.fire(type);
                if (this._activeProvider) {
                        this._onDidChangeActiveModel.fire(this._activeProvider.getActiveModel());
                }
        }

        override dispose(): void {
                for (const provider of this._providers.values()) {
                        provider.dispose();
                }
                this._providers.clear();
                super.dispose();
        }
}
