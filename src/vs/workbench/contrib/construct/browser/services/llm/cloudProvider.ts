// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import {
        IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
        IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
        IToolDefinition, ProviderStatus
} from '../../../../../../platform/construct/common/llm/constructAIProvider.js';
// SEC-5: Secret redaction for all log calls
import { redactSecrets } from '../../../../../../platform/construct/common/security/secretRedactor.js';
// Resolve API keys through ISecureKeyManager (single source of truth)
import { ISecureKeyManager, LLMProvider } from '../../../../../../platform/construct/common/security/secureKeyManager.js';
import { ConstructAuthError, ConstructRateLimitError, ConstructOverloadedError } from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

const DEFAULT_CLOUD_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CLOUD_MODEL = 'gpt-4o-mini';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const MAX_RETRIES = 3;

// P5: Token usage tracking interface
export interface ITokenUsage {
        promptTokens: number;
        completionTokens: number;
        totalCost: number;
}

// P5: Provider health status for fallback chain
interface IProviderHealth {
        provider: AIProviderType;
        healthy: boolean;
        lastCheck: number;
        errorCount: number;
}

/**
 * Parsed SSE chunk from the Anthropic streaming API.
 */
interface IAnthropicSSEChunk {
        type: string;
        content_block?: { type: string; id?: string; name?: string; text?: string };
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
        error?: { message?: string };
}

/**
 * CloudProvider — concrete AI provider for cloud APIs.
 *
 * This is the optional network fallback when neither Ollama nor Xenova
 * are suitable. It supports multiple cloud backends:
 * - **OpenAI-compatible APIs**: OpenAI, Together AI, Groq, LM Studio, LiteLLM
 * - **Anthropic API**: Direct integration with Claude models (auto-detected by API key prefix `sk-ant-`)
 *
 * NOT OFFLINE FIRST: This provider requires internet. It should only be
 * auto-selected when the user has explicitly configured it.
 *
 * Anthropic integration:
 * When the API key starts with "sk-ant-", the provider automatically uses
 * the Anthropic Messages API (https://api.anthropic.com/v1/messages) instead
 * of the OpenAI-compatible endpoint. This provides native support for Claude
 * models with their unique content block format and streaming protocol.
 */
export class CloudProvider extends Disposable implements IConstructAIProvider {
        readonly _serviceBrand: undefined;
        readonly providerType: AIProviderType = 'cloud';

        private _activeModel: IModelInfo | undefined;
        private _status: ProviderStatus = ProviderStatus.Unknown;
        private _baseUrl: string;
        private _apiKey: string = '';
        private _customModels: IModelInfo[] = [];

