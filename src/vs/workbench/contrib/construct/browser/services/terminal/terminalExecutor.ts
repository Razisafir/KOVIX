// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ITerminalExecutor, ITerminalExecResult, TerminalRateLimiter, detectShellMetacharInArgs, isCommandInAllowlist, isPrivilegeEscalation, DEFAULT_COMMAND_TIMEOUT_S, sanitiseForAuditLog, sanitiseOutput } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { ITerminalService } from '../../../../terminal/browser/terminal.js';
import { IShellLaunchConfig } from '../../../../../../platform/terminal/common/terminal.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';

/**
 * Security blocklist patterns -- checked before every command execution.
 * Blocks destructive commands that could damage the system.
 * Each pattern is tested against the lowercased, trimmed command.
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
        />\s*\/etc\//,                                                   // writing to /etc/ (e.g., echo "..." > /etc/...)
        /:\(\)\s*\{\s*:\|:&\s*\}/,                                // fork bomb: :(){ :|:& };:
        /\bshutdown\b/,                                                  // shutdown
        /\breboot\b/,                                                    // reboot
        /\binit\s+[06]\b/,                                              // init 0 / init 6
        /\bpkexec\b/,                                                    // SEC-P2: PolicyKit escalation
        /\bdoas\b/,                                                      // SEC-P2: OpenBSD doas
        /\bgosu\b/,                                                      // SEC-P2: gosu (Docker user switching)
        /\brun0\b/,                                                      // SEC-P2: systemd-run0 (systemd privilege escalation)
];

/** Marker used to capture exit code from shell output. */
const EXIT_CODE_MARKER = '__CONSTRUCT_EXIT__';

export class TerminalExecutorService extends Disposable implements ITerminalExecutor {
        readonly _serviceBrand: undefined;

        /** SEC-3: Rate limiter per agent session */
        private readonly rateLimiter = new TerminalRateLimiter();

        /** SEC-P2: Track whether user has confirmed privilege escalation this session — reserved for future UI confirmation flow */

        constructor(
                @ILogService private readonly logService: ILogService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ITerminalService private readonly terminalService: ITerminalService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                this.logService.info('[TerminalExecutor] Service created (SEC-3 hardened, SEC-P2 privilege escalation protection)');
        }

        /** SEC-P2: Check if a command requires user confirmation (privilege escalation) */
        requiresConfirmation(command: string): boolean {
                return isPrivilegeEscalation(command);
        }

        isBlocked(command: string): boolean {
                const normalizedCmd = command.trim().toLowerCase();
                for (const pattern of BLOCKLIST_PATTERNS) {
                        if (pattern.test(normalizedCmd)) {
                                this.logService.warn(`[TerminalExecutor] Blocked command: ${sanitiseForAuditLog(command)}`);
                                return true;
                        }
                }
                return false;
        }

