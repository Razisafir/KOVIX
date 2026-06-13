// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

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
