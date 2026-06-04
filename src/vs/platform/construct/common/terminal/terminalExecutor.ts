/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const ITerminalExecutor = createDecorator<ITerminalExecutor>('construct.terminalExecutor');

/**
 * Result of a terminal command execution.
 */
export interface ITerminalExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Service for executing terminal commands securely within VS Code.
 * Uses VS Code's terminal infrastructure for real process execution.
 * Enforces a security blocklist to prevent dangerous commands.
 */
export interface ITerminalExecutor {
	readonly _serviceBrand: undefined;

	/**
	 * Execute a command and return the result.
	 * The command runs in a real shell process via VS Code's terminal infrastructure.
	 *
	 * @param command The command to execute
	 * @param cwd Working directory (defaults to workspace root)
	 * @param timeout Timeout in milliseconds (default: 60000)
	 * @param signal Optional AbortSignal for cancellation
	 * @returns Result with stdout, stderr, and exit code
	 * @throws Error if command is on the security blocklist
	 */
	execute(
		command: string,
		cwd?: string,
		timeout?: number,
		signal?: AbortSignal
	): Promise<ITerminalExecResult>;

	/**
	 * Check if a command is on the security blocklist.
	 * Blocklist includes: rm -rf /, sudo, curl|sh, wget|sh, mkfs, dd to /dev,
	 * chmod 777 /, writing to /etc/, fork bombs.
	 */
	isBlocked(command: string): boolean;
}
