// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_ADDITIONAL_TERMS.txt.
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
 * SEC-3: Shell metacharacters that could chain commands when combined with
 * user-provided arguments. These are stripped/rejected from ARGUMENTS only
 * (not the command itself).
 */
export const SHELL_METACHAR_BLOCKLIST = [
        ';', '&&', '||', '|', '`', '$(', ')', '{', '}', '>>', '>', '<', '2>',
];

/**
 * SEC-3: Regex patterns for detecting shell metacharacters in arguments.
 */
const SHELL_METACHAR_REGEX = /(;|&&|\|\||`|\$\(|\{|}|\d*>|<)/;

/**
 * SEC-3: Default allowlist for restricted mode.
 * Only these commands are allowed when construct.terminal.restrictedMode is true.
 */
export const DEFAULT_COMMAND_ALLOWLIST: string[] = [
        'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc',
        'npm', 'yarn', 'pnpm', 'npx', 'node', 'python', 'python3', 'pip', 'pip3',
        'git', 'cargo', 'rustc', 'go', 'dotnet', 'java', 'javac', 'mvn', 'gradle',
        'make', 'cmake', 'gcc', 'g++', 'clang', 'cargo',
        'echo', 'pwd', 'whoami', 'which', 'where',
        'curl', 'wget',
        'docker', 'podman', 'kubectl',
        'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
        'mkdir', 'touch', 'cp', 'mv',
        'sed', 'awk', 'sort', 'uniq', 'diff', 'patch',
];

/**
 * SEC-3: Rate limit configuration for terminal commands.
 * Max 10 terminal commands per 30 seconds per agent session.
 */
export const TERMINAL_RATE_LIMIT = {
        maxCommands: 10,
        windowMs: 30_000,
};

/**
 * SEC-3: Secret patterns that must NEVER appear in audit logs.
 */
const SECRET_LOG_PATTERNS = [
        /sk-ant-[A-Za-z0-9_-]{20,}/g,
        /sk-[A-Za-z0-9]{20,}/g,
        /Bearer [A-Za-z0-9_.-]{20,}/g,
        /password=\S+/gi,
        /token=\S+/gi,
        /key=\S+/gi,
];

/**
 * SEC-3: Sanitise a command for audit logging — redact any secret patterns.
 */
export function sanitiseForAuditLog(text: string): string {
        let result = text;
        for (const pattern of SECRET_LOG_PATTERNS) {
                result = result.replace(pattern, '[REDACTED]');
        }
        return result;
}

/**
 * SEC-3: Check if a command's arguments contain shell metacharacters.
 * Returns the matched character if found, or null if clean.
 */
export function detectShellMetacharInArgs(args: string): string | null {
        const match = args.match(SHELL_METACHAR_REGEX);
        return match ? match[0] : null;
}

/**
 * SEC-3: Check if a command is in the allowlist (for restricted mode).
 */
export function isCommandInAllowlist(command: string, allowlist?: string[]): boolean {
        const list = allowlist ?? DEFAULT_COMMAND_ALLOWLIST;
        // Extract the base command (first token)
        const baseCommand = command.trim().split(/\s+/)[0];
        // Handle path-prefixed commands like /usr/bin/git
        const commandName = baseCommand.split('/').pop() ?? baseCommand;
        return list.some(allowed => commandName === allowed);
}

/**
 * SEC-3: Enforce workspace directory jail — prevent cd to paths outside workspace root.
 */
export async function isPathWithinWorkspace(filePath: string, workspaceRoot: string): Promise<boolean> {
        const path = await import('path');
        const resolved = path.resolve(filePath);
        const root = path.resolve(workspaceRoot);
        return resolved.startsWith(root + path.sep) || resolved === root;
}

/**
 * SEC-3: Rate limiter for terminal command execution.
 * Tracks command timestamps per session.
 */
export class TerminalRateLimiter {
        private commandTimestamps: number[] = [];

        /**
         * Check if a new command can be executed within the rate limit.
         * Returns true if the command is allowed, false if rate limited.
         */
        canExecute(): boolean {
                const now = Date.now();
                const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;

                // Remove timestamps outside the window
                this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);

                return this.commandTimestamps.length < TERMINAL_RATE_LIMIT.maxCommands;
        }

        /**
         * Record a command execution timestamp.
         */
        recordExecution(): void {
                this.commandTimestamps.push(Date.now());
        }

        /**
         * Get the number of remaining commands in the current window.
         */
        remainingCommands(): number {
                const now = Date.now();
                const windowStart = now - TERMINAL_RATE_LIMIT.windowMs;
                this.commandTimestamps = this.commandTimestamps.filter(ts => ts > windowStart);
                return Math.max(0, TERMINAL_RATE_LIMIT.maxCommands - this.commandTimestamps.length);
        }
}

/**
 * Service for executing terminal commands securely within CONSTRUCT IDE.
 * Uses CONSTRUCT IDE's terminal infrastructure for real process execution.
 * Enforces a security blocklist to prevent dangerous commands.
 *
 * SEC-3: Enhanced with:
 * - Shell metacharacter detection in arguments
 * - Allowlist mode for restricted sessions (WSL/Kali)
 * - Working directory jail
 * - Rate limiting (10 commands per 30 seconds)
 * - Audit logging with secret redaction
 */
export interface ITerminalExecutor {
        readonly _serviceBrand: undefined;

        /**
         * Execute a command and return the result.
         * The command runs in a real shell process via CONSTRUCT IDE's terminal infrastructure.
         *
         * SEC-3: Command is validated against:
         * - Shell metacharacter blocklist in arguments
         * - Restricted mode allowlist (if enabled)
         * - Working directory jail
         * - Rate limit (10 commands / 30 seconds)
         *
         * @param command The command to execute
         * @param cwd Working directory (defaults to workspace root)
         * @param timeout Timeout in milliseconds (default: 60000)
         * @param signal Optional AbortSignal for cancellation
         * @param onOutput Optional callback for streaming output chunks. Receives
         *   cleaned (ANSI-stripped) output data as it arrives, enabling real-time
         *   progress indicators for long-running commands like npm install.
         * @returns Result with stdout, stderr, and exit code
         * @throws Error if command is on the security blocklist
         */
        execute(
                command: string,
                cwd?: string,
                timeout?: number,
                signal?: AbortSignal,
                onOutput?: (data: string) => void
        ): Promise<ITerminalExecResult>;

        /**
         * Check if a command is on the security blocklist.
         * Blocklist includes: rm -rf /, sudo, curl|sh, wget|sh, mkfs, dd to /dev,
         * chmod 777 /, writing to /etc/, fork bombs.
         */
        isBlocked(command: string): boolean;
}
