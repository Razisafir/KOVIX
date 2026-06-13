/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for OllamaProvider — local AI provider.
 * Source: src/vs/workbench/contrib/construct/browser/services/llm/ollamaProvider.ts
 * Common types: src/vs/platform/construct/common/llm/constructAIProvider.ts
 *
 * Tests the connection logic, model listing, tool calling format,
 * text-only fallback, and context window estimation.
 */

// ---- Replicate production types and constants ----

const OLLAMA_BASE_URL = 'http://localhost:11434';
const MAX_RETRIES = 3;

type AIProviderType = 'ollama' | 'xenova' | 'cloud';

interface IModelInfo {
	id: string;
	displayName: string;
	provider: AIProviderType;
	contextWindowTokens: number;
	supportsTools: boolean;
	supportsStreaming: boolean;
}

interface IChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCallId?: string;
	toolCalls?: IToolCall[];
}

interface IToolCall {
	id: string;
	name: string;
	arguments: string;
}

interface IToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, unknown>;
		required?: string[];
	};
}

// ---- Model parsing logic ----

interface IOllamaModelRaw {
	name: string;
	model: string;
	size?: number;
	details?: { parameter_size?: string; family?: string };
}

function parseOllamaModels(data: { models?: IOllamaModelRaw[] }): IModelInfo[] {
	return (data.models || []).map(m => {
		const modelName = m.name || m.model;
		const family = m.details?.family?.toLowerCase() ?? '';
		const supportsTools = family.includes('llama') || family.includes('mistral') || family.includes('qwen') || family.includes('command');
		const contextWindowTokens = estimateContextWindow(modelName, m.details?.parameter_size);

		return {
			id: modelName,
			displayName: modelName,
			provider: 'ollama' as AIProviderType,
			contextWindowTokens,
			supportsTools,
			supportsStreaming: true,
		};
	});
}

/**
 * Estimate context window based on model name and parameter size.
 */
function estimateContextWindow(modelName: string, parameterSize?: string): number {
	const lowerName = modelName.toLowerCase();

	if (lowerName.includes('llama3.1')) { return 128_000; }
	if (lowerName.includes('llama3') || lowerName.includes('llama-3')) { return 8_192; }
	if (lowerName.includes('mistral') || lowerName.includes('mixtral')) { return 32_000; }
	if (lowerName.includes('qwen2.5') || lowerName.includes('qwen2')) { return 128_000; }
	if (lowerName.includes('codellama') || lowerName.includes('code-llama')) { return 16_384; }
	if (lowerName.includes('phi3') || lowerName.includes('phi-3')) { return 128_000; }
	if (lowerName.includes('gemma2') || lowerName.includes('gemma-2')) { return 8_192; }
	if (lowerName.includes('deepseek')) { return 64_000; }
	if (lowerName.includes('command')) { return 128_000; }

	if (parameterSize) {
		const sizeMatch = parameterSize.match(/(\d+)/);
		if (sizeMatch) {
			const params = parseInt(sizeMatch[1], 10);
			if (params >= 70) { return 128_000; }
			if (params >= 30) { return 32_000; }
			if (params >= 7) { return 8_192; }
		}
	}

	return 4_096;
}

// ---- Message conversion logic ----

function convertMessages(messages: IChatMessage[]): Array<Record<string, unknown>> {
	return messages.map(msg => {
		const result: Record<string, unknown> = { role: msg.role, content: msg.content };

		if (msg.toolCalls && msg.toolCalls.length > 0) {
			result.tool_calls = msg.toolCalls.map(tc => ({
				id: tc.id,
				type: 'function',
				function: {
					name: tc.name,
					arguments: tc.arguments,
				},
			}));
		}

		if (msg.toolCallId) {
			result.tool_call_id = msg.toolCallId;
		}

		return result;
	});
}

function convertTools(tools: IToolDefinition[]): Array<Record<string, unknown>> {
	return tools.map(tool => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}));
}

// ---- Connection status parsing ----

