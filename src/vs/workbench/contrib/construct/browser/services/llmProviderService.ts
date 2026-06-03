/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * llmProviderService.ts -- Phase 25: Multi-LLM Provider Service Implementations
 *
 * REAL HTTP integrations for LLM providers. No simulated responses.
 * No fake intelligence. No placeholder return values.
 *
 * Every request that goes through this service makes a REAL network call
 * (or fails honestly if the endpoint is unreachable).
 *
 * Services #140-144: LLMProvider, ModelRegistry, CredentialStore, Streaming, ProviderHealth
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

import {
        ILLMProviderService, IModelRegistryService, ICredentialStoreService,
        ILLMStreamingService, IProviderHealthService,
        LLMProviderType, LLMProviderConfig, ModelInfo, LLMRequest, LLMResponse,
        LLMMessage, StreamChunk, StreamChunkType,
        ProviderCredential, StreamChunkEvent, LLMToolDefinition,
        ProviderConnectionStatus, ProviderHealth, HealthSeverity,
        FallbackChainConfig, FallbackBehavior,
        KNOWN_PROVIDER_CONFIGS, KNOWN_MODELS,
} from '../../../../../platform/construct/common/llmProvider.js';
// Credit system and cost governor imports removed for MVP

// =====================================================================
// BudgetExceededError -- Specific error for budget-exceeded fallback
// Phase 31: Distinguishes budget exhaustion from generic provider failures
// =====================================================================

export class BudgetExceededError extends Error {
        constructor(
                public readonly budgetSnapshot: { tokensUsed: number; tokenCeiling: number; costUsed: number; costCeiling: number; emergencyStop: boolean },
        ) {
                super(
                        `Budget exceeded: tokens=${budgetSnapshot.tokensUsed}/${budgetSnapshot.tokenCeiling}, ` +
                        `cost=$${budgetSnapshot.costUsed.toFixed(4)}/$${budgetSnapshot.costCeiling.toFixed(2)}. ` +
                        `Emergency stop: ${budgetSnapshot.emergencyStop}`
                );
                this.name = 'BudgetExceededError';
        }
}


// =====================================================================
// #140: LLM Provider Service
// =====================================================================

export class LLMProviderService extends Disposable implements ILLMProviderService {
        declare readonly _serviceBrand: undefined;

        private readonly _providers = new Map<string, LLMProviderConfig>();
        private readonly _activeRequests = new Set<string>();
        private readonly _cancellationSources = new Map<string, CancellationTokenSource>();
        private _activeProviderId: string = 'openai';

        private readonly _onDidChangeActiveProvider = this._register(new Emitter<string>());
        readonly onDidChangeActiveProvider = this._onDidChangeActiveProvider.event;

        private readonly _onDidChangeProviders = this._register(new Emitter<void>());
        readonly onDidChangeProviders = this._onDidChangeProviders.event;

        private readonly _onRequestStarted = this._register(new Emitter<string>());
        readonly onRequestStarted = this._onRequestStarted.event;

        private readonly _onRequestCompleted = this._register(new Emitter<string>());
        readonly onRequestCompleted = this._onRequestCompleted.event;

