/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IDiffApplier = createDecorator<IDiffApplier>('construct.diffApplier');

/**
 * Result of applying a diff.
 */
export interface IDiffApplyResult {
	success: boolean;
	error?: string;
}

/**
 * Service for applying file changes using VS Code's IFileService.
 * Supports unified diff patches, direct file writes, and workspace-safe operations.
 */
export interface IDiffApplier {
	readonly _serviceBrand: undefined;

	/**
	 * Apply a unified diff patch to a file.
	 * Handles file creation (empty original), preserves line endings (CRLF/LF).
	 * Creates parent directories recursively.
	 * Validates that the target path is within the workspace root.
	 *
	 * @param filePath Path relative to workspace root or absolute URI string.
	 * @param diff Unified diff content.
	 */
	applyDiff(filePath: string, diff: string): Promise<IDiffApplyResult>;

	/**
	 * Write content to a file, creating it and parent directories if needed.
	 *
	 * @param filePath Path relative to workspace root or absolute URI string.
	 * @param content File content.
	 */
	writeFile(filePath: string, content: string): Promise<void>;

	/**
	 * Read a file's content as UTF-8 string.
	 *
	 * @param filePath Path relative to workspace root or absolute URI string.
	 */
	readFile(filePath: string): Promise<string>;

	/**
	 * Create an empty file, including parent directories.
	 *
	 * @param filePath Path relative to workspace root or absolute URI string.
	 */
	createFile(filePath: string): Promise<void>;

	/**
	 * Delete a file.
	 *
	 * @param filePath Path relative to workspace root or absolute URI string.
	 */
	deleteFile(filePath: string): Promise<void>;

	/**
	 * Check if a file exists.
	 *
	 * @param filePath Path relative to workspace root or absolute URI string.
	 */
	exists(filePath: string): Promise<boolean>;

	/**
	 * Validate that a path is within the workspace root.
	 *
	 * @param filePath Path to validate.
	 * @returns True if the path is within the workspace.
	 */
	isWithinWorkspace(filePath: string): boolean;
}
