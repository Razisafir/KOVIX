/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for MCPConnectionPool — MCP server connection management.
 * Source: src/vs/workbench/contrib/construct/browser/services/mcp/mcpConnectionPool.ts
 * Types: src/vs/platform/construct/common/mcp/mcpTypes.ts
 * Permissions: src/vs/platform/construct/common/mcp/mcpPermissions.ts
 *
 * Tests server lifecycle, tool execution, env sanitization,
 * connection retry, and graceful degradation.
 */

// ---- Replicate production constants and types ----

const MCP_MAX_CONCURRENT_SERVERS = 10;
const MCP_DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const MCP_HEALTH_CHECK_INTERVAL_MS = 30_000;
const MCP_MAX_RESTART_BACKOFF_MS = 60_000;
const MCP_RESTART_BACKOFF_BASE_MS = 1_000;

type MCPTransportType = 'stdio' | 'sse';
type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopping';
type MCPHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

interface IMCPServerDefinition {
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
	transport: MCPTransportType;
	secretEnvKeys?: string[];
}

type MCPPermissionLevel = 'untrusted' | 'standard' | 'elevated' | 'privileged';

interface MCPPermissionConfig {
	level: MCPPermissionLevel;
	allowedPaths?: string[];
	allowedNetwork?: string[];
	allowSubprocess?: boolean;
}

// ---- Permission enforcer (replicated from mcpPermissions.ts) ----

interface MCPAuditEntry {
	timestamp: number;
	serverName: string;
	permissionLevel: MCPPermissionLevel;
	action: string;
	resource: string;
	allowed: boolean;
}

class MCPPermissionEnforcer {
	private readonly _auditLog: MCPAuditEntry[] = [];

	constructor(
		private readonly config: MCPPermissionConfig,
		private readonly serverName: string = '<unknown>',
	) {}

	validateFileAccess(path: string, mode: 'read' | 'write'): boolean {
		const { level } = this.config;
		if (level === 'privileged') {
			this.audit('fileAccess', path, true);
			return true;
		}
		if (level === 'untrusted') {
			this.audit('fileAccess', path, false);
			return false;
		}
		const allowedPaths = this.config.allowedPaths ?? [];
		const isWithinAllowed = allowedPaths.length === 0 || allowedPaths.some(allowed => path.startsWith(allowed));
		if (!isWithinAllowed) {
			this.audit('fileAccess', path, false);
			return false;
		}
		if (level === 'standard') {
			const allowed = mode === 'read';
			this.audit('fileAccess', path, allowed);
			return allowed;
		}
		this.audit('fileAccess', path, true);
		return true;
	}

	validateNetworkAccess(url: string): boolean {
		const { level } = this.config;
		if (level === 'privileged') {
			this.audit('networkAccess', url, true);
			return true;
		}
		if (level === 'untrusted' || level === 'standard') {
			this.audit('networkAccess', url, false);
			return false;
		}
		const allowedNetwork = this.config.allowedNetwork ?? [];
		if (allowedNetwork.length === 0) {
			this.audit('networkAccess', url, false);
			return false;
		}
		let hostname: string;
		try {
			hostname = new URL(url).hostname;
		} catch {
			hostname = url;
		}
		const allowed = allowedNetwork.some(pattern => {
			if (pattern.startsWith('*.')) {
				const base = pattern.slice(2);
				return hostname === base || hostname.endsWith('.' + base);
			}
			return hostname === pattern || hostname.endsWith('.' + pattern);
		});
		this.audit('networkAccess', url, allowed);
		return allowed;
	}

	validateSubprocess(): boolean {
		const { level } = this.config;
		if (level !== 'privileged') {
			this.audit('subprocess', '<spawn>', false);
			return false;
		}
		const allowed = this.config.allowSubprocess === true;
		this.audit('subprocess', '<spawn>', allowed);
		return allowed;
	}

	getPermissionLevel(): MCPPermissionLevel {
		return this.config.level;
	}

	getAuditLog(): ReadonlyArray<MCPAuditEntry> {
		return this._auditLog;
	}

	private audit(action: string, resource: string, allowed: boolean): void {
		this._auditLog.push({
			timestamp: Date.now(),
			serverName: this.serverName,
			permissionLevel: this.config.level,
			action,
			resource,
			allowed,
		});
	}
}

// ---- Env sanitization logic ----

/**
 * Build a minimal environment for MCP server processes.
 * Security: Do NOT spread process.env — it contains host secrets.
 */
