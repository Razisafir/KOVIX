/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Anthropic Provider Service
 *  MVP: Real HTTP integration for Anthropic Claude API
 *
 *  - Real fetch() to https://api.anthropic.com/v1/messages
 *  - SSE streaming with proper chunk parsing
 *  - Tool use parsing: content_block_start, input_json_delta, content_block_stop
 *  - Error handling: 401, 429, 500, network failure
 *  - AbortSignal support for cancellation
 *  - Token counting: text.length / 4 heuristic
 *  - Model: claude-sonnet-4-20250514, max_tokens 8192
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

import {
        IAnthropicProviderService,
        AnthropicMessage,
        AnthropicRequestOptions,
        AnthropicResponse,
        AnthropicStreamChunk,
} from '../../../../../platform/construct/common/anthropicProvider.js';

// ── Constants ─────────────────────────────────────────────────

const API_BASE = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 8192;
const SECRET_KEY = 'construct.anthropicApiKey';
const CONFIG_MODEL_KEY = 'construct.anthropic.model';

const AVAILABLE_MODELS = [
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-opus-4-20250514',
];

// ── SSE Parsing Helpers ───────────────────────────────────────

interface SSEEvent {
        event: string;
        data: string;
}

function parseSSELines(buffer: string): { events: SSEEvent[]; remainder: string } {
        const events: SSEEvent[] = [];
        let currentEvent = '';
        let currentData = '';
        const lines = buffer.split('\n');
        const remainder: string[] = [];

        for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                        currentData = line.slice(6);
                } else if (line === '') {
                        // End of event
                        if (currentData) {
                                events.push({ event: currentEvent, data: currentData });
                        }
                        currentEvent = '';
                        currentData = '';
                } else if (i === lines.length - 1) {
                        // Incomplete line — keep for next chunk
                        remainder.push(line);
                }
        }

        return { events, remainder: remainder.join('\n') };
}

// ══════════════════════════════════════════════════════════════
// AnthropicProviderService
// ══════════════════════════════════════════════════════════════

export class AnthropicProviderService extends Disposable implements IAnthropicProviderService {
        declare readonly _serviceBrand: undefined;

        private _apiKey: string | undefined;
        private _activeModel: string = DEFAULT_MODEL;
        private _lastLatencyMs: number = 0;
        private _available: boolean = false;

        private readonly _onDidChangeModel = this._register(new Emitter<string>());
        readonly onDidChangeModel = this._onDidChangeModel.event;

        private readonly _onDidRequestComplete = this._register(new Emitter<{ tokensIn: number; tokensOut: number; latencyMs: number }>());
        readonly onDidRequestComplete = this._onDidRequestComplete.event;

        constructor(
                @ISecretStorageService private readonly secretStorageService: ISecretStorageService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();

                // Load saved API key on startup
                this._loadApiKey();

                // Load saved model preference
                const savedModel = this.configurationService.getValue<string>(CONFIG_MODEL_KEY);
                if (savedModel && AVAILABLE_MODELS.includes(savedModel)) {
                        this._activeModel = savedModel;
                }

                this.logService.info('[AnthropicProvider] Initialized');
        }

        // ── API Key Management ────────────────────────────────────

        getApiKeyStatus(): { configured: boolean; keyPrefix: string } {
                if (!this._apiKey) {
                        return { configured: false, keyPrefix: '' };
                }
                return {
                        configured: true,
                        keyPrefix: this._apiKey.slice(0, 8) + '...',
                };
        }

        async setApiKey(key: string): Promise<void> {
                this._apiKey = key;
                await this.secretStorageService.set(SECRET_KEY, key);
                this._available = true;
                this.logService.info('[AnthropicProvider] API key stored');
        }

        // ── Model Management ──────────────────────────────────────

        getActiveModel(): string {
                return this._activeModel;
        }

        setActiveModel(model: string): void {
                if (AVAILABLE_MODELS.includes(model)) {
                        this._activeModel = model;
                        this.configurationService.updateValue(CONFIG_MODEL_KEY, model);
                        this._onDidChangeModel.fire(model);
                        this.logService.info(`[AnthropicProvider] Model changed to ${model}`);
                }
        }

        getAvailableModels(): string[] {
                return [...AVAILABLE_MODELS];
        }

