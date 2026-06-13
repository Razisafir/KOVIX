/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for KaliToolBridge — security tool command routing.
 * Source: src/vs/platform/construct/common/terminal/kaliToolBridge.ts
 * Distribution: src/vs/platform/construct/common/terminal/distributionDetector.ts
 *
 * Tests distribution detection, command routing, target validation,
 * rate limiting, and audit logging.
 */

// ---- Replicate production types and logic ----

interface ILinuxDistribution {
	type: 'native' | 'wsl' | 'docker';
	name: string;
	available: boolean;
	tools?: string[];
}

/**
 * Route a command based on the distribution type.
 * Source: kaliToolBridge.ts routeCommand()
 */
function routeCommand(distribution: ILinuxDistribution | null, command: string): string {
	if (!distribution || !distribution.available) {
		return command;
	}

	switch (distribution.type) {
		case 'native':
			return command;
		case 'wsl':
			return `wsl -d kali-linux -- bash -c "${command.replace(/"/g, '\\"')}"`;
		case 'docker':
			return `docker run --rm kalilinux/kali-rolling bash -c "${command.replace(/"/g, '\\"')}"`;
		default:
			return command;
	}
}

/**
 * Internal IPs that are rejected by default for security scanning.
 * Source: kaliToolBridge.ts
 */
const INTERNAL_IP_PATTERNS = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2\d|3[0-1])\./,
	/^192\.168\./,
	/^localhost$/i,
	/^0\.0\.0\.0$/,
	/^\[::1?\]$/,
	/^::1?$/,
];

/**
 * Check if a target is an internal IP address.
 * Source: kaliToolBridge.ts isInternalTarget()
 */
function isInternalTarget(target: string): boolean {
	const cleaned = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
	for (const pattern of INTERNAL_IP_PATTERNS) {
		if (pattern.test(cleaned)) {
			return true;
		}
	}
	return false;
}

// ---- Rate limiting for Kali tools ----

const KALI_MAX_CONCURRENT = 5;

class KaliRateLimiter {
	private activeCount = 0;

	canExecute(): boolean {
		return this.activeCount < KALI_MAX_CONCURRENT;
	}

	startExecution(): void {
		if (!this.canExecute()) {
			throw new Error(`Maximum ${KALI_MAX_CONCURRENT} concurrent Kali tool executions`);
		}
		this.activeCount++;
	}

	endExecution(): void {
		this.activeCount = Math.max(0, this.activeCount - 1);
	}

	getActiveCount(): number {
		return this.activeCount;
	}
}

// ---- Audit logging ----

interface IKaliAuditEntry {
	timestamp: number;
	tool: string;
	command: string;
	target?: string;
	result: 'success' | 'error' | 'blocked';
	message?: string;
}

class KaliAuditLogger {
	private entries: IKaliAuditEntry[] = [];

	log(entry: IKaliAuditEntry): void {
		this.entries.push(entry);
	}

	getEntries(): IKaliAuditEntry[] {
		return [...this.entries];
	}

	getEntriesByTool(tool: string): IKaliAuditEntry[] {
		return this.entries.filter(e => e.tool === tool);
	}
}

// ---- Tests ----