function buildMinimalEnv(
	serverEnv: Record<string, string>,
	platform: string = 'linux'
): Record<string, string> {
	const minimalEnv: Record<string, string> = {
		PATH: '/usr/bin:/bin',
		HOME: '/home/user',
		USER: 'user',
		TEMP: '/tmp',
		TMPDIR: '/tmp',
		...(platform === 'win32' ? {
			SYSTEMROOT: 'C:\\Windows',
			COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
			PROGRAMFILES: 'C:\\Program Files',
		} : {}),
		// Only pass MCP-server-specific env vars from the definition
		...(serverEnv || {}),
	};
	return minimalEnv;
}

/**
 * Check if env contains any process.env keys (security violation).
 */
function envContainsProcessEnv(env: Record<string, string>, processEnvKeys: string[]): string[] {
	const leaks: string[] = [];
	for (const key of processEnvKeys) {
		if (key in env && !(key in ['PATH', 'HOME', 'USER', 'TEMP', 'TMPDIR', 'SYSTEMROOT', 'COMSPEC', 'PROGRAMFILES'])) {
			// Check if this wasn't from server definition
			leaks.push(key);
		}
	}
	return leaks;
}

// ---- Exponential backoff logic ----

function calculateRestartDelay(retryCount: number): number {
	const delay = MCP_RESTART_BACKOFF_BASE_MS * Math.pow(2, retryCount);
	return Math.min(delay, MCP_MAX_RESTART_BACKOFF_MS);
}

// ---- Simple connection pool for testing ----

interface IPoolEntry {
	name: string;
	state: MCPConnectionState;
	enforcer: MCPPermissionEnforcer;
}

class SimpleConnectionPool {
	private connections = new Map<string, IPoolEntry>();
	private readonly maxConcurrent = MCP_MAX_CONCURRENT_SERVERS;

	addServer(name: string, permissionConfig: MCPPermissionConfig): void {
		if (this.connections.size >= this.maxConcurrent) {
			throw new Error(`Connection pool full (max ${this.maxConcurrent})`);
		}
		const enforcer = new MCPPermissionEnforcer(permissionConfig, name);
		this.connections.set(name, { name, state: 'connecting', enforcer });
	}

	connect(name: string): void {
		const entry = this.connections.get(name);
		if (!entry) { throw new Error(`Server ${name} not found`); }
		entry.state = 'connected';
	}

	disconnect(name: string): void {
		const entry = this.connections.get(name);
		if (!entry) { return; }
		entry.state = 'disconnected';
		this.connections.delete(name);
	}

	getState(name: string): MCPConnectionState | undefined {
		return this.connections.get(name)?.state;
	}

	getEnforcer(name: string): MCPPermissionEnforcer | undefined {
		return this.connections.get(name)?.enforcer;
	}

	get activeConnectionCount(): number {
		let count = 0;
		for (const entry of this.connections.values()) {
			if (entry.state === 'connected' || entry.state === 'connecting') {
				count++;
			}
		}
		return count;
	}

	canConnect(): boolean {
		return this.activeConnectionCount < this.maxConcurrent;
	}

	executeTool(serverName: string, toolName: string, args: Record<string, unknown>): { success: boolean; data?: unknown; error?: string } {
		const entry = this.connections.get(serverName);
		if (!entry || entry.state !== 'connected') {
			return { success: false, error: `Server ${serverName} is not connected` };
		}

		// Validate file access for path-containing args
		if (args.path && !entry.enforcer.validateFileAccess(args.path as string, 'read')) {
			return { success: false, error: 'Permission denied: file access' };
		}

		return { success: true, data: { toolName, args } };
	}
}

// ---- Tests ----

