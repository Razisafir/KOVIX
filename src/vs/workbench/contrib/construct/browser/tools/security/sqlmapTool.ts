/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const sqlmapToolDefinition: IToolDefinition = {
	name: 'sqlmap_test',
	description: 'Test a URL for SQL injection vulnerabilities using sqlmap. Requires user confirmation.',
	inputSchema: {
		type: 'object',
		properties: {
			url: { type: 'string', description: 'Target URL to test for SQL injection (e.g. "http://example.com/page?id=1")' },
			options: { type: 'string', description: 'Additional sqlmap options (e.g. "--dbs --batch")' }
		},
		required: ['url']
	},
	modifiesFiles: false,
	requiresNetwork: true,
	requiresConfirmation: true,
	category: 'security'
};