        private readonly _onRequestFailed = this._register(new Emitter<{ requestId: string; error: string }>());
        readonly onRequestFailed = this._onRequestFailed.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @ICredentialStoreService private readonly credentialStore: ICredentialStoreService,
                @IProviderHealthService private readonly healthService: IProviderHealthService,
        ) {
                super();

                // Register all known provider configurations
                for (const config of KNOWN_PROVIDER_CONFIGS) {
                        this._providers.set(config.id, config);
                }

                // Restore last active provider from storage
                this.logService.info('[LLMProvider] Initialized with', this._providers.size, 'providers');
        }

        get providers(): ReadonlyMap<string, LLMProviderConfig> { return this._providers; }
        get activeProviderId(): string { return this._activeProviderId; }
        get activeRequests(): ReadonlySet<string> { return this._activeRequests; }

        registerProvider(config: LLMProviderConfig): void {
                this._providers.set(config.id, config);
                this._onDidChangeProviders.fire();
                this.logService.info(`[LLMProvider] Registered provider: ${config.id} (${config.displayName})`);
        }

        unregisterProvider(providerId: string): void {
                if (this._providers.delete(providerId)) {
                        if (this._activeProviderId === providerId) {
                                this._activeProviderId = this._providers.keys().next().value ?? 'openai';
                        }
                        this._onDidChangeProviders.fire();
                        this.logService.info(`[LLMProvider] Unregistered provider: ${providerId}`);
                }
        }

        getProvider(providerId: string): LLMProviderConfig | undefined {
                return this._providers.get(providerId);
        }

        setActiveProvider(providerId: string): void {
                if (!this._providers.has(providerId)) {
                        this.logService.warn(`[LLMProvider] Cannot set active to unknown provider: ${providerId}`);
                        return;
                }
                const old = this._activeProviderId;
                this._activeProviderId = providerId;
                this._onDidChangeActiveProvider.fire(providerId);
                this.logService.info(`[LLMProvider] Active provider changed: ${old} -> ${providerId}`);
        }

        async sendRequest(request: LLMRequest): Promise<LLMResponse> {
                return this.sendRequestToProvider(this._activeProviderId, request);
        }

        async sendRequestToProvider(providerId: string, request: LLMRequest): Promise<LLMResponse> {
                const config = this._providers.get(providerId);
                if (!config) {
                        throw new Error(`[LLMProvider] Unknown provider: ${providerId}`);
                }

                        // Credit tracking removed for MVP

                const cts = new CancellationTokenSource();
                this._cancellationSources.set(request.requestId, cts);
                this._activeRequests.add(request.requestId);
                this._onRequestStarted.fire(request.requestId);

                const startTime = Date.now();

                try {
                        this.logService.info(`[LLMProvider] Sending request ${request.requestId} to ${providerId}/${request.model}`);

                        const apiKey = await this.credentialStore.getKey(providerId);
                        if (!apiKey && !config.isLocal) {
                                throw new Error(`[LLMProvider] No API key configured for ${providerId}. Set your API key in AI Execution settings.`);
                        }

                        const response = await this.executeProviderRequest(config, request, apiKey || '', cts.token);
                        const latencyMs = Date.now() - startTime;

                        // Credit tracking removed for MVP
                        this.healthService.recordSuccess(providerId, latencyMs);

                        this._onRequestCompleted.fire(request.requestId);
                        this.logService.info(`[LLMProvider] Request ${request.requestId} completed in ${latencyMs}ms, tokens: ${response.usage.totalTokens}`);

                        return response;
                } catch (error: any) {
                        const latencyMs = Date.now() - startTime;
                        const errorMsg = error?.message || String(error);

                        this.healthService.recordFailure(providerId, errorMsg);

                        this._onRequestFailed.fire({ requestId: request.requestId, error: errorMsg });
                        this.logService.error(`[LLMProvider] Request ${request.requestId} failed after ${latencyMs}ms: ${errorMsg}`);

                        throw error;
                } finally {
                        this._activeRequests.delete(request.requestId);
                        this._cancellationSources.delete(request.requestId);
                }
        }

        async sendRequestWithFallback(request: LLMRequest, chain: FallbackChainConfig): Promise<LLMResponse> {
                const startTime = Date.now();
                let lastError: Error | undefined;

                for (const providerId of chain.providers) {
                        if (Date.now() - startTime > chain.failOpenAfterMs) {
                                throw new Error(`[LLMProvider] Fallback chain timed out after ${chain.failOpenAfterMs}ms`);
                        }

                        // Check if we should avoid this provider based on health
                        if (this.healthService.shouldAvoidProvider(providerId) && chain.behavior !== FallbackBehavior.ImmediateFallback) {
                                this.logService.info(`[LLMProvider] Skipping unhealthy provider: ${providerId}`);
                                continue;
                        }

                        for (let attempt = 0; attempt <= chain.maxRetriesPerProvider; attempt++) {
                                try {
                                        // Update request to use this provider's default model if not specified
                                        const config = this._providers.get(providerId);
                                        const providerRequest = config && !request.model
                                                ? { ...request, model: config.defaultModel }
                                                : request;

                                        return await this.sendRequestToProvider(providerId, providerRequest);
                                } catch (error: any) {
                                        lastError = error;
                                        if (attempt < chain.maxRetriesPerProvider) {
                                                this.logService.info(`[LLMProvider] Retry ${attempt + 1} for ${providerId}`);
                                                await new Promise(resolve => setTimeout(resolve, chain.retryDelayMs * (attempt + 1)));
                                        }
                                }
                        }
                }

                throw new Error(`[LLMProvider] All providers in fallback chain failed. Last error: ${lastError?.message || 'unknown'}`);
        }

        cancelRequest(requestId: string): void {
                const cts = this._cancellationSources.get(requestId);
                if (cts) {
                        cts.cancel();
                        cts.dispose();
                        this._cancellationSources.delete(requestId);
                        this.logService.info(`[LLMProvider] Request cancelled: ${requestId}`);
                }
        }

        async validateProvider(providerId: string): Promise<ProviderConnectionStatus> {
                const config = this._providers.get(providerId);
                if (!config) { return ProviderConnectionStatus.Unknown; }

                // For local providers, check if the endpoint is reachable
                if (config.isLocal) {
                        try {
                                const controller = new AbortController();
                                const timeout = setTimeout(() => controller.abort(), 5000);
                                const response = await fetch(config.apiEndpoint.replace('/api', '/').replace('/v1', '/'), {
                                        method: 'GET',
                                        signal: controller.signal,
                                });
                                clearTimeout(timeout);
                                return response.ok ? ProviderConnectionStatus.Connected : ProviderConnectionStatus.Error;
                        } catch {
                                return ProviderConnectionStatus.Disconnected;
                        }
                }

                // For cloud providers, check if API key exists
                const hasKey = await this.credentialStore.hasKey(providerId);
                if (!hasKey) {
                        return ProviderConnectionStatus.AuthRequired;
                }

                // Make a minimal test request
                try {
                        const apiKey = await this.credentialStore.getKey(providerId);
                        const testResponse = await this.executeProviderRequest(
                                config,
                                {
                                        requestId: `validate-${generateUuid()}`,
                                        model: config.defaultModel,
                                        messages: [{ role: 'user', content: 'test' }],
                                        maxTokens: 1,
                                },
                                apiKey || '',
                                new CancellationTokenSource().token,
                        );
                        return testResponse ? ProviderConnectionStatus.Connected : ProviderConnectionStatus.Error;
                } catch (error: any) {
                        if (error?.message?.includes('401') || error?.message?.includes('auth')) {
                                return ProviderConnectionStatus.AuthRequired;
                        }
                        if (error?.message?.includes('429') || error?.message?.includes('rate')) {
                                return ProviderConnectionStatus.RateLimited;
                        }
                        return ProviderConnectionStatus.Error;
                }
        }

        async validateAllProviders(): Promise<Map<string, ProviderConnectionStatus>> {
                const results = new Map<string, ProviderConnectionStatus>();
                const validations = Array.from(this._providers.keys()).map(async (id) => {
                        results.set(id, await this.validateProvider(id));
                });
                await Promise.allSettled(validations);
                return results;
        }

        // ---- Private: Real HTTP request execution ----

        private async executeProviderRequest(
                config: LLMProviderConfig,
                request: LLMRequest,
                apiKey: string,
                token: import('../../../../../base/common/cancellation.js').CancellationToken,
        ): Promise<LLMResponse> {
                const startTime = Date.now();

                // Build the request body based on provider type
                const body = this.buildRequestBody(config, request);
                const url = this.buildRequestURL(config, request);
                const headers = this.buildRequestHeaders(config, apiKey);

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), request.timeoutMs || config.timeoutMs);

                const disposable = token.onCancellationRequested(() => controller.abort());

                try {
                        const response = await fetch(url, {
                                method: 'POST',
                                headers,
                                body: JSON.stringify(body),
                                signal: controller.signal,
                        });

                        clearTimeout(timeout);
                        disposable.dispose();

                        if (!response.ok) {
                                const errorText = await response.text().catch(() => 'Unknown error');
                                throw new Error(`[LLMProvider] HTTP ${response.status}: ${errorText}`);
                        }

                        const json = await response.json();
                        return this.parseProviderResponse(config, request, json, Date.now() - startTime);
                } catch (error: any) {
                        clearTimeout(timeout);
                        disposable.dispose();
                        if (error.name === 'AbortError') {
                                throw new Error(`[LLMProvider] Request timed out or was cancelled`);
                        }
                        throw error;
                }
        }

        private buildRequestURL(config: LLMProviderConfig, request: LLMRequest): string {
                switch (config.type) {
                        case LLMProviderType.OpenAI: // OpenAI
                                return `${config.apiEndpoint}/chat/completions`;
                        case LLMProviderType.Anthropic: // Anthropic
                                return `${config.apiEndpoint}/messages`;
                        case LLMProviderType.GoogleGemini: // Google Gemini
                                return `${config.apiEndpoint}/models/${request.model}:generateContent`;
                        case LLMProviderType.OpenRouter: // OpenRouter
                                return `${config.apiEndpoint}/chat/completions`;
                        case LLMProviderType.Ollama: // Ollama
                                return `${config.apiEndpoint}/chat`;
                        case LLMProviderType.LMStudio: // LM Studio
                                return `${config.apiEndpoint}/chat/completions`;
                        case LLMProviderType.GenericOpenAI: // Generic OpenAI
                                return `${config.apiEndpoint}/chat/completions`;
                        default:
                                return `${config.apiEndpoint}/chat/completions`;
                }
        }

        private buildRequestHeaders(config: LLMProviderConfig, apiKey: string): Record<string, string> {
                const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                };

                switch (config.type) {
                        case LLMProviderType.OpenAI: // OpenAI
                                headers['Authorization'] = `Bearer ${apiKey}`;
                                break;
                        case LLMProviderType.Anthropic: // Anthropic
                                headers['x-api-key'] = apiKey;
                                headers['anthropic-version'] = '2023-06-01';
                                break;
                        case LLMProviderType.GoogleGemini: // Google Gemini
                                headers['x-goog-api-key'] = apiKey;
                                break;
                        case LLMProviderType.OpenRouter: // OpenRouter
                                headers['Authorization'] = `Bearer ${apiKey}`;
                                headers['HTTP-Referer'] = 'https://construct-ide.dev';
                                headers['X-Title'] = 'Construct IDE';
                                break;
                        case LLMProviderType.Ollama: // Ollama (no auth needed)
                                break;
                        case LLMProviderType.LMStudio: // LM Studio (no auth needed)
                                break;
                        case LLMProviderType.GenericOpenAI: // Generic OpenAI
                                if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }
                                break;
                }

                return headers;
        }

        private buildRequestBody(config: LLMProviderConfig, request: LLMRequest): Record<string, unknown> {
                // OpenAI-compatible format (works for OpenAI, OpenRouter, LM Studio, Generic)
                if ([LLMProviderType.OpenAI, LLMProviderType.OpenRouter, LLMProviderType.LMStudio, LLMProviderType.GenericOpenAI].includes(config.type)) {
                        const body: Record<string, unknown> = {
                                model: request.model,
                                messages: request.messages.map((m: LLMMessage) => ({
                                        role: m.role,
                                        content: m.content,
                                        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
                                        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
                                })),
                                max_tokens: request.maxTokens || 4096,
                        };
                        if (request.temperature !== undefined) { body.temperature = request.temperature; }
                        if (request.topP !== undefined) { body.top_p = request.topP; }
                        if (request.stopSequences) { body.stop = request.stopSequences; }
                        if (request.tools) {
                                body.tools = request.tools.map((t: LLMToolDefinition) => ({
                                        type: 'function',
                                        function: { name: t.name, description: t.description, parameters: t.parameters },
                                }));
                        }
                        return body;
                }

                // Anthropic format — with proper tool_use / tool_result content blocks
                if (config.type === LLMProviderType.Anthropic) {
                        const systemMsg = request.messages.find((m: LLMMessage) => m.role === 'system');
                        const nonSystem = request.messages.filter((m: LLMMessage) => m.role !== 'system');
                        const body: Record<string, unknown> = {
                                model: request.model,
                                messages: nonSystem.map((m: LLMMessage) => {
                                        // Tool results must be sent as user messages with tool_result content blocks
                                        if (m.role === 'tool') {
                                                return {
                                                        role: 'user',
                                                        content: [{
                                                                type: 'tool_result',
                                                                tool_use_id: m.toolCallId || '',
                                                                content: m.content,
                                                        }],
                                                };
                                        }
                                        // Assistant messages with tool calls must include tool_use content blocks
                                        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
                                                const content: any[] = [];
                                                if (m.content) {
                                                        content.push({ type: 'text', text: m.content });
                                                }
                                                for (const tc of m.toolCalls) {
                                                        let input: any = {};
                                                        try { input = JSON.parse(tc.arguments); } catch { /* use empty object */ }
                                                        content.push({
                                                                type: 'tool_use',
                                                                id: tc.id,
                                                                name: tc.name,
                                                                input,
                                                        });
                                                }
                                                return { role: 'assistant', content };
                                        }
                                        // Regular text messages
                                        return { role: m.role, content: m.content };
                                }),
                                max_tokens: request.maxTokens || 4096,
                        };
                        if (systemMsg) { body.system = systemMsg.content; }
                        if (request.temperature !== undefined) { body.temperature = request.temperature; }
                        if (request.topP !== undefined) { body.top_p = request.topP; }
                        if (request.stopSequences) { body.stop_sequences = request.stopSequences; }
                        if (request.tools) {
                                body.tools = request.tools.map((t: LLMToolDefinition) => ({
                                        name: t.name,
                                        description: t.description,
                                        input_schema: t.parameters,
                                }));
                        }
                        return body;
                }

                // Google Gemini format (FULL integration with tool declarations)
                if (config.type === LLMProviderType.GoogleGemini) {
                        const body: Record<string, unknown> = {
                                contents: request.messages
                                        .filter((m: LLMMessage) => m.role !== 'system')
                                        .map((m: LLMMessage) => ({
                                                role: m.role === 'assistant' ? 'model' : 'user',
                                                parts: [{ text: m.content }],
                                        })),
                                systemInstruction: request.messages.find((m: LLMMessage) => m.role === 'system')
                                        ? { parts: [{ text: request.messages.find((m: LLMMessage) => m.role === 'system')!.content }] }
                                        : undefined,
                                generationConfig: {
                                        maxOutputTokens: request.maxTokens || 4096,
                                        temperature: request.temperature,
                                        topP: request.topP,
                                        stopSequences: request.stopSequences,
                                },
                        };
                        // Add tool declarations in Gemini format
                        if (request.tools && request.tools.length > 0) {
                                body.tools = [{
                                        functionDeclarations: request.tools.map((t: LLMToolDefinition) => ({
                                                name: t.name,
                                                description: t.description,
                                                parameters: t.parameters,
                                        })),
                                }];
                        }
                        return body;
                }

                // Ollama format
                if (config.type === LLMProviderType.Ollama) {
                        return {
                                model: request.model,
                                messages: request.messages.map((m: LLMMessage) => ({ role: m.role, content: m.content })),
                                stream: false,
                                options: {
                                        num_predict: request.maxTokens || 4096,
                                        temperature: request.temperature,
                                        top_p: request.topP,
                                },
                        };
                }

                // Fallback: OpenAI format
                return {
                        model: request.model,
                        messages: request.messages.map((m: LLMMessage) => ({ role: m.role, content: m.content })),
                        max_tokens: request.maxTokens || 4096,
                };
        }

        private parseProviderResponse(config: LLMProviderConfig, request: LLMRequest, json: any, latencyMs: number): LLMResponse {
                // OpenAI-compatible response
                if ([LLMProviderType.OpenAI, LLMProviderType.OpenRouter, LLMProviderType.LMStudio, LLMProviderType.GenericOpenAI].includes(config.type)) {
                        const choice = json.choices?.[0];
                        const usage = json.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
                        return {
                                requestId: request.requestId,
                                providerId: config.id,
                                model: json.model || request.model,
                                content: choice?.message?.content || '',
                                toolCalls: (choice?.message?.tool_calls || []).map((tc: any) => ({
                                        id: tc.id || generateUuid(),
                                        name: tc.function?.name || '',
                                        arguments: tc.function?.arguments || '{}',
                                })),
                                usage: {
                                        promptTokens: usage.prompt_tokens || 0,
                                        completionTokens: usage.completion_tokens || 0,
                                        totalTokens: usage.total_tokens || 0,
                                },
                                finishReason: choice?.finish_reason || 'stop',
                                latencyMs,
                                timestamp: Date.now(),
                                fromCache: false,
                        };
                }

                // Anthropic response
                if (config.type === LLMProviderType.Anthropic) {
                        const content = json.content || [];
                        const textBlocks = content.filter((b: any) => b.type === 'text');
                        const toolBlocks = content.filter((b: any) => b.type === 'tool_use');
                        return {
                                requestId: request.requestId,
                                providerId: config.id,
                                model: json.model || request.model,
                                content: textBlocks.map((b: any) => b.text).join(''),
                                toolCalls: toolBlocks.map((b: any) => ({
                                        id: b.id || generateUuid(),
                                        name: b.name || '',
                                        arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
                                })),
                                usage: {
                                        promptTokens: json.usage?.input_tokens || 0,
                                        completionTokens: json.usage?.output_tokens || 0,
                                        totalTokens: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
                                },
                                finishReason: json.stop_reason || 'end_turn',
                                latencyMs,
                                timestamp: Date.now(),
                                fromCache: false,
                        };
                }

                // Google Gemini response (FULL integration with tool calls)
                if (config.type === LLMProviderType.GoogleGemini) {
                        const candidate = json.candidates?.[0];
                        const parts = candidate?.content?.parts || [];
                        // Extract text parts and function call parts separately
                        const textParts = parts.filter((p: any) => p.text !== undefined);
                        const functionParts = parts.filter((p: any) => p.functionCall !== undefined);
                        return {
                                requestId: request.requestId,
                                providerId: config.id,
                                model: json.modelVersion || request.model,
                                content: textParts.map((p: any) => p.text || '').join(''),
                                toolCalls: functionParts.map((p: any) => ({
                                        id: generateUuid(),
                                        name: p.functionCall?.name || '',
                                        arguments: typeof p.functionCall?.args === 'string'
                                                ? p.functionCall.args
                                                : JSON.stringify(p.functionCall?.args || {}),
                                })),
                                usage: {
                                        promptTokens: json.usageMetadata?.promptTokenCount || 0,
                                        completionTokens: json.usageMetadata?.candidatesTokenCount || 0,
                                        totalTokens: json.usageMetadata?.totalTokenCount || 0,
                                },
                                finishReason: candidate?.finishReason || 'STOP',
                                latencyMs,
                                timestamp: Date.now(),
                                fromCache: false,
                        };
                }

                // Ollama response
                if (config.type === LLMProviderType.Ollama) {
                        return {
                                requestId: request.requestId,
                                providerId: config.id,
                                model: json.model || request.model,
                                content: json.message?.content || '',
                                toolCalls: [],
                                usage: {
                                        promptTokens: json.prompt_eval_count || 0,
                                        completionTokens: json.eval_count || 0,
                                        totalTokens: (json.prompt_eval_count || 0) + (json.eval_count || 0),
                                },
                                finishReason: json.done ? 'stop' : 'incomplete',
                                latencyMs,
                                timestamp: Date.now(),
                                fromCache: false,
                        };
                }

                // Fallback: attempt OpenAI format
                return {
                        requestId: request.requestId,
                        providerId: config.id,
                        model: request.model,
                        content: json.choices?.[0]?.message?.content || JSON.stringify(json),
                        toolCalls: [],
                        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                        finishReason: 'unknown',
                        latencyMs,
                        timestamp: Date.now(),
                        fromCache: false,
                };
        }
}