        // ── Health ────────────────────────────────────────────────

        isAvailable(): boolean {
                return this._available && !!this._apiKey;
        }

        getLastLatencyMs(): number {
                return this._lastLatencyMs;
        }

        // ── Non-Streaming Request ──────────────────────────────────

        async sendMessage(messages: AnthropicMessage[], options?: AnthropicRequestOptions): Promise<AnthropicResponse> {
                const apiKey = this._requireApiKey();
                const model = options?.model ?? this._activeModel;
                const startTime = Date.now();

                const body: Record<string, unknown> = {
                        model,
                        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
                        messages: this._serializeMessages(messages),
                };

                if (options?.temperature !== undefined) {
                        body.temperature = options.temperature;
                }
                if (options?.systemPrompt) {
                        body.system = options.systemPrompt;
                }
                if (options?.tools && options.tools.length > 0) {
                        body.tools = options.tools.map(t => ({
                                name: t.name,
                                description: t.description,
                                input_schema: t.input_schema,
                        }));
                }

                try {
                        const response = await fetch(`${API_BASE}/messages`, {
                                method: 'POST',
                                headers: {
                                        'content-type': 'application/json',
                                        'x-api-key': apiKey,
                                        'anthropic-version': API_VERSION,
                                },
                                body: JSON.stringify(body),
                                signal: options?.abortSignal,
                        });

                        this._lastLatencyMs = Date.now() - startTime;

                        if (!response.ok) {
                                throw this._handleHttpError(response.status, await response.text());
                        }

                        const data = await response.json();

                        const result: AnthropicResponse = {
                                content: data.content || [],
                                stopReason: data.stop_reason || 'end_turn',
                                usage: {
                                        inputTokens: data.usage?.input_tokens ?? 0,
                                        outputTokens: data.usage?.output_tokens ?? 0,
                                },
                                model: data.model || model,
                        };

                        this._onDidRequestComplete.fire({
                                tokensIn: result.usage.inputTokens,
                                tokensOut: result.usage.outputTokens,
                                latencyMs: this._lastLatencyMs,
                        });

                        return result;
                } catch (error) {
                        if ((error as Error).name === 'AbortError') {
                                throw new Error('Request cancelled');
                        }
                        throw error;
                }
        }

        // ── Streaming Request ──────────────────────────────────────

