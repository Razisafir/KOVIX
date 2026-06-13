// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

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