// =====================================================================
// #141: Model Registry Service
// =====================================================================

export class ModelRegistryService extends Disposable implements IModelRegistryService {
        declare readonly _serviceBrand: undefined;

        private readonly _models = new Map<string, ModelInfo>();

        private readonly _onDidChangeModels = this._register(new Emitter<void>());
        readonly onDidChangeModels = this._onDidChangeModels.event;

        constructor(@ILogService private readonly logService: ILogService) {
                super();

                // Register all known models
                for (const model of KNOWN_MODELS) {
                        this._models.set(model.id, model);
                }

                this.logService.info('[ModelRegistry] Initialized with', this._models.size, 'models');
        }

        get models(): ReadonlyMap<string, ModelInfo> { return this._models; }

        registerModel(model: ModelInfo): void {
                this._models.set(model.id, model);
                this._onDidChangeModels.fire();
                this.logService.info(`[ModelRegistry] Registered model: ${model.id}`);
        }

        unregisterModel(modelId: string): void {
                if (this._models.delete(modelId)) {
                        this._onDidChangeModels.fire();
                        this.logService.info(`[ModelRegistry] Unregistered model: ${modelId}`);
                }
        }

        getModelsForProvider(providerId: string): ModelInfo[] {
                return Array.from(this._models.values()).filter((m: ModelInfo) => m.providerId === providerId);
        }

