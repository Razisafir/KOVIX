/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const metasploitToolDefinition: IToolDefinition = {
	name: 'metasploit_run',
	description: 'Run a Metasploit module. Requires user confirmation. Use only on authorized systems.',
	inputSchema: {
		type: 'object',
		properties: {
			module: { type: 'string', description: 'Metasploit module path (e.g. "exploit/windows/smb/ms17_010_eternalblue")' },
			options: { type: 'object', description: 'Module options as key-value pairs (e.g. {"RHOSTS": "192.168.1.1", "LHOST": "10.0.0.1"})', properties: {} }
		},
		required: ['module']
	},
	modifiesFiles: false,
	requiresNetwork: true,
	requiresConfirmation: true,
	category: 'security'
};
