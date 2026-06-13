/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const ghidraToolDefinition: IToolDefinition = {
        name: 'ghidra_decompile',
        description: 'Decompile a binary using Ghidra headless analysis. Runs in Docker for isolation. Requires user confirmation.',
        inputSchema: {
                type: 'object',
                properties: {
                        binary_path: { type: 'string', description: 'Path to the binary file (must be within workspace)' },
                },
                required: ['binary_path']
        },
        modifiesFiles: false,
        requiresNetwork: false,
        requiresConfirmation: true,
        category: 'security'
};