        async execute(
                command: string,
                cwd?: string,
                timeout?: number,
                signal?: AbortSignal,
                onOutput?: (data: string) => void
        ): Promise<ITerminalExecResult> {
                // SEC-3: Rate limiting
                if (!this.rateLimiter.canExecute()) {
                        const remaining = this.rateLimiter.remainingCommands();
                        throw new Error(`Command rate limit exceeded. Max 10 commands per 30 seconds. Please wait before trying again. (${remaining} remaining)`);
                }

                // SEC-3: Shell metacharacter detection in arguments
                const argsPart = this.extractArgsFromCommand(command);
                if (argsPart) {
                        const metachar = detectShellMetacharInArgs(argsPart);
                        if (metachar) {
                                throw new Error(`Command rejected: shell metacharacter "${metachar}" detected in arguments. Chained commands are not allowed for security reasons.`);
                        }
                }

                // SEC-3: Restricted mode allowlist check
                const restrictedMode = this.configurationService.getValue<boolean>('construct.terminal.restrictedMode') ?? true;
                if (restrictedMode && !isCommandInAllowlist(command)) {
                        throw new Error(`Command rejected in restricted mode: "${command.split(/\s+/)[0]}" is not in the allowed command list. Disable construct.terminal.restrictedMode to allow all commands.`);
                }

                // SEC-3: Working directory jail
                const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                if (cwd && workspaceRoot) {
                        const pathModule = await import('path');
                        const resolvedCwd = pathModule.resolve(cwd);
                        const resolvedRoot = pathModule.resolve(workspaceRoot);
                        if (!resolvedCwd.startsWith(resolvedRoot + pathModule.sep) && resolvedCwd !== resolvedRoot) {
                                throw new Error(`Security: working directory "${resolvedCwd}" is outside workspace "${resolvedRoot}". Commands cannot cd outside the workspace root.`);
                        }
                }

                        // SEC-3: Security check — blocklist
                if (this.isBlocked(command)) {
                        throw new Error(`Command blocked by security policy: "${command}". This command matches a dangerous pattern.`);
                }

                // SEC-P2: Privilege escalation check — even in unrestricted mode, commands
                // like sudo, pkexec, doas, gosu, run0 require user confirmation
                if (isPrivilegeEscalation(command)) {
                        this.logService.warn(`[TerminalExecutor] Privilege escalation command blocked: ${sanitiseForAuditLog(command)}`);
                        throw new Error(`Command requires user confirmation: "${command.split(/\s+/)[0]}" is a privilege escalation command. These commands are blocked for security. If you need elevated privileges, run the command manually in a terminal.`);
                }

                // SEC-3: Record execution for rate limiting
                this.rateLimiter.recordExecution();

                // SEC-P2: Use configurable timeout from construct.terminal.commandTimeout
                const configTimeout = this.configurationService.getValue<number>('construct.terminal.commandTimeout') ?? DEFAULT_COMMAND_TIMEOUT_S;
                const clampedTimeout = Math.max(10, Math.min(300, configTimeout));
                const effectiveTimeout = timeout ?? this.inferTimeout(command, clampedTimeout * 1000);
                this.logService.info(`[TerminalExecutor] Executing: ${sanitiseForAuditLog(command)} (timeout: ${effectiveTimeout}ms)`);

                // Resolve working directory
                const cwdUri = cwd ? URI.file(cwd) : (workspaceRoot ? URI.file(workspaceRoot) : undefined);

                // Build the command with exit code capture using a cross-shell compatible wrapper.
                // The EXIT_CODE_MARKER pattern is parsed from output to determine the exit code.
                const isWindows = navigator.platform.toLowerCase().includes('win');
                const isMac = navigator.platform.toLowerCase().includes('mac');

                // On macOS, prefer zsh (default since Catalina); fall back to bash on Linux
                const shellExe = isWindows ? 'cmd' : (isMac ? '/bin/zsh' : '/bin/bash');
                const wrappedCommand = isWindows
                        ? `${command} & echo ${EXIT_CODE_MARKER}%errorlevel%`
                        : `${command}; __exit_code__=$?; echo "${EXIT_CODE_MARKER}$__exit_code__"`;

                // Create a dedicated terminal for this command
                const launchConfig: IShellLaunchConfig = {
                        name: `Construct: ${command.substring(0, 40)}...`,
                        executable: shellExe,
                        args: isWindows ? ['/c', wrappedCommand] : ['-c', wrappedCommand],
                        cwd: cwdUri,
                        isFeatureTerminal: true,
                        hideFromUser: false,
                };

                // Create terminal and capture output
                const instance = await this.terminalService.createTerminal({ config: launchConfig });

                const startTime = Date.now();

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

                                // Stream output to callback for real-time progress
                                if (onOutput && clean.trim()) {
                                        onOutput(clean);
                                }
                        });

                        // Listen for terminal exit
                        const exitListener = instance.onExit((e: number | { code?: number } | undefined) => {
                                dataListener.dispose();
                                exitListener.dispose();

                                if (!settled) {
                                        const code = typeof e === 'number' ? e : (e?.code ?? exitCode);
                                        cleanup();
                                        // SEC-P2: Redact secrets from command output before returning to agent
                                        const result = {
                                                stdout: sanitiseOutput(this.cleanOutput(stdout)),
                                                stderr: sanitiseOutput(this.cleanOutput(stderr)),
                                                exitCode: code,
                                        };

                                        // SEC-3: Audit log the command
                                        this.auditLog(command, code, Date.now() - startTime);

                                        resolve(result);
                                }
                        });

                        // Timeout
                        const timer = setTimeout(() => {
                                if (!settled) {
                                        this.logService.warn(`[TerminalExecutor] Command timed out after ${effectiveTimeout}ms: ${sanitiseForAuditLog(command)}`);
                                        dataListener.dispose();
                                        exitListener.dispose();
                                        cleanup();
                                        this.auditLog(command, 124, effectiveTimeout);
                                        resolve({
                                                stdout: sanitiseOutput(this.cleanOutput(stdout)),
                                                stderr: sanitiseOutput('Command timed out'),
                                                exitCode: 124, // Standard timeout exit code
                                        });
                                }
                        }, effectiveTimeout);

                        // Abort signal
                        if (signal) {
                                const onAbort = () => {
                                        if (!settled) {
                                                this.logService.info(`[TerminalExecutor] Command aborted: ${sanitiseForAuditLog(command)}`);
                                                dataListener.dispose();
                                                exitListener.dispose();
                                                clearTimeout(timer);
                                                cleanup();
                                                this.auditLog(command, 130, Date.now() - startTime);
                                                resolve({
                                                        stdout: sanitiseOutput(this.cleanOutput(stdout)),
                                                        stderr: sanitiseOutput('Command cancelled by user'),
                                                        exitCode: 130, // Standard SIGINT exit code
                                                });
                                        }
                                };
                                signal.addEventListener('abort', onAbort, { once: true });
                        }
                });
        }

        /**
         * SEC-3: Extract the arguments portion of a command for metacharacter scanning.
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
         * SEC-3: Write an entry to the audit log.
         * Secrets are redacted before logging.
         */
        private async auditLog(command: string, exitCode: number, durationMs: number): Promise<void> {
                try {
                        const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
                        if (!workspaceRoot) { return; }

                        const pathModule = await import('path');
                        const fs = await import('fs');
                        const constructDir = pathModule.join(workspaceRoot, '.construct');
                        const auditPath = pathModule.join(constructDir, 'audit.log');

                        // Ensure .construct directory exists
                        if (!fs.existsSync(constructDir)) {
                                fs.mkdirSync(constructDir, { recursive: true });
                        }

                        const timestamp = new Date().toISOString();
                        const safeCommand = sanitiseForAuditLog(command);
                        // Hash the command for audit trail without logging full command
                        const commandHash = this.hashString(safeCommand);

                        const logLine = `${timestamp} | hash:${commandHash} | exit:${exitCode} | duration:${durationMs}ms\n`;

                        fs.appendFileSync(auditPath, logLine, 'utf-8');
                } catch {
                        // Audit logging is best-effort; never block execution
                }
        }

        /**
         * SEC-3: Simple hash function for command audit logging.
         * Avoids logging full commands which might contain secrets.
         */
        private hashString(str: string): string {
                let hash = 0;
                for (let i = 0; i < str.length; i++) {
                        const char = str.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash |= 0; // Convert to 32-bit integer
                }
                return Math.abs(hash).toString(16).padStart(8, '0');
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

        /**
         * Infer an appropriate timeout based on the command being executed.
         * Package manager commands (npm, yarn, pnpm) get 120s because they
         * often need to download and install large dependencies.
         * Build commands get 120s as well.
         * All other commands default to the provided default timeout.
         */
        private inferTimeout(command: string, defaultTimeout: number): number {
                const slowCommands = [
                        'npm ', 'npm install', 'npm create', 'npm run',
                        'yarn ', 'yarn install', 'yarn create', 'yarn run',
                        'pnpm ', 'pnpm install', 'pnpm create', 'pnpm run',
                        'npx ',
                        'cargo ', 'cargo build', 'cargo install',
                        'pip install', 'pip3 install',
                        'dotnet build', 'dotnet restore',
                        'make', 'cmake',
                        'docker build',
                ];
                const lowerCmd = command.toLowerCase().trim();
                for (const slow of slowCommands) {
                        if (lowerCmd.startsWith(slow.toLowerCase())) {
                                this.logService.info(`[TerminalExecutor] Using extended timeout (120s) for: ${sanitiseForAuditLog(command.substring(0, 60))}`);
                                return 120000;
                        }
                }
                return defaultTimeout;
        }

        override dispose(): void {
                super.dispose();
        }
}
