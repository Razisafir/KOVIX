// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const johnToolDefinition: IToolDefinition = {
	name: 'john_crack',
	description: 'Crack password hashes using John the Ripper. Requires user confirmation.',
	inputSchema: {
		type: 'object',
		properties: {
			hash_file: { type: 'string', description: 'Path to the file containing password hashes' },
			wordlist: { type: 'string', description: 'Path to wordlist file (e.g. "/usr/share/wordlists/rockyou.txt")' }
		},
		required: ['hash_file']
	},
	modifiesFiles: false,
	requiresNetwork: false,
	requiresConfirmation: true,
	category: 'security'
};
