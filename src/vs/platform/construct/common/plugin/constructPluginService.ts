/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

/**
 * @deprecated IConstructPluginService is not yet registered in the DI container.
 * Plugin marketplace support is planned for a future release (P3).
 * Do not inject this service until an implementation is provided.
 */
export const IConstructPluginService = createDecorator<IConstructPluginService>('construct.pluginService');

/**
 * A plugin that extends CONSTRUCT IDE functionality.
 */
export interface IConstructPlugin {
        /** Unique identifier (e.g., 'com.construct.plugin-security-scanner'). */
        readonly id: string;
        /** Display name. */
        readonly name: string;
        /** Plugin version. */
        readonly version: string;
        /** Brief description. */
        readonly description: string;
        /** Author name or organization. */
        readonly author: string;
        /** Whether this plugin is currently enabled. */
        enabled: boolean;
        /** Plugin capabilities. */
        readonly capabilities: IConstructPluginCapability[];
}

/**
 * Capabilities a plugin can provide.
 */
export interface IConstructPluginCapability {
        /** Type of capability. */
        type: 'tool' | 'provider' | 'memory' | 'ui' | 'theme';
        /** Unique ID for this capability. */
        id: string;
        /** Display name. */
        name: string;
}

/**
 * Service for managing CONSTRUCT IDE plugins.
 *
 * P3: Plugin marketplace API for community tools and integrations.
 * This is a future-facing interface — the MVP focuses on the core IDE.
 */
export interface IConstructPluginService {
        readonly _serviceBrand: undefined;

        /** Event fired when a plugin is installed. */
        readonly onDidInstallPlugin: Event<IConstructPlugin>;
        /** Event fired when a plugin is uninstalled. */
        readonly onDidUninstallPlugin: Event<string>;
        /** Event fired when a plugin is enabled/disabled. */
        readonly onDidChangePluginState: Event<IConstructPlugin>;

        /** All installed plugins. */
        readonly plugins: ReadonlyArray<IConstructPlugin>;

        /**
         * Install a plugin from the marketplace.
         */
        install(pluginId: string): Promise<IConstructPlugin>;

        /**
         * Uninstall a plugin.
         */
        uninstall(pluginId: string): Promise<void>;

        /**
         * Enable or disable a plugin.
         */
        setEnabled(pluginId: string, enabled: boolean): Promise<void>;

        /**
         * Search the marketplace for plugins.
         */
        search(query: string): Promise<IConstructPlugin[]>;
}
