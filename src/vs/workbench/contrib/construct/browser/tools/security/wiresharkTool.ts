// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

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
