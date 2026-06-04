/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IEmbeddingService } from '../../../../../../platform/construct/common/memory/embeddingService.js';
import { IEmbeddingConfig } from '../../../../../../platform/construct/common/memory/memoryTypes';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384;
const BATCH_SIZE = 32;

export class EmbeddingService extends Disposable implements IEmbeddingService {
        readonly _serviceBrand: undefined;

        private modelLoaded = false;
        private loadPromise: Promise<void> | undefined;
        private cache = new Map<string, number[]>();
        private readonly maxCacheSize = 1000;

        private embedModel: any;

        private readonly _onDidLoadModel = this._register(new Emitter<void>());
        readonly onDidLoadModel = this._onDidLoadModel.event;

        private readonly _onDidError = this._register(new Emitter<string>());
        readonly onDidError = this._onDidError.event;

        constructor(
                @ILogService private readonly logService: ILogService
        ) {
                super();
        }

        getConfig(): IEmbeddingConfig {
                return {
                        dimension: DIMENSION,
                        model: MODEL_NAME,
                        local: true,
                        batchSize: BATCH_SIZE
                };
        }

        isLocal(): boolean {
                return true;
        }

        async embed(text: string): Promise<number[]> {
                await this.ensureModel();

                const cached = this.cache.get(text);
                if (cached) { return cached; }

                try {
                        const result = await this.embedModel(text, { pooling: 'mean', normalize: true });
                        const embedding = Array.from(result.data) as number[];

                        this.setCache(text, embedding);
                        return embedding;
                } catch (error) {
                        this.logService.error('[Embedding] Failed to embed:', error);
                        this._onDidError.fire(error instanceof Error ? error.message : String(error));
                        // Return zero vector as fallback
                        return new Array(DIMENSION).fill(0);
                }
        }

        async embedBatch(texts: string[]): Promise<number[][]> {
                await this.ensureModel();

                const results: number[][] = [];

                for (let i = 0; i < texts.length; i += BATCH_SIZE) {
                        const batch = texts.slice(i, i + BATCH_SIZE);

                        try {
                                const result = await this.embedModel(batch, { pooling: 'mean', normalize: true });
                                const embeddings = this.tensorToArrays(result, batch.length);

                                for (let j = 0; j < batch.length; j++) {
                                        this.setCache(batch[j], embeddings[j]);
                                        results.push(embeddings[j]);
                                }
                        } catch (error) {
                                this.logService.error('[Embedding] Batch failed:', error);
                                for (const text of batch) {
                                        results.push(await this.embed(text));
                                }
                        }
                }

                return results;
        }

        // --- Private Helpers -------------------------------------------------------

        private async ensureModel(): Promise<void> {
                if (this.modelLoaded) { return; }
                if (this.loadPromise) { return this.loadPromise; }

                this.loadPromise = this.loadModel();
                return this.loadPromise;
        }

        private async loadModel(): Promise<void> {
                try {
                        this.logService.info(`[Embedding] Loading model ${MODEL_NAME}...`);

                        const transformers = await import('@xenova/transformers');
                        const pipeline = transformers.pipeline;

                        this.embedModel = await pipeline('feature-extraction', MODEL_NAME, {
                                quantized: true
                        });

                        this.modelLoaded = true;
                        this.logService.info('[Embedding] Model loaded successfully');
                        this._onDidLoadModel.fire();
                } catch (error) {
                        this.logService.error('[Embedding] Failed to load model:', error);
                        this._onDidError.fire(error instanceof Error ? error.message : String(error));
                        // Fallback: use hash-based pseudo-embeddings so the system still works
                        this.embedModel = this.pseudoEmbed.bind(this);
                        this.modelLoaded = true;
                }
        }

        private pseudoEmbed(text: string | string[], options?: any): any {
                // Simple hash-based pseudo-embedding as fallback when Xenova fails to load
                const texts = Array.isArray(text) ? text : [text];
                const results: number[][] = [];

                for (const t of texts) {
                        const embedding = new Array(DIMENSION).fill(0);
                        for (let i = 0; i < t.length; i++) {
                                embedding[i % DIMENSION] += t.charCodeAt(i) / 65536;
                        }
                        // Normalize
                        const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
                        for (let i = 0; i < DIMENSION; i++) {
                                embedding[i] /= norm;
                        }
                        results.push(embedding);
                }

                // Return object compatible with tensor interface
                if (Array.isArray(text)) {
                        return { data: results.flat() };
                }
                return { data: results[0] };
        }

        private tensorToArrays(tensor: any, batchSize: number): number[][] {
                const data = tensor.data ?? tensor;
                const arrays: number[][] = [];

                for (let i = 0; i < batchSize; i++) {
                        const start = i * DIMENSION;
                        const end = start + DIMENSION;
                        arrays.push(Array.from(data.slice(start, end)));
                }

                return arrays;
        }

        private setCache(text: string, embedding: number[]): void {
                if (this.cache.size >= this.maxCacheSize) {
                        const firstKey = this.cache.keys().next().value;
                        if (firstKey !== undefined) {
                                this.cache.delete(firstKey);
                        }
                }
                this.cache.set(text, embedding);
        }

        override dispose(): void {
                this.cache.clear();
                super.dispose();
        }
}
