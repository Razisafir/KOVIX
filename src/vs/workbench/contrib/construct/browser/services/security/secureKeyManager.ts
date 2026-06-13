// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ISecretStorageService } from '../../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ISecureKeyManager, LLMProvider, IProviderConfig, IProviderHealthResult, IMaskedKey } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

// Storage keys for non-sensitive configuration
const STORAGE_KEY_PREFIX = 'construct.keyManager';
// Legacy plaintext key storage key (used by old CloudProvider — DO NOT write new keys here)
const STORAGE_KEY_CLOUD_API_KEY = 'construct.cloud.apiKey';
const MASKED_KEY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.maskedKeys`;
const ACTIVE_PROVIDER_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.activeProvider`;
const PROVIDERS_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.providers`;
// Flag to ensure one-time migration runs only once
const MIGRATION_DONE_KEY = `${STORAGE_KEY_PREFIX}.migrationDone`;

// Secret storage key prefix for actual API keys
const SECRET_KEY_PREFIX = 'construct.apiKey';

/**
 * Default endpoints per provider type.
 */
const DEFAULT_ENDPOINTS: Record<LLMProvider, string> = {
        anthropic: 'https://api.anthropic.com',
        openai: 'https://api.openai.com',
        ollama: 'http://localhost:11434',
        litellm: '',
        custom: '',
        supermemory: 'https://api.supermemory.ai',
};

/**
 * Human-readable labels per provider type.
 */
const PROVIDER_LABELS: Record<LLMProvider, string> = {
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        ollama: 'Ollama',
        litellm: 'LiteLLM',
        custom: 'Custom',
        supermemory: 'Supermemory',
};

/**
 * Service for securely managing LLM provider API keys.
 *
 * Sensitive keys are stored in the OS keychain via VS Code's ISecretStorageService
 * (which delegates to the OS credential store / keychain). No plaintext keys are
 * ever persisted to settings.json or other configuration files. Only masked previews
 * are stored in IStorageService for display purposes.
 */
export class SecureKeyManagerService extends Disposable implements ISecureKeyManager {
        declare readonly _serviceBrand: undefined;

        private readonly _onDidChangeKey = this._register(new Emitter<LLMProvider>());
        readonly onDidChangeKey = this._onDidChangeKey.event;

        private readonly _onDidChangeActiveProvider = this._register(new Emitter<IProviderConfig>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;

        /** In-memory cache of decrypted keys to avoid repeated keychain reads. */
        private keyCache: Map<LLMProvider, string> = new Map();

        constructor(
                @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
                @IStorageService private readonly storageService: IStorageService,
                @ILogService private readonly logService: ILogService,
                @IConstructAIService private readonly aiService: IConstructAIService,
        ) {
                super();

                // Listen for external secret changes (e.g. another window changed the key)
                this._register(this.secretStorageService.onDidChangeSecret(key => {
                        if (key.startsWith(SECRET_KEY_PREFIX)) {
                                const provider = key.slice(SECRET_KEY_PREFIX.length + 1) as LLMProvider;
                                // Invalidate the cache entry so next getKey() reads fresh from keychain
                                this.keyCache.delete(provider);
                                this._onDidChangeKey.fire(provider);
                                this.logService.trace(`[SecureKeyManager] External key change detected for provider: ${provider}`);
                        }
                }));

                // Bridge: when IConstructAIService switches provider, sync the active
                // provider in key manager. This eliminates the split-brain where one
                // system shows "cloud" and the other still shows "ollama".
                this._register(this.aiService.onDidChangeActiveProvider((providerType: AIProviderType) => {
                        const mapping: Partial<Record<AIProviderType, LLMProvider>> = {
                                ollama: 'ollama',
                                cloud: 'openai',
                                xenova: 'ollama', // xenova doesn't need keys; map to ollama
                        };
                        const llmProvider = mapping[providerType];
                        if (llmProvider) {
                                const config: IProviderConfig = {
                                        id: `construct-${llmProvider}`,
                                        name: PROVIDER_LABELS[llmProvider],
                                        provider: llmProvider,
                                        endpoint: DEFAULT_ENDPOINTS[llmProvider],
                                        isActive: true,
                                };
                                // Update storage without re-firing the event (avoid infinite loop)
                                this.storageService.store(ACTIVE_PROVIDER_STORAGE_KEY, JSON.stringify(config), StorageScope.APPLICATION, StorageTarget.USER);
                                this.logService.info(`[SecureKeyManager] Synced active provider from AIService: ${providerType} -> ${llmProvider}`);
                        }
                }));

                // One-time migration: move any plaintext API keys from IStorageService
                // into ISecretStorageService (OS keychain) and delete the plaintext copies.
                this.migratePlaintextKeys();
        }

        // ─── Key CRUD ────────────────────────────────────────────────────────────────

        async setKey(provider: LLMProvider, key: string): Promise<void> {
                const validation = this.validateKey(provider, key);
                if (!validation.valid) {
                        throw new Error(validation.error ?? `Invalid key format for ${PROVIDER_LABELS[provider]}`);
                }

                const secretKey = this.getSecretKey(provider);
                await this.secretStorageService.set(secretKey, key);

                // Update in-memory cache
                this.keyCache.set(provider, key);

                // Store masked version for display in settings UI
                const masked = this.computeMaskedDisplay(key);
                this.storeMaskedKey(provider, masked);

                // SECURITY: API keys are ONLY stored in ISecretStorageService (OS keychain).
                // No plaintext key values are written to IStorageService (state.vscdb).
                // CloudProvider and other consumers must use ISecureKeyManager to retrieve keys.

                this.logService.info(`[SecureKeyManager] API key stored for provider: ${provider}`);
                this._onDidChangeKey.fire(provider);
        }

        async getKey(provider: LLMProvider): Promise<string | null> {
                // Check cache first
                const cached = this.keyCache.get(provider);
                if (cached !== undefined) {
                        return cached;
                }

                // SECURITY: Keys are ONLY retrieved from ISecretStorageService (OS keychain).
                // No fallback to IStorageService — plaintext key storage is prohibited.
                const secretKey = this.getSecretKey(provider);
                const value = await this.secretStorageService.get(secretKey);

                if (value !== undefined && value !== null) {
                        this.keyCache.set(provider, value);
                        return value;
                }

                return null;
        }

        async deleteKey(provider: LLMProvider): Promise<void> {
                const secretKey = this.getSecretKey(provider);
                await this.secretStorageService.delete(secretKey);

                // Clear cache
                this.keyCache.delete(provider);

                // Remove masked display
                this.removeMaskedKey(provider);

                // Clean up any legacy plaintext entries from IStorageService
                // (from before migration to ISecretStorageService-only storage)
                const storageKey = `construct.${provider}.apiKey`;
                this.storageService.remove(storageKey, StorageScope.PROFILE);
                if (provider === 'openai' || provider === 'anthropic' || provider === 'litellm' || provider === 'custom') {
                        this.storageService.remove(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                }

                this.logService.info(`[SecureKeyManager] API key deleted for provider: ${provider}`);
                this._onDidChangeKey.fire(provider);
        }

        async getMaskedKey(provider: LLMProvider): Promise<IMaskedKey> {
                const key = await this.getKey(provider);

                if (!key) {
                        return { display: '', provider, hasKey: false };
                }

                return {
                        display: this.computeMaskedDisplay(key),
                        provider,
                        hasKey: true,
                };
        }

        // ─── Validation ──────────────────────────────────────────────────────────────

        validateKey(provider: LLMProvider, key: string): { valid: boolean; error?: string } {
                if (provider === 'ollama') {
                        // Ollama does not require an API key
                        return { valid: true };
                }

                if (!key || key.trim().length === 0) {
                        return { valid: false, error: `API key for ${PROVIDER_LABELS[provider]} cannot be empty.` };
                }

                switch (provider) {
                        case 'anthropic':
                                if (!key.startsWith('sk-ant-')) {
                                        return { valid: false, error: 'Anthropic API keys must start with "sk-ant-".' };
                                }
                                break;

                        case 'openai':
                                if (!key.startsWith('sk-')) {
                                        return { valid: false, error: 'OpenAI API keys must start with "sk-".' };
                                }
                                break;

                        case 'litellm':
                        case 'custom':
                                // Non-empty string is sufficient
                                break;
                }

                return { valid: true };
        }

        // ─── Connection Testing ──────────────────────────────────────────────────────

        async testConnection(providerConfig: IProviderConfig): Promise<IProviderHealthResult> {
                const startTime = Date.now();
                const provider = providerConfig.provider;

                try {
                        const key = await this.getKey(provider);
                        const endpoint = providerConfig.endpoint ?? DEFAULT_ENDPOINTS[provider];

                        let result: IProviderHealthResult;

                        switch (provider) {
                                case 'anthropic':
                                        result = await this.testAnthropicConnection(key, endpoint);
                                        break;

                                case 'openai':
                                        result = await this.testOpenAIConnection(key, endpoint);
                                        break;

                                case 'ollama':
                                        result = await this.testOllamaConnection(endpoint);
                                        break;

                                case 'litellm':
                                case 'custom':
                                        result = await this.testGenericConnection(key, endpoint);
                                        break;

                                default:
                                        result = { healthy: false, latencyMs: Date.now() - startTime, error: `Unknown provider type: ${provider}` };
                        }

                        result.latencyMs = Date.now() - startTime;
                        return result;

                } catch (error) {
                        return {
                                healthy: false,
                                latencyMs: Date.now() - startTime,
                                error: error instanceof Error ? error.message : String(error),
                        };
                }
        }

        // ─── Provider Management ─────────────────────────────────────────────────────

        async getAllProviders(): Promise<IProviderConfig[]> {
                const raw = this.storageService.get(PROVIDERS_STORAGE_KEY, StorageScope.APPLICATION);
                if (!raw) {
                        return [];
                }

                try {
                        return JSON.parse(raw) as IProviderConfig[];
                } catch {
                        this.logService.warn('[SecureKeyManager] Failed to parse stored providers, resetting.');
                        return [];
                }
        }

        async setActiveProvider(providerConfig: IProviderConfig): Promise<void> {
                // Update isActive flag across all providers
                const providers = await this.getAllProviders();
                for (const p of providers) {
                        p.isActive = p.id === providerConfig.id;
                }
                this.storageService.store(PROVIDERS_STORAGE_KEY, JSON.stringify(providers), StorageScope.APPLICATION, StorageTarget.USER);

                // Store the active provider reference separately for quick lookup
                const activeConfig = { ...providerConfig, isActive: true };
                this.storageService.store(ACTIVE_PROVIDER_STORAGE_KEY, JSON.stringify(activeConfig), StorageScope.APPLICATION, StorageTarget.USER);

                // Bridge: sync the AI service provider when the key manager switches.
                // Map LLMProvider types to AIProviderType so IConstructAIService
                // stays in sync with the key manager's active provider.
                const providerToAIType: Partial<Record<LLMProvider, AIProviderType>> = {
                        ollama: 'ollama',
                        anthropic: 'cloud',
                        openai: 'cloud',
                        litellm: 'cloud',
                        custom: 'cloud',
                };
                const aiProviderType = providerToAIType[providerConfig.provider];
                if (aiProviderType) {
                        try {
                                await this.aiService.switchProvider(aiProviderType);
                        } catch (e) {
                                this.logService.warn(`[SecureKeyManager] Could not sync AIService provider: ${e instanceof Error ? e.message : String(e)}`);
                        }
                }

                this.logService.info(`[SecureKeyManager] Active provider set to: ${providerConfig.name} (${providerConfig.provider})`);
                this._onDidChangeActiveProvider.fire(activeConfig);
        }

        async getActiveProvider(): Promise<IProviderConfig | null> {
                const raw = this.storageService.get(ACTIVE_PROVIDER_STORAGE_KEY, StorageScope.APPLICATION);
                if (!raw) {
                        return null;
                }

                try {
                        return JSON.parse(raw) as IProviderConfig;
                } catch {
                        this.logService.warn('[SecureKeyManager] Failed to parse active provider, resetting.');
                        return null;
                }
        }

        // ─── Private Helpers ─────────────────────────────────────────────────────────

        /**
         * Build the secret storage key for a given provider.
         */
        private getSecretKey(provider: LLMProvider): string {
                return `${SECRET_KEY_PREFIX}.${provider}`;
        }

        /**
         * Compute a masked display string: first 7 chars + "..." + last 4 chars.
         * If the key is too short to mask meaningfully, show only the first 3 chars + "...".
         */
        private computeMaskedDisplay(key: string): string {
                if (key.length <= 11) {
                        return `${key.slice(0, 3)}...`;
                }
                return `${key.slice(0, 7)}...${key.slice(-4)}`;
        }

        /**
         * Persist a masked key display string to IStorageService.
         */
        private storeMaskedKey(provider: LLMProvider, maskedDisplay: string): void {
                const allMasked = this.loadAllMaskedKeys();
                allMasked[provider] = maskedDisplay;
                this.storageService.store(MASKED_KEY_STORAGE_KEY, JSON.stringify(allMasked), StorageScope.APPLICATION, StorageTarget.USER);
        }

        /**
         * Remove a masked key entry from IStorageService.
         */
        private removeMaskedKey(provider: LLMProvider): void {
                const allMasked = this.loadAllMaskedKeys();
                delete allMasked[provider];
                this.storageService.store(MASKED_KEY_STORAGE_KEY, JSON.stringify(allMasked), StorageScope.APPLICATION, StorageTarget.USER);
        }

        /**
         * Load all stored masked keys from IStorageService.
         */
        private loadAllMaskedKeys(): Record<string, string> {
                const raw = this.storageService.get(MASKED_KEY_STORAGE_KEY, StorageScope.APPLICATION);
                if (!raw) {
                        return {};
                }
                try {
                        return JSON.parse(raw) as Record<string, string>;
                } catch {
                        return {};
                }
        }

        // ─── Connection Test Implementations ─────────────────────────────────────────

        /**
         * Test Anthropic connection by sending a minimal messages request.
         * A 401 indicates a bad key, a 200/400 with proper shape indicates the key works.
         */
        private async testAnthropicConnection(key: string | null, endpoint: string): Promise<IProviderHealthResult> {
                if (!key) {
                        return { healthy: false, latencyMs: 0, error: 'No API key stored for Anthropic.' };
                }

                try {
                        const response = await fetch(`${endpoint}/v1/messages`, {
                                method: 'POST',
                                headers: {
                                        'Content-Type': 'application/json',
                                        'x-api-key': key,
                                        'anthropic-version': '2023-06-01',
                                },
                                body: JSON.stringify({
                                        model: 'claude-sonnet-4-20250514',
                                        max_tokens: 1,
                                        messages: [{ role: 'user', content: 'Hi' }],
                                }),
                        });

                        if (response.status === 401) {
                                return { healthy: false, latencyMs: 0, error: 'Authentication failed. Check your API key.' };
                        }

                        if (response.status === 200) {
                                return { healthy: true, latencyMs: 0 };
                        }

                        // Other status codes (400, 429, 500, etc.) indicate the key is accepted
                        // but there may be rate limits or other transient issues.
                        // We still consider the connection healthy if the key is valid.
                        if (response.status === 400 || response.status === 429) {
                                const body = await response.text().catch(() => '');
                                return { healthy: true, latencyMs: 0, error: `Key accepted, but received status ${response.status}: ${body.slice(0, 200)}` };
                        }

                        return { healthy: true, latencyMs: 0, error: `Unexpected status: ${response.status}` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Network error: ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        /**
         * Test OpenAI connection by listing models with the stored key.
         */
        private async testOpenAIConnection(key: string | null, endpoint: string): Promise<IProviderHealthResult> {
                if (!key) {
                        return { healthy: false, latencyMs: 0, error: 'No API key stored for OpenAI.' };
                }

                try {
                        const response = await fetch(`${endpoint}/v1/models`, {
                                method: 'GET',
                                headers: {
                                        'Authorization': `Bearer ${key}`,
                                },
                        });

                        if (response.status === 401) {
                                return { healthy: false, latencyMs: 0, error: 'Authentication failed. Check your API key.' };
                        }

                        if (response.status === 200) {
                                const body = await response.json().catch(() => null) as any;
                                const models: string[] = [];
                                if (body?.data && Array.isArray(body.data)) {
                                        for (const model of body.data) {
                                                if (model.id) {
                                                        models.push(model.id);
                                                }
                                        }
                                }
                                return { healthy: true, latencyMs: 0, models };
                        }

                        return { healthy: false, latencyMs: 0, error: `Unexpected status: ${response.status}` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Network error: ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        /**
         * Test Ollama connection by fetching the tags endpoint.
         * Ollama does not require an API key.
         */
        private async testOllamaConnection(endpoint: string): Promise<IProviderHealthResult> {
                try {
                        const response = await fetch(`${endpoint}/api/tags`, {
                                method: 'GET',
                        });

                        if (response.status === 200) {
                                const body = await response.json().catch(() => null) as any;
                                const models: string[] = [];
                                if (body?.models && Array.isArray(body.models)) {
                                        for (const model of body.models) {
                                                if (model.name) {
                                                        models.push(model.name);
                                                }
                                        }
                                }
                                return { healthy: true, latencyMs: 0, models };
                        }

                        return { healthy: false, latencyMs: 0, error: `Ollama returned status ${response.status}. Is Ollama running?` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Cannot reach Ollama at ${endpoint}. Is it running? ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        /**
         * Test a generic/LiteLLM connection by trying /v1/models first, then /health.
         */
        private async testGenericConnection(key: string | null, endpoint: string): Promise<IProviderHealthResult> {
                if (!endpoint) {
                        return { healthy: false, latencyMs: 0, error: 'No endpoint configured for this provider.' };
                }

                const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                };
                if (key) {
                        headers['Authorization'] = `Bearer ${key}`;
                }

                // Try /v1/models first
                try {
                        const modelsResponse = await fetch(`${endpoint}/v1/models`, {
                                method: 'GET',
                                headers,
                        });

                        if (modelsResponse.status === 200) {
                                const body = await modelsResponse.json().catch(() => null) as any;
                                const models: string[] = [];
                                if (body?.data && Array.isArray(body.data)) {
                                        for (const model of body.data) {
                                                if (model.id) {
                                                        models.push(model.id);
                                                }
                                        }
                                }
                                return { healthy: true, latencyMs: 0, models };
                        }

                        if (modelsResponse.status === 401) {
                                return { healthy: false, latencyMs: 0, error: 'Authentication failed. Check your API key and endpoint.' };
                        }
                } catch {
                        // /v1/models failed, try /health as fallback
                }

                // Fallback: try /health endpoint
                try {
                        const healthResponse = await fetch(`${endpoint}/health`, {
                                method: 'GET',
                                headers,
                        });

                        if (healthResponse.status === 200) {
                                return { healthy: true, latencyMs: 0 };
                        }

                        return { healthy: false, latencyMs: 0, error: `Health endpoint returned status ${healthResponse.status}.` };
                } catch (error) {
                        return { healthy: false, latencyMs: 0, error: `Cannot reach endpoint at ${endpoint}: ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        // ─── Lifecycle ───────────────────────────────────────────────────────────────

        override dispose(): void {
                this.keyCache.clear();
                super.dispose();
        }

        // ─── One-time Migration ────────────────────────────────────────────────────

        /**
         * Migrate any API keys stored in plaintext (IStorageService / state.vscdb)
         * to ISecretStorageService (OS keychain), then delete the plaintext copies.
         *
         * This runs once per application scope. The MIGRATION_DONE_KEY flag prevents
         * re-running on every startup.
         */
        private async migratePlaintextKeys(): Promise<void> {
                const migrationDone = this.storageService.get(MIGRATION_DONE_KEY, StorageScope.APPLICATION);
                if (migrationDone === 'true') {
                        return;
                }

                let migrated = 0;

                try {
                        // 1. Migrate the generic cloud API key (construct.cloud.apiKey)
                        const cloudKey = this.storageService.get(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                        if (cloudKey) {
                                // Determine which provider this key belongs to based on prefix
                                let provider: LLMProvider | undefined;
                                if (cloudKey.startsWith('sk-ant-')) {
                                        provider = 'anthropic';
                                } else if (cloudKey.startsWith('sk-')) {
                                        provider = 'openai';
                                } else {
                                        // Generic key — store under 'openai' as default cloud provider
                                        provider = 'openai';
                                }

                                const secretKey = this.getSecretKey(provider);
                                const existing = await this.secretStorageService.get(secretKey);
                                if (!existing) {
                                        await this.secretStorageService.set(secretKey, cloudKey);
                                }
                                // Delete the plaintext copy
                                this.storageService.remove(STORAGE_KEY_CLOUD_API_KEY, StorageScope.APPLICATION);
                                migrated++;
                                this.logService.info(`[SecureKeyManager] Migrated API key to secure storage (provider: ${provider})`);
                        }

                        // 2. Migrate per-provider keys (construct.{provider}.apiKey)
                        const providerTypes: LLMProvider[] = ['openai', 'anthropic', 'litellm', 'custom'];
                        for (const p of providerTypes) {
                                const storageKey = `construct.${p}.apiKey`;
                                const plainKey = this.storageService.get(storageKey, StorageScope.PROFILE);
                                if (plainKey) {
                                        const secretKey = this.getSecretKey(p);
                                        const existing = await this.secretStorageService.get(secretKey);
                                        if (!existing) {
                                                await this.secretStorageService.set(secretKey, plainKey);
                                        }
                                        // Delete the plaintext copy
                                        this.storageService.remove(storageKey, StorageScope.PROFILE);
                                        migrated++;
                                        this.logService.info(`[SecureKeyManager] Migrated API key to secure storage (provider: ${p})`);
                                }
                        }

                        // 3. Mark migration as done
                        this.storageService.store(MIGRATION_DONE_KEY, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE);

                        if (migrated > 0) {
                                this.logService.info(`[SecureKeyManager] Migration complete: ${migrated} API key(s) moved from plaintext to OS keychain`);
                        } else {
                                this.logService.trace('[SecureKeyManager] No plaintext API keys found to migrate');
                        }
                } catch (error) {
                        this.logService.error(`[SecureKeyManager] Key migration failed: ${error instanceof Error ? error.message : String(error)}`);
                        // Don't set migration flag so it retries next startup
                }
        }
}
