// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { LLMProvider } from './secureKeyManager.js';

/**
 * @deprecated IConstructKeyVault is deprecated. Use ISecureKeyManager instead.
 * This interface was never fully implemented. All key management goes through
 * ISecureKeyManager, which stores keys in the OS keychain via ISecretStorageService
 * and syncs to IStorageService for backward compatibility.
 *
 * This interface will be removed in a future version.
 */
export const IConstructKeyVault = createDecorator<IConstructKeyVault>('construct.keyVault');

/**
 * SEC-5: ConstructKeyVault — wraps the existing ISecurityKeyManager.
 *
 * API keys (Anthropic sk-ant-*, OpenAI sk-*, etc.) must never:
 * - Appear in any log file
 * - Appear in any IPC message payload (pass key references, not values)
 * - Be stored in plain text in .construct/settings.json
 * - Be committed to git
 *
 * This service ensures keys are ONLY stored via the OS keychain
 * through ISecureKeyManager, and are only ever accessed via
 * key references (provider name), not raw values in IPC messages.
 */
export interface IConstructKeyVault {
        readonly _serviceBrand: undefined;

        /**
         * Store an API key for a provider via the OS keychain.
         * Never writes the key to any settings file.
         *
         * @param provider The LLM provider.
         * @param key The API key to store securely.
         */
        setKey(provider: LLMProvider, key: string): Promise<void>;

        /**
         * Retrieve an API key from the OS keychain.
         * This should only be called by the backend when making API requests.
         * NEVER pass the returned value through IPC — use key references instead.
         *
         * @param provider The LLM provider.
         * @returns The API key, or null if none is stored.
         */
        getKey(provider: LLMProvider): Promise<string | null>;

        /**
         * Get a key reference (provider name) for IPC communication.
         * This is the ONLY way to refer to keys across the IPC bridge.
         * The actual key value is never transmitted.
         *
         * @param provider The LLM provider.
         * @returns A reference object that can be safely passed over IPC.
         */
        getKeyReference(provider: LLMProvider): { provider: LLMProvider; hasKey: boolean };

        /**
         * Delete a stored key.
         */
        deleteKey(provider: LLMProvider): Promise<void>;

        /**
         * Check if a key is stored for a provider (without retrieving it).
         */
        hasKey(provider: LLMProvider): Promise<boolean>;
}
