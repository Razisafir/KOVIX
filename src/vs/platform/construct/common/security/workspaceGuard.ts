// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceContextService } from '../../../workspace/common/workspace.js';
// Use VS Code's browser-safe path utilities — Node 'path' is NOT available in the renderer
import * as path from '../../../../base/common/path.js';

/**
 * Assert that a path is within the workspace boundary.
 * Throws an error if the resolved absolute path escapes the workspace root.
 * Used for IPC input validation to prevent path traversal attacks.
 *
 * FIX: Previous implementation only checked for '..' in the path string,
 * which allowed absolute paths like /etc/passwd to pass through.
 * Now properly resolves and compares against workspace root.
 */
export function assertWithinWorkspace(
        filePath: string,
        workspaceRoot?: string | IWorkspaceContextService
): void {
        // Reject path traversal attempts (e.g., ../../../etc/passwd)
        const normalized = path.normalize(filePath);
        if (normalized.includes('..')) {
                throw new Error(`Path traversal not allowed: "${filePath}"`);
        }

        // If a workspace root is provided, enforce boundary
        if (workspaceRoot) {
                let root: string;
                if (typeof workspaceRoot === 'string') {
                        root = path.resolve(workspaceRoot);
                } else {
                        // IWorkspaceContextService — extract first workspace folder
                        const folders = workspaceRoot.getWorkspace().folders;
                        if (folders.length === 0) {
                                // No workspace open — only allow relative paths within CWD
                                if (path.isAbsolute(filePath)) {
                                        throw new Error(`No workspace open. Absolute paths are not allowed: "${filePath}"`);
                                }
                                return;
                        }
                        root = path.resolve(folders[0].uri.fsPath);
                }

                // Resolve relative paths against the workspace root (not CWD)
                // This ensures 'src/utils/math.ts' resolves to '<root>/src/utils/math.ts'
                const resolved = path.isAbsolute(filePath)
                        ? path.resolve(filePath)
                        : path.resolve(root, filePath);

                if (!resolved.startsWith(root + path.sep) && resolved !== root) {
                        throw new Error(`Security: path "${resolved}" is outside workspace "${root}"`);
                }
        } else {
                // No workspace root provided — reject absolute paths as a safety measure
                if (path.isAbsolute(filePath)) {
                        throw new Error(`Absolute paths require a workspace context: "${filePath}"`);
                }
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
