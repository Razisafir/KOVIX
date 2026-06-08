// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IConstructTelemetryService = createDecorator<IConstructTelemetryService>('construct.telemetryService');

/**
 * Telemetry event types for CONSTRUCT IDE.
 */
export type ConstructTelemetryEvent =
        | 'provider.switched'
        | 'provider.connectionTested'
        | 'agent.taskStarted'
        | 'agent.taskCompleted'
        | 'agent.taskFailed'
        | 'agent.toolExecuted'
        | 'agent.diffAccepted'
        | 'agent.diffRejected'
        | 'agent.undoPerformed'
        | 'memory.stored'
        | 'memory.retrieved'
        | 'mcp.serverStarted'
        | 'mcp.serverCrashed'
        | 'session.created'
        | 'session.deleted'
        | 'config.changed'
        | 'notification.shown'
        | 'startup.time'
        | 'error.occurred';

/**
 * Telemetry properties for event context.
 */
export interface IConstructTelemetryProperties {
        [key: string]: string | number | boolean | undefined;
}

/**
 * Service for collecting and reporting usage telemetry.
 *
 * All telemetry is opt-in (disabled by default, user enables in onboarding).
 * No unique device fingerprinting — uses anonymous session IDs.
 * No code content or file names in telemetry payloads.
 *
 * Integrates with VS Code's built-in telemetry framework.
 */
export interface IConstructTelemetryService {
        readonly _serviceBrand: undefined;

        /**
         * Whether telemetry is currently enabled.
         */
        readonly isEnabled: boolean;

        /**
         * Enable or disable telemetry collection.
         */
        setEnabled(enabled: boolean): void;

        /**
         * Report a telemetry event.
         * @param event The event type.
         * @param properties Additional context (must NOT contain file contents or API keys).
         * @param measurements Numeric measurements (e.g., duration in ms).
         */
        reportEvent(event: ConstructTelemetryEvent, properties?: IConstructTelemetryProperties, measurements?: Record<string, number>): void;

        /**
         * Report an error.
         * @param errorType Category of the error.
         * @param message Error message (redacted of any secrets).
         */
        reportError(errorType: string, message: string): void;

        /**
         * Get the current telemetry data for display to the user
         * (transparency — users can see exactly what is sent).
         */
        getTelemetryData(): Record<string, unknown>;
}
