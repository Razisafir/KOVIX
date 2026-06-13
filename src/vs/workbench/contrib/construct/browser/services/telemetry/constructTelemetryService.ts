// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IConstructTelemetryService, ConstructTelemetryEvent, IConstructTelemetryProperties } from '../../../../../../platform/construct/common/telemetry/constructTelemetryService.js';

/**
 * No-op implementation of IConstructTelemetryService.
 *
 * All telemetry methods are safe no-ops until a real telemetry backend
 * is connected. Telemetry is opt-in and disabled by default.
 */
export class ConstructTelemetryService implements IConstructTelemetryService {
	readonly _serviceBrand: undefined;

	private _enabled: boolean = false;

	get isEnabled(): boolean {
		return this._enabled;
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	reportEvent(_event: ConstructTelemetryEvent, _properties?: IConstructTelemetryProperties, _measurements?: Record<string, number>): void {
		// No-op: telemetry not yet connected
	}

	reportError(_errorType: string, _message: string): void {
		// No-op: telemetry not yet connected
	}

	getTelemetryData(): Record<string, unknown> {
		return { enabled: this._enabled, eventsCollected: 0 };
	}
}
