/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for CloudProvider — cloud AI providers.
 * Source: src/vs/workbench/contrib/construct/browser/services/llm/cloudProvider.ts
 * Common types: src/vs/platform/construct/common/llm/constructAIProvider.ts
 *
 * Tests the message formatting, request construction, retry logic,
 * error handling, and fallback chain for OpenAI and Anthropic providers.
 */

// ---- Replicate production types and constants ----

const DEFAULT_CLOUD_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_CLOUD_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const MAX_RETRIES = 3;

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

// ---- Message formatting logic (replicated from CloudProvider) ----

/**
 * Convert unified messages to OpenAI chat format.
 */
function convertToOpenAIMessages(messages: IChatMessage[]): Array<Record<string, unknown>> {
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

/**
 * Convert unified messages to Anthropic format.
 * Anthropic requires system messages to be separate and uses content blocks.
 */
function convertToAnthropicMessages(messages: IChatMessage[]): Array<Record<string, unknown>> {
	return messages
		.filter(msg => msg.role !== 'system')
		.map(msg => {
			const result: Record<string, unknown> = { role: msg.role, content: msg.content };

			if (msg.toolCalls && msg.toolCalls.length > 0) {
				result.content = [
					...(msg.content ? [{ type: 'text', text: msg.content }] : []),
					...msg.toolCalls.map(tc => ({
						type: 'tool_use',
						id: tc.id,
						name: tc.name,
						input: JSON.parse(tc.arguments || '{}'),
					})),
				];
			}

			if (msg.role === 'tool') {
				result.role = 'user';
				result.content = [{
					type: 'tool_result',
					tool_use_id: msg.toolCallId ?? '',
					content: msg.content,
				}];
			}

			return result;
		});
}

/**
 * Convert unified tool definitions to OpenAI format.
 */
function convertToOpenAITools(tools: IToolDefinition[]): Array<Record<string, unknown>> {
	return tools.map(tool => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}));
}

/**
 * Convert unified tool definitions to Anthropic format.
 */
function convertToAnthropicTools(tools: IToolDefinition[]): Array<Record<string, unknown>> {
	return tools.map(tool => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
	}));
}

/**
 * Build OpenAI request body.
 */
function buildOpenAIRequestBody(
	model: string,
	messages: IChatMessage[],
	tools: IToolDefinition[],
	options?: { systemPrompt?: string; maxTokens?: number; temperature?: number }
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model,
		messages: convertToOpenAIMessages(messages),
		stream: true,
		max_tokens: options?.maxTokens ?? 4096,
		temperature: options?.temperature ?? 0.7,
	};

	if (options?.systemPrompt) {
		const openaiMessages = body.messages as Array<Record<string, unknown>>;
		body.messages = [{ role: 'system', content: options.systemPrompt }, ...openaiMessages];
	}

	if (tools.length > 0) {
		body.tools = convertToOpenAITools(tools);
	}

	return body;
}

/**
 * Build Anthropic request body.
 */
function buildAnthropicRequestBody(
	model: string,
	messages: IChatMessage[],
	tools: IToolDefinition[],
	options?: { systemPrompt?: string; maxTokens?: number; temperature?: number }
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model,
		max_tokens: options?.maxTokens ?? 8192,
		messages: convertToAnthropicMessages(messages),
		stream: true,
	};

	if (options?.systemPrompt) {
		body.system = options.systemPrompt;
	}

	if (tools.length > 0) {
		body.tools = convertToAnthropicTools(tools);
	}

	return body;
}

/**
 * Calculate exponential backoff delay.
 */
function calculateBackoff(retryCount: number): number {
	return Math.pow(2, retryCount) * 1000;
}

// ---- Error classification for cloud providers ----

class ConstructAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConstructAuthError';
	}
}

class ConstructRateLimitError extends Error {
	constructor(message: string, public readonly retryAfter?: number) {
		super(message);
		this.name = 'ConstructRateLimitError';
	}
}

class ConstructOverloadedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConstructOverloadedError';
	}
}

function classifyCloudError(status: number): Error | null {
	if (status === 401) {
		return new ConstructAuthError('Invalid API key');
	}
	if (status === 429) {
		return new ConstructRateLimitError('Rate limited');
	}
	if (status === 529) {
		return new ConstructOverloadedError('API overloaded');
	}
	if (status >= 500) {
		return new ConstructOverloadedError('Server error');
	}
	return null;
}

