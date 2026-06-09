// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalExecutor, ITerminalExecResult, sanitiseForAuditLog, TerminalRateLimiter } from '../common/terminal/terminalExecutor.js';
import { ILogService } from '../../log/common/log.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { execFile } from 'child_process';

/**
 * Node-layer terminal execution service.
 * Executes shell commands with full OS access via child_process.
 * This replaces the browser-layer child_process usage (P0-4 fix).
 */
export class TerminalNodeService extends Disposable implements ITerminalExecutor {
        declare readonly _serviceBrand: undefined;

        private readonly _rateLimiter = new TerminalRateLimiter();

        constructor(
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[TerminalNode] Service created');
        }

        isBlocked(command: string): boolean {
                // Check for dangerous commands: rm -rf /, sudo, curl|sh, etc.
                const dangerousPatterns = [
                        /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*--no-preserve-root\s+)(\/|[A-Z]:\\)/i,
                        /\bsudo\s+/i,
                        /\bcurl\b.*\|\s*(ba)?sh/i,
                        /\bwget\b.*\|\s*(ba)?sh/i,
                        /\bmkfs\b/i,
                        /\bdd\s+.*of=\/dev\//i,
                        /\bchmod\s+(777|666)\s+\//i,
                        /\b:()\s*\{.*;\s*\}/, // fork bomb
                        />\/etc\//i,
                ];
                return dangerousPatterns.some(pattern => pattern.test(command));
        }

        async execute(
                command: string,
                cwd?: string,
                timeout?: number,
                signal?: AbortSignal,
                onOutput?: (data: string) => void
        ): Promise<ITerminalExecResult> {
                // Security: check blocklist
                if (this.isBlocked(command)) {
                        const msg = `[TerminalNode] Blocked dangerous command: ${sanitiseForAuditLog(command).substring(0, 80)}`;
                        this.logService.error(msg);
                        throw new Error('Command blocked by security policy');
                }

                // Security: check rate limit
                if (!this._rateLimiter.canExecute()) {
                        this.logService.warn('[TerminalNode] Rate limit exceeded');
                        throw new Error('Terminal rate limit exceeded — too many commands');
                }

                // Security: audit log (redacted)
                this.logService.info(`[TerminalNode] Executing: ${sanitiseForAuditLog(command).substring(0, 100)}`);

                this._rateLimiter.recordExecution();

                return new Promise((resolve) => {
                        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
                        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

                        const child = execFile(shell, shellArgs, {
                                cwd,
                                timeout: timeout ?? 60000,
                                maxBuffer: 1024 * 1024 * 10, // 10MB
                        }, (error, stdout, stderr) => {
                                const exitCode = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;
                                if (error) {
                                        this.logService.warn(`[TerminalNode] Command failed (exit ${exitCode}): ${sanitiseForAuditLog(command).substring(0, 50)}`);
                                }
                                resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: typeof exitCode === 'number' ? exitCode : 1 });
                        });

                        // Handle abort signal
                        if (signal) {
                                const onAbort = () => {
                                        child.kill('SIGTERM');
                                        signal.removeEventListener('abort', onAbort);
                                };
                                signal.addEventListener('abort', onAbort);
                                child.on('exit', () => {
                                        signal.removeEventListener('abort', onAbort);
                                });
                        }

                        // Stream output if callback provided
                        if (onOutput) {
                                child.stdout?.on('data', (data: Buffer) => {
                                        // Strip ANSI escape codes for clean output
                                        const cleaned = data.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
                                        if (cleaned) { onOutput(cleaned); }
                                });
                        }
                });
        }
}
