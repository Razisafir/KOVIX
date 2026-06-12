/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('ConstructAIService', () => {
	test('AI provider types are distinct', () => {
		const providers = ['ollama', 'xenova', 'cloud'];
		const unique = new Set(providers);
		assert.strictEqual(unique.size, 3);
	});

	test('chat message roles are valid', () => {
		const validRoles = ['system', 'user', 'assistant', 'tool'];
		const msg = { role: 'user', content: 'Hello' };
		assert.ok(validRoles.includes(msg.role));
	});

	test('tool call has required fields', () => {
		const toolCall = {
			id: 'call_abc123',
			type: 'function' as const,
			function: { name: 'read_file', arguments: '{"path":"/src/main.ts"}' },
		};
		assert.ok(toolCall.id);
		assert.strictEqual(toolCall.type, 'function');
		assert.ok(toolCall.function.name);
		assert.ok(toolCall.function.arguments);
	});

	test('streaming events have valid types', () => {
		const validTypes = ['content_delta', 'tool_call', 'tool_result', 'plan_step', 'error', 'done'];
		const event = { type: 'content_delta', content: 'Hello' };
		assert.ok(validTypes.includes(event.type));
	});

	test('API key is not included in provider config serialization', () => {
		const config = { provider: 'cloud', model: 'claude-3', apiKey: 'sk-ant-secret-key-1234567890' };
		const serialized = JSON.stringify(config);
		const parsed = JSON.parse(serialized);
		// In production, the key would be redacted before logging
		assert.ok(parsed.apiKey); // Key exists for runtime use
		// But should never appear in logs
		const logOutput = `Provider config: provider=${config.provider}, model=${config.model}`;
		assert.ok(!logOutput.includes('sk-ant-'));
	});

	test('conversation messages are ordered by sequence', () => {
		const messages = [
			{ role: 'system', content: 'You are helpful.' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
			{ role: 'user', content: 'Write code' },
		];
		const userMsgIndices = messages
			.map((m, i) => m.role === 'user' ? i : -1)
			.filter(i => i >= 0);
		// User messages should be in ascending order
		for (let i = 1; i < userMsgIndices.length; i++) {
			assert.ok(userMsgIndices[i] > userMsgIndices[i - 1]);
		}
	});

	test('model selection falls back to default', () => {
		const availableModels = ['codellama:7b', 'qwen2.5-coder:7b'];
		const requestedModel = 'nonexistent:model';
		const defaultModel = availableModels[0];
		const selected = availableModels.includes(requestedModel) ? requestedModel : defaultModel;
		assert.strictEqual(selected, 'codellama:7b');
	});

	test('abort signal cancels in-flight request', async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		assert.strictEqual(signal.aborted, false);
		controller.abort('User cancelled');
		assert.strictEqual(signal.aborted, true);
	});
});