suite('MCPConnectionPool', () => {

	suite('Server lifecycle — start/stop', () => {
		test('server can be added and connected', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('test-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			pool.connect('test-server');
			assert.strictEqual(pool.getState('test-server'), 'connected');
		});

		test('server can be disconnected', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('test-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			pool.connect('test-server');
			pool.disconnect('test-server');
			assert.strictEqual(pool.getState('test-server'), undefined);
		});

		test('pool tracks active connections', () => {
			const pool = new SimpleConnectionPool();
			assert.strictEqual(pool.activeConnectionCount, 0);
			pool.addServer('s1', { level: 'standard' });
			assert.strictEqual(pool.activeConnectionCount, 1);
			pool.connect('s1');
			assert.strictEqual(pool.activeConnectionCount, 1);
		});

		test('pool enforces maximum concurrent servers', () => {
			const pool = new SimpleConnectionPool();
			for (let i = 0; i < MCP_MAX_CONCURRENT_SERVERS; i++) {
				pool.addServer(`server-${i}`, { level: 'untrusted' });
			}
			assert.throws(
				() => pool.addServer('one-too-many', { level: 'untrusted' }),
				/Connection pool full/
			);
		});

		test('canConnect returns false when pool is full', () => {
			const pool = new SimpleConnectionPool();
			for (let i = 0; i < MCP_MAX_CONCURRENT_SERVERS; i++) {
				pool.addServer(`server-${i}`, { level: 'untrusted' });
			}
			assert.strictEqual(pool.canConnect(), false);
		});
	});

	suite('Tool execution — tools are called correctly', () => {
		test('tool execution succeeds on connected server', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('test-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			pool.connect('test-server');

			const result = pool.executeTool('test-server', 'read_file', { path: '/workspace/src/main.ts' });
			assert.strictEqual(result.success, true);
		});

		test('tool execution fails on disconnected server', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('test-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			// Not connected yet

			const result = pool.executeTool('test-server', 'read_file', { path: '/workspace/src/main.ts' });
			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('not connected'));
		});

		test('tool execution fails on non-existent server', () => {
			const pool = new SimpleConnectionPool();
			const result = pool.executeTool('no-such-server', 'read_file', { path: '/tmp/test' });
			assert.strictEqual(result.success, false);
		});

		test('tool execution fails when permission denied', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('test-server', { level: 'untrusted' });
			pool.connect('test-server');

			const result = pool.executeTool('test-server', 'read_file', { path: '/workspace/src/main.ts' });
			assert.strictEqual(result.success, false);
			assert.ok(result.error?.includes('Permission denied'));
		});
	});

	suite('Env sanitization — no process.env leak', () => {
		test('minimal env does not contain arbitrary process.env keys', () => {
			const serverEnv = { MY_API_KEY: 'key123' };
			const env = buildMinimalEnv(serverEnv);

			// Should contain standard keys
			assert.ok('PATH' in env, 'PATH should be present');
			assert.ok('HOME' in env, 'HOME should be present');
			assert.ok('USER' in env, 'USER should be present');

			// Should contain server-specific keys
			assert.strictEqual(env.MY_API_KEY, 'key123');

			// Should NOT contain arbitrary process env keys
			assert.ok(!('AWS_SECRET_ACCESS_KEY' in env), 'Should not leak AWS keys');
			assert.ok(!('GITHUB_TOKEN' in env), 'Should not leak GitHub token');
		});

		test('Windows platform adds SYSTEMROOT and COMSPEC', () => {
			const env = buildMinimalEnv({}, 'win32');
			assert.ok('SYSTEMROOT' in env, 'SYSTEMROOT should be present on Windows');
			assert.ok('COMSPEC' in env, 'COMSPEC should be present on Windows');
		});

		test('Linux platform does not add Windows keys', () => {
			const env = buildMinimalEnv({}, 'linux');
			assert.ok(!('SYSTEMROOT' in env), 'SYSTEMROOT should not be present on Linux');
			assert.ok(!('COMSPEC' in env), 'COMSPEC should not be present on Linux');
		});

		test('server env keys override minimal env defaults', () => {
			const serverEnv = { HOME: '/custom/home', CUSTOM_VAR: 'value' };
			const env = buildMinimalEnv(serverEnv);
			assert.strictEqual(env.HOME, '/custom/home', 'Server env should override defaults');
			assert.strictEqual(env.CUSTOM_VAR, 'value', 'Custom server var should be present');
		});
	});

	suite('Connection retry — exponential backoff', () => {
		test('backoff increases exponentially', () => {
			assert.strictEqual(calculateRestartDelay(0), 1_000);
			assert.strictEqual(calculateRestartDelay(1), 2_000);
			assert.strictEqual(calculateRestartDelay(2), 4_000);
			assert.strictEqual(calculateRestartDelay(3), 8_000);
			assert.strictEqual(calculateRestartDelay(4), 16_000);
		});

		test('backoff is capped at MCP_MAX_RESTART_BACKOFF_MS', () => {
			const largeRetryCount = 20;
			const delay = calculateRestartDelay(largeRetryCount);
			assert.ok(delay <= MCP_MAX_RESTART_BACKOFF_MS, `Delay ${delay} should be <= ${MCP_MAX_RESTART_BACKOFF_MS}`);
		});

		test('MCP_MAX_RESTART_BACKOFF_MS is 60 seconds', () => {
			assert.strictEqual(MCP_MAX_RESTART_BACKOFF_MS, 60_000);
		});

		test('MCP_RESTART_BACKOFF_BASE_MS is 1 second', () => {
			assert.strictEqual(MCP_RESTART_BACKOFF_BASE_MS, 1_000);
		});
	});

	suite('Graceful degradation — agent continues if server crashes', () => {
		test('other servers remain operational when one crashes', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('healthy-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			pool.addServer('crashing-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			pool.connect('healthy-server');
			pool.connect('crashing-server');

			// Simulate crash by disconnecting
			pool.disconnect('crashing-server');

			// Healthy server should still work
			const result = pool.executeTool('healthy-server', 'read_file', { path: '/workspace/src/main.ts' });
			assert.strictEqual(result.success, true, 'Healthy server should still execute tools');
		});

		test('failed server returns proper error for tool execution', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('crashed-server', { level: 'elevated', allowedPaths: ['/workspace'] });
			pool.connect('crashed-server');
			pool.disconnect('crashed-server');

			const result = pool.executeTool('crashed-server', 'read_file', { path: '/workspace/file.ts' });
			assert.strictEqual(result.success, false);
			assert.ok(result.error);
		});

		test('pool can add new servers after crash', () => {
			const pool = new SimpleConnectionPool();
			pool.addServer('crashed', { level: 'untrusted' });
			pool.disconnect('crashed');

			// Should be able to add a replacement
			pool.addServer('replacement', { level: 'untrusted' });
			pool.connect('replacement');
			assert.strictEqual(pool.getState('replacement'), 'connected');
		});

		test('permission audit log is maintained for debugging', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'untrusted' }, 'test-server');
			enforcer.validateFileAccess('/etc/passwd', 'read');
			enforcer.validateNetworkAccess('https://evil.com');
			enforcer.validateSubprocess();

			const log = enforcer.getAuditLog();
			assert.strictEqual(log.length, 3, 'Should have 3 audit entries');
			assert.strictEqual(log[0].action, 'fileAccess');
			assert.strictEqual(log[0].allowed, false);
			assert.strictEqual(log[1].action, 'networkAccess');
			assert.strictEqual(log[1].allowed, false);
			assert.strictEqual(log[2].action, 'subprocess');
			assert.strictEqual(log[2].allowed, false);
		});
	});

	suite('Permission levels', () => {
		test('untrusted enforcer denies everything', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'untrusted' }, 'test');
			assert.strictEqual(enforcer.validateFileAccess('/workspace/file.ts', 'read'), false);
			assert.strictEqual(enforcer.validateNetworkAccess('https://api.example.com'), false);
			assert.strictEqual(enforcer.validateSubprocess(), false);
		});

		test('privileged enforcer allows everything', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'privileged', allowSubprocess: true }, 'test');
			assert.strictEqual(enforcer.validateFileAccess('/etc/passwd', 'read'), true);
			assert.strictEqual(enforcer.validateNetworkAccess('https://any.com'), true);
			assert.strictEqual(enforcer.validateSubprocess(), true);
		});

		test('standard enforcer allows read-only file access', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'standard', allowedPaths: ['/workspace'] }, 'test');
			assert.strictEqual(enforcer.validateFileAccess('/workspace/file.ts', 'read'), true);
			assert.strictEqual(enforcer.validateFileAccess('/workspace/file.ts', 'write'), false);
		});

		test('elevated enforcer allows read+write within allowed paths', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'elevated', allowedPaths: ['/workspace'] }, 'test');
			assert.strictEqual(enforcer.validateFileAccess('/workspace/file.ts', 'read'), true);
			assert.strictEqual(enforcer.validateFileAccess('/workspace/file.ts', 'write'), true);
		});

		test('elevated enforcer denies access outside allowed paths', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'elevated', allowedPaths: ['/workspace'] }, 'test');
			assert.strictEqual(enforcer.validateFileAccess('/etc/passwd', 'read'), false);
		});

		test('elevated enforcer validates network access', () => {
			const enforcer = new MCPPermissionEnforcer({ level: 'elevated', allowedNetwork: ['api.github.com'] }, 'test');
			assert.strictEqual(enforcer.validateNetworkAccess('https://api.github.com/repos'), true);
			assert.strictEqual(enforcer.validateNetworkAccess('https://evil.com'), false);
		});
	});
});
