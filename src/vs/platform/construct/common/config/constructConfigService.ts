// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * @deprecated IConstructConfigService is not yet registered in the DI container.
 * Configuration is currently handled via VS Code's IConfigurationService.
 * This interface will be registered when the unified config service is implemented.
 */
export const IConstructConfigService = createDecorator<IConstructConfigService>('construct.configService');

/**
 * Configuration scopes for CONSTRUCT settings.
 */
export type ConstructConfigScope = 'machine' | 'workspace' | 'profile';

/**
 * A single configuration entry with metadata.
 */
export interface IConstructConfigEntry<T = unknown> {
        /** The configuration key (e.g., 'construct.cloud.apiKey'). */
        readonly key: string;
        /** The current value. */
        value: T;
        /** The scope where this value is stored. */
        scope: ConstructConfigScope;
        /** Whether the value has been modified from its default. */
        isModified: boolean;
        /** The default value for this key. */
        defaultValue: T;
        /** Human-readable description of this setting. */
        description: string;
}

/**
 * Centralized configuration service for CONSTRUCT IDE.
 *
 * P0 FIX: This is the SINGLE source of truth for all configuration.
 * Previously, configuration was fragmented across 3+ independent paths
 * (IConfigurationService, IStorageService, and ISecretStorageService)
 * with no synchronization between them. This service unifies them.
 *
 * Configuration priority (highest wins):
 * 1. Machine-specific overrides (OS keychain for secrets)
 * 2. Workspace settings (.construct/settings.json)
 * 3. Profile settings (user preferences)
 * 4. Default values
 */
export interface IConstructConfigService {
        readonly _serviceBrand: undefined;

        /** Event fired when any configuration value changes. */
        readonly onDidChangeConfiguration: Event<string>;

        /**
         * Get a configuration value.
         * @param key The configuration key (e.g., 'construct.cloud.baseUrl').
         * @param scope Optional scope to read from (defaults to most specific).
         */
        getValue<T>(key: string, scope?: ConstructConfigScope): T;

        /**
         * Set a configuration value.
         * @param key The configuration key.
         * @param value The value to set.
         * @param scope The scope to write to.
         */
        setValue<T>(key: string, value: T, scope: ConstructConfigScope): Promise<void>;

        /**
         * Remove a configuration value (reverts to default).
         */
        removeValue(key: string): Promise<void>;

        /**
         * Get all configuration entries, optionally filtered by prefix.
         */
        getAllEntries(prefix?: string): IConstructConfigEntry[];

        /**
         * Check if a configuration key exists.
         */
        hasValue(key: string): boolean;

        /**
         * Reset all configuration to defaults.
         */
        resetAll(): Promise<void>;

        /**
         * Get the path to the .construct directory for the current workspace.
         */
        getConstructDir(): URI;

        /**
         * Export all settings as a JSON object (for backup/migration).
         */
        exportSettings(): Record<string, unknown>;

        /**
         * Import settings from a JSON object.
         */
        importSettings(settings: Record<string, unknown>): Promise<void>;
}
