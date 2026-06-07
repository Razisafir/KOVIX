/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import {
        IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
        IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
        IToolDefinition, ProviderStatus
} from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

/**
 * OllamaProvider — concrete AI provider that connects to a local Ollama instance.
 *
 * Communication is via HTTP to localhost:11434 using Ollama's native API:
 * - /api/chat for streaming chat with tool support
 * - /api/generate for completions
 * - /api/tags for listing available models
 *
 * OFFLINE FIRST: Ollama runs entirely locally. If Ollama is not running,
 * this provider reports ProviderStatus.Unreachable so the auto-selection
 * logic can fall back to Xenova.
 *
 * Graceful degradation:
 * - If Ollama is not installed/running: checkStatus() returns Unreachable
 * - If Ollama is running but no models are pulled: returns NoModels
 * - Tool calling is only enabled for models that support it (checked via model capabilities)
 */
export class OllamaProvider extends Disposable implements IConstructAIProvider {
        readonly _serviceBrand: undefined;
        readonly providerType: AIProviderType = 'ollama';

        private _activeModel: IModelInfo | undefined;
        private _status: ProviderStatus = ProviderStatus.Unknown;
        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;
        private readonly _onDidChangeStatus = this._register(new Emitter<ProviderStatus>());
        readonly onDidChangeStatus = this._onDidChangeStatus.event;

