/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IAnthropicProvider, IAnthropicProviderConfig, IAnthropicTool, IAnthropicMessage, StreamEvent } from '../../../../../../platform/construct/common/llm/anthropicProvider.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;
const MAX_RETRIES = 4;
const STORAGE_KEY_API_KEY = 'construct.anthropic.apiKey';

/**
 * Parsed SSE chunk from the Anthropic streaming API.
 */
interface IAnthropicSSEChunk {
	type: string;
	content_block?: { type: string; id?: string; name?: string; text?: string };
	delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
	error?: { message?: string };
}

export class AnthropicProviderService extends Disposable implements IAnthropicProvider {
	readonly _serviceBrand: undefined;

	private _config: IAnthropicProviderConfig;
	private readonly _onKeyInvalid = this._register(new Emitter<void>());
	readonly onKeyInvalid = this._onKeyInvalid.event;
	private readonly _onConnectionError = this._register(new Emitter<Error>());
	readonly onConnectionError = this._onConnectionError.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		// Read API key from storage
		const storedKey = this.storageService.get(STORAGE_KEY_API_KEY, undefined) ?? '';
		this._config = {
			apiKey: storedKey,
			model: DEFAULT_MODEL,
			maxTokens: DEFAULT_MAX_TOKENS,
		};

		this.logService.info('[AnthropicProvider] Initialized');
	}

	get config(): IAnthropicProviderConfig {
		return this._config;
	}

	updateConfig(config: Partial<IAnthropicProviderConfig>): void {
		if (config.apiKey !== undefined) {
			this._config.apiKey = config.apiKey;
			this.storageService.store(STORAGE_KEY_API_KEY, config.apiKey, 0 /* StorageScope.APPLICATION */, 1 /* StorageTarget.MACHINE */);
		}
		if (config.model !== undefined) {
			this._config.model = config.model;
		}
		if (config.maxTokens !== undefined) {
			this._config.maxTokens = config.maxTokens;
		}
		this.logService.info(`[AnthropicProvider] Config updated: model=${this._config.model}, maxTokens=${this._config.maxTokens}`);
	}

	async *streamMessages(
		messages: IAnthropicMessage[],
		tools: IAnthropicTool[],
		signal?: AbortSignal,
		systemPrompt?: string
	): AsyncGenerator<StreamEvent> {
		if (!this._config.apiKey) {
			yield { type: 'error', text: 'Anthropic API key not configured. Please set it in Construct settings.' };
			return;
		}

		const body: Record<string, unknown> = {
			model: this._config.model,
			max_tokens: this._config.maxTokens,
			messages,
			stream: true,
		};

		// Add system prompt if provided (Anthropic API uses top-level "system" field)
		if (systemPrompt) {
			body.system = systemPrompt;
		}

		if (tools.length > 0) {
			body.tools = tools;
		}

		let retryCount = 0;

		while (retryCount <= MAX_RETRIES) {
			try {
				const response = await fetch(ANTHROPIC_API_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': this._config.apiKey,
						'anthropic-version': '2023-06-01',
						'anthropic-dangerous-direct-browser-access': 'true',
					},
					body: JSON.stringify(body),
					signal,
				});

				// Handle 401 -- invalid API key
				if (response.status === 401) {
					this.logService.error('[AnthropicProvider] API key invalid (401)');
					this._onKeyInvalid.fire();
					yield { type: 'error', text: 'API key invalid. Please check your Anthropic API key in settings.' };
					return;
				}

				// Handle 429 -- rate limited
				if (response.status === 429) {
					const backoffMs = Math.pow(2, retryCount) * 1000; // 1s->2s->4s->8s
					retryCount++;
					if (retryCount > MAX_RETRIES) {
						yield { type: 'error', text: 'Rate limited by Anthropic API. Please try again later.' };
						return;
					}
					this.logService.warn(`[AnthropicProvider] Rate limited (429). Retrying in ${backoffMs}ms (attempt ${retryCount}/${MAX_RETRIES})`);
					yield { type: 'error', text: `Rate limited. Retrying in ${backoffMs / 1000}s...` };
					await this.sleep(backoffMs, signal);
					continue;
				}

				// Handle 5xx -- server error
				if (response.status >= 500) {
					retryCount++;
					if (retryCount > MAX_RETRIES) {
						yield { type: 'error', text: `Anthropic API server error (${response.status}). Please try again later.` };
						return;
					}
					const backoffMs = Math.pow(2, retryCount) * 1000;
					this.logService.warn(`[AnthropicProvider] Server error (${response.status}). Retrying in ${backoffMs}ms`);
					await this.sleep(backoffMs, signal);
					continue;
				}

				// Handle other non-OK responses
				if (!response.ok) {
					const errorText = await response.text();
					this.logService.error(`[AnthropicProvider] API error (${response.status}): ${errorText}`);
					yield { type: 'error', text: `API error (${response.status}): ${errorText}` };
					return;
				}

				// Parse SSE stream
				if (!response.body) {
					yield { type: 'error', text: 'No response body from Anthropic API.' };
					return;
				}

				// Track current tool_use block for accumulation
				let currentToolId: string | null = null;
				let currentToolName: string | null = null;
				let currentToolInput = '';

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) { break; }

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed || !trimmed.startsWith('data: ')) {
								continue;
							}

							const jsonStr = trimmed.slice(6); // Remove "data: " prefix
							if (jsonStr === '[DONE]') {
								continue;
							}

							let chunk: IAnthropicSSEChunk;
							try {
								chunk = JSON.parse(jsonStr) as IAnthropicSSEChunk;
							} catch {
								// Skip malformed JSON lines
								continue;
							}

							const eventType = chunk.type;

							if (eventType === 'content_block_start') {
								const contentBlock = chunk.content_block;
								if (contentBlock?.type === 'tool_use') {
									currentToolId = contentBlock.id ?? null;
									currentToolName = contentBlock.name ?? null;
									currentToolInput = '';
									yield {
										type: 'tool_start',
										toolId: currentToolId ?? '',
										toolName: currentToolName ?? '',
									};
								}
							} else if (eventType === 'content_block_delta') {
								const delta = chunk.delta;
								if (delta?.type === 'text_delta' && delta.text) {
									yield { type: 'token', text: delta.text };
								} else if (delta?.type === 'input_json_delta' && delta.partial_json) {
									currentToolInput += delta.partial_json;
									yield {
										type: 'tool_input',
										toolId: currentToolId ?? '',
										text: delta.partial_json,
									};
								}
							} else if (eventType === 'content_block_stop') {
								if (currentToolId && currentToolName) {
									let parsedInput: unknown = {};
									if (currentToolInput) {
										try {
											parsedInput = JSON.parse(currentToolInput);
										} catch {
											parsedInput = { raw: currentToolInput };
										}
									}
									yield {
										type: 'tool_end',
										toolId: currentToolId,
										toolName: currentToolName,
										toolInput: parsedInput,
									};
									currentToolId = null;
									currentToolName = null;
									currentToolInput = '';
								}
							} else if (eventType === 'message_delta') {
								const delta = chunk.delta;
								if (delta?.stop_reason) {
									yield { type: 'done', stopReason: delta.stop_reason };
								}
							} else if (eventType === 'message_stop') {
								// Message complete
							} else if (eventType === 'error') {
								yield { type: 'error', text: chunk.error?.message ?? 'Unknown streaming error' };
							}
						}
					}
				} finally {
					reader.releaseLock();
				}

				// Successfully completed -- exit retry loop
				return;

			} catch (error: unknown) {
				if (error instanceof DOMException && error.name === 'AbortError') {
					this.logService.info('[AnthropicProvider] Request aborted by user');
					yield { type: 'error', text: 'Request cancelled.' };
					return;
				}

				retryCount++;
				if (retryCount > MAX_RETRIES) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					this.logService.error('[AnthropicProvider] Network error after max retries:', errorMsg);
					if (error instanceof Error) {
						this._onConnectionError.fire(error);
					}
					yield { type: 'error', text: `Connection failed: ${errorMsg}` };
					return;
				}

				const backoffMs = Math.pow(2, retryCount) * 1000;
				const errorMsg = error instanceof Error ? error.message : String(error);
				this.logService.warn(`[AnthropicProvider] Network error. Retrying in ${backoffMs}ms:`, errorMsg);
				await this.sleep(backoffMs, signal);
			}
		}
	}

	private sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
			signal?.addEventListener('abort', () => {
				clearTimeout(timer);
				reject(new DOMException('Aborted', 'AbortError'));
			}, { once: true });
		});
	}

	override dispose(): void {
		super.dispose();
	}
}