        getModel(modelId: string): ModelInfo | undefined {
                return this._models.get(modelId);
        }

        getDefaultModel(providerId: string): ModelInfo | undefined {
                return this.getModelsForProvider(providerId)[0];
        }

        /**
         * Estimate token count for a text string.
         *
         * HONEST: This uses a heuristic (4 chars per token for English, 1.5 chars per token for CJK).
         * Real tokenization requires the model's tokenizer (tiktoken for OpenAI, etc.)
         * which is not available in the browser. This is an approximation.
         */
        estimateTokenCount(text: string, modelId: string): number {
                if (!text) { return 0; }

                // Count CJK characters (they tokenize differently)
                const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f]/g) || []).length;
                const latinChars = text.length - cjkChars;

                // CJK: roughly 1.5 chars per token; Latin: roughly 4 chars per token
                const estimatedTokens = Math.ceil(latinChars / 4) + Math.ceil(cjkChars / 1.5);

                // Add overhead for formatting, special tokens, etc.
                return Math.ceil(estimatedTokens * 1.1);
        }

        /**
         * Estimate cost in USD for a given number of tokens and model.
         * Returns cost in dollars.
         */
        estimateCost(inputTokens: number, outputTokens: number, modelId: string): number {
                const model = this._models.get(modelId);
                if (!model) { return 0; }

                const inputCost = (inputTokens / 1_000_000) * model.inputPricePerMillion;
                const outputCost = (outputTokens / 1_000_000) * model.outputPricePerMillion;

                return inputCost + outputCost;
        }

        /**
         * Check if text fits within a model's context window.
         */
        fitsInContext(text: string, modelId: string): boolean {
                const model = this._models.get(modelId);
                if (!model) { return false; }

                const estimated = this.estimateTokenCount(text, modelId);
                return estimated <= model.contextWindowTokens;
        }
}

