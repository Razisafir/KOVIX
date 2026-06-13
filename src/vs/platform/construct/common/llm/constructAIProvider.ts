/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export class ConstructAuthError extends Error {
        constructor(message: string) {
                super(message);
                this.name = 'ConstructAuthError';
        }
}

export class ConstructRateLimitError extends Error {
        constructor(message: string, public readonly retryAfter?: number) {
                super(message);
                this.name = 'ConstructRateLimitError';
        }
}

export class ConstructNetworkError extends Error {
        constructor(message: string) {
                super(message);
                this.name = 'ConstructNetworkError';
        }
}

export class ConstructOverloadedError extends Error {
        constructor(message: string) {
                super(message);
                this.name = 'ConstructOverloadedError';
        }
}

export class ConstructTimeoutError extends Error {
        constructor(message: string, public readonly timeoutMs: number) {
                super(message);
                this.name = 'ConstructTimeoutError';
        }
}

export class ConstructSecurityError extends Error {
        constructor(message: string, public readonly code?: string) {
                super(message);
                this.name = 'ConstructSecurityError';
        }
}

export const IConstructAIProvider = createDecorator<IConstructAIProvider>('construct.aiProvider');

/**
 * Represents a model available from a provider.
 * Contains identifying information and capabilities needed
 * for model selection in the UI and agent system.
 */
export interface IModelInfo {
        /** Unique identifier for the model (e.g. 'llama3.1:8b', 'claude-sonnet-4-20250514') */
        id: string;
        /** Human-readable name for display in the model picker */
        displayName: string;
        /** The provider that hosts this model */
        provider: AIProviderType;
        /** Approximate context window size in tokens */
        contextWindowTokens: number;
        /** Whether this model supports tool/function calling */
        supportsTools: boolean;
        /** Whether this model supports streaming responses */
        supportsStreaming: boolean;
}

/**
 * A chat message in the unified format used across all providers.
 * Each provider adapter translates between this format and its native API format.
 */
export interface IChatMessage {
        role: 'system' | 'user' | 'assistant' | 'tool';
        content: string;
        /** For tool_result messages: the ID of the tool call this is responding to */
        toolCallId?: string;
        /** For assistant messages: tool calls requested by the model */
        toolCalls?: IToolCall[];
}

/**
 * A tool call requested by the model during a response.
 */
export interface IToolCall {
        /** Unique ID for this tool call */
        id: string;
        /** Name of the tool to invoke */
        name: string;
        /** JSON-encoded arguments for the tool */
        arguments: string;
}

/**
 * A tool definition that can be provided to any provider.
 * Follows the OpenAI function-calling schema convention.
 */
export interface IToolDefinition {
        name: string;
        description: string;
        inputSchema: {
                type: 'object';
                properties: Record<string, unknown>;
                required?: string[];
        };
}

/**
 * Stream events emitted by any AI provider during a streaming response.
 * All providers must yield events in this unified format so the agent
 * loop and UI can consume them without provider-specific logic.
 */
export type AIStreamEvent =
        | { type: 'token'; text: string }
        | { type: 'tool_start'; toolId: string; toolName: string }
        | { type: 'tool_input'; toolId: string; text: string }
        | { type: 'tool_end'; toolId: string; toolName: string; toolInput: unknown }
        | { type: 'done'; stopReason: string }
        | { type: 'error'; text: string };

/**
 * Options for the chat method.
 * Controls behavior of the AI response generation.
 */
export interface IChatOptions {
        /** AbortSignal for cancelling the request */
        signal?: AbortSignal;
        /** System prompt to prepend to the conversation */
        systemPrompt?: string;
        /** Maximum tokens to generate in the response */
        maxTokens?: number;
        /** Temperature for sampling (0.0 = deterministic, 1.0 = creative) */
        temperature?: number;
}

/**
 * Options for the complete method.
 * Used for inline code completion (e.g. Copilot-style suggestions).
 */
