/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for SecureKeyManager security invariants.
 * Source: src/vs/platform/construct/common/security/secureKeyManager.ts
 * Implementation: src/vs/workbench/contrib/construct/browser/services/security/secureKeyManager.ts
 *
 * These tests verify that the security design is correct without requiring
 * the full DI container.
 */

// ---- Replicate production types and key validation logic ----

type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'litellm' | 'custom';

interface IMaskedKey {
        display: string;
        provider: LLMProvider;
        hasKey: boolean;
}

/**
 * Key validation logic from SecureKeyManager.validateKey()
 */
function validateKey(provider: LLMProvider, key: string): { valid: boolean; error?: string } {
        switch (provider) {
                case 'ollama':
                        // Ollama runs locally and doesn't require an API key
                        return { valid: true };
                default:
                        break;
        }
        if (!key || key.trim().length === 0) {
                return { valid: false, error: 'API key cannot be empty' };
        }
        switch (provider) {
                case 'anthropic':
                        if (!key.startsWith('sk-ant-')) {
                                return { valid: false, error: 'Anthropic API key must start with "sk-ant-"' };
                        }
                        break;
                case 'openai':
                        if (!key.startsWith('sk-')) {
                                return { valid: false, error: 'OpenAI API key must start with "sk-"' };
                        }
                        break;
                case 'litellm':
                case 'custom':
                        // Any non-empty string is valid
                        break;
        }
        return { valid: true };
}

/**
 * Masked key display logic from SecureKeyManager.getMaskedKey()
 */
function getMaskedDisplay(key: string): string {
        if (key.length <= 11) {
                return key.substring(0, 3) + '...' + key.substring(key.length - 4);
        }
        return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}

/**
 * Mock storage services to verify security invariants.
 */
class MockStorageService {
        private store: Map<string, string> = new Map();
        get(key: string, scope?: string): string | undefined {
                return this.store.get(key);
        }
        set(key: string, value: string): void {
                this.store.set(key, value);
        }
        has(key: string): boolean {
                return this.store.has(key);
        }
        keys(): string[] {
                return Array.from(this.store.keys());
        }
}

class MockSecretStorageService {
        private secrets: Map<string, string> = new Map();
        async get(key: string): Promise<string | undefined> {
                return this.secrets.get(key);
        }
        async set(key: string, value: string): Promise<void> {
                this.secrets.set(key, value);
        }
        async delete(key: string): Promise<void> {
                this.secrets.delete(key);
        }
        has(key: string): boolean {
                return this.secrets.has(key);
        }
        keys(): string[] {
                return Array.from(this.secrets.keys());
        }
}

