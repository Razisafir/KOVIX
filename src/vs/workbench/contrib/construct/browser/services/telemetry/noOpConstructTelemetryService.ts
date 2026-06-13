/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
