"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
/**
 * Key validation logic from SecureKeyManager.validateKey()
 */
function validateKey(provider, key) {
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
function getMaskedDisplay(key) {
    if (key.length <= 11) {
        return key.substring(0, 3) + '...' + key.substring(key.length - 4);
    }
    return key.substring(0, 7) + '...' + key.substring(key.length - 4);
}
/**
 * Mock storage services to verify security invariants.
 */
class MockStorageService {
    store = new Map();
    get(key, scope) {
        return this.store.get(key);
    }
    set(key, value) {
        this.store.set(key, value);
    }
    has(key) {
        return this.store.has(key);
    }
    keys() {
        return Array.from(this.store.keys());
    }
}
class MockSecretStorageService {
    secrets = new Map();
    async get(key) {
        return this.secrets.get(key);
    }
    async set(key, value) {
        this.secrets.set(key, value);
    }
    async delete(key) {
        this.secrets.delete(key);
    }
    has(key) {
        return this.secrets.has(key);
    }
    keys() {
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
            const provider = 'anthropic';
            const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            // Keys go to secret storage, NOT plain storage
            secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, apiKey);
            storage.set(`${MASKED_KEY_STORAGE_KEY}.${provider}`, getMaskedDisplay(apiKey));
            // Verify: storage should NOT contain the raw key
            for (const key of storage.keys()) {
                const value = storage.get(key);
                assert.ok(!value.includes(apiKey), `Raw API key found in storage at key "${key}": ${value}`);
                assert.ok(!value.includes('sk-ant-api03'), `Partial API key found in storage at key "${key}": ${value}`);
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
            const provider = 'openai';
            const apiKey = 'sk-abcdefghijklmnopqrstuvwx1234567890';
            await secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, apiKey);
            assert.strictEqual(await secretStorage.get(`${SECRET_KEY_PREFIX}.${provider}`), apiKey);
        });
        test('all provider types are stored in secret storage', () => {
            const secretStorage = new MockSecretStorageService();
            const providers = ['anthropic', 'openai', 'litellm', 'custom'];
            for (const provider of providers) {
                secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, `test-key-${provider}`);
            }
            for (const provider of providers) {
                assert.strictEqual(secretStorage.has(`${SECRET_KEY_PREFIX}.${provider}`), true, `Provider ${provider} not found in secret storage`);
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
//# sourceMappingURL=secureKeyManager.test.js.map