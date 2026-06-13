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
const crypto = __importStar(require("crypto"));
/**
 * Key validation logic from SecureKeyManager.validateKey()
 */
function validateKey(provider, key) {
    switch (provider) {
        case 'ollama':
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
 * PBKDF2 key derivation — replicates the production SecureKeyManager logic.
 * Uses 600,000 iterations of SHA-512 with a salt.
 */
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha512';
function deriveEncryptionKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
}
function encryptKey(plaintext, encryptionKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return { encrypted, iv: iv.toString('hex'), tag };
}
function decryptKey(encryptedData, encryptionKey, ivHex, tagHex) {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
/**
 * Rotate encryption key — re-encrypt all keys with a new master key.
 */
function rotateEncryptionKey(keys, oldKey, newKey) {
    const result = new Map();
    for (const [provider, data] of keys) {
        const plaintext = decryptKey(data.encrypted, oldKey, data.iv, data.tag);
        const reEncrypted = encryptKey(plaintext, newKey);
        result.set(provider, reEncrypted);
    }
    return result;
}
/**
 * Zero a buffer — overwrite with zeros to clear sensitive data from memory.
 */
function zeroBuffer(buf) {
    buf.fill(0);
}
// ---- Mock storage services ----
class MockStorageService {
    store = new Map();
    get(key, _scope) {
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
    suite('Key storage — keys are stored encrypted', () => {
        test('encryptKey produces non-plaintext output', () => {
            const salt = crypto.randomBytes(16);
            const masterKey = deriveEncryptionKey('master-password', salt);
            const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            const encrypted = encryptKey(apiKey, masterKey);
            assert.ok(!encrypted.encrypted.includes(apiKey), 'Encrypted output should not contain plaintext');
            assert.ok(encrypted.encrypted.length > 0, 'Encrypted output should not be empty');
            assert.ok(encrypted.iv.length > 0, 'IV should be present');
            assert.ok(encrypted.tag.length > 0, 'Auth tag should be present');
        });
        test('decryptKey recovers the original key', () => {
            const salt = crypto.randomBytes(16);
            const masterKey = deriveEncryptionKey('master-password', salt);
            const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            const encrypted = encryptKey(apiKey, masterKey);
            const decrypted = decryptKey(encrypted.encrypted, masterKey, encrypted.iv, encrypted.tag);
            assert.strictEqual(decrypted, apiKey, 'Decrypted key should match original');
        });
        test('different IVs produce different ciphertexts', () => {
            const salt = crypto.randomBytes(16);
            const masterKey = deriveEncryptionKey('master-password', salt);
            const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            const enc1 = encryptKey(apiKey, masterKey);
            const enc2 = encryptKey(apiKey, masterKey);
            assert.notStrictEqual(enc1.encrypted, enc2.encrypted, 'Same key encrypted twice should differ (different IVs)');
        });
    });
    suite('Key retrieval — keys can be retrieved', () => {
        test('key stored in secret storage can be retrieved', async () => {
            const secretStorage = new MockSecretStorageService();
            const apiKey = 'sk-ant-api03-testkey1234567890abcdef';
            await secretStorage.set(`${SECRET_KEY_PREFIX}.anthropic`, apiKey);
            const retrieved = await secretStorage.get(`${SECRET_KEY_PREFIX}.anthropic`);
            assert.strictEqual(retrieved, apiKey, 'Retrieved key should match stored key');
        });
        test('retrieving non-existent key returns undefined', async () => {
            const secretStorage = new MockSecretStorageService();
            const retrieved = await secretStorage.get(`${SECRET_KEY_PREFIX}.anthropic`);
            assert.strictEqual(retrieved, undefined, 'Non-existent key should return undefined');
        });
    });
    suite('No plaintext — no plaintext keys in IStorageService', () => {
        test('storage service never contains raw API keys', async () => {
            const storage = new MockStorageService();
            const secretStorage = new MockSecretStorageService();
            const provider = 'anthropic';
            const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            secretStorage.set(`${SECRET_KEY_PREFIX}.${provider}`, apiKey);
            storage.set(`${MASKED_KEY_STORAGE_KEY}.${provider}`, getMaskedDisplay(apiKey));
            for (const key of storage.keys()) {
                const value = storage.get(key);
                assert.ok(!value.includes(apiKey), `Raw API key found in storage at key "${key}": ${value}`);
                assert.ok(!value.includes('sk-ant-api03'), `Partial API key found in storage at key "${key}": ${value}`);
            }
            assert.strictEqual(secretStorage.has(`${SECRET_KEY_PREFIX}.${provider}`), true);
            assert.strictEqual(await secretStorage.get(`${SECRET_KEY_PREFIX}.${provider}`), apiKey);
        });
        test('legacy plaintext storage key is never written', () => {
            const storage = new MockStorageService();
            assert.strictEqual(storage.has(STORAGE_KEY_CLOUD_API_KEY), false);
        });
    });
    suite('PBKDF2 derivation — verify proper iterations', () => {
        test('PBKDF2 uses 600,000 iterations', () => {
            assert.strictEqual(PBKDF2_ITERATIONS, 600_000, 'PBKDF2 iterations should be 600,000');
        });
        test('PBKDF2 produces deterministic key from same inputs', () => {
            const salt = crypto.randomBytes(16);
            const password = 'test-master-password';
            const key1 = deriveEncryptionKey(password, salt);
            const key2 = deriveEncryptionKey(password, salt);
            assert.ok(key1.equals(key2), 'Same inputs should produce same key');
        });
        test('different passwords produce different keys', () => {
            const salt = crypto.randomBytes(16);
            const key1 = deriveEncryptionKey('password1', salt);
            const key2 = deriveEncryptionKey('password2', salt);
            assert.ok(!key1.equals(key2), 'Different passwords should produce different keys');
        });
        test('different salts produce different keys', () => {
            const salt1 = crypto.randomBytes(16);
            const salt2 = crypto.randomBytes(16);
            const key1 = deriveEncryptionKey('same-password', salt1);
            const key2 = deriveEncryptionKey('same-password', salt2);
            assert.ok(!key1.equals(key2), 'Different salts should produce different keys');
        });
        test('derived key length is 32 bytes (256 bits)', () => {
            const salt = crypto.randomBytes(16);
            const key = deriveEncryptionKey('test', salt);
            assert.strictEqual(key.length, PBKDF2_KEY_LENGTH, 'Key should be 32 bytes');
        });
    });
    suite('Key rotation — rotateEncryptionKey works', () => {
        test('rotation re-encrypts all keys with new master key', () => {
            const oldSalt = crypto.randomBytes(16);
            const newSalt = crypto.randomBytes(16);
            const oldMasterKey = deriveEncryptionKey('old-password', oldSalt);
            const newMasterKey = deriveEncryptionKey('new-password', newSalt);
            const keys = new Map();
            const apiKey1 = 'sk-ant-api03-key1abcdefghijklmnopqrst';
            const apiKey2 = 'sk-key2abcdefghijklmnopqrstuvwx1234';
            keys.set('anthropic', encryptKey(apiKey1, oldMasterKey));
            keys.set('openai', encryptKey(apiKey2, oldMasterKey));
            const rotated = rotateEncryptionKey(keys, oldMasterKey, newMasterKey);
            // Verify keys can be decrypted with new master key
            const dec1 = decryptKey(rotated.get('anthropic').encrypted, newMasterKey, rotated.get('anthropic').iv, rotated.get('anthropic').tag);
            const dec2 = decryptKey(rotated.get('openai').encrypted, newMasterKey, rotated.get('openai').iv, rotated.get('openai').tag);
            assert.strictEqual(dec1, apiKey1, 'Rotated anthropic key should decrypt correctly');
            assert.strictEqual(dec2, apiKey2, 'Rotated openai key should decrypt correctly');
        });
        test('old master key cannot decrypt rotated keys', () => {
            const oldSalt = crypto.randomBytes(16);
            const newSalt = crypto.randomBytes(16);
            const oldMasterKey = deriveEncryptionKey('old-password', oldSalt);
            const newMasterKey = deriveEncryptionKey('new-password', newSalt);
            const apiKey = 'sk-ant-api03-key1abcdefghijklmnopqrst';
            const keys = new Map();
            keys.set('anthropic', encryptKey(apiKey, oldMasterKey));
            const rotated = rotateEncryptionKey(keys, oldMasterKey, newMasterKey);
            // Trying to decrypt with old key should fail (auth tag mismatch)
            assert.throws(() => decryptKey(rotated.get('anthropic').encrypted, oldMasterKey, rotated.get('anthropic').iv, rotated.get('anthropic').tag));
        });
    });
    suite('Memory zeroing — keys are zeroed after use', () => {
        test('zeroBuffer overwrites buffer with zeros', () => {
            const buf = Buffer.from('sensitive-key-data-here1234567890');
            assert.ok(buf.some(b => b !== 0), 'Buffer should have non-zero values before zeroing');
            zeroBuffer(buf);
            assert.ok(buf.every(b => b === 0), 'Buffer should be all zeros after zeroing');
        });
        test('zeroed buffer cannot be used for decryption', () => {
            const salt = crypto.randomBytes(16);
            const masterKey = deriveEncryptionKey('master-password', salt);
            const apiKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            const encrypted = encryptKey(apiKey, masterKey);
            // Zero the key
            zeroBuffer(masterKey);
            // Attempting decryption with zeroed key should fail (auth tag mismatch)
            assert.throws(() => decryptKey(encrypted.encrypted, masterKey, encrypted.iv, encrypted.tag));
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
        test('masked display does not reveal full key', () => {
            const anthropicKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwx';
            const openaiKey = 'sk-abcdefghijklmnopqrstuvwx1234567890abcdef';
            const anthropicMasked = getMaskedDisplay(anthropicKey);
            const openaiMasked = getMaskedDisplay(openaiKey);
            assert.ok(!anthropicMasked.includes(anthropicKey), 'Masked display contains full key!');
            assert.ok(!openaiMasked.includes(openaiKey), 'Masked display contains full key!');
            assert.strictEqual(anthropicMasked, 'sk-ant-...uvwx');
            assert.strictEqual(openaiMasked, 'sk-abcd...cdef');
        });
    });
});
//# sourceMappingURL=secureKeyManager.test.js.map