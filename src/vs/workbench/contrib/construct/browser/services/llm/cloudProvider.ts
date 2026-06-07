/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import {
        IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
        IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
        IToolDefinition, ProviderStatus
} from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

const DEFAULT_CLOUD_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CLOUD_MODEL = 'gpt-4o-mini';
const MAX_RETRIES = 3;
const STORAGE_KEY_CLOUD_API_KEY = 'construct.cloud.apiKey';

/**
 * CloudProvider — concrete AI provider for any OpenAI-compatible API.
 *
 * This is the optional network fallback when neither Ollama nor Xenova
 * are suitable. It supports any API that follows the OpenAI chat completions
 * format, including:
 * - OpenAI (api.openai.com)
 * - Together AI
 * - Groq
 * - LM Studio (local server)
 * - Any LiteLLM proxy
 *
 * NOT OFFLINE FIRST: This provider requires internet. It should only be
 * auto-selected when the user has explicitly configured it. The UI must
 * clearly indicate when cloud mode is active.
 *
 * Graceful degradation:
 * - If no API key is configured: ProviderStatus.NoModels
 * - If the endpoint is unreachable: ProviderStatus.Unreachable
 * - Network errors are reported clearly to the user
 */
export class CloudProvider extends Disposable implements IConstructAIProvider {
        readonly _serviceBrand: undefined;
        readonly providerType: AIProviderType = 'cloud';

