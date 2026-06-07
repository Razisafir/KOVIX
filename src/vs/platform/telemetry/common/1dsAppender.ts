/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//
// CONSTRUCT IDE MODIFICATION: All 1DS telemetry has been neutralized.
// Users of an offline AI IDE must not phone home. The log() and flush()
// methods are no-ops. The original implementation is preserved in git history.
//

import type { IExtendedTelemetryItem, ITelemetryItem, ITelemetryUnloadState } from '@microsoft/1ds-core-js';
import type { IXHROverride } from '@microsoft/1ds-post-js';
import { ITelemetryAppender } from './telemetryUtils.js';

// Interface type preserved for API compatibility with subclasses and tests.
export interface IAppInsightsCore {
	pluginVersionString: string;
	track(item: ITelemetryItem | IExtendedTelemetryItem): void;
	unload(isAsync: boolean, unloadComplete: (unloadState: ITelemetryUnloadState) => void): void;
}

// Endpoint URLs retained for API compatibility (not used).
const endpointUrl = 'https://mobile.events.data.microsoft.com/OneCollector/1.0';
const endpointHealthUrl = 'https://mobile.events.data.microsoft.com/ping';

/**
 * CONSTRUCT IDE: AbstractOneDataSystemAppender with telemetry disabled.
 *
 * All telemetry is neutralized — log() is a no-op, flush() resolves immediately.
 * This ensures CONSTRUCT IDE never sends data to Microsoft's 1DS endpoints.
 * The class structure is preserved for compatibility with subclasses and tests.
 */
export abstract class AbstractOneDataSystemAppender implements ITelemetryAppender {

	protected _aiCoreOrKey: IAppInsightsCore | string | undefined;
	protected readonly endPointUrl = endpointUrl;
	protected readonly endPointHealthUrl = endpointHealthUrl;

	constructor(
		_isInternalTelemetry: boolean,
		_eventPrefix: string,
		_defaultData: { [key: string]: any } | null,
		iKeyOrClientFactory: string | (() => IAppInsightsCore),
		_xhrOverride?: IXHROverride
	) {
		if (typeof iKeyOrClientFactory === 'function') {
			this._aiCoreOrKey = iKeyOrClientFactory();
		} else {
			this._aiCoreOrKey = iKeyOrClientFactory;
		}
	}

	log(_eventName: string, _data?: any): void {
		// CONSTRUCT IDE: No telemetry. All 1DS telemetry is disabled.
		// Users of an offline AI IDE must not phone home.
		return;
	}

	flush(): Promise<void> {
		// CONSTRUCT IDE: No telemetry. Flush is a no-op.
		return Promise.resolve(undefined);
	}
}