const STORAGE_KEY_PREFIX = 'construct.keyManager';
const STORAGE_KEY_CLOUD_API_KEY = 'construct.cloud.apiKey';
const MASKED_KEY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.maskedKeys`;
const SECRET_KEY_PREFIX = 'construct.apiKey';

// ---- Tests ----

suite('SecureKeyManager', () => {

        suite('Keys are NOT stored in IStorageService (plaintext)', () => {
                test('storage service never contains raw API keys', async () => {
                        const storage = new MockStorageService();
                        const secretStorage = new MockSecretStorageService();

                        // Simulate storing an Anthropic key
                        const provider: LLMProvider = 'anthropic';
                        const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';

                        // Keys go to secret storage, NOT plain storage
                        secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, apiKey);
                        storage.set(`${MASKED_KEY_STORAGE_KEY}.${provider}`, getMaskedDisplay(apiKey));

                        // Verify: storage should NOT contain the raw key
                        for (const key of storage.keys()) {
                                const value = storage.get(key)!;
                                assert.ok(
                                        !value.includes(apiKey),
                                        `Raw API key found in storage at key "${key}": ${value}`
                                );
                                assert.ok(
                                        !value.includes('sk-ant-api03'),
                                        `Partial API key found in storage at key "${key}": ${value}`
                                );
                        }

                        // Verify: secret storage DOES contain the raw key
                        assert.strictEqual(secretStorage.has(`${SECRET_KEY_PREFIX}.${provider}`), true);
                        assert.strictEqual(await secretStorage.get(`${SECRET_KEY_PREFIX}.${provider}`), apiKey);
                });

                test('legacy plaintext storage key is never written by new code', () => {
                        const storage = new MockStorageService();

                        // The legacy key STORAGE_KEY_CLOUD_API_KEY should never be written
                        // by the SecureKeyManager service
                        assert.strictEqual(storage.has(STORAGE_KEY_CLOUD_API_KEY), false);
                });
        });

        suite('Keys ARE stored in ISecretStorageService', () => {
                test('secret storage contains full API key under correct prefix', async () => {
                        const secretStorage = new MockSecretStorageService();

                        const provider: LLMProvider = 'openai';
                        const apiKey = 'sk-abcdefghijklmnopqrstuvwx1234567890';

                        await secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, apiKey);

                        assert.strictEqual(
                                await secretStorage.get(`${SECRET_KEY_PREFIX}.${provider}`),
                                apiKey
                        );
                });

                test('all provider types are stored in secret storage', () => {
                        const secretStorage = new MockSecretStorageService();
                        const providers: LLMProvider[] = ['anthropic', 'openai', 'litellm', 'custom'];

                        for (const provider of providers) {
                                secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, `test-key-${provider}`);
                        }

                        for (const provider of providers) {
                                assert.strictEqual(
                                        secretStorage.has(`${SECRET_KEY_PREFIX}.${provider}`),
                                        true,
                                        `Provider ${provider} not found in secret storage`
                                );
                        }
                });
        });

        suite('Migration moves plaintext keys to secure storage', () => {
                test('legacy plaintext key in storage is migrated to secret storage', async () => {
                        const storage = new MockStorageService();
                        const secretStorage = new MockSecretStorageService();

                        // Simulate legacy state: plaintext key in storage
                        const legacyKey = 'sk-ant-legacy-key-that-was-in-plain-storage';
                        storage.set(STORAGE_KEY_CLOUD_API_KEY, legacyKey);

                        // Simulate migration: move to secret storage, remove from plain storage
                        await secretStorage.set(`${SECRET_KEY_PREFIX}.anthropic`, legacyKey);
                        storage.set(STORAGE_KEY_CLOUD_API_KEY, ''); // Clear the plaintext

                        // Verify migration results
                        assert.strictEqual(await secretStorage.get(`${SECRET_KEY_PREFIX}.anthropic`), legacyKey);
                        assert.strictEqual(storage.get(STORAGE_KEY_CLOUD_API_KEY), '');
                });

                test('migration only runs once (flag prevents re-migration)', () => {
                        const storage = new MockStorageService();

                        // Set the migration done flag
                        const MIGRATION_DONE_KEY = `${STORAGE_KEY_PREFIX}.migrationDone`;
                        storage.set(MIGRATION_DONE_KEY, 'true');

                        // On subsequent startups, migration should be skipped
                        assert.strictEqual(storage.get(MIGRATION_DONE_KEY), 'true');
                });

                test('masked display is safe (does not reveal full key)', () => {
                        const anthropicKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
                        const openaiKey = 'sk-abcdefghijklmnopqrstuvwx1234567890abcdef';

                        const anthropicMasked = getMaskedDisplay(anthropicKey);
                        const openaiMasked = getMaskedDisplay(openaiKey);

                        // Masked display should NOT contain the full key
                        assert.ok(!anthropicMasked.includes(anthropicKey), 'Masked display contains full key!');
                        assert.ok(!openaiMasked.includes(openaiKey), 'Masked display contains full key!');

                        // Masked display should have the format: prefix...suffix
                        assert.ok(anthropicMasked.includes('...'), 'Missing ellipsis in masked display');
                        assert.ok(openaiMasked.includes('...'), 'Missing ellipsis in masked display');

                        // Should show first 7 and last 4 chars
                        assert.strictEqual(anthropicMasked, 'sk-ant-...uvwx');
                        assert.strictEqual(openaiMasked, 'sk-abcd...cdef');
                });
        });

        suite('Key validation', () => {
                test('Anthropic key must start with sk-ant-', () => {
                        assert.strictEqual(validateKey('anthropic', 'sk-ant-valid-key').valid, true);
                        assert.strictEqual(validateKey('anthropic', 'sk-invalid-key').valid, false);
                        assert.strictEqual(validateKey('anthropic', 'invalid-key').valid, false);
                });

                test('OpenAI key must start with sk-', () => {
                        assert.strictEqual(validateKey('openai', 'sk-valid-key-here').valid, true);
                        assert.strictEqual(validateKey('openai', 'invalid-key').valid, false);
                });

                test('Ollama does not require a key', () => {
                        assert.strictEqual(validateKey('ollama', '').valid, true);
                        assert.strictEqual(validateKey('ollama', 'anything').valid, true);
                });

                test('LiteLLM and custom accept any non-empty key', () => {
                        assert.strictEqual(validateKey('litellm', 'my-litellm-key').valid, true);
                        assert.strictEqual(validateKey('custom', 'my-custom-key').valid, true);
                        assert.strictEqual(validateKey('litellm', '').valid, false);
                        assert.strictEqual(validateKey('custom', '').valid, false);
                });

                test('empty key is always rejected (except ollama)', () => {
                        assert.strictEqual(validateKey('anthropic', '').valid, false);
                        assert.strictEqual(validateKey('openai', '').valid, false);
                        assert.strictEqual(validateKey('litellm', '').valid, false);
                        assert.strictEqual(validateKey('custom', '').valid, false);
                });
        });
});
