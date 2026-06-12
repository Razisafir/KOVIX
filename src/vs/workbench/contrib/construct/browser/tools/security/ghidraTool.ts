import { IToolDefinition } from '../../../../../../platform/construct/common/tools/constructToolRegistry.js';

export const ghidraToolDefinition: IToolDefinition = {
        name: 'ghidra_decompile',
        description: 'Decompile a binary using Ghidra headless analysis. Runs in Docker for isolation. Requires user confirmation.',
        inputSchema: {
                type: 'object',
                properties: {
                        binary_path: { type: 'string', description: 'Path to the binary file (must be within workspace)' },
                        function_name: { type: 'string', description: 'Specific function to decompile' }
                },
                required: ['binary_path']
        },
        modifiesFiles: false,
        requiresNetwork: false,
        category: 'security'
};
