// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEmbeddingService } from '../common/memory/embeddingService.js';
import { IEmbeddingConfig } from '../common/memory/memoryTypes.js';
import { ILogService } from '../../log/common/log.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';

/**
 * Node-layer embedding service for generating text embeddings.
 * Uses Ollama's /api/embed endpoint with nomic-embed-text model.
 * Falls back to a deterministic pseudo-embedding if Ollama is unavailable.
 */
export class EmbeddingNodeService extends Disposable implements IEmbeddingService {
        declare readonly _serviceBrand: undefined;

        private _model: string = 'nomic-embed-text';
        private _dimension: number = 768;
        private _batchSize: number = 32;
        private _ollamaAvailable: boolean = true;

        private readonly _onDidLoadModel = this._register(new Emitter<void>());
        readonly onDidLoadModel = this._onDidLoadModel.event;

        private readonly _onDidError = this._register(new Emitter<string>());
        readonly onDidError = this._onDidError.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                this.logService.info('[EmbeddingNode] Service created (Ollama embedding with pseudo-embedding fallback)');
        }

        async embed(text: string): Promise<number[]> {
                this.logService.trace(`[EmbeddingNode] Generating embedding for: ${text.substring(0, 50)}...`);

                if (this._ollamaAvailable) {
                        try {
                                const baseUrl = this.configurationService.getValue<string>('construct.ollama.baseUrl') || 'http://localhost:11434';
                                const response = await fetch(`${baseUrl}/api/embed`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ model: this._model, input: text }),
                                });

                                if (!response.ok) {
                                        throw new Error(`Ollama embed API returned ${response.status}: ${response.statusText}`);
                                }

                                const data = await response.json() as { embeddings?: number[][] };
                                if (data.embeddings && data.embeddings.length > 0 && data.embeddings[0].length > 0) {
                                        this._dimension = data.embeddings[0].length;
                                        return data.embeddings[0];
                                }

                                throw new Error('Ollama embed API returned empty embeddings');
                        } catch (err: unknown) {
                                const msg = err instanceof Error ? err.message : String(err);
                                this.logService.warn(`[EmbeddingNode] Ollama embedding failed, falling back to pseudo-embedding: ${msg}`);
                                this._ollamaAvailable = false;
                        }
                }

                // Fallback: pseudo-embedding
                return this.pseudoEmbed(text);
        }

        async embedBatch(texts: string[]): Promise<number[][]> {
                return Promise.all(texts.map(t => this.embed(t)));
        }

        getConfig(): IEmbeddingConfig {
                return {
                        dimension: this._dimension,
                        model: this._model,
                        local: true,
                        batchSize: this._batchSize,
                };
        }

        isLocal(): boolean {
                return true;
        }

        /**
         * Deterministic pseudo-embedding based on text hash.
         * Used as a fallback when Ollama is unavailable.
         */
        private pseudoEmbed(text: string): number[] {
                const dimension = 384;
                const embedding = new Array(dimension).fill(0);
                for (let i = 0; i < text.length; i++) {
                        embedding[i % dimension] += text.charCodeAt(i) / 65536;
                }
                // Normalize
                const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
                return embedding.map(v => v / norm);
        }
}
