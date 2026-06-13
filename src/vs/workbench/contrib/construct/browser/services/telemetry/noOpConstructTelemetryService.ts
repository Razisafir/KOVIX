// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  No-op implementation of IConstructTelemetryService.
 *  All methods are empty stubs — telemetry is opt-in and disabled by default.
 *  When telemetry is enabled in the future, replace this with a real implementation
 *  that integrates with VS Code's ITelemetryService.
 *--------------------------------------------------------------------------------------------*/

import { IConstructTelemetryService, ConstructTelemetryEvent, IConstructTelemetryProperties } from '../../../../../../platform/construct/common/telemetry/constructTelemetryService.js';

export class NoOpConstructTelemetryService implements IConstructTelemetryService {
        readonly _serviceBrand: undefined;

        private _enabled = false;

        get isEnabled(): boolean {
                return this._enabled;
        }

        setEnabled(enabled: boolean): void {
                this._enabled = enabled;
        }

        reportEvent(_event: ConstructTelemetryEvent, _properties?: IConstructTelemetryProperties, _measurements?: Record<string, number>): void {
                // No-op: telemetry is disabled by default
        }

        reportError(_errorType: string, _message: string): void {
                // No-op: telemetry is disabled by default
        }

        getTelemetryData(): Record<string, unknown> {
                return { enabled: this._enabled, eventsSent: 0 };
        }
}