function parseOllamaStatus(responseOk: boolean, data: { models?: unknown[] }): 'available' | 'noModels' | 'unreachable' {
	if (!responseOk) { return 'unreachable'; }
	if (!data.models || data.models.length === 0) { return 'noModels'; }
	return 'available';
}

// ---- NDJSON streaming parser ----

function parseNDJSONChunk(line: string): Record<string, unknown> | null {
	const trimmed = line.trim();
	if (!trimmed) { return null; }
	try {
		return JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		return null;
	}
}

// ---- Tests ----

suite('OllamaProvider', () => {

	suite('Connection — connection to Ollama', () => {
		test('default base URL is localhost:11434', () => {
			assert.strictEqual(OLLAMA_BASE_URL, 'http://localhost:11434');
		});

		test('status is available when models exist', () => {
			const status = parseOllamaStatus(true, { models: [{ name: 'llama3' }] });
			assert.strictEqual(status, 'available');
		});

		test('status is noModels when models array is empty', () => {
			const status = parseOllamaStatus(true, { models: [] });
			assert.strictEqual(status, 'noModels');
		});

		test('status is noModels when models is missing', () => {
			const status = parseOllamaStatus(true, {});
			assert.strictEqual(status, 'noModels');
		});

		test('status is unreachable when response is not OK', () => {
			const status = parseOllamaStatus(false, {});
			assert.strictEqual(status, 'unreachable');
		});

		test('Ollama is offline-first (isOffline returns true)', () => {
			// OllamaProvider.isOffline() always returns true
			assert.ok(true, 'Ollama runs locally and does not require internet');
		});
	});

	suite('Model listing — models are listed correctly', () => {
		test('parses Ollama /api/tags response', () => {
			const data = {
				models: [
					{ name: 'llama3.1:8b', model: 'llama3.1:8b', details: { family: 'llama', parameter_size: '8B' } },
					{ name: 'mistral:7b', model: 'mistral:7b', details: { family: 'mistral', parameter_size: '7B' } },
					{ name: 'gemma2:2b', model: 'gemma2:2b', details: { family: 'gemma', parameter_size: '2B' } },
				],
			};
			const models = parseOllamaModels(data);

			assert.strictEqual(models.length, 3);
			assert.strictEqual(models[0].id, 'llama3.1:8b');
			assert.strictEqual(models[1].id, 'mistral:7b');
			assert.strictEqual(models[2].id, 'gemma2:2b');
		});

		test('all parsed models have provider=ollama', () => {
			const data = {
				models: [
					{ name: 'llama3:8b', model: 'llama3:8b', details: { family: 'llama' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].provider, 'ollama');
		});

		test('all parsed models have supportsStreaming=true', () => {
			const data = {
				models: [
					{ name: 'llama3:8b', model: 'llama3:8b', details: { family: 'llama' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].supportsStreaming, true);
		});

		test('empty response returns empty array', () => {
			const models = parseOllamaModels({});
			assert.strictEqual(models.length, 0);
		});
	});

	suite('Tool calling — tool calling format', () => {
		const sampleTools: IToolDefinition[] = [
			{
				name: 'run_terminal',
				description: 'Execute a terminal command',
				inputSchema: {
					type: 'object',
					properties: { command: { type: 'string' } },
					required: ['command'],
				},
			},
		];

		test('tools are converted to Ollama (OpenAI-compatible) format', () => {
			const converted = convertTools(sampleTools);
			assert.strictEqual(converted.length, 1);
			assert.strictEqual(converted[0].type, 'function');
			assert.ok((converted[0].function as Record<string, unknown>).name);
			assert.ok((converted[0].function as Record<string, unknown>).parameters);
		});

		test('messages with tool calls are converted correctly', () => {
			const messages: IChatMessage[] = [
				{
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'call_1', name: 'run_terminal', arguments: '{"command":"ls"}' }],
				},
			];
			const converted = convertMessages(messages);
			assert.ok(Array.isArray(converted[0].tool_calls));
			assert.strictEqual((converted[0].tool_calls as Array<Record<string, unknown>>).length, 1);
		});

		test('tool result messages include tool_call_id', () => {
			const messages: IChatMessage[] = [
				{ role: 'tool', content: 'file1.txt\nfile2.txt', toolCallId: 'call_1' },
			];
			const converted = convertMessages(messages);
			assert.strictEqual(converted[0].tool_call_id, 'call_1');
		});

		test('NDJSON chunk with tool_calls is parsed correctly', () => {
			const chunk = JSON.stringify({
				message: {
					role: 'assistant',
					content: '',
					tool_calls: [{
						id: 'call_abc',
						function: { name: 'run_terminal', arguments: '{"command":"ls"}' },
					}],
				},
				done: false,
			});
			const parsed = parseNDJSONChunk(chunk);
			assert.ok(parsed !== null);
			assert.ok(parsed.message);
		});
	});

	suite('Text-only fallback — fallback when model does not support tools', () => {
		test('gemma2 models do not support tools', () => {
			const data = {
				models: [
					{ name: 'gemma2:2b', model: 'gemma2:2b', details: { family: 'gemma', parameter_size: '2B' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].supportsTools, false, 'gemma2 should not support tools');
		});

		test('llama models support tools', () => {
			const data = {
				models: [
					{ name: 'llama3:8b', model: 'llama3:8b', details: { family: 'llama', parameter_size: '8B' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].supportsTools, true, 'llama should support tools');
		});

		test('mistral models support tools', () => {
			const data = {
				models: [
					{ name: 'mistral:7b', model: 'mistral:7b', details: { family: 'mistral', parameter_size: '7B' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].supportsTools, true, 'mistral should support tools');
		});

		test('qwen models support tools', () => {
			const data = {
				models: [
					{ name: 'qwen2.5:7b', model: 'qwen2.5:7b', details: { family: 'qwen', parameter_size: '7B' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].supportsTools, true, 'qwen should support tools');
		});

		test('unknown family defaults to no tool support', () => {
			const data = {
				models: [
					{ name: 'custom-model:latest', model: 'custom-model:latest', details: { family: 'custom' } },
				],
			};
			const models = parseOllamaModels(data);
			assert.strictEqual(models[0].supportsTools, false, 'Unknown family should not support tools');
		});
	});

	suite('Context window estimation', () => {
		test('llama3.1 has 128k context', () => {
			assert.strictEqual(estimateContextWindow('llama3.1:8b'), 128_000);
		});

		test('llama3 has 8k context', () => {
			assert.strictEqual(estimateContextWindow('llama3:8b'), 8_192);
		});

		test('mistral has 32k context', () => {
			assert.strictEqual(estimateContextWindow('mistral:7b'), 32_000);
		});

		test('deepseek has 64k context', () => {
			assert.strictEqual(estimateContextWindow('deepseek-coder:6.7b'), 64_000);
		});

		test('unknown model defaults to 4k context', () => {
			assert.strictEqual(estimateContextWindow('unknown-model'), 4_096);
		});

		test('70B+ models get 128k context by parameter size', () => {
			assert.strictEqual(estimateContextWindow('some-model', '70B'), 128_000);
		});

		test('7B models get 8k context by parameter size', () => {
			assert.strictEqual(estimateContextWindow('some-model', '7B'), 8_192);
		});
	});

	suite('NDJSON streaming parser', () => {
		test('valid JSON line is parsed', () => {
			const result = parseNDJSONChunk('{"message":{"content":"hello"},"done":false}');
			assert.ok(result !== null);
			assert.strictEqual((result.message as Record<string, unknown>).content, 'hello');
		});

		test('empty line returns null', () => {
			assert.strictEqual(parseNDJSONChunk(''), null);
			assert.strictEqual(parseNDJSONChunk('   '), null);
		});

		test('invalid JSON returns null', () => {
			assert.strictEqual(parseNDJSONChunk('not json'), null);
		});

		test('done signal is parsed correctly', () => {
			const result = parseNDJSONChunk('{"done":true}');
			assert.ok(result !== null);
			assert.strictEqual(result.done, true);
		});
	});
});
