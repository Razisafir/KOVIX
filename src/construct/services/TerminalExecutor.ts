/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Terminal Executor (Safe Command Runner)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';

export interface TerminalResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class TerminalExecutor {
	private static readonly BLOCKLIST_PATTERNS: RegExp[] = [
		/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/,         // rm -rf /
		/\bmkfs\b/,                                           // mkfs
		/\bdd\s+.*of=\/dev\//,                                // dd of=/dev/
		/\bformat\s+[a-zA-Z]:\s*$/,                           // format C:
		/\bshutdown\b/,                                       // shutdown
		/\breboot\b/,                                         // reboot
		/\bhalt\b/,                                           // halt
		/\binit\s+[06]\b/,                                    // init 0/6
		/\bkill\s+-9\s+1\b/,                                  // kill -9 1
		/\bchmod\s+777\s+\//,                                 // chmod 777 /
		/:\(\)\{\s*:\|:&\s*\};\s*:/,                          // fork bomb
		/\bcurl\b.*\|\s*\bbash\b/,                            // curl | bash
		/\bwget\b.*\|\s*\bbash\b/,                            // wget | bash
		/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\//,       // rm -rf / (with combined flags)
		/\bdel\s+\/[sfq]/,                                    // del /f /s /q
	];

	private static readonly DEFAULT_TIMEOUT_MS = 60_000;

	async run(
		command: string,
		args: string[] = [],
		options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {}
	): Promise<TerminalResult> {
		const fullCommand = [command, ...args].join(' ');

		// Check blocklist
		for (const pattern of TerminalExecutor.BLOCKLIST_PATTERNS) {
			if (pattern.test(fullCommand)) {
				throw new Error(`Command blocked by security policy: ${fullCommand}`);
			}
		}

		const timeoutMs = options.timeoutMs ?? TerminalExecutor.DEFAULT_TIMEOUT_MS;

		return new Promise<TerminalResult>((resolve, reject) => {
			const proc = spawn(command, args, { cwd: options.cwd });
			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
			proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

			const timer = setTimeout(() => {
				proc.kill('SIGKILL');
				reject(new Error(`Command timed out after ${timeoutMs}ms: ${fullCommand}`));
			}, timeoutMs);

			if (options.signal) {
				options.signal.addEventListener('abort', () => {
					proc.kill('SIGKILL');
					clearTimeout(timer);
					reject(new Error('Command aborted'));
				}, { once: true });
			}

			proc.on('close', (code) => {
				clearTimeout(timer);
				resolve({ stdout, stderr, exitCode: code ?? 1 });
			});

			proc.on('error', (err) => {
				clearTimeout(timer);
				reject(err);
			});
		});
	}

	static isBlocked(command: string): boolean {
		for (const pattern of TerminalExecutor.BLOCKLIST_PATTERNS) {
			if (pattern.test(command)) {
				return true;
			}
		}
		return false;
	}
}
