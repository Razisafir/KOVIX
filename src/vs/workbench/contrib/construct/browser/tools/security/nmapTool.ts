// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const nmapToolDefinition: IToolDefinition = {
        name: 'nmap_scan',
        description: 'Run an nmap network scan. Shows open ports and services on the target. Requires user confirmation.',
        inputSchema: {
                type: 'object',
                properties: {
                        target: { type: 'string', description: 'Target hostname or IP address' },
                        options: { type: 'string', description: 'Additional nmap options/flags (e.g. "-sV -sC")' }
                },
                required: ['target']
        },
        modifiesFiles: false,
        requiresNetwork: true,
        requiresConfirmation: true,
        category: 'security'
};
