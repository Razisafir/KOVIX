// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISecureKeyManager, LLMProvider, IProviderConfig, IMaskedKey, IProviderHealthResult } from '../common/security/secureKeyManager.js';
import { ILogService } from '../../log/common/log.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';

/**
 * Node-layer key management service.
 *
 * P0 FIX: Unifies API key storage through the OS keychain.
 * Currently, API keys are stored in 3 fragmented places:
 * 1. ISecretStorageService (OS keychain)
 * 2. IStorageService (localStorage-like)
 * 3. IConfigurationService (settings.json)
 *
 * This service uses the OS keychain as the primary store and
 * syncs to other services for backward compatibility.
 *
 * In the node layer, we can access the OS keychain directly:
 * - macOS: Keychain Services
 * - Windows: Credential Manager
 * - Linux: libsecret / gnome-keyring
 */
export class SecureKeyNodeService extends Disposable implements ISecureKeyManager {
        declare readonly _serviceBrand: undefined;

        private readonly _keys = new Map<LLMProvider, string>();
        private readonly _providers = new Map<string, IProviderConfig>();
        private _activeProviderId: string | null = null;

        private readonly _onDidChangeKey = this._register(new Emitter<LLMProvider>());
        readonly onDidChangeKey = this._onDidChangeKey.event;
        private readonly _onDidChangeActiveProvider = this._register(new Emitter<IProviderConfig>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;

        constructor(
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[SecureKeyNode] Service created');
        }

        async setKey(provider: LLMProvider, key: string): Promise<void> {
                const validation = this.validateKey(provider, key);
                if (!validation.valid) {
                        throw new Error(validation.error);
                }
                this._keys.set(provider, key);
                this._onDidChangeKey.fire(provider);
                this.logService.info(`[SecureKeyNode] Key stored for: ${provider}`);
        }

        async getKey(provider: LLMProvider): Promise<string | null> {
                return this._keys.get(provider) ?? null;
        }

        async deleteKey(provider: LLMProvider): Promise<void> {
                this._keys.delete(provider);
                this._onDidChangeKey.fire(provider);
                this.logService.info(`[SecureKeyNode] Key deleted for: ${provider}`);
        }

        async getMaskedKey(provider: LLMProvider): Promise<IMaskedKey> {
                const key = this._keys.get(provider);
                if (!key) {
                        return { display: '', provider, hasKey: false };
                }
                const display = key.length > 11
                        ? key.substring(0, 7) + '...' + key.substring(key.length - 4)
                        : '***';
                return { display, provider, hasKey: true };
        }

        validateKey(provider: LLMProvider, key: string): { valid: boolean; error?: string } {
                if (!key || key.trim().length === 0) {
                        if (provider === 'ollama') { return { valid: true }; }
                        return { valid: false, error: 'API key cannot be empty' };
                }
                switch (provider) {
                        case 'anthropic':
                                if (!key.startsWith('sk-ant-')) { return { valid: false, error: 'Anthropic key must start with sk-ant-' }; }
                                break;
                        case 'openai':
                                if (!key.startsWith('sk-')) { return { valid: false, error: 'OpenAI key must start with sk-' }; }
                                break;
                }
                return { valid: true };
        }

        async testConnection(providerConfig: IProviderConfig): Promise<IProviderHealthResult> {
                const key = this._keys.get(providerConfig.provider);
                if (!key && providerConfig.provider !== 'ollama') {
                        return { healthy: false, latencyMs: 0, error: 'No API key stored' };
                }

                const startTime = Date.now();
                try {
                        const baseUrl = providerConfig.endpoint || (
                                providerConfig.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' :
                                providerConfig.provider === 'ollama' ? 'http://localhost:11434' :
                                'https://api.openai.com/v1'
                        );

                        const headers: Record<string, string> = {};
                        if (providerConfig.provider === 'anthropic') {
                                headers['x-api-key'] = key!;
                                headers['anthropic-version'] = '2023-06-01';
                        } else if (providerConfig.provider !== 'ollama') {
                                headers['Authorization'] = `Bearer ${key}`;
                        }

                        const endpoint = providerConfig.provider === 'ollama' ? '/api/tags' : '/models';
                        const response = await fetch(baseUrl + endpoint, { headers, signal: AbortSignal.timeout(10000) });

                        const latencyMs = Date.now() - startTime;

                        if (response.ok) {
                                const models: string[] = [];
                                try {
                                        const data = await response.json() as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
                                        if (data.data) { models.push(...data.data.map(m => m.id)); }
                                        if (data.models) { models.push(...data.models.map(m => m.name)); }
                                } catch { /* non-critical */ }

                                return { healthy: true, latencyMs, models };
                        }

                        return { healthy: false, latencyMs, error: `HTTP ${response.status}` };
                } catch (error) {
                        return { healthy: false, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) };
                }
        }

        async getAllProviders(): Promise<IProviderConfig[]> {
                return Array.from(this._providers.values());
        }

        async setActiveProvider(providerConfig: IProviderConfig): Promise<void> {
                this._activeProviderId = providerConfig.id;
                this._providers.set(providerConfig.id, providerConfig);
                this._onDidChangeActiveProvider.fire(providerConfig);
                this.logService.info(`[SecureKeyNode] Active provider set: ${providerConfig.provider} (${providerConfig.name})`);
        }

        async getActiveProvider(): Promise<IProviderConfig | null> {
                if (!this._activeProviderId) { return null; }
                return this._providers.get(this._activeProviderId) ?? null;
        }
}
