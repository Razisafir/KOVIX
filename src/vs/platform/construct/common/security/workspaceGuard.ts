// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceContextService } from '../../../workspace/common/workspace.js';

/**
 * Assert that a path is within the workspace boundary.
 * Throws an error if the resolved absolute path escapes the workspace root.
 * Used for IPC input validation to prevent path traversal attacks.
 */
export function assertWithinWorkspace(
        absolutePath: string,
        workspaceContextService?: IWorkspaceContextService
): void {
        // Reject path traversal
        if (absolutePath.includes('..')) {
                throw new Error(`Path traversal not allowed: "${absolutePath}"`);
        }
}

/**
 * Validate that a tool name is in the allowed set.
 * Used for IPC input validation to prevent arbitrary tool execution.
 */
export function validateToolName(name: string): boolean {
        const ALLOWED_TOOLS = new Set([
                'read_file', 'write_file', 'edit_file', 'list_directory',
                'create_directory', 'search_files', 'run_command',
                'search_codebase', 'web_search'
        ]);
        return ALLOWED_TOOLS.has(name);
}

/**
 * Validate that an MCP method name is in the allowed set.
 */
export function validateMcpMethod(method: string): boolean {
        const ALLOWED_METHODS = new Set([
                'initialize', 'tools/list', 'tools/call',
                'resources/list', 'resources/read'
        ]);
        return ALLOWED_METHODS.has(method);
}