        private _activeModel: IModelInfo | undefined;
        private _status: ProviderStatus = ProviderStatus.Unknown;
        private _baseUrl: string;
        private _apiKey: string;
        private _customModels: IModelInfo[] = [];

        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;
        private readonly _onDidChangeStatus = this._register(new Emitter<ProviderStatus>());
        readonly onDidChangeStatus = this._onDidChangeStatus.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @IStorageService private readonly _storageService: IStorageService,
        ) {
                super();

                this._baseUrl = configurationService.getValue<string>('construct.cloud.baseUrl') || DEFAULT_CLOUD_BASE_URL;
                this._apiKey = this._storageService.get(STORAGE_KEY_CLOUD_API_KEY, 0 /* StorageScope.APPLICATION */) ?? '';

                this.logService.info('[CloudProvider] Initialized (baseUrl: ' + this._baseUrl + ')');
        }

        isOffline(): boolean {
                return false;
        }

        async checkStatus(): Promise<ProviderStatus> {
                if (!this._apiKey) {
                        this._setStatus(ProviderStatus.NoModels);
                        return this._status;
                }

                try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 10_000);

                        const response = await fetch(this._baseUrl + '/models', {
                                headers: {
                                        'Authorization': 'Bearer ' + this._apiKey,
                                },
                                signal: controller.signal,
                        });
                        clearTimeout(timeout);

                        if (!response.ok) {
                                this._setStatus(ProviderStatus.Unreachable);
                                return this._status;
                        }

                        const data = await response.json() as { data?: Array<{ id: string; owned_by?: string }> };
                        if (!data.data || data.data.length === 0) {
                                this._setStatus(ProviderStatus.NoModels);
                                return this._status;
                        }

                        // Cache models
                        this._customModels = data.data.map(m => ({
                                id: m.id,
                                displayName: m.id,
                                provider: 'cloud' as AIProviderType,
                                contextWindowTokens: 128_000, // Default, varies by model
                                supportsTools: true,
                                supportsStreaming: true,
                        }));

                        // Auto-select first model if none is active
                        if (!this._activeModel && this._customModels.length > 0) {
                                const configuredModel = this.configurationService.getValue<string>('construct.cloud.model') || DEFAULT_CLOUD_MODEL;
                                const found = this._customModels.find(m => m.id === configuredModel);
                                await this.setActiveModel(found ? found.id : this._customModels[0].id);
                        }

                        this._setStatus(ProviderStatus.Available);
                        return this._status;
                } catch {
                        this._setStatus(ProviderStatus.Unreachable);
                        return this._status;
                }
        }

        getActiveModel(): IModelInfo | undefined {
                return this._activeModel;
        }

        async setActiveModel(modelId: string): Promise<boolean> {
                const models = await this.listModels();
                const model = models.find(m => m.id === modelId);
                if (!model) {
                        this.logService.warn('[CloudProvider] Model not found: ' + modelId);
                        return false;
                }
                this._activeModel = model;
                this._onDidChangeActiveModel.fire(model);
                this.logService.info('[CloudProvider] Active model set to: ' + modelId);
                return true;
        }

        async listModels(): Promise<IModelInfo[]> {
                if (this._customModels.length > 0) {
                        return [...this._customModels];
                }

                // Return a default set of known models if we haven't fetched yet
                return [
                        {
                                id: 'gpt-4o-mini',
                                displayName: 'GPT-4o Mini',
                                provider: 'cloud' as AIProviderType,
                                contextWindowTokens: 128_000,
                                supportsTools: true,
                                supportsStreaming: true,
                        },
                        {
                                id: 'gpt-4o',
                                displayName: 'GPT-4o',
                                provider: 'cloud' as AIProviderType,
                                contextWindowTokens: 128_000,
                                supportsTools: true,
                                supportsStreaming: true,
                        },
                ];
        }

        async *chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                if (!this._activeModel) {
                        yield { type: 'error', text: 'No model selected. Please select a model in the CONSTRUCT model picker.' };
                        return;
                }

                if (!this._apiKey) {
                        yield { type: 'error', text: 'Cloud API key not configured. Please set your API key in Construct settings.' };
                        return;
                }

                // Convert to OpenAI format
                const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

                const body: Record<string, unknown> = {
                        model: this._activeModel.id,
                        messages: openaiMessages,
                        stream: true,
                        max_tokens: options?.maxTokens ?? 4096,
                        temperature: options?.temperature ?? 0.7,
                };

                if (tools.length > 0 && this._activeModel.supportsTools) {
                        body.tools = this.convertTools(tools);
                }

                let retryCount = 0;

                while (retryCount <= MAX_RETRIES) {
                        try {
                                const response = await fetch(this._baseUrl + '/chat/completions', {
                                        method: 'POST',
                                        headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': 'Bearer ' + this._apiKey,
                                        },
                                        body: JSON.stringify(body),
                                        signal: options?.signal,
                                });

                                // Handle 401
                                if (response.status === 401) {
                                        yield { type: 'error', text: 'Cloud API key is invalid. Please check your settings.' };
                                        return;
                                }

                                // Handle 429
                                if (response.status === 429) {
                                        retryCount++;
                                        if (retryCount > MAX_RETRIES) {
                                                yield { type: 'error', text: 'Rate limited by cloud API. Please try again later.' };
                                                return;
                                        }
                                        const backoffMs = Math.pow(2, retryCount) * 1000;
                                        yield { type: 'error', text: 'Rate limited. Retrying in ' + (backoffMs / 1000) + 's...' };
                                        await this.sleep(backoffMs, options?.signal);
                                        continue;
                                }

                                // Handle 5xx
                                if (response.status >= 500) {
                                        retryCount++;
                                        if (retryCount > MAX_RETRIES) {
                                                yield { type: 'error', text: 'Cloud API server error (' + response.status + ').' };
                                                return;
                                        }
                                        await this.sleep(Math.pow(2, retryCount) * 1000, options?.signal);
                                        continue;
                                }

                                if (!response.ok) {
                                        const errorText = await response.text();
                                        yield { type: 'error', text: 'Cloud API error (' + response.status + '): ' + errorText };
                                        return;
                                }

                                if (!response.body) {
                                        yield { type: 'error', text: 'No response body from cloud API.' };
                                        return;
                                }

                                // Parse OpenAI SSE stream
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
                                                buffer = lines.pop() ?? '';

                                                for (const line of lines) {
                                                        const trimmed = line.trim();
                                                        if (!trimmed || !trimmed.startsWith('data: ')) { continue; }

                                                        const jsonStr = trimmed.slice(6);
                                                        if (jsonStr === '[DONE]') {
                                                                yield { type: 'done', stopReason: 'stop' };
                                                                return;
                                                        }

                                                        let chunk: Record<string, unknown>;
                                                        try {
                                                                chunk = JSON.parse(jsonStr) as Record<string, unknown>;
                                                        } catch {
                                                                continue;
                                                        }

                                                        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
                                                        if (!choices || choices.length === 0) { continue; }

                                                        const choice = choices[0];
                                                        const delta = choice.delta as Record<string, unknown> | undefined;

                                                        if (delta) {
                                                                // Text content
                                                                if (delta.content && typeof delta.content === 'string') {
                                                                        yield { type: 'token', text: delta.content as string };
                                                                }

                                                                // Tool calls
                                                                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                                                                        for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
                                                                                const func = tc.function as Record<string, unknown> | undefined;

                                                                                if (tc.id) {
                                                                                        // New tool call starting
                                                                                        currentToolId = String(tc.id);
                                                                                        currentToolName = func?.name ? String(func.name) : '';
                                                                                        currentToolInput = '';
                                                                                        yield { type: 'tool_start', toolId: currentToolId, toolName: currentToolName };
                                                                                }

                                                                                if (func?.arguments && typeof func.arguments === 'string') {
                                                                                        currentToolInput += func.arguments;
                                                                                        yield { type: 'tool_input', toolId: currentToolId ?? '', text: func.arguments };
                                                                                }

                                                                                if (currentToolId && choice.finish_reason === 'tool_calls') {
                                                                                        let parsedInput: unknown = {};
                                                                                        try {
                                                                                                parsedInput = JSON.parse(currentToolInput);
                                                                                        } catch {
                                                                                                parsedInput = { raw: currentToolInput };
                                                                                        }
                                                                                        yield { type: 'tool_end', toolId: currentToolId, toolName: currentToolName ?? '', toolInput: parsedInput };
                                                                                        currentToolId = null;
                                                                                        currentToolName = null;
                                                                                        currentToolInput = '';
                                                                                }
                                                                        }
                                                                }
                                                        }

                                                        if (choice.finish_reason === 'stop') {
                                                                yield { type: 'done', stopReason: 'stop' };
                                                                return;
                                                        }
                                                }
                                        }
                                } finally {
                                        reader.releaseLock();
                                }

                                yield { type: 'done', stopReason: 'stop' };
                                return;

                        } catch (error: unknown) {
                                if (error instanceof DOMException && error.name === 'AbortError') {
                                        yield { type: 'error', text: 'Request cancelled.' };
                                        return;
                                }

                                retryCount++;
                                if (retryCount > MAX_RETRIES) {
                                        yield { type: 'error', text: 'Cloud connection failed: ' + (error instanceof Error ? error.message : String(error)) };
                                        return;
                                }

                                await this.sleep(Math.pow(2, retryCount) * 1000, options?.signal);
                        }
                }
        }

        async complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                if (!this._activeModel || !this._apiKey) {
                        return { text: '', finished: true };
                }

                const body: Record<string, unknown> = {
                        model: this._activeModel.id,
                        messages: [
                                {
                                        role: 'user',
                                        content: 'Complete the following code. Only output the completion, no explanation:\n\n' + prefix,
                                },
                        ],
                        max_tokens: options?.maxTokens ?? 128,
                        temperature: options?.temperature ?? 0.2,
                        stream: false,
                };

                try {
                        const response = await fetch(this._baseUrl + '/chat/completions', {
                                method: 'POST',
                                headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': 'Bearer ' + this._apiKey,
                                },
                                body: JSON.stringify(body),
                                signal: options?.signal,
                        });

                        if (!response.ok) {
                                return { text: '', finished: true };
                        }

                        const data = await response.json() as {
                                choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
                        };

                        const text = data.choices?.[0]?.message?.content ?? '';
                        const finished = data.choices?.[0]?.finish_reason === 'stop';
                        return { text, finished };
                } catch {
                        return { text: '', finished: true };
                }
        }

        // --- Private helpers ---

        private _setStatus(status: ProviderStatus): void {
                if (this._status !== status) {
                        this._status = status;
                        this._onDidChangeStatus.fire(status);
                }
        }

        /**
         * Convert unified messages to OpenAI chat format.
         * System prompts are extracted and placed as the first system message.
         */
        private convertMessages(messages: IChatMessage[], systemPrompt?: string): Array<Record<string, unknown>> {
                const result: Array<Record<string, unknown>> = [];

                if (systemPrompt) {
                        result.push({ role: 'system', content: systemPrompt });
                }

                for (const msg of messages) {
                        if (msg.role === 'system') {
                                result.push({ role: 'system', content: msg.content });
                        } else if (msg.role === 'user') {
                                result.push({ role: 'user', content: msg.content });
                        } else if (msg.role === 'assistant') {
                                const assistantMsg: Record<string, unknown> = { role: 'assistant', content: msg.content || null };
                                if (msg.toolCalls && msg.toolCalls.length > 0) {
                                        assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
                                                id: tc.id,
                                                type: 'function',
                                                function: {
                                                        name: tc.name,
                                                        arguments: tc.arguments,
                                                },
                                        }));
                                }
                                result.push(assistantMsg);
                        } else if (msg.role === 'tool') {
                                result.push({
                                        role: 'tool',
                                        content: msg.content,
                                        tool_call_id: msg.toolCallId,
                                });
                        }
                }

                return result;
        }

        /**
         * Convert unified tool definitions to OpenAI tool format.
         */
        private convertTools(tools: IToolDefinition[]): Array<Record<string, unknown>> {
                return tools.map(tool => ({
                        type: 'function',
                        function: {
                                name: tool.name,
                                description: tool.description,
                                parameters: tool.parameters,
                        },
                }));
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
