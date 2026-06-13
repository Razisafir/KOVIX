/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
        ITerminalExecutor, ITerminalExecResult,
        sanitiseForAuditLog, sanitiseOutput, stripAnsiEscapeSequences,
        TerminalRateLimiter, DEFAULT_COMMAND_ALLOWLIST, FILE_OPERATION_COMMANDS,
        TERMINAL_RATE_LIMIT,
        detectShellMetacharInArgs,
        isPrivilegeEscalation,
} from '../common/terminal/terminalExecutor.js';
import { assertWithinWorkspace } from '../common/security/workspaceGuard.js';
import { ILogService } from '../../log/common/log.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { execFile } from 'child_process';
import * as path from '../../../base/common/path.js';

/**
 * Node-layer terminal execution service.
 * Executes shell commands with full OS access via child_process.
 * This replaces the browser-layer child_process usage (P0-4 fix).
 *
 * SEC-4.2: Security parity with browser-layer TerminalExecutorService:
 * - Command allowlist enforcement (exact match)
 * - Shell metacharacter detection in arguments
 * - Workspace boundary check for file operation commands
 * - Output sanitization (ANSI stripping, truncation, secret redaction)
 * - Rate limiting (10 commands / 30 seconds)
 * - Audit logging with secret redaction
 */
export class TerminalNodeService extends Disposable implements ITerminalExecutor {
        declare readonly _serviceBrand: undefined;

        private readonly _rateLimiter = new TerminalRateLimiter();

        /** Workspace root for boundary checks — set via setWorkspaceRoot or constructor */
        private _workspaceRoot: string | undefined;

        constructor(
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[TerminalNode] Service created (SEC-4.2 hardened, SEC-P2 privilege escalation protection)');
        }

        /** SEC-P2: Check if a command requires user confirmation (privilege escalation) */
        requiresConfirmation(command: string): boolean {
                return isPrivilegeEscalation(command);
        }