        async *sendMessageStream(messages: AnthropicMessage[], options?: AnthropicRequestOptions): AsyncIterable<AnthropicStreamChunk> {
                const apiKey = this._requireApiKey();
                const model = options?.model ?? this._activeModel;
                const startTime = Date.now();

                const body: Record<string, unknown> = {
                        model,
                        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
                        messages: this._serializeMessages(messages),
                        stream: true,
                };

                if (options?.temperature !== undefined) {
                        body.temperature = options.temperature;
                }
                if (options?.systemPrompt) {
                        body.system = options.systemPrompt;
                }
                if (options?.tools && options.tools.length > 0) {
                        body.tools = options.tools.map(t => ({
                                name: t.name,
                                description: t.description,
                                input_schema: t.input_schema,
                        }));
                }

                let response: Response;
                try {
                        response = await fetch(`${API_BASE}/messages`, {
                                method: 'POST',
                                headers: {
                                        'content-type': 'application/json',
                                        'x-api-key': apiKey,
                                        'anthropic-version': API_VERSION,
                                },
                                body: JSON.stringify(body),
                                signal: options?.abortSignal,
                        });
                } catch (error) {
                        if ((error as Error).name === 'AbortError') {
                                yield { type: 'error', error: 'Request cancelled' };
                                return;
                        }
                        yield { type: 'error', error: `Network error: ${(error as Error).message}` };
                        return;
                }

                if (!response.ok) {
                        const errorText = await response.text();
                        yield { type: 'error', error: this._handleHttpError(response.status, errorText).message };
                        return;
                }

                // Parse SSE stream
                const reader = response.body?.getReader();
                if (!reader) {
                        yield { type: 'error', error: 'No response body' };
                        return;
                }

                const decoder = new TextDecoder();
                let buffer = '';
                let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
                let totalInputTokens = 0;
                let totalOutputTokens = 0;

                try {
                        while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                buffer += decoder.decode(value, { stream: true });

                                const { events, remainder } = parseSSELines(buffer);
                                buffer = remainder;

                                for (const event of events) {
                                        if (event.event === 'error') {
                                                yield { type: 'error', error: event.data };
                                                continue;
                                        }

                                        let parsed: any;
                                        try {
                                                parsed = JSON.parse(event.data);
                                        } catch {
                                                continue; // Skip malformed JSON
                                        }

                                        const chunkType = parsed.type;

                                        if (chunkType === 'content_block_start') {
                                                const block = parsed.content_block;
                                                if (block?.type === 'tool_use') {
                                                        currentToolUse = {
                                                                id: block.id,
                                                                name: block.name,
                                                                inputJson: '',
                                                        };
                                                }
                                        } else if (chunkType === 'content_block_delta') {
                                                const delta = parsed.delta;
                                                if (delta?.type === 'text_delta') {
                                                        yield { type: 'text', text: delta.text };
                                                } else if (delta?.type === 'input_json_delta') {
                                                        if (currentToolUse) {
                                                                currentToolUse.inputJson += delta.partial_json;
                                                        }
                                                }
                                        } else if (chunkType === 'content_block_stop') {
                                                if (currentToolUse) {
                                                        let input: any = {};
                                                        try {
                                                                input = JSON.parse(currentToolUse.inputJson || '{}');
                                                        } catch {
                                                                this.logService.warn('[AnthropicProvider] Failed to parse tool input JSON, using empty object');
                                                        }
                                                        yield {
                                                                type: 'tool_use',
                                                                toolUse: {
                                                                        id: currentToolUse.id,
                                                                        name: currentToolUse.name,
                                                                        input,
                                                                },
                                                        };
                                                        currentToolUse = null;
                                                }
                                        } else if (chunkType === 'message_delta') {
                                                if (parsed.usage) {
                                                        totalOutputTokens = parsed.usage.output_tokens ?? totalOutputTokens;
                                                }
                                        } else if (chunkType === 'message_start') {
                                                if (parsed.message?.usage) {
                                                        totalInputTokens = parsed.message.usage.input_tokens ?? 0;
                                                }
                                        } else if (chunkType === 'message_stop') {
                                                this._lastLatencyMs = Date.now() - startTime;
                                                this._onDidRequestComplete.fire({
                                                        tokensIn: totalInputTokens,
                                                        tokensOut: totalOutputTokens,
                                                        latencyMs: this._lastLatencyMs,
                                                });
                                        }
                                }
                        }
                } finally {
                        reader.releaseLock();
                }

                yield { type: 'stop' };
        }

        // ── Private Helpers ───────────────────────────────────────

        private _requireApiKey(): string {
                if (!this._apiKey) {
                        throw new Error('Anthropic API key not configured. Please set your API key in Construct Settings.');
                }
                return this._apiKey;
        }

        private _serializeMessages(messages: AnthropicMessage[]): any[] {
                return messages.map(msg => ({
                        role: msg.role,
                        content: typeof msg.content === 'string' ? msg.content : msg.content.map(block => {
                                if (block.type === 'text') {
                                        return { type: 'text', text: block.text };
                                } else if (block.type === 'tool_use') {
                                        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
                                } else if (block.type === 'tool_result') {
                                        return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content };
                                }
                                return block;
                        }),
                }));
        }

        private _handleHttpError(status: number, body: string): Error {
                switch (status) {
                        case 401:
                                return new Error('Invalid API key. Please check your Anthropic API key in Construct Settings.');
                        case 429:
                                return new Error('Rate limit exceeded. Please wait a moment and try again.');
                        case 500:
                        case 502:
                        case 503:
                                return new Error(`Anthropic server error (${status}). Please try again later.`);
                        default:
                                return new Error(`API error (${status}): ${body.slice(0, 200)}`);
                }
        }

        private async _loadApiKey(): Promise<void> {
                try {
                        const key = await this.secretStorageService.get(SECRET_KEY);
                        if (key) {
                                this._apiKey = key;
                                this._available = true;
                                this.logService.info('[AnthropicProvider] API key loaded from storage');
                        }
                } catch (err) {
                        this.logService.warn('[AnthropicProvider] Failed to load API key from storage:', err);
                }
        }
}
