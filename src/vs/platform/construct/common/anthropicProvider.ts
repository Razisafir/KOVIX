/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Anthropic Provider Service Interface
 *  MVP: Direct Anthropic API integration with streaming + tool use
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export const IAnthropicProviderService = createDecorator<IAnthropicProviderService>('construct.anthropicProvider');

export interface IAnthropicProviderService {
	readonly _serviceBrand: undefined;

	/** Send messages and get a complete response (non-streaming) */
	sendMessage(messages: AnthropicMessage[], options?: AnthropicRequestOptions): Promise<AnthropicResponse>;

	/** Send messages with streaming — yields chunks as they arrive */
	sendMessageStream(messages: AnthropicMessage[], options?: AnthropicRequestOptions): AsyncIterable<AnthropicStreamChunk>;

	/** API key management — backed by VS Code SecretStorage */
	getApiKeyStatus(): { configured: boolean; keyPrefix: string };
	setApiKey(key: string): Promise<void>;

	/** Model selection */
	getActiveModel(): string;
	setActiveModel(model: string): void;
	getAvailableModels(): string[];

	/** Health check */
	isAvailable(): boolean;
	getLastLatencyMs(): number;

	/** Events */
	readonly onDidChangeModel: Event<string>;
	readonly onDidRequestComplete: Event<{ tokensIn: number; tokensOut: number; latencyMs: number }>;
}

// -- Data Types --

export interface AnthropicMessage {
	role: 'user' | 'assistant';
	content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
	type: 'text' | 'tool_use' | 'tool_result';
	text?: string;
	id?: string;
	name?: string;
	input?: any;
	tool_use_id?: string;
	content?: string;
}

export interface AnthropicRequestOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
	tools?: AnthropicToolDef[];
	systemPrompt?: string;
	abortSignal?: AbortSignal;
}

export interface AnthropicToolDef {
	name: string;
	description: string;
	input_schema: object;
}

export interface AnthropicResponse {
	content: AnthropicContentBlock[];
	stopReason: string;
	usage: { inputTokens: number; outputTokens: number };
	model: string;
}

export interface AnthropicStreamChunk {
	type: 'text' | 'tool_use' | 'stop' | 'error';
	text?: string;
	toolUse?: { id: string; name: string; input: any };
	error?: string;
}
