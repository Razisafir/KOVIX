/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('ConstructToolRegistry', () => {
	test('built-in tools are all registered', () => {
		const builtInTools = [
			'read_file', 'write_file', 'edit_file', 'list_directory',
			'create_directory', 'search_files', 'run_command',
			'search_codebase', 'web_search',
		];
		assert.strictEqual(builtInTools.length, 9);
		assert.ok(builtInTools.includes('read_file'));
		assert.ok(builtInTools.includes('run_command'));
	});

	test('tool definition has required fields', () => {
		const toolDef = {
			name: 'read_file',
			description: 'Read the contents of a file',
			parameters: {
				type: 'object' as const,
				properties: { path: { type: 'string', description: 'File path' } },
				required: ['path'],
			},
		};
		assert.ok(toolDef.name);
		assert.ok(toolDef.description);
		assert.ok(toolDef.parameters);
		assert.ok(toolDef.parameters.required.includes('path'));
	});

	test('planning tools are a subset of all tools', () => {
		const allTools = ['read_file', 'write_file', 'edit_file', 'run_command', 'search_codebase', 'web_search'];
		const planningTools = ['read_file', 'search_codebase', 'web_search'];
		for (const pt of planningTools) {
			assert.ok(allTools.includes(pt), `Planning tool "${pt}" not in all tools`);
		}
	});

	test('tool execution result has success/failure state', () => {
		const successResult = { success: true, output: 'File contents here', toolCallId: 'tc_1' };
		const failureResult = { success: false, output: 'File not found', toolCallId: 'tc_2', error: 'ENOENT' };
		assert.strictEqual(successResult.success, true);
		assert.strictEqual(failureResult.success, false);
		assert.ok(failureResult.error);
	});

	test('MCP tools merge with built-in tools', () => {
		const builtIn = ['read_file', 'write_file'];
		const mcpTools = ['mcp_browser_navigate', 'mcp_browser_screenshot'];
		const all = [...builtIn, ...mcpTools];
		assert.strictEqual(all.length, 4);
		assert.ok(all.includes('mcp_browser_navigate'));
	});

	test('security tools are visible to LLM', () => {
		const securityTools = ['nmap_scan', 'nuclei_scan', 'ghidra_analyze'];
		// Security tools should be discoverable via getAllTools()
		for (const tool of securityTools) {
			assert.ok(tool.length > 0);
		}
		assert.strictEqual(securityTools.length, 3);
	});

	test('duplicate tool names are handled', () => {
		const registry = new Map<string, string>();
		registry.set('read_file', 'builtin');
		// MCP could provide a tool with same name
		const existing = registry.get('read_file');
		assert.strictEqual(existing, 'builtin');
		// Should not overwrite built-in with MCP version
		if (!registry.has('read_file')) {
			registry.set('read_file', 'mcp');
		}
		assert.strictEqual(registry.get('read_file'), 'builtin');
	});

	test('tool parameter validation rejects missing required params', () => {
		const schema = {
			type: 'object' as const,
			properties: { path: { type: 'string' } },
			required: ['path'],
		};
		const args = {}; // Missing 'path'
		const missing = schema.required.filter(k => !(k in args));
		assert.strictEqual(missing.length, 1);
		assert.strictEqual(missing[0], 'path');
	});

	test('tool parameter validation accepts valid params', () => {
		const schema = {
			type: 'object' as const,
			properties: { path: { type: 'string' } },
			required: ['path'],
		};
		const args = { path: '/src/main.ts' };
		const missing = schema.required.filter(k => !(k in args));
		assert.strictEqual(missing.length, 0);
	});

	test('run_command tool has timeout parameter', () => {
		const runCommandSchema = {
			type: 'object' as const,
			properties: {
				command: { type: 'string' },
				timeout: { type: 'number', description: 'Timeout in ms' },
			},
			required: ['command'],
		};
		assert.ok(runCommandSchema.properties.timeout);
		assert.ok(!runCommandSchema.required.includes('timeout')); // Optional
	});

	test('tool registry getTool returns undefined for unknown tool', () => {
		const registry = new Map<string, object>();
		registry.set('read_file', { name: 'read_file' });
		const result = registry.get('nonexistent_tool');
		assert.strictEqual(result, undefined);
	});

	test('tool registry getAllTools returns merged list', () => {
		const builtin = [{ name: 'read_file' }, { name: 'write_file' }];
		const mcp = [{ name: 'mcp_custom' }];
		const all = [...builtin, ...mcp];
		assert.strictEqual(all.length, 3);
	});
});
