/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConstructService } from '../common/construct.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions.js';

class ConstructService implements IConstructService {
	declare readonly _serviceBrand: undefined;
	private _port: number = 8000;

	async start(): Promise<void> {
		// Agent backend start is handled by the main process or external launcher
		// This service provides the renderer-side interface
	}

	getPort(): number { return this._port; }

	async stop(): Promise<void> {
		// No-op in renderer process
	}
}

registerSingleton(IConstructService, ConstructService, InstantiationType.Delayed);
