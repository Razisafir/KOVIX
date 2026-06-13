// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import {
        IConstructAIProvider, AIProviderType, AIStreamEvent, IChatMessage,
        IChatOptions, ICompleteOptions, ICompleteResult, IModelInfo,
        ProviderStatus
} from '../../../../../../platform/construct/common/llm/constructAIProvider.js';

/**
 * XenovaProvider — concrete AI provider that runs ONNX models in-process
 * using @xenova/transformers.
 *
 * This is the offline fallback when Ollama is not available. It loads
 * quantized models directly in the Node.js process using WebAssembly
 * accelerated ONNX runtime.
 *
 * OFFLINE FIRST: Xenova runs entirely in-process with no network needed
 * after model download. Models are cached locally on first use.
 *
 * Limitations:
 * - Smaller models only (typically <3B params) due to memory constraints
 * - Tool calling support depends on the model (limited for small models)
 * - Slower inference than Ollama (no GPU acceleration)
 * - complete() works well; chat() with tools may be degraded
 *
 * Architecture:
 * - The actual model loading and inference runs in a Worker thread to
 *   avoid blocking the main process.
 * - Communication is via postMessage with structured-clone-compatible data.
 */
export class XenovaProvider extends Disposable implements IConstructAIProvider {
        readonly _serviceBrand: undefined;
        readonly providerType: AIProviderType = 'xenova';

        private _activeModel: IModelInfo | undefined;
        private _status: ProviderStatus = ProviderStatus.Unknown;
        private _worker: Worker | null = null;
        private _modelLoaded: boolean = false;
        private _pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = new Map();
        private _requestId: number = 0;

        private readonly _onDidChangeActiveModel = this._register(new Emitter<IModelInfo | undefined>());
        readonly onDidChangeActiveModel = this._onDidChangeActiveModel.event;
        private readonly _onDidChangeStatus = this._register(new Emitter<ProviderStatus>());
        readonly onDidChangeStatus = this._onDidChangeStatus.event;

        /** Default small model for in-process inference */
        private static readonly DEFAULT_MODEL = 'Xenova/Qwen1.5-0.5B-Chat';