        /**
         * Set or update the workspace root for boundary checks.
         */
        setWorkspaceRoot(root: string): void {
                this._workspaceRoot = root;
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
                        /\bpkexec\b/i,                  // SEC-P2: PolicyKit escalation
                        /\bdoas\b/i,                    // SEC-P2: OpenBSD doas
                        /\bgosu\b/i,                    // SEC-P2: gosu (Docker user switching)
                        /\brun0\b/i,                    // SEC-P2: systemd-run0
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
                // ── SEC-4.2: Rate limiting ──────────────────────────────────────────
                if (!this._rateLimiter.canExecute()) {
                        const remaining = this._rateLimiter.remainingCommands();
                        const msg = `Command rate limit exceeded. Max ${TERMINAL_RATE_LIMIT.maxCommands} commands per ${TERMINAL_RATE_LIMIT.windowMs / 1000}s. Please wait before trying again. (${remaining} remaining)`;
                        this.logService.warn(`[TerminalNode] Rate limit exceeded for: ${sanitiseForAuditLog(command).substring(0, 60)}`);
                        throw new Error(msg);
                }

                // ── SEC-4.2: Shell metacharacter detection in arguments ─────────────
                const argsPart = this.extractArgsFromCommand(command);
                if (argsPart) {
                        const metachar = detectShellMetacharInArgs(argsPart);
                        if (metachar) {
                                this.logSecurityEvent('metachar_rejected', command, `Shell metacharacter "${metachar}" detected in arguments`);
                                throw new Error(`Command rejected: shell metacharacter "${metachar}" detected in arguments. Chained commands are not allowed for security reasons.`);
                        }
                }

                // ── SEC-4.2: Command allowlist enforcement (exact match) ────────────
                const baseCommand = command.trim().split(/\s+/)[0];
                const commandName = baseCommand.split('/').pop() ?? baseCommand;
                const isAllowed = DEFAULT_COMMAND_ALLOWLIST.some(allowed => commandName === allowed);
                if (!isAllowed) {
                        this.logSecurityEvent('allowlist_rejected', command, `"${commandName}" not in allowlist`);
                        throw new Error(`Command rejected: "${commandName}" is not in the allowed command list. Only allowlisted commands may be executed.`);
                }

                // ── SEC-4.2: Workspace boundary check for file-operation commands ───
                if (FILE_OPERATION_COMMANDS.includes(commandName)) {
                        await this.enforceWorkspaceBoundary(command, commandName, argsPart);
                }

                // ── SEC-4.2: Working directory jail ─────────────────────────────────
                if (cwd && this._workspaceRoot) {
                        const resolvedCwd = path.resolve(cwd);
                        const resolvedRoot = path.resolve(this._workspaceRoot);
                        if (!resolvedCwd.startsWith(resolvedRoot + path.sep) && resolvedCwd !== resolvedRoot) {
                                this.logSecurityEvent('cwd_escape', command, `cwd "${resolvedCwd}" outside workspace "${resolvedRoot}"`);
                                throw new Error(`Security: working directory "${resolvedCwd}" is outside workspace "${resolvedRoot}". Commands cannot run outside the workspace root.`);
                        }
                }

                // ── Security: check blocklist ────────────────────────────────────────
                if (this.isBlocked(command)) {
                        this.logSecurityEvent('blocklist_rejected', command, 'Matched dangerous command pattern');
                        throw new Error('Command blocked by security policy');
                }

                // ── SEC-P2: Privilege escalation check ─────────────────────────────
                if (isPrivilegeEscalation(command)) {
                        this.logSecurityEvent('privilege_escalation_rejected', command, 'Privilege escalation command blocked');
                        throw new Error(`Command requires user confirmation: "${commandName}" is a privilege escalation command. These commands are blocked for security. If you need elevated privileges, run the command manually in a terminal.`);
                }

                // ── SEC-4.2: Record execution for rate limiting (before execution) ──
                this._rateLimiter.recordExecution();

                // ── Audit log (redacted) ─────────────────────────────────────────────
                this.logService.info(`[TerminalNode] Executing: ${sanitiseForAuditLog(command).substring(0, 100)}`);

                return new Promise((resolve) => {
                        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
                        const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

                        const child = execFile(shell, shellArgs, {
                                cwd,
                                timeout: timeout ?? 60000,
                                maxBuffer: 1024 * 1024 * 10, // 10MB
                        }, (error, stdout, stderr) => {
                                const exitCode = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;

                                // SEC-4.2: Sanitise output before returning to agent
                                const safeStdout = sanitiseOutput(stdout ?? '');
                                const safeStderr = sanitiseOutput(stderr ?? '');

                                if (error) {
                                        this.logService.warn(`[TerminalNode] Command failed (exit ${exitCode}): ${sanitiseForAuditLog(command).substring(0, 50)}`);
                                }

                                // SEC-4.2: Audit log the command completion
                                this.logService.info(`[TerminalNode] Completed: exit=${typeof exitCode === 'number' ? exitCode : 1} cmd=${sanitiseForAuditLog(command).substring(0, 60)}`);

                                resolve({
                                        stdout: safeStdout,
                                        stderr: safeStderr,
                                        exitCode: typeof exitCode === 'number' ? exitCode : 1,
                                });
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

                        // Stream output if callback provided — ANSI-stripped and sanitised
                        if (onOutput) {
                                child.stdout?.on('data', (data: Buffer) => {
                                        // Strip ANSI escape codes for clean output, then redact secrets
                                        const cleaned = stripAnsiEscapeSequences(data.toString());
                                        const safe = sanitiseForAuditLog(cleaned);
                                        if (safe) { onOutput(safe); }
                                });
                        }
                });
        }

        /**
         * SEC-4.2: Extract the arguments portion of a command for metacharacter scanning.
         * Returns everything after the first token (the command itself).
         */
        private extractArgsFromCommand(command: string): string | null {
                const parts = command.trim().split(/\s+/);
                if (parts.length <= 1) {
                        return null; // No arguments
                }
                return parts.slice(1).join(' ');
        }

        /**
         * SEC-4.2: Enforce workspace boundary for file operation commands.
         * Checks that any path-like arguments resolve within the workspace root.
         * Uses assertWithinWorkspace from workspaceGuard.ts for robust validation
         * (handles path traversal, symlinks, absolute paths).
         */
        private async enforceWorkspaceBoundary(
                command: string,
                commandName: string,
                argsPart: string | null,
        ): Promise<void> {
                if (!argsPart || !this._workspaceRoot) {
                        // No args or no workspace — can't check boundaries
                        // If no workspace root is set, skip the check (allows standalone usage)
                        return;
                }

                // Extract path-like tokens from the arguments
                // Heuristic: tokens that look like file paths (contain / or \, or start with . or ~)
                const tokens = argsPart.split(/\s+/);
                const pathTokens = tokens.filter(token => {
                        // Skip flags/options
                        if (token.startsWith('-')) { return false; }
                        // Looks like a path: contains separator, starts with . or ~, or is absolute
                        return token.includes('/') || token.includes('\\') || token.startsWith('.') || token.startsWith('~');
                });

                for (const token of pathTokens) {
                        try {
                                // Expand ~ to home directory
                                let expanded = token;
                                if (token.startsWith('~')) {
                                        const os = require('os');
                                        expanded = token.replace(/^~/, os.homedir());
                                }

                                // Resolve against workspace root if relative
                                const resolvedPath = path.isAbsolute(expanded)
                                        ? path.resolve(expanded)
                                        : path.resolve(this._workspaceRoot!, expanded);

                                // Use assertWithinWorkspace for robust validation
                                assertWithinWorkspace(resolvedPath, this._workspaceRoot);
                        } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                this.logSecurityEvent('workspace_escape', command, `Path "${token}" outside workspace: ${msg}`);
                                throw new Error(`Security: command "${commandName}" targets path outside workspace: "${token}". ${msg}`);
                        }
                }
        }

        /**
         * SEC-4.2: Log a security event for monitoring and alerting.
         */
        private logSecurityEvent(eventType: string, command: string, detail: string): void {
                const safeCommand = sanitiseForAuditLog(command).substring(0, 80);
                this.logService.warn(`[TerminalNode] SECURITY: type=${eventType} detail="${detail}" cmd="${safeCommand}"`);
        }

        override dispose(): void {
                super.dispose();
        }
}
