/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ITerminalExecutor, ITerminalExecResult } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { ITerminalService } from '../../../../terminal/browser/terminal.js';
import { IShellLaunchConfig } from '../../../../../../platform/terminal/common/terminal.js';
import { URI } from '../../../../../../base/common/uri.js';

/**
 * Security blocklist patterns -- checked before every command execution.
 * Blocks destructive commands that could damage the system.
 */
const BLOCKLIST_PATTERNS: RegExp[] = [
        /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--)recursive.*\s+\//,         // rm -rf / or rm --recursive /
        /rm\s+-[a-zA-Z]*f[a-zA-Z]*\s+\//,                             // rm -rf /
        /\bsudo\b/,                                                      // any sudo
        /curl\s+.*\|\s*(sh|bash)/,                                       // curl | sh / curl | bash
        /wget\s+.*\|\s*(sh|bash)/,                                       // wget | sh / wget | bash
        /\bmkfs\b/,                                                       // mkfs
        /\bdd\s+.*of=\/dev\//,                                            // dd if=...of=/dev/...
        /chmod\s+777\s+\//,                                               // chmod 777 /
        /chmod\s+777\s+\//,                                               // chmod 777 / (duplicate removed in lint)
        /\bchmod\s+777\s+\//,                                            // chmod 777 /
];

/** Marker used to capture exit code from shell output. */
const EXIT_CODE_MARKER = '__CONSTRUCT_EXIT__';

export class TerminalExecutorService extends Disposable implements ITerminalExecutor {
        readonly _serviceBrand: undefined;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ITerminalService private readonly terminalService: ITerminalService,
        ) {
                super();
                this.logService.info('[TerminalExecutor] Service created');
        }

        isBlocked(command: string): boolean {
                const normalizedCmd = command.trim().toLowerCase();
                for (const pattern of BLOCKLIST_PATTERNS) {
                        if (pattern.test(normalizedCmd)) {
                                this.logService.warn(`[TerminalExecutor] Blocked command: ${command}`);
                                return true;
                        }
                }
                return false;
        }

        async execute(
                command: string,
                cwd?: string,
                timeout: number = 60000,
                signal?: AbortSignal
        ): Promise<ITerminalExecResult> {
                // Security check
                if (this.isBlocked(command)) {
                        throw new Error(`Command blocked by security policy: "${command}". This command matches a dangerous pattern.`);
                }

                this.logService.info(`[TerminalExecutor] Executing: ${command}`);

                // Resolve working directory
                const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                const cwdUri = cwd ? URI.file(cwd) : workspaceRoot;

                // Build the command with exit code capture using a cross-shell compatible wrapper.
                // The EXIT_CODE_MARKER pattern is parsed from output to determine the exit code.
                const isWindows = navigator.platform.toLowerCase().includes('win');
                const wrappedCommand = isWindows
                        ? `${command} & echo ${EXIT_CODE_MARKER}%errorlevel%`
                        : `${command}; __exit_code__=$?; echo "${EXIT_CODE_MARKER}$__exit_code__"`;

                // Create a dedicated terminal for this command
                const launchConfig: IShellLaunchConfig = {
                        name: `Construct: ${command.substring(0, 40)}...`,
                        executable: isWindows ? 'cmd' : '/bin/bash',
                        args: isWindows ? ['/c', wrappedCommand] : ['-c', wrappedCommand],
                        cwd: cwdUri,
                        isFeatureTerminal: true,
                        hideFromUser: false,
                };

                // Create terminal and capture output
                const instance = await this.terminalService.createTerminal({ config: launchConfig });

                return new Promise<ITerminalExecResult>((resolve, reject) => {
                        let stdout = '';
                        const stderr = '';
                        let exitCode = 0;
                        let settled = false;

                        const cleanup = () => {
                                settled = true;
                                try {
                                        instance.dispose();
                                } catch {
                                        // Terminal might already be disposed
                                }
                        };

                        // Listen for output
                        const dataListener = instance.onData((data: string) => {
                                // Strip ANSI escape codes for cleaner output
                                const clean = this.stripAnsi(data);

                                // Check for exit code marker
                                const exitMatch = clean.match(new RegExp(`${EXIT_CODE_MARKER}(\\d+)`));
                                if (exitMatch) {
                                        exitCode = parseInt(exitMatch[1], 10);
                                        // Remove the marker from output
                                        stdout += clean.replace(new RegExp(`${EXIT_CODE_MARKER}\\d+\\n?`, 'g'), '');
                                } else {
                                        stdout += clean;
                                }
                        });

                        // Listen for terminal exit
                        const exitListener = instance.onExit((e: number | { code?: number } | undefined) => {
                                dataListener.dispose();
                                exitListener.dispose();

                                if (!settled) {
                                        const code = typeof e === 'number' ? e : (e?.code ?? exitCode);
                                        cleanup();
                                        resolve({
                                                stdout: this.cleanOutput(stdout),
                                                stderr: this.cleanOutput(stderr),
                                                exitCode: code,
                                        });
                                }
                        });

                        // Timeout
                        const timer = setTimeout(() => {
                                if (!settled) {
                                        this.logService.warn(`[TerminalExecutor] Command timed out after ${timeout}ms: ${command}`);
                                        dataListener.dispose();
                                        exitListener.dispose();
                                        cleanup();
                                        resolve({
                                                stdout: this.cleanOutput(stdout),
                                                stderr: 'Command timed out',
                                                exitCode: 124, // Standard timeout exit code
                                        });
                                }
                        }, timeout);

                        // Abort signal
                        if (signal) {
                                const onAbort = () => {
                                        if (!settled) {
                                                this.logService.info(`[TerminalExecutor] Command aborted: ${command}`);
                                                dataListener.dispose();
                                                exitListener.dispose();
                                                clearTimeout(timer);
                                                cleanup();
                                                resolve({
                                                        stdout: this.cleanOutput(stdout),
                                                        stderr: 'Command cancelled by user',
                                                        exitCode: 130, // Standard SIGINT exit code
                                                });
                                        }
                                };
                                signal.addEventListener('abort', onAbort, { once: true });
                        }
                });
        }

        /**
         * Strip ANSI escape sequences from terminal output.
         * Handles CSI sequences, OSC sequences, and carriage returns.
         */
        private stripAnsi(text: string): string {
                return text
                        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')      // CSI sequences (colors, cursor)
                        .replace(/\x1b\][^\x07]*\x07/g, '')           // OSC sequences (title, etc.)
                        .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')  // Private CSI sequences
                        .replace(/\x1b\[[0-9;]*m/g, '')               // SGR sequences (colors)
                        .replace(/\x1b\[(?:A|B|C|D|E|F|G|H|J|K|S|T|f|i|l|m|n|s|u)/g, '') // Cursor/erase sequences
                        .replace(/\r\n/g, '\n')                        // Normalize line endings
                        .replace(/\r/g, '\n');                         // Standalone CR to LF
        }

        /**
         * Clean up terminal output -- remove excessive blank lines and trailing whitespace.
         */
        private cleanOutput(text: string): string {
                return text
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
        }

        override dispose(): void {
                super.dispose();
        }
}
