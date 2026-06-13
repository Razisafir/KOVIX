// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { ISecureKeyManager, LLMProvider, IProviderConfig, IMaskedKey, IProviderHealthResult } from '../common/security/secureKeyManager.js';
import { ILogService } from '../../log/common/log.js';
import { IEncryptionMainService } from '../../encryption/common/encryptionService.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { Queue } from '../../../base/common/async.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

/**
 * On-disk layout for encrypted API key storage.
 *
 * File: <userDataDir>/construct-keys.json
 * Contents: { "anthropic": "<encrypted>", "openai": "<encrypted>", ... }
 *           + metadata: { "activeProviderId": "...", "providers": [...] }
 *
 * Encryption: Uses Electron safeStorage (DPAPI on Windows, Keychain on macOS,
 * libsecret/gnome-keyring on Linux). If safeStorage is unavailable (e.g. headless
 * Linux without a keyring), falls back to AES-256-GCM with a PBKDF2-derived key
 * from the machine ID. If BOTH fail, throws an error — NEVER stores plaintext.
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
 * encrypted with AES-256-GCM using a key derived via PBKDF2 (100,000 iterations)
 * from the machine ID. There is NO base64 fallback — plaintext storage is
 * NEVER permitted. If both encryption methods fail, an error is thrown.
 *
 * In-memory cache is used for performance but is never the source of truth.
 * The encrypted file on disk is always authoritative.
 *
 * SEC-P2: Encryption keys are zeroed from memory after use via buffer.fill(0).
 * SEC-P2: Key derivation uses PBKDF2 with 100,000 iterations from machine ID.
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

        /** SEC-P2: PBKDF2-derived encryption key (zeroed on dispose). */
        private _derivedKey: Buffer | null = null;

        /** SEC-P2: Salt for PBKDF2 key derivation. */
        private static readonly PBKDF2_SALT = 'kovix-encryption-salt-v1';

        /** SEC-P2: PBKDF2 iteration count. */
        private static readonly PBKDF2_ITERATIONS = 100_000;

        /** SEC-P2: Key length in bytes. */
        private static readonly KEY_LENGTH = 32;

        /**
         * SEC-P2: Derive encryption key from machine ID using PBKDF2.
         * This replaces storing a random key file alongside encrypted data.
         * The machine ID provides a stable, unique per-machine key material.
         */
        private getDerivedKey(): Buffer {
                if (this._derivedKey) {
                        return this._derivedKey;
                }

                // Get machine ID: try /etc/machine-id (Linux), then hardware UUID, then hostname
                let machineId: string;
                try {
                        if (process.platform === 'linux') {
                                machineId = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
                        } else if (process.platform === 'darwin') {
                                // macOS: use IOPlatformUUID via ioreg
                                const { execSync } = require('child_process');
                                try {
                                        machineId = execSync('ioreg -rd1 -c IOPlatformExpertDevice | awk \'/IOPlatformUUID/ { gsub(/\"/,\"\",$3); print $3 }\'', { encoding: 'utf-8' }).trim();
                                } catch {
                                        machineId = os.hostname();
                                }
                        } else if (process.platform === 'win32') {
                                // Windows: use MachineGuid from registry
                                const { execSync } = require('child_process');
                                try {
                                        machineId = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf-8' })
                                                .split('\n')
                                                .find((l: string) => l.includes('MachineGuid'))
                                                ?.split('REG_SZ')?.[1]?.trim() ?? os.hostname();
                                } catch {
                                        machineId = os.hostname();
                                }
                        } else {
                                machineId = os.hostname();
                        }
                } catch {
                        machineId = os.hostname();
                }

                // Derive key using PBKDF2 with 100,000 iterations
                this._derivedKey = crypto.pbkdf2Sync(
                        machineId,
                        SecureKeyNodeService.PBKDF2_SALT,
                        SecureKeyNodeService.PBKDF2_ITERATIONS,
                        SecureKeyNodeService.KEY_LENGTH,
                        'sha256'
                );

                return this._derivedKey;
        }

        /**
         * SEC-P2: Rotate the encryption key and re-encrypt all stored secrets.
         * This generates a new PBKDF2 salt and re-encrypts all keys with the
         * new derived key. Old AES-encrypted values are decrypted and re-encrypted.
         */
        async rotateEncryptionKey(): Promise<void> {
                await this.ensureStoreLoaded();

                // Decrypt all existing keys
                const decryptedKeys: Map<LLMProvider, string> = new Map();
                for (const [provider, encrypted] of Object.entries(this.storeData.keys)) {
                        try {
                                const decrypted = await this.decryptValue(encrypted);
                                decryptedKeys.set(provider as LLMProvider, decrypted);
                        } catch (error) {
                                this.logService.error(`[SecureKeyNode] Failed to decrypt key for ${provider} during rotation: ${error instanceof Error ? error.message : String(error)}`);
                        }
                }

                // Zero out the old derived key from memory
                if (this._derivedKey) {
                        this._derivedKey.fill(0);
                        this._derivedKey = null;
                }

                // Generate new salt for the new key derivation
                const newSalt = crypto.randomBytes(16).toString('hex');
                (SecureKeyNodeService as any).PBKDF2_SALT = newSalt;

                // Re-encrypt all keys with the new derived key
                this.storeData.keys = {};
                for (const [provider, plaintext] of decryptedKeys) {
                        try {
                                const encrypted = await this.encryptValue(plaintext);
                                this.storeData.keys[provider] = encrypted;
                                this.logService.info(`[SecureKeyNode] Re-encrypted key for: ${provider}`);
                        } catch (error) {
                                this.logService.error(`[SecureKeyNode] Failed to re-encrypt key for ${provider}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                }

                await this.persistStore();
                this.logService.info('[SecureKeyNode] Encryption key rotation completed');
        }

        constructor(
                @ILogService private readonly logService: ILogService,
                @IEncryptionMainService private readonly encryptionService: IEncryptionMainService,
                @IEnvironmentMainService environmentService: IEnvironmentMainService,
        ) {
                super();
                this.storePath = join(environmentService.userDataPath, 'construct-keys.json');
                this.logService.info('[SecureKeyNode] Service created with encryption-backed storage at: ' + this.storePath);
        }

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
         * Falls back to AES-256-GCM encryption with a PBKDF2-derived key from
         * the machine ID if safeStorage is unavailable.
         * SEC-P2: There is NO base64 fallback — if both methods fail, throws an error.
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
                        this.logService.warn('[SecureKeyNode] safeStorage failed, falling back to PBKDF2-derived key encryption: ' + (error instanceof Error ? error.message : String(error)));
                        this.encryptionAvailable = false;
                }

                // SEC-P2: Use AES-256-GCM with a PBKDF2-derived key from machine ID.
                // This replaces the old random key file approach and the base64 fallback.
                try {
                        const encKey = this.getDerivedKey();

                        // Encrypt with AES-256-GCM
                        const iv = crypto.randomBytes(12);
                        const cipher = crypto.createCipheriv('aes-256-gcm', encKey as unknown as Uint8Array, iv as unknown as Uint8Array);
                        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8') as unknown as Uint8Array, cipher.final() as unknown as Uint8Array]);
                        const authTag = cipher.getAuthTag();

                        // Format: aes:iv:authTag:ciphertext (all base64)
                        return `aes:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
                } catch (aesError) {
                        // SEC-P2: NO base64 fallback — plaintext storage is NEVER permitted
                        const msg = aesError instanceof Error ? aesError.message : String(aesError);
                        this.logService.error('[SecureKeyNode] ⛔ AES-256-GCM encryption failed. Refusing to store plaintext. Error: ' + msg);
                        throw new Error('Encryption failed: cannot securely store key. Both safeStorage and AES-256-GCM are unavailable. Key will NOT be stored.');
                }
        }

        /**
         * Decrypt a value that was encrypted by encryptValue.
         * Supports: safeStorage and AES-256-GCM formats.
         * SEC-P2: b64 format is rejected — legacy base64 values must be re-stored.
         */
        private async decryptValue(ciphertext: string): Promise<string> {
                // Check for AES-GCM encrypted format
                if (ciphertext.startsWith('aes:')) {
                        const parts = ciphertext.slice(4).split(':');
                        if (parts.length !== 3) {
                                throw new Error('Invalid AES encrypted format');
                        }

                        const iv = Buffer.from(parts[0], 'base64');
                        const authTag = Buffer.from(parts[1], 'base64');
                        const encrypted = Buffer.from(parts[2], 'base64');

                        // SEC-P2: Use PBKDF2-derived key instead of key file
                        const encKey = this.getDerivedKey();

                        const decipher = crypto.createDecipheriv('aes-256-gcm', encKey as unknown as Uint8Array, iv as unknown as Uint8Array);
                        decipher.setAuthTag(authTag as unknown as Uint8Array);

                        try {
                                const result = decipher.update(encrypted as unknown as Uint8Array) + decipher.final('utf-8');
                                return result;
                        } catch (decryptError) {
                                // Decryption with PBKDF2 key failed — try legacy key file if it exists
                                const keyFilePath = nodePath.join(nodePath.dirname(this.storePath), '.construct-enc-key');
                                if (fs.existsSync(keyFilePath)) {
                                        this.logService.warn('[SecureKeyNode] PBKDF2 decryption failed, trying legacy key file');
                                        const legacyKey = Buffer.from(fs.readFileSync(keyFilePath, 'utf-8').trim(), 'hex');
                                        const legacyDecipher = crypto.createDecipheriv('aes-256-gcm', legacyKey as unknown as Uint8Array, iv as unknown as Uint8Array);
                                        legacyDecipher.setAuthTag(authTag as unknown as Uint8Array);
                                        const result = legacyDecipher.update(encrypted as unknown as Uint8Array) + legacyDecipher.final('utf-8');
                                        // Zero the legacy key from memory
                                        legacyKey.fill(0);
                                        return result;
                                }
                                throw decryptError;
                        }
                }

                // SEC-P2: Reject base64 fallback — these are insecure and must not be used
                if (ciphertext.startsWith('b64:')) {
                        throw new Error('Insecure base64-encoded key detected. Please delete and re-enter your API key. Base64 storage is no longer supported for security reasons.');
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
                // SEC-P2: Zero encryption keys from memory before garbage collection
                if (this._derivedKey) {
                        this._derivedKey.fill(0);
                        this._derivedKey = null;
                }

                this.keyCache.clear();
                super.dispose();
        }
}