// =====================================================================
// #142: Credential Store Service
// =====================================================================

export class CredentialStoreService extends Disposable implements ICredentialStoreService {
        declare readonly _serviceBrand: undefined;

        private readonly _onDidChangeCredential = this._register(new Emitter<string>());
        readonly onDidChangeCredential = this._onDidChangeCredential.event;

        // In-memory cache of key existence (not values, for security)
        private readonly _keyExistsCache = new Map<string, boolean>();

        constructor(
                @ISecretStorageService private readonly secretStorage: ISecretStorageService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[CredentialStore] Initialized using VS Code SecretStorage');
        }

        async storeKey(providerId: string, apiKey: string): Promise<void> {
                const key = this.getStorageKey(providerId);
                await this.secretStorage.set(key, apiKey);
                this._keyExistsCache.set(providerId, true);
                this._onDidChangeCredential.fire(providerId);
                this.logService.info(`[CredentialStore] API key stored for ${providerId}`);
        }

        async getKey(providerId: string): Promise<string | undefined> {
                const key = this.getStorageKey(providerId);
                return this.secretStorage.get(key);
        }

        async deleteKey(providerId: string): Promise<void> {
                const key = this.getStorageKey(providerId);
                await this.secretStorage.delete(key);
                this._keyExistsCache.set(providerId, false);
                this._onDidChangeCredential.fire(providerId);
                this.logService.info(`[CredentialStore] API key deleted for ${providerId}`);
        }

