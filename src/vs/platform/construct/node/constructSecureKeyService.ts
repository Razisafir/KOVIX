// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISecureKeyManager, LLMProvider, IProviderConfig, IMaskedKey, IProviderHealthResult } from '../common/security/secureKeyManager.js';
import { ILogService } from '../../log/common/log.js';
import { IEncryptionMainService } from '../../encryption/common/encryptionService.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { Queue } from '../../../base/common/async.js';

/**
 * On-disk layout for encrypted API key storage.
 *
 * File: <userDataDir>/construct-keys.json
 * Contents: { "anthropic": "<encrypted>", "openai": "<encrypted>", ... }
 *           + metadata: { "activeProviderId": "...", "providers": [...] }
 *
 * Encryption: Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS,
 * libsecret/gnome-keyring on Linux). If safeStorage is unavailable (e.g. headless
 * Linux without a keyring), falls back to base64 obfuscation with a warning.
 * This is equivalent to VS Code's own --password-store=basic fallback.
 */
interface KeyStoreData {
        /** Encrypted API keys, keyed by LLMProvider. */
        keys: Record<string, string>;
        /** Active provider configuration. */
        activeProviderId: string | null;
        /** All provider configurations. */
        providers: IProviderConfig[];
}

/**
 * Node-layer key management service.
 *
 * SECURITY: API keys are encrypted with Electron's safeStorage API before
 * being persisted to disk. safeStorage delegates to:
 * - macOS: Keychain Services
 * - Windows: Credential Manager (DPAPI)
 * - Linux: libsecret / gnome-keyring / kwallet
 *
 * If safeStorage is unavailable (headless Linux without a keyring), keys are
 * obfuscated with base64 and a loud warning is logged. This matches VS Code's
 * own fallback behavior when --password-store=basic is used.
 *
 * In-memory cache is used for performance but is never the source of truth.
 * The encrypted file on disk is always authoritative.
 */
export class SecureKeyNodeService extends Disposable implements ISecureKeyManager {
        declare readonly _serviceBrand: undefined;