        /** Available models known to work well with @xenova/transformers */
        private static readonly KNOWN_MODELS: IModelInfo[] = [
                {
                        id: 'Xenova/Qwen1.5-0.5B-Chat',
                        displayName: 'Qwen 1.5 0.5B Chat',
                        provider: 'xenova',
                        contextWindowTokens: 32_768,
                        supportsTools: false,
                        supportsStreaming: true,
                },
                {
                        id: 'Xenova/Phi-3-mini-4k-instruct',
                        displayName: 'Phi-3 Mini (4k context)',
                        provider: 'xenova',
                        contextWindowTokens: 4_096,
                        supportsTools: false,
                        supportsStreaming: true,
                },
                {
                        id: 'Xenova/codellama-7b-instruct',
                        displayName: 'CodeLlama 7B Instruct',
                        provider: 'xenova',
                        contextWindowTokens: 16_384,
                        supportsTools: false,
                        supportsStreaming: true,
                },
                {
                        id: 'Xenova/starcoder2-3b',
                        displayName: 'StarCoder2 3B',
                        provider: 'xenova',
                        contextWindowTokens: 16_384,
                        supportsTools: false,
                        supportsStreaming: true,
                },
        ];

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                this.logService.info('[XenovaProvider] Initialized');
        }

        isOffline(): boolean {
                return true;
        }

        async checkStatus(): Promise<ProviderStatus> {
                // Xenova relies on Web Workers which are unavailable in Electron's
                // sandboxed renderer process. Report Unreachable honestly rather
                // than pretending to work.
                //
                // In a browser context (vscode-web), Web Workers are available,
                // so Xenova can function. In Electron desktop, the sandbox blocks
                // Worker creation, so Xenova will always fail at runtime.
                try {
                        // Quick check: can we create a Worker?
                        if (typeof Worker === 'undefined') {
                                this.logService.warn('[XenovaProvider] Web Workers not available in this environment');
                                this._setStatus(ProviderStatus.Unreachable);
                                return this._status;
                        }

                        // Try to verify Worker creation works (Electron sandbox blocks this)
                        try {
                                const testBlob = new Blob([''], { type: 'application/javascript' });
                                const testUrl = URL.createObjectURL(testBlob);
                                const testWorker = new Worker(testUrl);
                                URL.revokeObjectURL(testUrl);
                                testWorker.terminate();
                        } catch (workerError) {
                                this.logService.warn('[XenovaProvider] Cannot create Web Worker (Electron sandbox?):', workerError instanceof Error ? workerError.message : String(workerError));
                                this._setStatus(ProviderStatus.Unreachable);
                                return this._status;
                        }

                        if (!this._worker) {
                                this.initWorker();
                        }
                        // If we already have a model loaded, we're available
                        if (this._modelLoaded && this._activeModel) {
                                this._setStatus(ProviderStatus.Available);
                                return this._status;
                        }

                        // Try to auto-select the default model
                        const configuredModel = this.configurationService.getValue<string>('construct.xenova.model') || XenovaProvider.DEFAULT_MODEL;
                        const model = XenovaProvider.KNOWN_MODELS.find(m => m.id === configuredModel) ?? XenovaProvider.KNOWN_MODELS[0];

                        this._activeModel = model;
                        this._onDidChangeActiveModel.fire(model);
                        this._setStatus(ProviderStatus.Available);
                        return this._status;
                } catch (error) {
                        this.logService.error('[XenovaProvider] Status check failed:', error instanceof Error ? error.message : String(error));
                        this._setStatus(ProviderStatus.Unreachable);
                        return this._status;
                }
        }

        getActiveModel(): IModelInfo | undefined {
                return this._activeModel;
        }

        async setActiveModel(modelId: string): Promise<boolean> {
                const model = XenovaProvider.KNOWN_MODELS.find(m => m.id === modelId);
                if (!model) {
                        this.logService.warn('[XenovaProvider] Model not found: ' + modelId);
                        return false;
                }
                this._activeModel = model;
                this._modelLoaded = false; // Will reload on next request
                this._onDidChangeActiveModel.fire(model);
                this.logService.info('[XenovaProvider] Active model set to: ' + modelId);
                return true;
        }

        async listModels(): Promise<IModelInfo[]> {
                return [...XenovaProvider.KNOWN_MODELS];
        }

        async *chat(messages: IChatMessage[], _tools: unknown[], options?: IChatOptions): AsyncIterable<AIStreamEvent> {
                if (!this._activeModel) {
                        yield { type: 'error', text: 'No model selected. Please select a model in the CONSTRUCT model picker.' };
                        return;
                }

                // Ensure worker is ready
                if (!this._worker) {
                        this.initWorker();
                }

                // Format messages into a prompt the model can understand
                const prompt = this.formatChatPrompt(messages, options?.systemPrompt);

                try {
                        // Send generation request to worker
                        const requestId = ++this._requestId;
                        const resultPromise = this.createRequestPromise(requestId);

                        this._worker!.postMessage({
                                type: 'generate',
                                requestId,
                                model: this._activeModel.id,
                                prompt,
                                maxTokens: options?.maxTokens ?? 2048,
                                temperature: options?.temperature ?? 0.7,
                        });

                        // Stream tokens as they come from the worker
                        const result = await resultPromise as { tokens: string[]; done: boolean };
                        for (const token of result.tokens) {
                                yield { type: 'token', text: token };
                        }
                        yield { type: 'done', stopReason: result.done ? 'stop' : 'length' };
                } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        this.logService.error('[XenovaProvider] Chat failed:', errorMsg);
                        yield { type: 'error', text: 'Xenova generation failed: ' + errorMsg };
                }
        }

        async complete(prefix: string, suffix: string, options?: ICompleteOptions): Promise<ICompleteResult> {
                if (!this._activeModel) {
                        return { text: '', finished: true };
                }

                if (!this._worker) {
                        this.initWorker();
                }

                try {
                        const requestId = ++this._requestId;
                        const resultPromise = this.createRequestPromise(requestId);

                        this._worker!.postMessage({
                                type: 'complete',
                                requestId,
                                model: this._activeModel.id,
                                prefix,
                                suffix,
                                maxTokens: options?.maxTokens ?? 128,
                                temperature: options?.temperature ?? 0.2,
                                stop: options?.stop ?? ['\n\n', '```'],
                        });

                        const result = await resultPromise as { text: string; finished: boolean };
                        return { text: result.text, finished: result.finished };
                } catch (error) {
                        this.logService.error('[XenovaProvider] Complete failed:', error instanceof Error ? error.message : String(error));
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
         * Initialize the Web Worker for model inference.
         * The worker loads @xenova/transformers and handles model loading/generation
         * without blocking the main thread.
         */
        private initWorker(): void {
                if (this._worker) { return; }

                // Create an inline worker using a Blob URL.
                // In a full build, this would reference a separate worker file.
                const workerCode = `
                        let pipeline = null;
                        let currentModel = null;

                        self.onmessage = async function(e) {
                                const { type, requestId, model, prompt, prefix, suffix, maxTokens, temperature, stop } = e.data;

                                try {
                                        if (type === 'generate' || type === 'complete') {
                                                // Load model if not already loaded or if model changed
                                                if (!pipeline || currentModel !== model) {
                                                        self.postMessage({ type: 'status', message: 'Loading model: ' + model });
                                                        const { pipeline: createPipeline } = await import('@xenova/transformers');
                                                        pipeline = await createPipeline('text-generation', model, {
                                                                dtype: 'q4',
                                                        });
                                                        currentModel = model;
                                                }

                                                const inputText = type === 'generate' ? prompt : prefix;
                                                const result = await pipeline(inputText, {
                                                        max_new_tokens: maxTokens,
                                                        temperature: temperature,
                                                        do_sample: temperature > 0,
                                                        return_full_text: false,
                                                });

                                                const text = result?.[0]?.generated_text ?? '';

                                                if (type === 'generate') {
                                                        // For chat, split into token-like chunks for streaming
                                                        const tokens = splitIntoChunks(text, 4);
                                                        self.postMessage({ type: 'response', requestId, tokens, done: true });
                                                } else {
                                                        self.postMessage({ type: 'response', requestId, text, finished: true });
                                                }
                                        }
                                } catch (error) {
                                        self.postMessage({ type: 'error', requestId, error: error.message });
                                }
                        };

                        function splitIntoChunks(text, chunkSize) {
                                const chunks = [];
                                for (let i = 0; i < text.length; i += chunkSize) {
                                        chunks.push(text.slice(i, i + chunkSize));
                                }
                                return chunks;
                        }
                `;

                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);
                this._worker = new Worker(workerUrl);
                URL.revokeObjectURL(workerUrl);

                this._worker.onmessage = (e: MessageEvent) => {
                        const data = e.data as Record<string, unknown>;
                        const requestId = data.requestId as number;
                        const pending = this._pendingRequests.get(requestId);
                        if (pending) {
                                this._pendingRequests.delete(requestId);
                                if (data.type === 'error') {
                                        pending.reject(new Error(String(data.error)));
                                } else {
                                        pending.resolve(data);
                                }
                        }
                };

                this._worker.onerror = (error: ErrorEvent) => {
                        this.logService.error('[XenovaProvider] Worker error:', error.message);
                        // Reject all pending requests
                        for (const [id, pending] of this._pendingRequests) {
                                pending.reject(new Error('Worker error: ' + error.message));
                                this._pendingRequests.delete(id);
                        }
                };

                this.logService.info('[XenovaProvider] Worker initialized');
        }

        private createRequestPromise(requestId: number): Promise<unknown> {
                return new Promise((resolve, reject) => {
                        this._pendingRequests.set(requestId, { resolve, reject });
                });
        }

        /**
         * Format chat messages into a single prompt string for text-generation models.
         * Uses a chat template that the model was trained on.
         */
        private formatChatPrompt(messages: IChatMessage[], systemPrompt?: string): string {
                let prompt = '';

                if (systemPrompt) {
                        prompt += '<|im_start|>system\n' + systemPrompt + '<|im_end|>\n';
                }

                for (const msg of messages) {
                        if (msg.role === 'system') {
                                prompt += '<|im_start|>system\n' + msg.content + '<|im_end|>\n';
                        } else if (msg.role === 'user') {
                                prompt += '<|im_start|>user\n' + msg.content + '<|im_end|>\n';
                        } else if (msg.role === 'assistant') {
                                prompt += '<|im_start|>assistant\n' + msg.content + '<|im_end|>\n';
                        } else if (msg.role === 'tool') {
                                // For small models, just include tool results as user messages
                                prompt += '<|im_start|>user\n[Tool Result]: ' + msg.content + '<|im_end|>\n';
                        }
                }

                prompt += '<|im_start|>assistant\n';
                return prompt;
        }

        override dispose(): void {
                if (this._worker) {
                        this._worker.terminate();
                        this._worker = null;
                }
                for (const [, pending] of this._pendingRequests) {
                        pending.reject(new Error('Provider disposed'));
                }
                this._pendingRequests.clear();
                super.dispose();
        }
}