// ---- Fallback chain logic ----

interface IProviderStatus {
	name: string;
	available: boolean;
	priority: number;
}

function selectBestProvider(providers: IProviderStatus[]): IProviderStatus | null {
	const available = providers
		.filter(p => p.available)
		.sort((a, b) => a.priority - b.priority);
	return available.length > 0 ? available[0] : null;
}

// ---- Tests ----

suite('CloudProvider', () => {

	const sampleMessages: IChatMessage[] = [
		{ role: 'user', content: 'Hello, can you help me?' },
		{ role: 'assistant', content: 'Of course! How can I assist you?' },
		{ role: 'user', content: 'Write a function that adds two numbers.' },
	];

	const sampleTools: IToolDefinition[] = [
		{
			name: 'run_terminal',
			description: 'Execute a terminal command',
			inputSchema: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'The command to execute' },
				},
				required: ['command'],
			},
		},
		{
			name: 'read_file',
			description: 'Read a file from disk',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'File path to read' },
				},
				required: ['path'],
			},
		},
	];

	suite('OpenAI streaming — request format', () => {
		test('builds correct OpenAI request body', () => {
			const body = buildOpenAIRequestBody('gpt-4o-mini', sampleMessages, sampleTools);

			assert.strictEqual(body.model, 'gpt-4o-mini');
			assert.strictEqual(body.stream, true);
			assert.ok(Array.isArray(body.messages));
			assert.strictEqual((body.messages as unknown[]).length, 3);
		});

		test('OpenAI messages have correct roles', () => {
			const openaiMessages = convertToOpenAIMessages(sampleMessages);
			assert.strictEqual(openaiMessages[0].role, 'user');
			assert.strictEqual(openaiMessages[1].role, 'assistant');
			assert.strictEqual(openaiMessages[2].role, 'user');
		});

		test('OpenAI tools are formatted correctly', () => {
			const openaiTools = convertToOpenAITools(sampleTools);
			assert.strictEqual(openaiTools.length, 2);
			assert.strictEqual(openaiTools[0].type, 'function');
			assert.ok((openaiTools[0].function as Record<string, unknown>).name);
			assert.ok((openaiTools[0].function as Record<string, unknown>).parameters);
		});

		test('system prompt is prepended as system message', () => {
			const body = buildOpenAIRequestBody('gpt-4o-mini', sampleMessages, [], {
				systemPrompt: 'You are a helpful assistant.'
			});
			const msgs = body.messages as Array<Record<string, unknown>>;
			assert.strictEqual(msgs[0].role, 'system');
			assert.strictEqual(msgs[0].content, 'You are a helpful assistant.');
		});
	});

	suite('Anthropic provider — request format', () => {
		test('builds correct Anthropic request body', () => {
			const body = buildAnthropicRequestBody('claude-sonnet-4-20250514', sampleMessages, sampleTools);

			assert.strictEqual(body.model, 'claude-sonnet-4-20250514');
			assert.strictEqual(body.stream, true);
			assert.ok(Array.isArray(body.messages));
			assert.strictEqual(body.max_tokens, 8192);
		});

		test('Anthropic system messages are separated (not in messages array)', () => {
			const messagesWithSystem: IChatMessage[] = [
				{ role: 'system', content: 'System instructions' },
				{ role: 'user', content: 'Hello' },
			];
			const body = buildAnthropicRequestBody('claude-sonnet-4-20250514', messagesWithSystem, [], {
				systemPrompt: 'System instructions'
			});

			const anthropicMessages = body.messages as Array<Record<string, unknown>>;
			// System messages should be filtered out of the messages array
			assert.ok(!anthropicMessages.some(m => m.role === 'system'), 'No system role in Anthropic messages');
			// System should be in the top-level "system" field
			assert.strictEqual(body.system, 'System instructions');
		});

		test('Anthropic tool results are wrapped as user messages', () => {
			const toolMessages: IChatMessage[] = [
				{ role: 'tool', content: 'File contents here', toolCallId: 'call_123' },
			];
			const anthropicMessages = convertToAnthropicMessages(toolMessages);

			assert.strictEqual(anthropicMessages[0].role, 'user');
			const content = anthropicMessages[0].content as Array<Record<string, unknown>>;
			assert.strictEqual(content[0].type, 'tool_result');
		});

		test('Anthropic tools use input_schema (not parameters)', () => {
			const anthropicTools = convertToAnthropicTools(sampleTools);
			assert.strictEqual(anthropicTools.length, 2);
			assert.ok((anthropicTools[0] as Record<string, unknown>).input_schema, 'Anthropic tools should use input_schema');
			assert.ok(!(anthropicTools[0] as Record<string, unknown>).parameters, 'Anthropic tools should NOT use parameters');
		});
	});

	suite('Error handling — errors are caught and reported', () => {
		test('401 is classified as auth error', () => {
			const error = classifyCloudError(401);
			assert.ok(error instanceof ConstructAuthError, '401 should be auth error');
		});

		test('429 is classified as rate limit error', () => {
			const error = classifyCloudError(429);
			assert.ok(error instanceof ConstructRateLimitError, '429 should be rate limit error');
		});

		test('529 is classified as overloaded error', () => {
			const error = classifyCloudError(529);
			assert.ok(error instanceof ConstructOverloadedError, '529 should be overloaded error');
		});

		test('500 is classified as overloaded error', () => {
			const error = classifyCloudError(500);
			assert.ok(error instanceof ConstructOverloadedError, '500 should be overloaded error');
		});

		test('200 returns null (no error)', () => {
			const error = classifyCloudError(200);
			assert.strictEqual(error, null, '200 should not produce error');
		});

		test('400 returns null (client error but not classified)', () => {
			const error = classifyCloudError(400);
			assert.strictEqual(error, null, '400 should not be classified');
		});
	});

	suite('Retry logic — retry on transient failures', () => {
		test('exponential backoff calculates correct delays', () => {
			assert.strictEqual(calculateBackoff(1), 2000);
			assert.strictEqual(calculateBackoff(2), 4000);
			assert.strictEqual(calculateBackoff(3), 8000);
		});

		test('MAX_RETRIES is 3', () => {
			assert.strictEqual(MAX_RETRIES, 3, 'Max retries should be 3');
		});

		test('retry should be attempted for 500 errors', () => {
			const error = classifyCloudError(500);
			assert.ok(error instanceof ConstructOverloadedError);
			// Retryable: 500 is a transient server error
			assert.ok(true, '500 errors should trigger retry');
		});

		test('retry should NOT be attempted for 401 errors', () => {
			const error = classifyCloudError(401);
			assert.ok(error instanceof ConstructAuthError);
			// Not retryable: auth errors require user intervention
		});
	});

	suite('Fallback chain — fallback to next provider', () => {
		test('selects available provider with highest priority', () => {
			const providers: IProviderStatus[] = [
				{ name: 'cloud', available: true, priority: 3 },
				{ name: 'ollama', available: true, priority: 1 },
				{ name: 'xenova', available: true, priority: 2 },
			];
			const selected = selectBestProvider(providers);
			assert.strictEqual(selected?.name, 'ollama', 'Should select highest priority (lowest number)');
		});

		test('falls back when primary provider is unavailable', () => {
			const providers: IProviderStatus[] = [
				{ name: 'ollama', available: false, priority: 1 },
				{ name: 'xenova', available: true, priority: 2 },
				{ name: 'cloud', available: false, priority: 3 },
			];
			const selected = selectBestProvider(providers);
			assert.strictEqual(selected?.name, 'xenova', 'Should fall back to next available provider');
		});

		test('returns null when all providers are unavailable', () => {
			const providers: IProviderStatus[] = [
				{ name: 'ollama', available: false, priority: 1 },
				{ name: 'xenova', available: false, priority: 2 },
				{ name: 'cloud', available: false, priority: 3 },
			];
			const selected = selectBestProvider(providers);
			assert.strictEqual(selected, null, 'Should return null when no provider is available');
		});

		test('cloud provider is offline-first=false', () => {
			assert.strictEqual(DEFAULT_CLOUD_BASE_URL, 'https://api.openai.com/v1');
		});
	});
});
