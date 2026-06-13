/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const wiresharkToolDefinition: IToolDefinition = {
	name: 'wireshark_capture',
	description: 'Capture network packets using tshark (Wireshark CLI). Requires user confirmation.',
	inputSchema: {
		type: 'object',
		properties: {
			iface: { type: 'string', description: 'Network interface to capture on (e.g. "eth0")' },
			duration: { type: 'number', description: 'Capture duration in seconds' }
		},
		required: ['iface', 'duration']
	},
	modifiesFiles: false,
	requiresNetwork: true,
	requiresConfirmation: true,
	category: 'security'
};
