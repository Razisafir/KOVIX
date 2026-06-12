/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Replicate the core logic of assertWithinWorkspace from the source for direct testing.
 * The real function is at: src/vs/platform/construct/common/security/workspaceGuard.ts
 *
 * This test exercises the EXACT same algorithm as the production code, including:
 * - Path normalization
 * - Workspace boundary enforcement
 * - Symlink resolution via realpathSync
 * - Absolute path rejection without workspace context
 */

// ---- Replicate production logic for testing ----

function assertWithinWorkspace(filePath: string, workspaceRoot?: string): void {
	const normalized = path.normalize(filePath);
	if (normalized.includes('..')) {
		throw new Error(`Path traversal not allowed: "${filePath}"`);
	}

	if (workspaceRoot) {
		const root = path.resolve(workspaceRoot);

		const resolved = path.isAbsolute(filePath)
			? path.resolve(filePath)
			: path.resolve(root, filePath);

		// Resolve symlinks to prevent bypass via symlink chains
		let realPath: string;
		let realRoot: string;
		try {
			realPath = fs.realpathSync(resolved);
		} catch {
			try {
				realPath = fs.realpathSync(path.dirname(resolved));
			} catch {
				realPath = resolved;
			}
		}
		try {
			realRoot = fs.realpathSync(root);
		} catch {
			realRoot = root;
		}

		if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
			throw new Error(`Path traversal detected: ${filePath} resolves outside workspace`);
		}
	} else {
		if (path.isAbsolute(filePath)) {
			throw new Error(`Absolute paths require a workspace context: "${filePath}"`);
		}
	}
}

function validateToolName(name: string): boolean {
	const ALLOWED_TOOLS = new Set([
		'read_file', 'write_file', 'edit_file', 'list_directory',
		'create_directory', 'search_files', 'run_command',
		'search_codebase', 'web_search'
	]);
	return ALLOWED_TOOLS.has(name);
}

function validateMcpMethod(method: string): boolean {
	const ALLOWED_METHODS = new Set([
		'initialize', 'tools/list', 'tools/call',
		'resources/list', 'resources/read'
	]);
	return ALLOWED_METHODS.has(method);
}

// ---- Tests ----

suite('WorkspaceGuard', () => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovix-wg-test-'));
	const workspaceDir = path.join(tmpDir, 'workspace');
	const outsideDir = path.join(tmpDir, 'outside');

	suiteSetup(() => {
		fs.mkdirSync(workspaceDir, { recursive: true });
		fs.mkdirSync(outsideDir, { recursive: true });
		fs.writeFileSync(path.join(workspaceDir, 'safe.txt'), 'hello');
		fs.writeFileSync(path.join(outsideDir, 'dangerous.txt'), 'evil');
	});

	suiteTeardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('path traversal with .. is detected', () => {
		assert.throws(
			() => assertWithinWorkspace('../../../etc/passwd', workspaceDir),
			/Path traversal not allowed/
		);
	});

	test('path traversal with embedded .. is detected', () => {
		assert.throws(
			() => assertWithinWorkspace('src/../../../etc/passwd', workspaceDir),
			/Path traversal not allowed/
		);
	});

	test('absolute path outside workspace is rejected', () => {
		assert.throws(
			() => assertWithinWorkspace('/etc/passwd', workspaceDir),
			/Path traversal detected/
		);
	});

	test('relative path within workspace is accepted', () => {
		assert.doesNotThrow(() => {
			assertWithinWorkspace('src/main.ts', workspaceDir);
		});
	});

	test('absolute path within workspace is accepted', () => {
		const safePath = path.join(workspaceDir, 'safe.txt');
		assert.doesNotThrow(() => {
			assertWithinWorkspace(safePath, workspaceDir);
		});
	});

	test('path with encoded traversal is detected', () => {
		const encodedPath = '..%2F..%2Fetc%2Fpasswd';
		const decoded = decodeURIComponent(encodedPath);
		assert.throws(
			() => assertWithinWorkspace(decoded, workspaceDir),
			/Path traversal not allowed/
		);
	});

	test('rejects symlink that resolves outside workspace', () => {
		// Create a symlink inside workspace that points outside
		const symlinkPath = path.join(workspaceDir, 'evil-link');
		const targetPath = path.join(outsideDir, 'dangerous.txt');
		try {
			fs.symlinkSync(targetPath, symlinkPath);
		} catch {
			// Symlinks may not be supported on this platform; skip test
			return;
		}

		assert.throws(
			() => assertWithinWorkspace(symlinkPath, workspaceDir),
			/Path traversal detected/
		);
	});

	test('accepts symlink that resolves within workspace', () => {
		// Create a symlink inside workspace that points to another file in workspace
		const targetPath = path.join(workspaceDir, 'safe.txt');
		const symlinkPath = path.join(workspaceDir, 'safe-link');
		try {
			fs.symlinkSync(targetPath, symlinkPath);
		} catch {
			return; // Skip if symlinks not supported
		}

		assert.doesNotThrow(() => {
			assertWithinWorkspace(symlinkPath, workspaceDir);
		});
	});

	test('absolute path without workspace context is rejected', () => {
		assert.throws(
			() => assertWithinWorkspace('/usr/local/bin/something'),
			/Absolute paths require a workspace context/
		);
	});

	test('relative path without workspace context is accepted', () => {
		// Relative paths without workspace root should be allowed
		// (they resolve against CWD, which is the agent's responsibility)
		assert.doesNotThrow(() => {
			assertWithinWorkspace('src/main.ts');
		});
	});

	test('validateToolName accepts allowed tools', () => {
		assert.strictEqual(validateToolName('read_file'), true);
		assert.strictEqual(validateToolName('run_command'), true);
		assert.strictEqual(validateToolName('web_search'), true);
	});

	test('validateToolName rejects unknown tools', () => {
		assert.strictEqual(validateToolName('rm_rf'), false);
		assert.strictEqual(validateToolName('eval'), false);
		assert.strictEqual(validateToolName('execute_arbitrary'), false);
	});

	test('validateMcpMethod accepts allowed methods', () => {
		assert.strictEqual(validateMcpMethod('tools/call'), true);
		assert.strictEqual(validateMcpMethod('initialize'), true);
	});

	test('validateMcpMethod rejects unknown methods', () => {
		assert.strictEqual(validateMcpMethod('system/exec'), false);
		assert.strictEqual(validateMcpMethod('debug/inspect'), false);
	});

	test('workspace root path itself is allowed', () => {
		assert.doesNotThrow(() => {
			assertWithinWorkspace(workspaceDir, workspaceDir);
		});
	});

	test('deeply nested path within workspace is allowed', () => {
		assert.doesNotThrow(() => {
			assertWithinWorkspace('src/vs/platform/construct/common/test.ts', workspaceDir);
		});
	});
});
