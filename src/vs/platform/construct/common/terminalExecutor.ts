/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Terminal Executor Service Interface
 *  MVP: Real command execution with safety checks and streaming
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export const ITerminalExecutorService = createDecorator<ITerminalExecutorService>('construct.terminalExecutor');

export interface ITerminalExecutorService {
	readonly _serviceBrand: undefined;

	/** Execute a command — uses child_process in desktop, VS Code terminal API in browser */
	execute(command: string, cwd?: string, timeout?: number): Promise<ExecutionResult>;

	/** Status */
	isRunning(): boolean;
	getActiveCommand(): string | undefined;

	/** Events */
	readonly onOutput: Event<{ stdout: string; stderr: string }>;
	readonly onComplete: Event<ExecutionResult>;
}

export interface ExecutionResult {
	success: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	duration: number;
	timedOut: boolean;
	command: string;
}