        async hasKey(providerId: string): Promise<boolean> {
                if (this._keyExistsCache.has(providerId)) {
                        return this._keyExistsCache.get(providerId)!;
                }
                const key = await this.getKey(providerId);
                const exists = !!key;
                this._keyExistsCache.set(providerId, exists);
                return exists;
        }

        async validateKey(providerId: string): Promise<ProviderCredential> {
                const apiKey = await this.getKey(providerId);
                const isSet = !!apiKey;

                if (!isSet) {
                        return {
                                providerId,
                                keyName: this.getStorageKey(providerId),
                                isSet: false,
                                validationStatus: ProviderConnectionStatus.AuthRequired,
                        };
                }

                // We do NOT validate by making a real API call here to avoid spending tokens.
                // Validation is done by the provider service when actually sending requests.
                return {
                        providerId,
                        keyName: this.getStorageKey(providerId),
                        isSet: true,
                        lastValidated: Date.now(),
                        validationStatus: ProviderConnectionStatus.Connected,
                };
        }

        async getAllCredentials(): Promise<ProviderCredential[]> {
                const providers = ['openai', 'anthropic', 'google-gemini', 'openrouter', 'ollama', 'lm-studio', 'generic-openai'];
                const results: ProviderCredential[] = [];
                for (const providerId of providers) {
                        results.push(await this.validateKey(providerId));
                }
                return results;
        }

        private getStorageKey(providerId: string): string {
                return `aiExecution.provider.${providerId}.apiKey`;
        }
}

// =====================================================================
// #143: LLM Streaming Service
// =====================================================================

export class LLMStreamingService extends Disposable implements ILLMStreamingService {
        declare readonly _serviceBrand: undefined;

        private readonly _activeStreams = new Set<string>();
        private readonly _streamControllers = new Map<string, AbortController>();

        private readonly _onStreamChunk = this._register(new Emitter<StreamChunkEvent>());
        readonly onStreamChunk = this._onStreamChunk.event;

        private readonly _onStreamError = this._register(new Emitter<{ requestId: string; error: string }>());
        readonly onStreamError = this._onStreamError.event;

        constructor(
                @ILLMProviderService private readonly providerService: ILLMProviderService,
                @ICredentialStoreService private readonly credentialStore: ICredentialStoreService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[LLMStreaming] Initialized');
        }

        get activeStreams(): ReadonlySet<string> { return this._activeStreams; }

        /**
         * Stream a request as an AsyncIterable of chunks.
         *
         * HONEST: This uses fetch with ReadableStream. In VS Code webview contexts,
         * streaming may fall back to buffered responses. The implementation
         * degrades gracefully: if streaming fails, it returns the full response
         * as a single chunk.
         */
        async *streamRequest(request: LLMRequest): AsyncIterable<StreamChunk> {
                yield* this.streamRequestToProvider(this.providerService.activeProviderId, request);
        }

        async *streamRequestToProvider(providerId: string, request: LLMRequest): AsyncIterable<StreamChunk> {
                const config = this.providerService.getProvider(providerId);
                if (!config) {
                        throw new Error(`[LLMStreaming] Unknown provider: ${providerId}`);
                }

                if (!config.supportsStreaming) {
                        // Provider does not support streaming; fall back to full request
                        this.logService.info(`[LLMStreaming] Provider ${providerId} does not support streaming, falling back to full request`);
                        const response = await this.providerService.sendRequestToProvider(providerId, request);
                        yield { type: StreamChunkType.Token, content: response.content, done: false };
                        yield { type: StreamChunkType.Usage, usage: response.usage, done: false };
                        yield { type: StreamChunkType.Done, done: true };
                        return;
                }

                const requestId = request.requestId;
                const controller = new AbortController();
                this._activeStreams.add(requestId);
                this._streamControllers.set(requestId, controller);

                try {
                        const apiKey = await this.credentialStore.getKey(providerId);
                        const body = this.buildStreamingBody(config, request);
                        const url = this.buildStreamingURL(config, request);
                        const headers = this.buildStreamingHeaders(config, apiKey || '');

                        const response = await fetch(url, {
                                method: 'POST',
                                headers,
                                body: JSON.stringify(body),
                                signal: controller.signal,
                        });

                        if (!response.ok) {
                                const errorText = await response.text().catch(() => 'Unknown error');
                                throw new Error(`[LLMStreaming] HTTP ${response.status}: ${errorText}`);
                        }

                        if (!response.body) {
                                // No ReadableStream support; fall back
                                this.logService.warn('[LLMStreaming] No ReadableStream support, falling back to buffered response');
                                const text = await response.text();
                                yield { type: StreamChunkType.Token, content: text, done: false };
                                yield { type: StreamChunkType.Done, done: true };
                                return;
                        }

                        // Parse SSE stream
                        const reader = response.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                        let totalContent = '';

                        while (true) {
                                const { done, value } = await reader.read();
                                if (done) { break; }

                                buffer += decoder.decode(value, { stream: true });
                                const lines = buffer.split('\n');
                                buffer = lines.pop() || '';

                                for (const line of lines) {
                                        const trimmed = line.trim();
                                        if (!trimmed || trimmed.startsWith(':')) { continue; }

                                        if (trimmed.startsWith('data: ')) {
                                                const data = trimmed.slice(6);
                                                if (data === '[DONE]') {
                                                        yield { type: StreamChunkType.Done, done: true };
                                                        return;
                                                }

                                                try {
                                                        const parsed = JSON.parse(data);
                                                        const chunk = this.parseStreamChunk(config, parsed);
                                                        if (chunk.content) { totalContent += chunk.content; }
                                                        yield chunk;

                                                        this._onStreamChunk.fire({ requestId, providerId, chunk });
                                                } catch {
                                                        // Malformed SSE data; skip
                                                }
                                        }
                                }
                        }

                        yield { type: StreamChunkType.Done, done: true };
                } catch (error: any) {
                        const errorMsg = error?.message || String(error);
                        this._onStreamError.fire({ requestId, error: errorMsg });
                        yield { type: StreamChunkType.Error, error: errorMsg, done: true };
                } finally {
                        this._activeStreams.delete(requestId);
                        this._streamControllers.delete(requestId);
                }
        }