        private _baseUrl: string;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConfigurationService configurationService: IConfigurationService,
        ) {
                super();
                this._baseUrl = configurationService.getValue<string>('construct.ollama.baseUrl') || OLLAMA_BASE_URL;
                this.logService.info('[OllamaProvider] Initialized (baseUrl: ' + this._baseUrl + ')');
        }

        isOffline(): boolean {
                return true;
        }

        async checkStatus(): Promise<ProviderStatus> {
                try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 5000);
                        const response = await fetch(this._baseUrl + '/api/tags', {
                                signal: controller.signal,
                        });
                        clearTimeout(timeout);

                        if (!response.ok) {
                                this._setStatus(ProviderStatus.Unreachable);
                                return this._status;
                        }

                        const data = await response.json() as { models?: Array<{ name: string }> };
                        if (!data.models || data.models.length === 0) {
                                this._setStatus(ProviderStatus.NoModels);
                                return this._status;
                        }

                        this._setStatus(ProviderStatus.Available);

                        // Auto-select first model if none is active
                        if (!this._activeModel) {
                                const models = await this.listModels();
                                if (models.length > 0) {
                                        await this.setActiveModel(models[0].id);
                                }
                        }

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
                        this.logService.warn('[OllamaProvider] Model not found: ' + modelId);
                        return false;
                }
                this._activeModel = model;
                this._onDidChangeActiveModel.fire(model);
                this.logService.info('[OllamaProvider] Active model set to: ' + modelId);
                return true;
        }

        async listModels(): Promise<IModelInfo[]> {
                try {
                        const response = await fetch(this._baseUrl + '/api/tags');
                        if (!response.ok) {
                                return [];
                        }

                        const data = await response.json() as {
                                models: Array<{
                                        name: string;
                                        model: string;
                                        size?: number;
                                        details?: { parameter_size?: string; family?: string };
                                }>;
                        };

                        return (data.models || []).map(m => {
                                const modelName = m.name || m.model;
                                // Determine tool support based on model family
                                const family = m.details?.family?.toLowerCase() ?? '';
                                const supportsTools = family.includes('llama') || family.includes('mistral') || family.includes('qwen') || family.includes('command');
                                // Estimate context window based on model size
                                const contextWindowTokens = this.estimateContextWindow(modelName, m.details?.parameter_size);

                                return {
                                        id: modelName,
                                        displayName: modelName,
                                        provider: 'ollama' as AIProviderType,
                                        contextWindowTokens,
                                        supportsTools,
                                        supportsStreaming: true,
                                } satisfies IModelInfo;
                        });
                } catch (error) {
                        this.logService.error('[OllamaProvider] Failed to list models:', error instanceof Error ? error.message : String(error));
                        return [];
                }
        }

        async *chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                if (!this._activeModel) {
                        yield { type: 'error', text: 'No model selected. Please select a model in the CONSTRUCT model picker.' };
                        return;
                }

                // Convert unified messages to Ollama format
                const ollamaMessages = this.convertMessages(messages);

                const body: Record<string, unknown> = {
                        model: this._activeModel.id,
                        messages: ollamaMessages,
                        stream: true,
                        options: {
                                num_predict: options?.maxTokens ?? 4096,
                                temperature: options?.temperature ?? 0.7,
                        },
                };

                if (options?.systemPrompt) {
                        body.system = options.systemPrompt;
                }

                // Add tools if the model supports them
                if (tools.length > 0 && this._activeModel.supportsTools) {
                        body.tools = this.convertTools(tools);
                }

                let retryCount = 0;
                while (retryCount <= MAX_RETRIES) {
                        try {
                                const controller = new AbortController();
                                const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

                                // Forward external abort signal
                                if (options?.signal) {
                                        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
                                }

                                const response = await fetch(this._baseUrl + '/api/chat', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(body),
                                        signal: controller.signal,
                                });
                                clearTimeout(timeout);

                                if (!response.ok) {
                                        const errorText = await response.text();
                                        if (response.status >= 500 && retryCount < MAX_RETRIES) {
                                                retryCount++;
                                                this.logService.warn('[OllamaProvider] Server error (' + response.status + '). Retrying (' + retryCount + '/' + MAX_RETRIES + ')');
                                                await this.sleep(Math.pow(2, retryCount) * 1000, options?.signal);
                                                continue;
                                        }
                                        yield { type: 'error', text: 'Ollama API error (' + response.status + '): ' + errorText };
                                        return;
                                }

                                if (!response.body) {
                                        yield { type: 'error', text: 'No response body from Ollama API.' };
                                        return;
                                }

                                // Parse Ollama's NDJSON streaming format
                                // Each line is a JSON object with a partial response
                                // Track tool calls from Ollama streaming responses
                                // (Ollama sends complete tool calls, not incremental deltas)

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
                                                        if (!trimmed) { continue; }

                                                        let chunk: Record<string, unknown>;
                                                        try {
                                                                chunk = JSON.parse(trimmed) as Record<string, unknown>;
                                                        } catch {
                                                                continue;
                                                        }

                                                        // Handle text content
                                                        if (typeof chunk.message === 'object' && chunk.message !== null) {
                                                                const message = chunk.message as Record<string, unknown>;

                                                                if (message.content && typeof message.content === 'string') {
                                                                        const text = message.content as string;
                                                                        if (text.length > 0) {
                                                                                yield { type: 'token', text };
                                                                        }
                                                                }

                                                                // Handle tool calls from Ollama
                                                                if (message.tool_calls && Array.isArray(message.tool_calls)) {
                                                                        for (const tc of message.tool_calls as Array<Record<string, unknown>>) {
                                                                                const func = tc.function as Record<string, unknown> | undefined;
                                                                                if (func) {
                                                                                        const toolId = String(tc.id ?? 'tool_' + Date.now());
                                                                                        const toolName = String(func.name ?? '');
                                                                                        const toolArgs = typeof func.arguments === 'string' ? func.arguments : JSON.stringify(func.arguments ?? {});

                                                                                        yield { type: 'tool_start', toolId, toolName };
                                                                                        yield { type: 'tool_input', toolId, text: toolArgs };

                                                                                        let parsedInput: unknown = {};
                                                                                        try {
                                                                                                parsedInput = JSON.parse(toolArgs);
                                                                                        } catch {
                                                                                                parsedInput = { raw: toolArgs };
                                                                                        }
                                                                                        yield { type: 'tool_end', toolId, toolName, toolInput: parsedInput };
                                                                                }
                                                                        }
                                                                }
                                                        }

                                                        // Handle done signal
                                                        if (chunk.done === true) {
                                                                yield { type: 'done', stopReason: 'stop' };
                                                                return;
                                                        }

                                                        // Handle errors
                                                        if (chunk.error) {
                                                                yield { type: 'error', text: String(chunk.error) };
                                                                return;
                                                        }
                                                }
                                        }
                                } finally {
                                        reader.releaseLock();
                                }

                                // If we get here without a done event, the stream ended normally
                                yield { type: 'done', stopReason: 'stop' };
                                return;

                        } catch (error: unknown) {
                                if (error instanceof DOMException && error.name === 'AbortError') {
                                        this.logService.info('[OllamaProvider] Request aborted by user');
                                        yield { type: 'error', text: 'Request cancelled.' };
                                        return;
                                }

                                retryCount++;
                                if (retryCount > MAX_RETRIES) {
                                        const errorMsg = error instanceof Error ? error.message : String(error);
                                        this.logService.error('[OllamaProvider] Connection failed after retries:', errorMsg);
                                        yield { type: 'error', text: 'Ollama connection failed: ' + errorMsg };
                                        return;
                                }

                                const backoffMs = Math.pow(2, retryCount) * 1000;
                                this.logService.warn('[OllamaProvider] Network error. Retrying in ' + backoffMs + 'ms');
                                await this.sleep(backoffMs, options?.signal);
                        }
                }
        }

        async complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                if (!this._activeModel) {
                        return { text: '', finished: true };
                }

                const body: Record<string, unknown> = {
                        model: this._activeModel.id,
                        prompt: prefix,
                        suffix: suffix || undefined,
                        stream: false,
                        options: {
                                num_predict: options?.maxTokens ?? 256,
                                temperature: options?.temperature ?? 0.2,
                                stop: options?.stop ?? ['\n\n', '```'],
                        },
                };

                try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 30_000);
                        if (options?.signal) {
                                options.signal.addEventListener('abort', () => controller.abort(), { once: true });
                        }

                        const response = await fetch(this._baseUrl + '/api/generate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(body),
                                signal: controller.signal,
                        });
                        clearTimeout(timeout);

                        if (!response.ok) {
                                this.logService.error('[OllamaProvider] Completion error: ' + response.status);
                                return { text: '', finished: true };
                        }

                        const data = await response.json() as { response?: string; done?: boolean };
                        return {
                                text: data.response ?? '',
                                finished: data.done ?? true,
                        };
                } catch (error) {
                        this.logService.error('[OllamaProvider] Completion failed:', error instanceof Error ? error.message : String(error));
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
         * Convert unified chat messages to Ollama's chat message format.
         * Ollama uses: { role, content, tool_calls?, tool_call_id? }
         */
        private convertMessages(messages: IChatMessage[]): Array<Record<string, unknown>> {
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
         * Convert unified tool definitions to Ollama's tool format.
         * Ollama follows the OpenAI function-calling schema.
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

        /**
         * Estimate the context window size based on model name and parameter size.
         * Common Ollama models have known context windows; for unknown models,
         * we default to 4096 as a safe lower bound.
         */
        private estimateContextWindow(modelName: string, parameterSize?: string): number {
                const lowerName = modelName.toLowerCase();

                // Known model context windows
                if (lowerName.includes('llama3.1') || lowerName.includes('llama3.1')) {
                        return 128_000;
                }
                if (lowerName.includes('llama3') || lowerName.includes('llama-3')) {
                        return 8_192;
                }
                if (lowerName.includes('mistral') || lowerName.includes('mixtral')) {
                        return 32_000;
                }
                if (lowerName.includes('qwen2.5') || lowerName.includes('qwen2')) {
                        return 128_000;
                }
                if (lowerName.includes('codellama') || lowerName.includes('code-llama')) {
                        return 16_384;
                }
                if (lowerName.includes('phi3') || lowerName.includes('phi-3')) {
                        return 128_000;
                }
                if (lowerName.includes('gemma2') || lowerName.includes('gemma-2')) {
                        return 8_192;
                }
                if (lowerName.includes('deepseek')) {
                        return 64_000;
                }
                if (lowerName.includes('command')) {
                        return 128_000;
                }

                // Larger models tend to have bigger context windows
                if (parameterSize) {
                        const sizeMatch = parameterSize.match(/(\d+)/);
                        if (sizeMatch) {
                                const params = parseInt(sizeMatch[1], 10);
                                if (params >= 70) { return 128_000; }
                                if (params >= 30) { return 32_000; }
                                if (params >= 7) { return 8_192; }
                        }
                }

                // Safe default
                return 4_096;
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