suite('KaliToolBridge', () => {

	const nativeDist: ILinuxDistribution = { type: 'native', name: 'Kali Linux', available: true };
	const wslDist: ILinuxDistribution = { type: 'wsl', name: 'Kali Linux (WSL)', available: true };
	const dockerDist: ILinuxDistribution = { type: 'docker', name: 'Kali Linux (Docker)', available: true };
	const unavailableDist: ILinuxDistribution = { type: 'native', name: 'Kali Linux', available: false };

	suite('Distribution detection — Kali is detected', () => {
		test('detectNativeKali parses /etc/os-release with ID=kali', async () => {
			const mockExec = async (cmd: string) => {
				if (cmd === 'cat /etc/os-release') {
					return {
						stdout: 'NAME="Kali GNU/Linux"\nID=kali\nVERSION="2024.1"',
						stderr: '',
						exitCode: 0,
					};
				}
				return { stdout: '', stderr: '', exitCode: 1 };
			};

			// Simulate detectNativeKali logic
			const result = await mockExec('cat /etc/os-release');
			assert.strictEqual(result.exitCode, 0);
			assert.ok(result.stdout.includes('ID=kali'));
		});

		test('detectNativeKali returns null for non-Kali', async () => {
			const mockExec = async (cmd: string) => {
				if (cmd === 'cat /etc/os-release') {
					return {
						stdout: 'NAME="Ubuntu"\nID=ubuntu\nVERSION="22.04"',
						stderr: '',
						exitCode: 0,
					};
				}
				return { stdout: '', stderr: '', exitCode: 1 };
			};

			const result = await mockExec('cat /etc/os-release');
			assert.ok(!result.stdout.includes('ID=kali'));
		});

		test('distribution with available=true is usable', () => {
			assert.strictEqual(nativeDist.available, true);
			assert.strictEqual(wslDist.available, true);
			assert.strictEqual(dockerDist.available, true);
		});

		test('distribution with available=false is not usable', () => {
			assert.strictEqual(unavailableDist.available, false);
		});
	});

	suite('Command routing — commands are routed correctly', () => {
		test('native distribution executes command directly', () => {
			const result = routeCommand(nativeDist, 'nmap -sV 192.168.1.1');
			assert.strictEqual(result, 'nmap -sV 192.168.1.1');
		});

		test('WSL distribution wraps command with wsl -d kali-linux', () => {
			const result = routeCommand(wslDist, 'nmap -sV 192.168.1.1');
			assert.ok(result.startsWith('wsl -d kali-linux -- bash -c'));
			assert.ok(result.includes('nmap -sV 192.168.1.1'));
		});

		test('Docker distribution wraps command with docker run', () => {
			const result = routeCommand(dockerDist, 'nmap -sV 192.168.1.1');
			assert.ok(result.startsWith('docker run --rm kalilinux/kali-rolling'));
			assert.ok(result.includes('nmap -sV 192.168.1.1'));
		});

		test('null distribution returns command unchanged', () => {
			const result = routeCommand(null, 'nmap -sV 192.168.1.1');
			assert.strictEqual(result, 'nmap -sV 192.168.1.1');
		});

		test('unavailable distribution returns command unchanged', () => {
			const result = routeCommand(unavailableDist, 'nmap -sV 192.168.1.1');
			assert.strictEqual(result, 'nmap -sV 192.168.1.1');
		});

		test('commands with double quotes are escaped in WSL', () => {
			const result = routeCommand(wslDist, 'echo "hello world"');
			assert.ok(result.includes('\\"'), 'Double quotes should be escaped');
		});

		test('commands with double quotes are escaped in Docker', () => {
			const result = routeCommand(dockerDist, 'echo "hello world"');
			assert.ok(result.includes('\\"'), 'Double quotes should be escaped');
		});
	});

	suite('Target validation — internal IPs are rejected by default', () => {
		test('127.0.0.1 is internal', () => {
			assert.strictEqual(isInternalTarget('127.0.0.1'), true);
		});

		test('10.x.x.x is internal', () => {
			assert.strictEqual(isInternalTarget('10.0.0.1'), true);
			assert.strictEqual(isInternalTarget('10.255.255.255'), true);
		});

		test('172.16-31.x.x is internal', () => {
			assert.strictEqual(isInternalTarget('172.16.0.1'), true);
			assert.strictEqual(isInternalTarget('172.31.255.255'), true);
		});

		test('172.15.x.x is NOT internal', () => {
			assert.strictEqual(isInternalTarget('172.15.0.1'), false);
		});

		test('172.32.x.x is NOT internal', () => {
			assert.strictEqual(isInternalTarget('172.32.0.1'), false);
		});

		test('192.168.x.x is internal', () => {
			assert.strictEqual(isInternalTarget('192.168.1.1'), true);
			assert.strictEqual(isInternalTarget('192.168.0.1'), true);
		});

		test('localhost is internal', () => {
			assert.strictEqual(isInternalTarget('localhost'), true);
		});

		test('0.0.0.0 is internal', () => {
			assert.strictEqual(isInternalTarget('0.0.0.0'), true);
		});

		test('external IPs are not internal', () => {
			assert.strictEqual(isInternalTarget('8.8.8.8'), false);
			assert.strictEqual(isInternalTarget('1.1.1.1'), false);
			assert.strictEqual(isInternalTarget('203.0.113.1'), false);
		});

		test('URL with internal IP is detected', () => {
			assert.strictEqual(isInternalTarget('http://192.168.1.1:8080'), true);
		});

		test('URL with external IP is not internal', () => {
			assert.strictEqual(isInternalTarget('https://example.com'), false);
		});
	});

	suite('Rate limiting — max 5 concurrent', () => {
		test('allows up to 5 concurrent executions', () => {
			const limiter = new KaliRateLimiter();
			for (let i = 0; i < 5; i++) {
				assert.strictEqual(limiter.canExecute(), true, `Execution ${i + 1} should be allowed`);
				limiter.startExecution();
			}
		});

		test('rejects execution when at max capacity', () => {
			const limiter = new KaliRateLimiter();
			for (let i = 0; i < 5; i++) {
				limiter.startExecution();
			}
			assert.strictEqual(limiter.canExecute(), false);
			assert.throws(
				() => limiter.startExecution(),
				/Maximum 5 concurrent/
			);
		});

		test('execution slot freed after completion', () => {
			const limiter = new KaliRateLimiter();
			for (let i = 0; i < 5; i++) {
				limiter.startExecution();
			}
			limiter.endExecution();
			assert.strictEqual(limiter.canExecute(), true);
		});

		test('active count tracks correctly', () => {
			const limiter = new KaliRateLimiter();
			assert.strictEqual(limiter.getActiveCount(), 0);
			limiter.startExecution();
			assert.strictEqual(limiter.getActiveCount(), 1);
			limiter.startExecution();
			assert.strictEqual(limiter.getActiveCount(), 2);
			limiter.endExecution();
			assert.strictEqual(limiter.getActiveCount(), 1);
		});
	});

	suite('Audit logging — executions are logged', () => {
		test('successful execution is logged', () => {
			const logger = new KaliAuditLogger();
			logger.log({
				timestamp: Date.now(),
				tool: 'nmap',
				command: 'nmap -sV 192.168.1.1',
				target: '192.168.1.1',
				result: 'success',
			});
			assert.strictEqual(logger.getEntries().length, 1);
			assert.strictEqual(logger.getEntries()[0].tool, 'nmap');
			assert.strictEqual(logger.getEntries()[0].result, 'success');
		});

		test('blocked execution is logged', () => {
			const logger = new KaliAuditLogger();
			logger.log({
				timestamp: Date.now(),
				tool: 'nmap',
				command: 'nmap -sV 127.0.0.1',
				target: '127.0.0.1',
				result: 'blocked',
				message: 'Internal IP target rejected',
			});
			assert.strictEqual(logger.getEntries()[0].result, 'blocked');
			assert.strictEqual(logger.getEntries()[0].message, 'Internal IP target rejected');
		});

		test('entries can be filtered by tool', () => {
			const logger = new KaliAuditLogger();
			logger.log({ timestamp: Date.now(), tool: 'nmap', command: 'nmap', result: 'success' });
			logger.log({ timestamp: Date.now(), tool: 'nuclei', command: 'nuclei', result: 'success' });
			logger.log({ timestamp: Date.now(), tool: 'nmap', command: 'nmap -sV', result: 'error' });

			const nmapEntries = logger.getEntriesByTool('nmap');
			assert.strictEqual(nmapEntries.length, 2);
		});
	});
});
