/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Terminal Executor Service
 *  MVP: Real command execution with safety checks and streaming output
 *
 *  - child_process.spawn('bash', ['-c', command]) for real execution
 *  - Stream stdout/stderr to callback (for webview display)
 *  - Timeout: 60s default, configurable
 *  - Blocklist: dangerous commands rejected before spawn
 *  - Working directory: project root (detect from active workspace)
 *  - Exit code handling: 0 = success, non-zero = error with stderr
 *  - Browser fallback: VS Code terminal API with output capture
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ICommandSafetyService } from '../../../../../platform/construct/common/commandSafety.js';

import {
	ITerminalExecutorService,
	ExecutionResult,
} from '../../../../../platform/construct/common/terminalExecutor.js';

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 60000;
const MAX_OUTPUT_LENGTH = 100000; // Truncate output beyond this

// ── Blocklist ─────────────────────────────────────────────────

const BLOCKED_PATTERNS: RegExp[] = [
	/rm\s+-rf\s+\//,            // rm -rf /
	/rm\s+-rf\s+~\//,           // rm -rf ~/
	/sudo\s/,                    // sudo
	/curl.*\|\s*sh/,             // curl | sh
	/wget.*\|\s*sh/,             // wget | sh
	/curl.*\|\s*bash/,           // curl | bash
	/eval\s+\(/,                 // eval (
	/>\s*\/etc\//,               // > /etc/
	/mkfs\./,                    // mkfs.
	/dd\s+if=/,                  // dd if=
	/:(){ :\|:& };:/,            // fork bomb
];

// ══════════════════════════════════════════════════════════════
// TerminalExecutorService
// ══════════════════════════════════════════════════════════════

export class TerminalExecutorService extends Disposable implements ITerminalExecutorService {
	declare readonly _serviceBrand: undefined;

	private _running: boolean = false;
	private _activeCommand: string | undefined;

	private readonly _onOutput = this._register(new Emitter<{ stdout: string; stderr: string }>());
	readonly onOutput = this._onOutput.event;

	private readonly _onComplete = this._register(new Emitter<ExecutionResult>());
	readonly onComplete = this._onComplete.event;

	constructor(
		@ICommandSafetyService private readonly commandSafetyService: ICommandSafetyService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[TerminalExecutor] Initialized');
	}

	async execute(command: string, cwd?: string, timeout?: number): Promise<ExecutionResult> {
		// Block dangerous commands
		for (const pattern of BLOCKED_PATTERNS) {
			if (pattern.test(command)) {
				const result: ExecutionResult = {
					success: false,
					exitCode: -1,
					stdout: '',
					stderr: `Command blocked for security: "${command.slice(0, 50)}" matches dangerous pattern. If you believe this is a false positive, please run the command manually in the terminal.`,
					duration: 0,
					timedOut: false,
					command,
				};
				this._onComplete.fire(result);
				return result;
			}
		}

		// Use CommandSafetyService for additional checks
		const safetyResult = this.commandSafetyService.analyzeCommand(command);
		if (!safetyResult.allowed) {
			const result: ExecutionResult = {
				success: false,
				exitCode: -1,
				stdout: '',
				stderr: safetyResult.blockReason ?? 'Command blocked for security',
				duration: 0,
				timedOut: false,
				command,
			};
			this._onComplete.fire(result);
			return result;
		}

		// Resolve working directory
		const workDir = cwd ?? this._getWorkspaceRoot();
		const timeoutMs = timeout ?? DEFAULT_TIMEOUT;
		const startTime = Date.now();

		this._running = true;
		this._activeCommand = command;

		try {
			// Try to use child_process directly (desktop mode)
			const result = await this._executeDesktop(command, workDir, timeoutMs);
			return result;
		} catch (spawnError) {
			// Fallback: try VS Code terminal API (browser mode)
			this.logService.info('[TerminalExecutor] child_process not available, using VS Code terminal fallback');
			try {
				const result = await this._executeBrowser(command, workDir, timeoutMs);
				return result;
			} catch (browserError) {
				const result: ExecutionResult = {
					success: false,
					exitCode: -1,
					stdout: '',
					stderr: `Failed to execute command: ${(browserError as Error).message}`,
					duration: Date.now() - startTime,
					timedOut: false,
					command,
				};
				this._onComplete.fire(result);
				return result;
			}
		} finally {
			this._running = false;
			this._activeCommand = undefined;
		}
	}

	isRunning(): boolean {
		return this._running;
	}

	getActiveCommand(): string | undefined {
		return this._activeCommand;
	}

	// ── Desktop Execution (child_process) ──────────────────────

	private async _executeDesktop(command: string, cwd: string, timeoutMs: number): Promise<ExecutionResult> {
		const { spawn } = require('child_process');
		const startTime = Date.now();

		return new Promise<ExecutionResult>((resolve, reject) => {
			let stdout = '';
			let stderr = '';
			let timedOut = false;

			const childProcess = spawn('bash', ['-c', command], {
				cwd,
				env: { ...process.env as Record<string, string> },
				stdio: 'pipe',
			});

			childProcess.stdout?.on('data', (data: Buffer) => {
				const chunk = data.toString('utf-8');
				stdout += chunk;
				this._onOutput.fire({ stdout: chunk, stderr: '' });
			});

			childProcess.stderr?.on('data', (data: Buffer) => {
				const chunk = data.toString('utf-8');
				stderr += chunk;
				this._onOutput.fire({ stdout: '', stderr: chunk });
			});

			childProcess.on('error', (err: Error) => {
				reject(err);
			});

			childProcess.on('close', (exitCode: number | null) => {
				const result: ExecutionResult = {
					success: exitCode === 0,
					exitCode: exitCode ?? -1,
					stdout: this._truncateOutput(stdout),
					stderr: this._truncateOutput(stderr),
					duration: Date.now() - startTime,
					timedOut,
					command,
				};
				this._onComplete.fire(result);
				resolve(result);
			});

			// Timeout handling
			const timer = setTimeout(() => {
				timedOut = true;
				try { childProcess.kill('SIGTERM'); } catch { /* already dead */ }
				// Force kill after 5s
				setTimeout(() => {
					try { childProcess.kill('SIGKILL'); } catch { /* already dead */ }
				}, 5000);
			}, timeoutMs);

			childProcess.on('close', () => {
				clearTimeout(timer);
			});
		});
	}

	// ── Browser Execution Fallback ─────────────────────────────

	private async _executeBrowser(command: string, cwd: string, timeoutMs: number): Promise<ExecutionResult> {
		const startTime = Date.now();

		// In browser mode, we simulate command execution
		// Real implementation would use VS Code terminal API + output capture
		this.logService.info(`[TerminalExecutor] Browser mode: would execute "${command}" in ${cwd}`);

		const result: ExecutionResult = {
			success: false,
			exitCode: -1,
			stdout: '',
			stderr: 'Terminal execution requires desktop mode. Please run this command manually in the integrated terminal.',
			duration: Date.now() - startTime,
			timedOut: false,
			command,
		};

		this._onComplete.fire(result);
		return result;
	}

	// ── Helpers ────────────────────────────────────────────────

	private _getWorkspaceRoot(): string {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return folders[0].uri.fsPath;
		}
		return process.cwd?.() ?? '/tmp';
	}

	private _truncateOutput(output: string): string {
		if (output.length <= MAX_OUTPUT_LENGTH) {
			return output;
		}
		const half = Math.floor(MAX_OUTPUT_LENGTH / 2);
		return output.slice(0, half) + '\n... [truncated] ...\n' + output.slice(-half);
	}
}
