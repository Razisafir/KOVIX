/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const hydraToolDefinition: IToolDefinition = {
	name: 'hydra_brute',
	description: 'Brute force attack using Hydra against a network service. Requires user confirmation.',
	inputSchema: {
		type: 'object',
		properties: {
			target: { type: 'string', description: 'Target hostname or IP address' },
			service: { type: 'string', description: 'Service to attack (e.g. "ssh", "ftp", "http-post-form")' },
			wordlist: { type: 'string', description: 'Path to wordlist file' }
		},
		required: ['target', 'service', 'wordlist']
	},
	modifiesFiles: false,
	requiresNetwork: true,
	requiresConfirmation: true,
	category: 'security'
};