        private readonly _onDidChangeKey = this._register(new Emitter<LLMProvider>());
        readonly onDidChangeKey = this._onDidChangeKey.event;
        private readonly _onDidChangeActiveProvider = this._register(new Emitter<IProviderConfig>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;

        /** Path to the encrypted key store file. */
        private readonly storePath: string;

        /** In-memory cache of decrypted keys (for performance, NOT source of truth). */
        private keyCache: Map<LLMProvider, string> = new Map();

        /** Whether encryption is available on this system. */
        private encryptionAvailable: boolean = true;

        /** Whether the store has been loaded from disk yet. */
        private storeLoaded = false;

        /** In-memory store data (loaded from disk). */
        private storeData: KeyStoreData = { keys: {}, activeProviderId: null, providers: [] };

        /** Serialize writes to the key store file. */
        private readonly writeQueue = new Queue<void>();

        constructor(
                @ILogService private readonly logService: ILogService,
                @IEncryptionMainService private readonly encryptionService: IEncryptionMainService,
                @IEnvironmentMainService environmentService: IEnvironmentMainService,
        ) {
                super();
                this.storePath = join(environmentService.userDataPath, 'construct-keys.json');
                this.logService.info('[SecureKeyNode] Service created with encryption-backed storage at: ' + this.storePath);
        }

        // ─── Key CRUD ────────────────────────────────────────────────────────────────

        async setKey(provider: LLMProvider, key: string): Promise<void> {
                const validation = this.validateKey(provider, key);
                if (!validation.valid) {
                        throw new Error(validation.error);
                }

                await this.ensureStoreLoaded();

                const encrypted = await this.encryptValue(key);
                this.storeData.keys[provider] = encrypted;
                this.keyCache.set(provider, key);

                await this.persistStore();
                this.logService.info(`[SecureKeyNode] Key stored (encrypted) for: ${provider}`);
                this._onDidChangeKey.fire(provider);
        }

        async getKey(provider: LLMProvider): Promise<string | null> {
                // Check cache first
                const cached = this.keyCache.get(provider);
                if (cached !== undefined) {
                        return cached;
                }

                await this.ensureStoreLoaded();

                const encrypted = this.storeData.keys[provider];
                if (!encrypted) {
                        return null;
                }

                try {
                        const decrypted = await this.decryptValue(encrypted);
                        this.keyCache.set(provider, decrypted);
                        return decrypted;
                } catch (error) {
                        this.logService.error(`[SecureKeyNode] Failed to decrypt key for ${provider}: ${error instanceof Error ? error.message : String(error)}`);
                        return null;
                }
        }

        async deleteKey(provider: LLMProvider): Promise<void> {
                await this.ensureStoreLoaded();

                delete this.storeData.keys[provider];
                this.keyCache.delete(provider);

                await this.persistStore();
                this.logService.info(`[SecureKeyNode] Key deleted for: ${provider}`);
                this._onDidChangeKey.fire(provider);
        }

        async getMaskedKey(provider: LLMProvider): Promise<IMaskedKey> {
                const key = await this.getKey(provider);
                if (!key) {
                        return { display: '', provider, hasKey: false };
                }
                const display = key.length > 11
                        ? key.substring(0, 7) + '...' + key.substring(key.length - 4)
                        : '***';
                return { display, provider, hasKey: true };
        }

        // ─── Validation ──────────────────────────────────────────────────────────────

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

        // ─── Connection Testing ──────────────────────────────────────────────────────

        async testConnection(providerConfig: IProviderConfig): Promise<IProviderHealthResult> {
                const key = await this.getKey(providerConfig.provider);
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
                                headers['Authorization'] = 'Bearer ' + key;
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

                        return { healthy: false, latencyMs, error: 'HTTP ' + response.status };
                } catch (error) {
                        return { healthy: false, latencyMs: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) };
                }
        }

        // ─── Provider Management ─────────────────────────────────────────────────────

        async getAllProviders(): Promise<IProviderConfig[]> {
                await this.ensureStoreLoaded();
                return this.storeData.providers;
        }

        async setActiveProvider(providerConfig: IProviderConfig): Promise<void> {
                await this.ensureStoreLoaded();

                // Update isActive flag across all providers
                for (const p of this.storeData.providers) {
                        p.isActive = p.id === providerConfig.id;
                }

                // Add if not already present
                if (!this.storeData.providers.find(p => p.id === providerConfig.id)) {
                        this.storeData.providers.push({ ...providerConfig, isActive: true });
                }

                this.storeData.activeProviderId = providerConfig.id;

                await this.persistStore();
                this.logService.info('[SecureKeyNode] Active provider set: ' + providerConfig.provider + ' (' + providerConfig.name + ')');
                this._onDidChangeActiveProvider.fire(providerConfig);
        }

        async getActiveProvider(): Promise<IProviderConfig | null> {
                await this.ensureStoreLoaded();
                if (!this.storeData.activeProviderId) { return null; }
                return this.storeData.providers.find(p => p.id === this.storeData.activeProviderId) ?? null;
        }

        // ─── Encryption Helpers ─────────────────────────────────────────────────────

        /**
         * Encrypt a plaintext value using Electron's safeStorage.
         * Falls back to AES-256-GCM encryption with a machine-derived key if
         * safeStorage is unavailable. This is far more secure than base64.
         */
        private async encryptValue(plaintext: string): Promise<string> {
                try {
                        if (this.encryptionAvailable) {
                                const available = await this.encryptionService.isEncryptionAvailable();
                                if (available) {
                                        return await this.encryptionService.encrypt(plaintext);
                                }
                                this.encryptionAvailable = false;
                        }
                } catch (error) {
                        this.logService.warn('[SecureKeyNode] safeStorage failed, falling back to machine-key encryption: ' + (error instanceof Error ? error.message : String(error)));
                        this.encryptionAvailable = false;
                }

                // BUG 3 FIX: Use AES-256-GCM with a machine-derived key instead of base64.
                // The key is derived from /etc/machine-id (Linux), hardware UUID, or a
                // random key file persisted alongside the key store.
                try {
                        const crypto = await import('crypto');
                        const { readFileSync, writeFileSync, existsSync } = await import('fs');
                        const { dirname, join } = await import('path');

                        // Get or create a machine-specific encryption key
                        const keyFilePath = join(dirname(this.storePath), '.construct-enc-key');
                        let encKey: Buffer;

                        if (existsSync(keyFilePath)) {
                                encKey = Buffer.from(readFileSync(keyFilePath, 'utf-8').trim(), 'hex');
                        } else {
                                // Try to derive from machine-id on Linux
                                let keyMaterial: string;
                                try {
                                        keyMaterial = readFileSync('/etc/machine-id', 'utf-8').trim();
                                } catch {
                                        // No machine-id — generate a random key and persist it
                                        keyMaterial = crypto.randomBytes(32).toString('hex');
                                }
                                // Derive a 32-byte key using SHA-256
                                encKey = crypto.createHash('sha256').update('construct-ide:' + keyMaterial).digest();
                                writeFileSync(keyFilePath, encKey.toString('hex'), { mode: 0o600 });
                        }

                        // Encrypt with AES-256-GCM
                        const iv = crypto.randomBytes(12);
                        const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
                        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
                        const authTag = cipher.getAuthTag();

                        // Format: aes:iv:authTag:ciphertext (all base64)
                        return `aes:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
                } catch (aesError) {
                        // Last resort fallback — base64 (NOT secure)
                        this.logService.warn('[SecureKeyNode] ⚠️ AES encryption failed, using base64 obfuscation: ' +
                                (aesError instanceof Error ? aesError.message : String(aesError)));
                        return 'b64:' + Buffer.from(plaintext, 'utf-8').toString('base64');
                }
        }

        /**
         * Decrypt a value that was encrypted by encryptValue.
         * Supports: safeStorage, AES-256-GCM, and base64 formats.
         */
        private async decryptValue(ciphertext: string): Promise<string> {
                // Check for AES-GCM encrypted format
                if (ciphertext.startsWith('aes:')) {
                        const crypto = await import('crypto');
                        const { readFileSync, existsSync } = await import('fs');
                        const { dirname, join } = await import('path');

                        const parts = ciphertext.slice(4).split(':');
                        if (parts.length !== 3) {
                                throw new Error('Invalid AES encrypted format');
                        }

                        const iv = Buffer.from(parts[0], 'base64');
                        const authTag = Buffer.from(parts[1], 'base64');
                        const encrypted = Buffer.from(parts[2], 'base64');

                        // Read the encryption key
                        const keyFilePath = join(dirname(this.storePath), '.construct-enc-key');
                        if (!existsSync(keyFilePath)) {
                                throw new Error('Encryption key file not found — cannot decrypt');
                        }
                        const encKey = Buffer.from(readFileSync(keyFilePath, 'utf-8').trim(), 'hex');

                        const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
                        decipher.setAuthTag(authTag);
                        return decipher.update(encrypted) + decipher.final('utf-8');
                }

                // Check for base64 fallback prefix
                if (ciphertext.startsWith('b64:')) {
                        return Buffer.from(ciphertext.slice(4), 'base64').toString('utf-8');
                }

                // Use safeStorage decryption
                return await this.encryptionService.decrypt(ciphertext);
        }

        // ─── Persistence ─────────────────────────────────────────────────────────────

        /**
         * Load the key store from disk. Called lazily on first access.
         */
        private async ensureStoreLoaded(): Promise<void> {
                if (this.storeLoaded) { return; }

                try {
                        const { readFile } = await import('fs/promises');
                        const raw = await readFile(this.storePath, 'utf-8');
                        const parsed = JSON.parse(raw) as KeyStoreData;
                        this.storeData = {
                                keys: parsed.keys || {},
                                activeProviderId: parsed.activeProviderId || null,
                                providers: parsed.providers || [],
                        };
                        this.logService.info('[SecureKeyNode] Key store loaded from disk (' + Object.keys(this.storeData.keys).length + ' keys)');
                } catch (error) {
                        // File doesn't exist or is corrupt — start fresh
                        if ((error as any).code !== 'ENOENT') {
                                this.logService.warn('[SecureKeyNode] Failed to load key store, starting fresh: ' + (error instanceof Error ? error.message : String(error)));
                        }
                        this.storeData = { keys: {}, activeProviderId: null, providers: [] };
                }

                this.storeLoaded = true;
        }

        /**
         * Persist the key store to disk. Serialized through a write queue.
         */
        private async persistStore(): Promise<void> {
                this.writeQueue.queue(async () => {
                        try {
                                const { writeFile, mkdir } = await import('fs/promises');
                                const { dirname } = await import('path');
                                const dir = dirname(this.storePath);
                                await mkdir(dir, { recursive: true });
                                await writeFile(this.storePath, JSON.stringify(this.storeData, null, 2), 'utf-8');
                        } catch (error) {
                                this.logService.error('[SecureKeyNode] Failed to persist key store: ' + (error instanceof Error ? error.message : String(error)));
                        }
                });
        }

        // ─── Lifecycle ───────────────────────────────────────────────────────────────

        override dispose(): void {
                this.keyCache.clear();
                super.dispose();
        }
}