        // P5: Token usage tracking
        private _tokenUsage: ITokenUsage = { promptTokens: 0, completionTokens: 0, totalCost: 0 };
        // P5: Streaming error recovery — track last known good state (used for recovery on reconnect)
        private _lastStreamedText = '';
        // P5: Streaming error recovery — track tool calls for recovery on reconnect
        private _lastStreamedToolCalls: Array<{ id: string; name: string; input: string }> = [];
        // P5: Provider health for fallback chain
        private _providerHealth: Map<AIProviderType, IProviderHealth> = new Map();

        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;
        private readonly _onDidChangeStatus = this._register(new Emitter<ProviderStatus>());
        readonly onDidChangeStatus = this._onDidChangeStatus.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @ISecureKeyManager private readonly _keyManager: ISecureKeyManager,
        ) {
                super();

                this._baseUrl = configurationService.getValue<string>('construct.cloud.baseUrl') || DEFAULT_CLOUD_BASE_URL;
                // Resolve key through ISecureKeyManager (OS keychain — single source of truth)
                this._resolveApiKey();

                // Listen for key changes and re-resolve
                this._register(this._keyManager.onDidChangeKey(() => {
                        this._resolveApiKey();
                }));

                // SEC-5: Redact any potential secrets from log output
                this.logService.info(redactSecrets('[CloudProvider] Initialized (baseUrl: ' + this._baseUrl + ', backend: ' + (this.isAnthropicKey ? 'Anthropic' : 'OpenAI-compatible') + ')'));
        }

        /**
         * Resolve API key through ISecureKeyManager (OS keychain — single source of truth).
         * No plaintext fallback: keys must come from secure storage.
         */
        private async _resolveApiKey(): Promise<void> {
                // ISecureKeyManager is the ONLY source of API keys.
                // Plaintext storage in IStorageService/state.vscdb is no longer used.
                try {
                        const activeProvider = await this._keyManager.getActiveProvider();
                        if (activeProvider && (activeProvider.provider === 'openai' || activeProvider.provider === 'anthropic' || activeProvider.provider === 'litellm' || activeProvider.provider === 'custom')) {
                                const key = await this._keyManager.getKey(activeProvider.provider);
                                if (key) {
                                        this._apiKey = key;
                                        return;
                                }
                        }

                        // If no active provider, try all cloud-capable providers
                        const cloudProviders: LLMProvider[] = ['openai', 'anthropic', 'litellm', 'custom'];
                        for (const provider of cloudProviders) {
                                const key = await this._keyManager.getKey(provider);
                                if (key) {
                                        this._apiKey = key;
                                        return;
                                }
                        }
                } catch {
                        // ISecureKeyManager may not be available in all contexts
                }

                // No key found in secure storage — user must configure one via SecureKeyManager
                this._apiKey = '';
        }

        /** Whether the configured API key is for the Anthropic API. */
        private get isAnthropicKey(): boolean {
                return this._apiKey.startsWith('sk-ant-');
        }

        isOffline(): boolean {
                return false;
        }

        async checkStatus(): Promise<ProviderStatus> {
                // P0-2 FIX: Always resolve key from secure storage before checking
                await this._resolveApiKey();

                if (!this._apiKey) {
                        this._setStatus(ProviderStatus.NoModels);
                        return this._status;
                }

                // Anthropic backend: check via a lightweight models request
                if (this.isAnthropicKey) {
                        return this.checkAnthropicStatus();
                }

                return this.checkOpenAIStatus();
        }

        /**
         * Check Anthropic API status by making a minimal request.
         * Anthropic doesn't have a /models endpoint, so we report Available
         * if the key format looks valid.
         */
        private async checkAnthropicStatus(): Promise<ProviderStatus> {
                // Anthropic doesn't have a public models listing endpoint.
                // If the key format is valid (starts with sk-ant-), report Available.
                if (this._apiKey.startsWith('sk-ant-')) {
                        // Provide known Anthropic models
                        this._customModels = [
                                {
                                        id: DEFAULT_ANTHROPIC_MODEL,
                                        displayName: 'Claude Sonnet 4',
                                        provider: 'cloud' as AIProviderType,
                                        contextWindowTokens: 200_000,
                                        supportsTools: true,
                                        supportsStreaming: true,
                                },
                                {
                                        id: 'claude-3-5-sonnet-20241022',
                                        displayName: 'Claude 3.5 Sonnet',
                                        provider: 'cloud' as AIProviderType,
                                        contextWindowTokens: 200_000,
                                        supportsTools: true,
                                        supportsStreaming: true,
                                },
                                {
                                        id: 'claude-3-5-haiku-20241022',
                                        displayName: 'Claude 3.5 Haiku',
                                        provider: 'cloud' as AIProviderType,
                                        contextWindowTokens: 200_000,
                                        supportsTools: true,
                                        supportsStreaming: true,
                                },
                        ];

                        if (!this._activeModel) {
                                const configuredModel = this.configurationService.getValue<string>('construct.anthropic.model') || DEFAULT_ANTHROPIC_MODEL;
                                const found = this._customModels.find(m => m.id === configuredModel);
                                await this.setActiveModel(found ? found.id : this._customModels[0].id);
                        }

                        this._setStatus(ProviderStatus.Available);
                        return this._status;
                }

                this._setStatus(ProviderStatus.NoModels);
                return this._status;
        }

        /**
         * Check OpenAI-compatible API status via /models endpoint.
         */
        private async checkOpenAIStatus(): Promise<ProviderStatus> {
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
                                contextWindowTokens: 128_000,
                                supportsTools: true,
                                supportsStreaming: true,
                        }));

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

                // Return default models based on backend
                if (this.isAnthropicKey) {
                        return [
                                {
                                        id: DEFAULT_ANTHROPIC_MODEL,
                                        displayName: 'Claude Sonnet 4',
                                        provider: 'cloud' as AIProviderType,
                                        contextWindowTokens: 200_000,
                                        supportsTools: true,
                                        supportsStreaming: true,
                                },
                                {
                                        id: 'claude-3-5-sonnet-20241022',
                                        displayName: 'Claude 3.5 Sonnet',
                                        provider: 'cloud' as AIProviderType,
                                        contextWindowTokens: 200_000,
                                        supportsTools: true,
                                        supportsStreaming: true,
                                },
                        ];
                }

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

        // P5: Get token usage for the current session
        getTokenUsage(): ITokenUsage {
                return { ...this._tokenUsage };
        }

        // P5: Get last streamed text for recovery purposes
        getLastStreamedText(): string {
                return this._lastStreamedText;
        }

        // P5: Get last streamed tool calls for recovery purposes
        getLastStreamedToolCalls(): Array<{ id: string; name: string; input: string }> {
                return [...this._lastStreamedToolCalls];
        }

        // P5: Update token usage estimate from streaming events
        private updateTokenUsage(promptChars: number, completionChars: number): void {
                // Estimate: 1 token ≈ 4 characters
                const promptTokens = Math.ceil(promptChars / 4);
                const completionTokens = Math.ceil(completionChars / 4);
                this._tokenUsage.promptTokens += promptTokens;
                this._tokenUsage.completionTokens += completionTokens;
                // Rough cost estimate: GPT-4o-mini = $0.15/1M input, $0.60/1M output
                const inputCost = (promptTokens / 1_000_000) * 0.15;
                const outputCost = (completionTokens / 1_000_000) * 0.60;
                this._tokenUsage.totalCost += inputCost + outputCost;
        }

        // P5: Provider health check — ping the API to verify the key is valid
        async checkProviderHealth(): Promise<boolean> {
                try {
                        await this._resolveApiKey();
                        if (!this._apiKey) { return false; }

                        if (this.isAnthropicKey) {
                                // Anthropic: send a minimal request to verify key
                                const controller = new AbortController();
                                const timeout = setTimeout(() => controller.abort(), 5000);
                                const response = await fetch(ANTHROPIC_API_URL, {
                                        method: 'POST',
                                        headers: {
                                                'Content-Type': 'application/json',
                                                'x-api-key': this._apiKey,
                                                'anthropic-version': '2023-06-01',
                                                'anthropic-dangerous-direct-browser-access': 'true',
                                        },
                                        body: JSON.stringify({
                                                model: this._activeModel?.id ?? DEFAULT_ANTHROPIC_MODEL,
                                                max_tokens: 1,
                                                messages: [{ role: 'user', content: 'ping' }],
                                        }),
                                        signal: controller.signal,
                                });
                                clearTimeout(timeout);
                                return response.ok || response.status === 400; // 400 = valid key, bad request
                        } else {
                                // OpenAI-compatible: hit /models endpoint
                                const controller = new AbortController();
                                const timeout = setTimeout(() => controller.abort(), 5000);
                                const response = await fetch(this._baseUrl + '/models', {
                                        headers: { 'Authorization': 'Bearer ' + this._apiKey },
                                        signal: controller.signal,
                                });
                                clearTimeout(timeout);
                                return response.ok;
                        }
                } catch {
                        return false;
                }
        }

        // P5: Fallback chain — try next configured provider
        async attemptFallbackChain(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): Promise<AsyncIterable<AIStreamEvent> | null> {
                // If Anthropic key fails, try OpenAI and vice versa
                // This is a simple single-hop fallback for now
                const providers: AIProviderType[] = this.isAnthropicKey
                        ? ['cloud'] // Would need a separate OpenAI key for true fallback
                        : ['cloud'];

                for (const provider of providers) {
                        const health = this._providerHealth.get(provider);
                        if (health && !health.healthy) { continue; }

                        // If we're already using this provider, skip
                        if (provider === 'cloud' && this.providerType === 'cloud') { continue; }

                        this.logService.info('[CloudProvider] Attempting fallback to ' + provider);
                        // Note: Full fallback chain would require a second API key.
                        // For now, log and return null.
                }

                return null;
        }

        async *chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                // P0-2 FIX: Resolve key before chat
                await this._resolveApiKey();

                if (!this._activeModel) {
                        yield { type: 'error', text: 'No model selected. Please select a model in the CONSTRUCT model picker.' };
                        return;
                }

                if (!this._apiKey) {
                        yield { type: 'error', text: 'Cloud API key not configured. Please set your API key in Construct settings.' };
                        return;
                }

                // Route to the appropriate backend based on API key
                if (this.isAnthropicKey) {
                        yield* this.chatAnthropic(messages, tools, options);
                } else {
                        yield* this.chatOpenAI(messages, tools, options);
                }
        }

        /**
         * Chat using the Anthropic Messages API.
         * Converts unified messages to Anthropic format and parses their SSE stream.
         */
        private async *chatAnthropic(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                // Convert unified messages to Anthropic format
                const anthropicMessages = this.convertToAnthropicMessages(messages);
                const anthropicTools = this.convertToAnthropicTools(tools);

                const body: Record<string, unknown> = {
                        model: this._activeModel!.id,
                        max_tokens: options?.maxTokens ?? 8192,
                        messages: anthropicMessages,
                        stream: true,
                };

                if (options?.systemPrompt) {
                        body.system = options.systemPrompt;
                }

                if (anthropicTools.length > 0) {
                        body.tools = anthropicTools;
                }

                let retryCount = 0;

                while (retryCount <= MAX_RETRIES) {
                        try {
                                const response = await fetch(ANTHROPIC_API_URL, {
                                        method: 'POST',
                                        headers: {
                                                'Content-Type': 'application/json',
                                                'x-api-key': this._apiKey,
                                                'anthropic-version': '2023-06-01',
                                                'anthropic-dangerous-direct-browser-access': 'true',
                                        },
                                        body: JSON.stringify(body),
                                        signal: options?.signal,
                                });

                                if (response.status === 401) {
                                        throw new ConstructAuthError('Anthropic API key is invalid. Please check your settings.');
                                }

                                if (response.status === 529) {
                                        throw new ConstructOverloadedError('Anthropic API is overloaded. Please try again later.');
                                }

                                if (response.status === 429) {
                                        retryCount++;
                                        if (retryCount > MAX_RETRIES) {
                                                const retryAfterHeader = response.headers.get('retry-after');
                                                const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
                                                throw new ConstructRateLimitError('Rate limited by Anthropic API. Please try again later.', retryAfter);
                                        }
                                        const backoffMs = Math.pow(2, retryCount) * 1000;
                                        yield { type: 'error', text: 'Rate limited. Retrying in ' + (backoffMs / 1000) + 's...' };
                                        await this.sleep(backoffMs, options?.signal);
                                        continue;
                                }

                                if (response.status >= 500) {
                                        retryCount++;
                                        if (retryCount > MAX_RETRIES) {
                                                throw new ConstructOverloadedError('Anthropic API server error (' + response.status + ').');
                                        }
                                        await this.sleep(Math.pow(2, retryCount) * 1000, options?.signal);
                                        continue;
                                }

                                if (!response.ok) {
                                        const errorText = await response.text();
                                        yield { type: 'error', text: 'Anthropic API error (' + response.status + '): ' + errorText };
                                        return;
                                }

                                if (!response.body) {
                                        yield { type: 'error', text: 'No response body from Anthropic API.' };
                                        return;
                                }

                                // Parse Anthropic SSE stream
                                // P5: Streaming error recovery — track last known good state
                                let currentToolId: string | null = null;
                                let currentToolName: string | null = null;
                                let currentToolInput = '';
                                let streamedText = '';
                                let streamedToolCalls: Array<{ id: string; name: string; input: string }> = [];

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
                                                        if (jsonStr === '[DONE]') { continue; }

                                                        let chunk: IAnthropicSSEChunk;
                                                        try {
                                                                chunk = JSON.parse(jsonStr) as IAnthropicSSEChunk;
                                                        } catch {
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
                                                                        streamedText += delta.text; // P5: track for recovery
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
                                                                        // P5: Track for streaming recovery
                                                                        streamedToolCalls.push({ id: currentToolId, name: currentToolName, input: currentToolInput });
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
                                                                        // P5: Update token usage on completion
                                                                        const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
                                                                        this.updateTokenUsage(promptChars, streamedText.length);
                                                                        yield { type: 'done', stopReason: delta.stop_reason };
                                                                }
                                                        } else if (eventType === 'error') {
                                                                yield { type: 'error', text: chunk.error?.message ?? 'Unknown streaming error' };
                                                        }
                                                }
                                        }
                                } finally {
                                        // P5: Save last known good state for potential recovery
                                        this._lastStreamedText = streamedText;
                                        this._lastStreamedToolCalls = streamedToolCalls;
                                        reader.releaseLock();
                                }

                                return;

                        } catch (error: unknown) {
                                if (error instanceof DOMException && error.name === 'AbortError') {
                                        yield { type: 'error', text: 'Request cancelled.' };
                                        return;
                                }

                                // Re-throw typed errors (auth, rate limit, overloaded) without retrying
                                if (error instanceof ConstructAuthError || error instanceof ConstructRateLimitError || error instanceof ConstructOverloadedError) {
                                        yield { type: 'error', text: error.message };
                                        return;
                                }

                                retryCount++;
                                if (retryCount > MAX_RETRIES) {
                                        yield { type: 'error', text: 'Anthropic connection failed: ' + (error instanceof Error ? error.message : String(error)) };
                                        return;
                                }

                                await this.sleep(Math.pow(2, retryCount) * 1000, options?.signal);
                        }
                }
        }

        /**
         * Chat using the OpenAI-compatible chat completions API.
         */
        private async *chatOpenAI(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

                const body: Record<string, unknown> = {
                        model: this._activeModel!.id,
                        messages: openaiMessages,
                        stream: true,
                        max_tokens: options?.maxTokens ?? 4096,
                        temperature: options?.temperature ?? 0.7,
                };

                if (tools.length > 0 && this._activeModel!.supportsTools) {
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

                                if (response.status === 401) {
                                        yield { type: 'error', text: 'Cloud API key is invalid. Please check your settings.' };
                                        return;
                                }

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
                                                                if (delta.content && typeof delta.content === 'string') {
                                                                        yield { type: 'token', text: delta.content as string };
                                                                }

                                                                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                                                                        for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
                                                                                const func = tc.function as Record<string, unknown> | undefined;

                                                                                if (tc.id) {
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

                if (this.isAnthropicKey) {
                        return this.completeAnthropic(prefix, options);
                }

                return this.completeOpenAI(prefix, options);
        }

        /**
         * Complete using Anthropic API (non-streaming).
         */
        private async completeAnthropic(prefix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                const body: Record<string, unknown> = {
                        model: this._activeModel!.id,
                        max_tokens: options?.maxTokens ?? 128,
                        messages: [
                                { role: 'user', content: 'Complete the following code. Only output the completion, no explanation:\n\n' + prefix },
                        ],
                        stream: false,
                };

                try {
                        const response = await fetch(ANTHROPIC_API_URL, {
                                method: 'POST',
                                headers: {
                                        'Content-Type': 'application/json',
                                        'x-api-key': this._apiKey,
                                        'anthropic-version': '2023-06-01',
                                        'anthropic-dangerous-direct-browser-access': 'true',
                                },
                                body: JSON.stringify(body),
                                signal: options?.signal,
                        });

                        if (!response.ok) {
                                return { text: '', finished: true };
                        }

                        const data = await response.json() as {
                                content?: Array<{ type: string; text?: string }>;
                                stop_reason?: string;
                        };

                        const textBlock = data.content?.find(b => b.type === 'text');
                        const text = textBlock?.text ?? '';
                        return { text, finished: data.stop_reason === 'end_turn' };
                } catch {
                        return { text: '', finished: true };
                }
        }

        /**
         * Complete using OpenAI-compatible API (non-streaming).
         */
        private async completeOpenAI(prefix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                const body: Record<string, unknown> = {
                        model: this._activeModel!.id,
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
         * Convert unified messages to Anthropic Messages API format.
         * Anthropic uses content blocks (tool_use, tool_result) instead of
         * separate message roles for tool calls.
         */
        private convertToAnthropicMessages(messages: IChatMessage[]): Array<Record<string, unknown>> {
                const result: Array<Record<string, unknown>> = [];

                for (const msg of messages) {
                        if (msg.role === 'system') {
                                // System messages are handled via the top-level 'system' field, skip here
                                continue;
                        } else if (msg.role === 'user') {
                                result.push({ role: 'user', content: msg.content });
                        } else if (msg.role === 'assistant') {
                                // Build content blocks for assistant messages with tool calls
                                const contentBlocks: Array<Record<string, unknown>> = [];
                                if (msg.content) {
                                        contentBlocks.push({ type: 'text', text: msg.content });
                                }
                                if (msg.toolCalls && msg.toolCalls.length > 0) {
                                        for (const tc of msg.toolCalls) {
                                                let parsedArgs: unknown = {};
                                                try {
                                                        parsedArgs = JSON.parse(tc.arguments);
                                                } catch {
                                                        parsedArgs = { raw: tc.arguments };
                                                }
                                                contentBlocks.push({
                                                        type: 'tool_use',
                                                        id: tc.id,
                                                        name: tc.name,
                                                        input: parsedArgs,
                                                });
                                        }
                                }
                                result.push({
                                        role: 'assistant',
                                        content: contentBlocks.length > 0 ? contentBlocks : msg.content,
                                });
                        } else if (msg.role === 'tool') {
                                // Anthropic wraps tool results in a user message with tool_result content blocks
                                result.push({
                                        role: 'user',
                                        content: [{
                                                type: 'tool_result',
                                                tool_use_id: msg.toolCallId,
                                                content: msg.content,
                                        }],
                                });
                        }
                }

                // Anthropic requires the conversation to start with a user message
                // Remove any leading assistant messages
                while (result.length > 0 && (result[0] as { role: string }).role !== 'user') {
                        result.shift();
                }

                return result;
        }

        /**
         * Convert unified tool definitions to Anthropic tool format.
         */
        private convertToAnthropicTools(tools: IToolDefinition[]): Array<Record<string, unknown>> {
                return tools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.inputSchema,
                }));
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
                                parameters: tool.inputSchema,
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