export interface ICompleteOptions {
        /** AbortSignal for cancellation */
        signal?: AbortSignal;
        /** Maximum tokens to generate */
        maxTokens?: number;
        /** Temperature for sampling */
        temperature?: number;
        /** Stop sequences that end generation */
        stop?: string[];
}

/**
 * Result of an inline completion request.
 */
export interface ICompleteResult {
        /** The generated completion text */
        text: string;
        /** Whether the completion was truncated due to maxTokens */
        finished: boolean;
}

/**
 * Provider type discriminator.
 * Used to identify which backend is currently active.
 */
export type AIProviderType = 'ollama' | 'xenova' | 'cloud';

/**
 * Status of a provider, used for health checks and auto-selection.
 */
export enum ProviderStatus {
        /** Provider is available and ready to serve requests */
        Available = 'available',
        /** Provider is reachable but no models are loaded/available */
        NoModels = 'noModels',
        /** Provider endpoint is not reachable */
        Unreachable = 'unreachable',
        /** Provider has not been checked yet */
        Unknown = 'unknown',
}

/**
 * IConstructAIProvider — the unified AI provider interface for CONSTRUCT IDE.
 *
 * This is the single abstraction that all AI consumers (agent loop, chat panel,
 * inline completions) use. Concrete implementations (OllamaProvider, XenovaProvider,
 * CloudProvider) adapt their respective backends to this interface.
 *
 * The constructAIService auto-selects the best available provider at startup:
 * 1. Try Ollama (localhost:11434) — local inference via Ollama
 * 2. Fall back to Xenova — in-process ONNX models via @xenova/transformers
 * 3. Fall back to Cloud — optional OpenAI-compatible API
 *
 * OFFLINE FIRST: Ollama and Xenova work without internet.
 * Cloud is only used when explicitly configured.
 */
export interface IConstructAIProvider {
        readonly _serviceBrand: undefined;

        /**
         * Stream a conversation to the active model, yielding AIStreamEvents.
         * ALL AI responses must stream token-by-token. Never await a full
         * response before showing output.
         *
         * @param messages Conversation messages in unified format.
         * @param tools Tool definitions available to the model.
         * @param options Chat options (signal, systemPrompt, maxTokens, temperature).
         * @returns AsyncIterable of AIStreamEvent items.
         */
        chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent>;

        /**
         * Generate an inline code completion for the given prefix/suffix.
         * Used for Copilot-style code suggestions.
         *
         * @param prefix Code before the cursor position.
         * @param suffix Code after the cursor position (optional).
         * @param options Completion options.
         * @returns The completion result.
         */
        complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult>;

        /**
         * List all models available from this provider.
         * For Ollama, this queries /api/tags.
         * For Xenova, this returns cached ONNX model info.
         * For Cloud, this queries /v1/models.
         *
         * @returns Array of model info objects.
         */
        listModels(): Promise<IModelInfo[]>;

        /**
         * Get the currently active model.
         * This is the model that will be used for chat() and complete() calls.
         */
        getActiveModel(): IModelInfo | undefined;

        /**
         * Set the active model by ID.
         * The model must be available from listModels().
         *
         * @param modelId The model ID to activate.
         * @returns True if the model was successfully activated.
         */
        setActiveModel(modelId: string): Promise<boolean>;

        /**
         * Whether this provider can operate without internet.
         * Ollama and Xenova return true; Cloud returns false.
         */
        isOffline(): boolean;

        /**
         * Check the current status of this provider.
         * Used by the auto-selection logic and status bar.
         */
        checkStatus(): Promise<ProviderStatus>;

        /**
         * The type of this provider (ollama, xenova, or cloud).
         */
        readonly providerType: AIProviderType;

        /**
         * Event fired when the active model changes.
         */
        readonly onDidChangeActiveModel: Event<IModelInfo | undefined>;

        /**
         * Event fired when the provider status changes.
         */
        readonly onDidChangeStatus: Event<ProviderStatus>;

        /**
         * Dispose the provider and release resources (worker threads, connections, etc.).
         */
        dispose(): void;
}
