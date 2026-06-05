/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const IAnthropicProvider = createDecorator<IAnthropicProvider>('construct.anthropicProvider');

/**
 * Stream events emitted by the Anthropic provider during a streaming response.
 */
export type StreamEvent =
        | { type: 'token'; text: string }
        | { type: 'tool_start'; toolId: string; toolName: string }
        | { type: 'tool_input'; toolId: string; text: string }
        | { type: 'tool_end'; toolId: string; toolName: string; toolInput: unknown }
        | { type: 'done'; stopReason: string }
        | { type: 'error'; text: string };

/**
 * Tool definition sent with each Anthropic API call.
 */
export interface IAnthropicTool {
        name: string;
        description: string;
        input_schema: object;
}

/**
 * Message in the Anthropic conversation format.
 */
export interface IAnthropicMessage {
        role: 'user' | 'assistant';
        content: string | IAnthropicContentBlock[];
}

export interface IAnthropicContentBlock {
        type: 'text' | 'tool_use' | 'tool_result';
        text?: string;
        tool_use_id?: string;
        name?: string;
        input?: unknown;
        content?: string | IAnthropicContentBlock[];
        id?: string;
        /** Whether this tool_result represents an error. Required by Anthropic API spec. */
        is_error?: boolean;
}

/**
 * Configuration for the Anthropic provider.
 */
export interface IAnthropicProviderConfig {
        apiKey: string;
        model: string;
        maxTokens: number;
}

/**
 * Service for streaming responses from the Anthropic API.
 */
export interface IAnthropicProvider {
        readonly _serviceBrand: undefined;

        /**
         * Stream a conversation to the Anthropic API, yielding StreamEvents.
         * Handles 429 with exponential backoff (1s->2s->4s->8s, max 4 retries).
         * Handles 401 by firing onKeyInvalid.
         * Handles network errors by firing onConnectionError.
         *
         * @param messages Conversation messages (user/assistant turns).
         * @param tools Tool definitions available to the model.
         * @param signal Optional AbortSignal for cancellation.
         * @param systemPrompt Optional system prompt for the model.
         */
        streamMessages(
                messages: IAnthropicMessage[],
                tools: IAnthropicTool[],
                signal?: AbortSignal,
                systemPrompt?: string
        ): AsyncGenerator<StreamEvent>;

        /**
         * Get or set the provider configuration (API key, model, max tokens).
         */
        readonly config: IAnthropicProviderConfig;
        updateConfig(config: Partial<IAnthropicProviderConfig>): void;

        /**
         * Events for error conditions.
         */
        readonly onKeyInvalid: Event<void>;
        readonly onConnectionError: Event<Error>;
}