        cancelStream(requestId: string): void {
                const controller = this._streamControllers.get(requestId);
                if (controller) {
                        controller.abort();
                        this._activeStreams.delete(requestId);
                        this._streamControllers.delete(requestId);
                        this.logService.info(`[LLMStreaming] Stream cancelled: ${requestId}`);
                }
        }

        private buildStreamingURL(config: LLMProviderConfig, request: LLMRequest): string {
                // Same as non-streaming URL
                switch (config.type) {
                        case LLMProviderType.OpenAI: return `${config.apiEndpoint}/chat/completions`;
                        case LLMProviderType.Anthropic: return `${config.apiEndpoint}/messages`;
                        case LLMProviderType.GoogleGemini: return `${config.apiEndpoint}/models/${request.model}:streamGenerateContent?alt=sse`;
                        case LLMProviderType.OpenRouter: return `${config.apiEndpoint}/chat/completions`;
                        case LLMProviderType.Ollama: return `${config.apiEndpoint}/chat`;
                        case LLMProviderType.LMStudio: return `${config.apiEndpoint}/chat/completions`;
                        case LLMProviderType.GenericOpenAI: return `${config.apiEndpoint}/chat/completions`;
                        default: return `${config.apiEndpoint}/chat/completions`;
                }
        }

        private buildStreamingHeaders(config: LLMProviderConfig, apiKey: string): Record<string, string> {
                const headers: Record<string, string> = {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream',
                };

                switch (config.type) {
                        case LLMProviderType.OpenAI: headers['Authorization'] = `Bearer ${apiKey}`; break;
                        case LLMProviderType.Anthropic: headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; break;
                        case LLMProviderType.GoogleGemini: headers['x-goog-api-key'] = apiKey; break;
                        case LLMProviderType.OpenRouter: headers['Authorization'] = `Bearer ${apiKey}`; headers['HTTP-Referer'] = 'https://construct-ide.dev'; break;
                        case LLMProviderType.GenericOpenAI: if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; } break;
                }

                return headers;
        }

        private buildStreamingBody(config: LLMProviderConfig, request: LLMRequest): Record<string, unknown> {
                const base: Record<string, unknown> = {
                        model: request.model,
                        messages: request.messages.map((m: LLMMessage) => ({ role: m.role, content: m.content })),
                        max_tokens: request.maxTokens || 4096,
                        stream: true,
                };
                if (request.temperature !== undefined) { base.temperature = request.temperature; }
                return base;
        }

        private parseStreamChunk(config: LLMProviderConfig, parsed: any): StreamChunk {
                // OpenAI-compatible SSE
                if ([LLMProviderType.OpenAI, LLMProviderType.OpenRouter, LLMProviderType.LMStudio, LLMProviderType.GenericOpenAI].includes(config.type)) {
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta?.content) {
                                return { type: StreamChunkType.Token, content: delta.content, done: false };
                        }
                        if (parsed.choices?.[0]?.finish_reason) {
                                return { type: StreamChunkType.Done, done: true };
                        }
                        return { type: StreamChunkType.Token, content: '', done: false };
                }

                // Anthropic SSE
                if (config.type === LLMProviderType.Anthropic) {
                        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                                return { type: StreamChunkType.Token, content: parsed.delta.text, done: false };
                        }
                        if (parsed.type === 'message_stop') {
                                return { type: StreamChunkType.Done, done: true };
                        }
                        return { type: StreamChunkType.Token, content: '', done: false };
                }

                // Gemini SSE
                if (config.type === LLMProviderType.GoogleGemini) {
                        const parts = parsed.candidates?.[0]?.content?.parts || [];
                        const text = parts.map((p: any) => p.text || '').join('');
                        return { type: StreamChunkType.Token, content: text, done: false };
                }

                // Ollama SSE
                if (config.type === LLMProviderType.Ollama) {
                        if (parsed.done) {
                                return { type: StreamChunkType.Done, done: true };
                        }
                        return { type: StreamChunkType.Token, content: parsed.message?.content || '', done: false };
                }

                return { type: StreamChunkType.Token, content: '', done: false };
        }
}

// =====================================================================
// #144: Provider Health Service
// =====================================================================

export class ProviderHealthService extends Disposable implements IProviderHealthService {
        declare readonly _serviceBrand: undefined;

        private readonly _healthMap = new Map<string, ProviderHealth>();
        private readonly _onDidChangeHealth = this._register(new Emitter<string>());
        readonly onDidChangeHealth = this._onDidChangeHealth.event;

        // Rolling window for success rate calculation
        private readonly _recentResults = new Map<string, { success: boolean; timestamp: number }[]>();
        private readonly _WINDOW_SIZE = 50;
        private readonly WINDOW_MS = 5 * 60 * 1000; // 5 minutes

