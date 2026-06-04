/*---------------------------------------------------------------------------------------------
 *  Construct IDE - LLM Bridge (Anthropic Claude API)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import type { IncomingMessage } from 'http';

export interface SecretStorageLike {
	get(key: string): Promise<string | undefined>;
}

export interface StreamOptions {
	signal?: AbortSignal;
}

export class LLMBridge {
	private readonly secrets: SecretStorageLike;
	private readonly apiKey: string | null = null;
	public static readonly MAX_TOKENS_PER_TURN = 30_000;
	private static readonly MODEL = 'claude-sonnet-4-20250514';
	private static readonly MAX_TOKENS = 8192;
	private static readonly API_URL = 'https://api.anthropic.com/v1/messages';
	private static readonly MAX_RETRIES = 4;

	constructor(secrets: SecretStorageLike, apiKey?: string) {
		this.secrets = secrets;
		this.apiKey = apiKey ?? null;
	}

	async *streamCompletion(prompt: string, options?: StreamOptions): AsyncIterable<string> {
		const key = this.apiKey ?? await this.secrets.get('anthropicApiKey');
		if (!key) {
			throw new Error('Anthropic API key not configured. Set it via the Construct settings.');
		}

		const body = JSON.stringify({
			model: LLMBridge.MODEL,
			max_tokens: LLMBridge.MAX_TOKENS,
			messages: [{ role: 'user', content: prompt }],
			stream: true,
		});

		let lastRetryDelay = 0;

		for (let attempt = 0; attempt <= LLMBridge.MAX_RETRIES; attempt++) {
			if (options?.signal?.aborted) {
				throw new Error('LLM request aborted');
			}

			try {
				yield* this.doStreamRequest(key, body, options);
				return; // Success — exit the retry loop
			} catch (err: unknown) {
				const isRetryable = err instanceof Error && (err as any).statusCode === 429;
				if (!isRetryable || attempt === LLMBridge.MAX_RETRIES) {
					throw err;
				}
				// Exponential backoff: 1s → 2s → 4s → 8s
				const delay = lastRetryDelay === 0 ? 1000 : lastRetryDelay * 2;
				lastRetryDelay = delay;
				await this.sleep(delay, options?.signal);
			}
		}
	}

	private async *doStreamRequest(apiKey: string, body: string, options?: StreamOptions): AsyncIterable<string> {
		const controller = new AbortController();
		const signal = controller.signal;

		// Link external abort to our controller
		if (options?.signal) {
			if (options.signal.aborted) {
				controller.abort();
			}
			options.signal.addEventListener('abort', () => controller.abort(), { once: true });
		}

		const response = await new Promise<IncomingMessage>((resolve, reject) => {
			const req = https.request(
				LLMBridge.API_URL,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': apiKey,
						'anthropic-version': '2023-06-01',
						'Accept': 'text/event-stream',
					},
					signal,
				},
				(res) => resolve(res),
			);

			req.on('error', reject);
			req.write(body);
			req.end();
		});

		if (response.statusCode !== 200) {
			let errorBody = '';
			for await (const chunk of response) {
				errorBody += chunk.toString();
			}
			const err = new Error(`LLM API error ${response.statusCode}: ${errorBody}`);
			(err as any).statusCode = response.statusCode;
			throw err;
		}

		let buffer = '';

		for await (const chunk of response) {
			if (signal.aborted) {
				throw new Error('LLM request aborted');
			}

			buffer += chunk.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || !trimmed.startsWith('data: ')) {
					continue;
				}

				const data = trimmed.slice(6); // Remove 'data: '
				if (data === '[DONE]') {
					return;
				}

				try {
					const event = JSON.parse(data);

					if (event.type === 'content_block_delta') {
						const delta = event.delta;
						if (delta && delta.type === 'text_delta' && delta.text) {
							yield delta.text;
						}
					}
				} catch {
					// Ignore malformed JSON — SSE can have partial events
				}
			}
		}
	}

	private sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
			if (signal) {
				const onAbort = () => {
					clearTimeout(timer);
					reject(new Error('LLM request aborted during backoff'));
				};
				signal.addEventListener('abort', onAbort, { once: true });
			}
		});
	}

	static estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	getTokenEstimator(): (text: string) => number {
		return LLMBridge.estimateTokens;
	}
}
