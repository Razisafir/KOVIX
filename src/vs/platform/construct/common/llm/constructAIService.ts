// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import {
	IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
	IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
	IToolDefinition, ProviderStatus
} from './constructAIProvider.js';

export const IConstructAIService = createDecorator<IConstructAIService>('construct.aiService');

/**
 * IConstructAIService — the unified AI service that auto-selects the best provider.
 *
 * At startup, this service checks providers in priority order:
 * 1. Ollama (localhost:11434) — local inference, GPU-accelerated
 * 2. Xenova — in-process ONNX models, CPU-only fallback
 * 3. Cloud — optional OpenAI-compatible API (only if explicitly configured)
 *
 * The active provider delegates all chat(), complete(), listModels(), etc. calls.
 * The service also provides methods to switch providers manually and to check
 * the status of all providers for the onboarding wizard.
 *
 * OFFLINE FIRST: The service prefers offline providers. Cloud is only selected
 * when the user explicitly activates it or when no offline providers are available.
 */
export interface IConstructAIService {
	readonly _serviceBrand: undefined;

	/**
	 * The currently active AI provider.
	 * All chat/complete calls are delegated to this provider.
	 */
	readonly activeProvider: IConstructAIProvider | undefined;

	/**
	 * The type of the currently active provider.
	 * Used for status bar display ("local" vs "cloud").
	 */
	readonly activeProviderType: AIProviderType | undefined;

	/**
	 * Stream a conversation using the active provider.
	 * Delegates to IConstructAIProvider.chat().
	 *
	 * @param messages Conversation messages in unified format.
	 * @param tools Tool definitions available to the model.
	 * @param options Chat options.
	 * @returns AsyncIterable of AIStreamEvent items.
	 */
	chat(messages: IChatMessage[], tools: IToolDefinition[], options?: IChatOptions): AsyncIterable<AIStreamEvent>;

	/**
	 * Generate an inline completion using the active provider.
	 * Delegates to IConstructAIProvider.complete().
	 *
	 * @param prefix Code before the cursor.
	 * @param suffix Code after the cursor.
	 * @param options Completion options.
	 * @returns Completion result.
	 */
	complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult>;

	/**
	 * List models from the active provider.
	 */
	listModels(): Promise<IModelInfo[]>;

	/**
	 * Get the currently active model.
	 */
	getActiveModel(): IModelInfo | undefined;

	/**
	 * Set the active model on the active provider.
	 */
	setActiveModel(modelId: string): Promise<boolean>;

	/**
	 * Whether the active provider can work offline.
	 */
	isOffline(): boolean;

	/**
	 * Auto-select the best available provider.
	 * Priority: Ollama > Xenova > Cloud.
	 * Called at startup and when a provider's status changes.
	 */
	autoSelectProvider(): Promise<IConstructAIProvider | undefined>;

	/**
	 * Manually switch to a specific provider type.
	 *
	 * @param providerType The provider to switch to.
	 * @returns True if the switch was successful.
	 */
	switchProvider(providerType: AIProviderType): Promise<boolean>;

	/**
	 * Get the status of all providers.
	 * Used by the onboarding wizard and status bar.
	 */
	getAllProviderStatuses(): Promise<Map<AIProviderType, ProviderStatus>>;

	/**
	 * Get a specific provider by type.
	 * Used for direct provider access (e.g., Ollama for model pulling).
	 */
	getProvider(type: AIProviderType): IConstructAIProvider | undefined;

	/**
	 * Event fired when the active provider changes.
	 */
	readonly onDidChangeActiveProvider: Event<AIProviderType>;

	/**
	 * Event fired when the active model changes.
	 */
	readonly onDidChangeActiveModel: Event<IModelInfo | undefined>;
}
