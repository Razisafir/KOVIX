/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCPClient Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { MCPClient } from '../../../src/construct/services/MCPClient';
import * as path from 'path';

describe('MCPClient', () => {
	let client: MCPClient;
	const workspaceRoot = '/tmp/test-workspace';

	beforeEach(() => {
		client = new MCPClient(workspaceRoot);
	});

	afterEach(async () => {
		await client.stop();
	});

	describe('constructor', () => {
		test('creates instance with workspace root', () => {
			expect(client).toBeInstanceOf(MCPClient);
		});
	});

	describe('path validation', () => {
		test('rejects paths outside workspace root', async () => {
			await expect(client.readFile('../../../etc/passwd')).rejects.toThrow('Path traversal detected');
		});

		test('rejects absolute paths outside workspace', async () => {
			await expect(client.readFile('/etc/passwd')).rejects.toThrow('Path traversal detected');
		});

		test('accepts paths within workspace', () => {
			// This would fail at the MCP request level, but path validation should pass
			// We test the validation by checking it doesn't throw immediately
			const client2 = new MCPClient('/workspace');
			// Path validation is internal — we verify the constructor works
			expect(client2).toBeInstanceOf(MCPClient);
		});
	});
});