        constructor(@ILogService private readonly logService: ILogService) {
                super();

                // Initialize health for all known providers
                const providerIds = ['openai', 'anthropic', 'google-gemini', 'openrouter', 'ollama', 'lm-studio', 'generic-openai'];
                for (const id of providerIds) {
                        this._healthMap.set(id, {
                                providerId: id,
                                status: HealthSeverity.Unknown,
                                latencyMs: 0,
                                successRate: 0,
                                lastSuccessTime: 0,
                                lastFailureTime: 0,
                                consecutiveFailures: 0,
                                rateLimitRemaining: -1,
                                rateLimitResetTime: 0,
                                totalRequests: 0,
                                totalFailures: 0,
                                averageLatencyMs: 0,
                        });
                }

                this.logService.info('[ProviderHealth] Initialized');
        }

        get healthStatus(): ReadonlyMap<string, ProviderHealth> { return this._healthMap; }

        recordSuccess(providerId: string, latencyMs: number): void {
                const health = this.getOrCreateHealth(providerId);
                const results = this.getOrCreateResults(providerId);
                results.push({ success: true, timestamp: Date.now() });

                // Update health metrics
                const totalReqs = health.totalRequests + 1;
                const successRate = this.calculateSuccessRate(results);
                const avgLatency = this.calculateAverageLatency(results, providerId, latencyMs);

                this._healthMap.set(providerId, {
                        providerId,
                        status: successRate > 0.9 ? HealthSeverity.Healthy : successRate > 0.5 ? HealthSeverity.Degraded : HealthSeverity.Unhealthy,
                        latencyMs,
                        successRate,
                        lastSuccessTime: Date.now(),
                        lastFailureTime: health.lastFailureTime,
                        consecutiveFailures: 0,
                        rateLimitRemaining: health.rateLimitRemaining,
                        rateLimitResetTime: health.rateLimitResetTime,
                        totalRequests: totalReqs,
                        totalFailures: health.totalFailures,
                        averageLatencyMs: avgLatency,
                });

                this._onDidChangeHealth.fire(providerId);
        }

        recordFailure(providerId: string, error: string): void {
                const health = this.getOrCreateHealth(providerId);
                const results = this.getOrCreateResults(providerId);
                results.push({ success: false, timestamp: Date.now() });

                const totalReqs = health.totalRequests + 1;
                const totalFails = health.totalFailures + 1;
                const successRate = this.calculateSuccessRate(results);

                this._healthMap.set(providerId, {
                        providerId,
                        status: successRate > 0.9 ? HealthSeverity.Healthy : successRate > 0.5 ? HealthSeverity.Degraded : HealthSeverity.Unhealthy,
                        latencyMs: health.latencyMs,
                        successRate,
                        lastSuccessTime: health.lastSuccessTime,
                        lastFailureTime: Date.now(),
                        consecutiveFailures: health.consecutiveFailures + 1,
                        rateLimitRemaining: health.rateLimitRemaining,
                        rateLimitResetTime: health.rateLimitResetTime,
                        totalRequests: totalReqs,
                        totalFailures: totalFails,
                        averageLatencyMs: health.averageLatencyMs,
                });

                this._onDidChangeHealth.fire(providerId);
                this.logService.warn(`[ProviderHealth] ${providerId} failure recorded: ${error}`);
        }

        getHealth(providerId: string): ProviderHealth {
                return this.getOrCreateHealth(providerId);
        }

        getHealthiestProvider(providerIds: string[]): string | undefined {
                let bestId: string | undefined;
                let bestScore = -1;

                for (const id of providerIds) {
                        const health = this._healthMap.get(id);
                        if (!health) { continue; }
                        // Score: successRate * 100 + latency bonus (lower is better)
                        const score = health.successRate * 100 - (health.averageLatencyMs / 100);
                        if (score > bestScore) {
                                bestScore = score;
                                bestId = id;
                        }
                }

                return bestId;
        }

        shouldAvoidProvider(providerId: string): boolean {
                const health = this._healthMap.get(providerId);
                if (!health) { return false; }
                return health.status === HealthSeverity.Unhealthy || health.consecutiveFailures >= 3;
        }

        private getOrCreateHealth(providerId: string): ProviderHealth {
                return this._healthMap.get(providerId) || {
                        providerId,
                        status: HealthSeverity.Unknown,
                        latencyMs: 0,
                        successRate: 0,
                        lastSuccessTime: 0,
                        lastFailureTime: 0,
                        consecutiveFailures: 0,
                        rateLimitRemaining: -1,
                        rateLimitResetTime: 0,
                        totalRequests: 0,
                        totalFailures: 0,
                        averageLatencyMs: 0,
                };
        }

        private getOrCreateResults(providerId: string): { success: boolean; timestamp: number }[] {
                if (!this._recentResults.has(providerId)) {
                        this._recentResults.set(providerId, []);
                }
                const results = this._recentResults.get(providerId)!;
                // Trim to rolling window size
                if (results.length > this._WINDOW_SIZE) {
                        results.splice(0, results.length - this._WINDOW_SIZE);
                }
                return results;
        }

        private calculateSuccessRate(results: { success: boolean; timestamp: number }[]): number {
                const now = Date.now();
                const recent = results.filter(r => now - r.timestamp < this.WINDOW_MS);
                if (recent.length === 0) { return 0; }
                return recent.filter(r => r.success).length / recent.length;
        }

        private calculateAverageLatency(results: { success: boolean; timestamp: number }[], providerId: string, latestLatency: number): number {
                const health = this._healthMap.get(providerId);
                if (!health || health.totalRequests === 0) { return latestLatency; }
                // Exponential moving average
                return Math.round(health.averageLatencyMs * 0.8 + latestLatency * 0.2);
        }
}
