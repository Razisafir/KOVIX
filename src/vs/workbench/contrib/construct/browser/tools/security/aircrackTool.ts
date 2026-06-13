/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const aircrackToolDefinition: IToolDefinition = {
	name: 'aircrack_capture',
	description: 'WiFi assessment using Aircrack-ng suite. Captures wireless traffic for analysis. Requires user confirmation.',
	inputSchema: {
		type: 'object',
		properties: {
			iface: { type: 'string', description: 'Wireless interface to use (e.g. "wlan0")' }
		},
		required: ['iface']
	},
	modifiesFiles: false,
	requiresNetwork: true,
	requiresConfirmation: true,
	category: 'security'
};
