/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const nucleiToolDefinition: IToolDefinition = {
        name: 'nuclei_scan',
        description: 'Run a Nuclei vulnerability scan. Template-based CVE and misconfiguration scanning. Requires user confirmation.',
        inputSchema: {
                type: 'object',
                properties: {
                        target: { type: 'string', description: 'Target URL or hostname' },
                        templates: { type: 'string', description: 'Template tags or path (e.g. "cve,rce" or path to template file)' }
                },
                required: ['target']
        },
        modifiesFiles: false,
        requiresNetwork: true,
        requiresConfirmation: true,
        category: 'security'
};
