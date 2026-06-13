// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IEmbeddingService } from '../../../../../../platform/construct/common/memory/embeddingService.js';
import { IEmbeddingConfig } from '../../../../../../platform/construct/common/memory/memoryTypes';

const OLLAMA_EMBED_URL = 'http://localhost:11434/api/embeddings';
const OLLAMA_MODEL = 'nomic-embed-text';
const OLLAMA_DIMENSION = 768; // nomic-embed-text
const XENOVA_MODEL = 'Xenova/all-MiniLM-L6-v2';
const XENOVA_DIMENSION = 384;
const BATCH_SIZE = 32;

/**
 * EmbeddingService — generates text embeddings using Ollama (primary)
 * or Xenova (fallback), with graceful degradation.
 *
 * Embedding strategy (offline-first):
 * 1. **Ollama embeddings** (primary): Calls /api/embeddings with nomic-embed-text.
 *    High quality, GPU-accelerated, requires Ollama running with model pulled.
 * 2. **Xenova in-process** (fallback): Uses @xenova/transformers ONNX models
 *    in the browser. CPU-only, lower quality, but fully offline.
 *
 * The service auto-detects which backend is available at first embed call.
 * If neither is available (should not happen in normal use), returns zero vectors
 * and fires an error event.
 */
export class EmbeddingService extends Disposable implements IEmbeddingService {
	readonly _serviceBrand: undefined;

	private _mode: 'ollama' | 'xenova' | 'unavailable' = 'ollama';
	private _modeDetected = false;
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
		const dimension = this._mode === 'ollama' ? OLLAMA_DIMENSION : XENOVA_DIMENSION;
		const model = this._mode === 'ollama' ? OLLAMA_MODEL : XENOVA_MODEL;
		return {
			dimension,
			model,
			local: true,
			batchSize: BATCH_SIZE
		};
	}

	isLocal(): boolean {
		return true;
	}

	async embed(text: string): Promise<number[]> {
		await this.detectMode();

		const cached = this.cache.get(text);
		if (cached) { return cached; }

		try {
			if (this._mode === 'ollama') {
				return await this.embedOllama(text);
			} else if (this._mode === 'xenova') {
				return await this.embedXenova(text);
			} else {
				// No embedding available — return zero vector
				const dimension = XENOVA_DIMENSION;
				return new Array(dimension).fill(0);
			}
		} catch (error) {
			this.logService.error('[Embedding] Failed to embed:', error);
			this._onDidError.fire(error instanceof Error ? error.message : String(error));
			const dimension = this._mode === 'ollama' ? OLLAMA_DIMENSION : XENOVA_DIMENSION;
			return new Array(dimension).fill(0);
		}
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		await this.detectMode();

		const results: number[][] = [];

		if (this._mode === 'ollama') {
			// Ollama doesn't have a batch endpoint, embed one by one
			for (const text of texts) {
				results.push(await this.embed(text));
			}
		} else {
			// Xenova batch
			for (let i = 0; i < texts.length; i += BATCH_SIZE) {
				const batch = texts.slice(i, i + BATCH_SIZE);

				try {
					await this.ensureXenovaModel();
					const result = await this.embedModel(batch, { pooling: 'mean', normalize: true });
					const embeddings = this.tensorToArrays(result, batch.length, XENOVA_DIMENSION);

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
		}

		return results;
	}

	// --- Mode Detection ---

	/**
	 * Auto-detect which embedding backend is available.
	 * Priority: Ollama > Xenova > Unavailable
	 */
	private async detectMode(): Promise<void> {
		if (this._modeDetected) { return; }

		// Try Ollama first
		try {
			const response = await fetch('http://localhost:11434/api/tags', {
				method: 'GET',
				signal: AbortSignal.timeout(3000),
			});

			if (response.ok) {
				const data = await response.json() as { models?: Array<{ name: string }> };
				const modelNames = data.models?.map(m => m.name) ?? [];
				const hasEmbedModel = modelNames.some(n => n.startsWith(OLLAMA_MODEL));

				if (hasEmbedModel) {
					this._mode = 'ollama';
					this._modeDetected = true;
					this.modelLoaded = true;
					this.logService.info('[Embedding] Using Ollama embeddings (' + OLLAMA_MODEL + ')');
					return;
				}

				this.logService.warn('[Embedding] Ollama running but ' + OLLAMA_MODEL + ' not found. Pull it: ollama pull ' + OLLAMA_MODEL + '. Falling back to Xenova.');
			}
		} catch {
			this.logService.info('[Embedding] Ollama not reachable, trying Xenova fallback');
		}

		// Fallback: Xenova
		try {
			await this.ensureXenovaModel();
			this._mode = 'xenova';
			this._modeDetected = true;
			this.logService.info('[Embedding] Using Xenova in-process embeddings (' + XENOVA_MODEL + ')');
			return;
		} catch {
			this.logService.error('[Embedding] Neither Ollama nor Xenova available for embeddings');
			this._mode = 'unavailable';
			this._modeDetected = true;
			this._onDidError.fire('No embedding backend available. Install Ollama and pull nomic-embed-text, or ensure @xenova/transformers is installed.');
		}
	}

	// --- Ollama Embedding ---

	private async embedOllama(text: string): Promise<number[]> {
		try {
			const response = await fetch(OLLAMA_EMBED_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: OLLAMA_MODEL,
					prompt: text,
				}),
			});

			if (!response.ok) {
				throw new Error('Ollama embedding API returned ' + response.status);
			}

			const data = await response.json() as { embedding: number[] };
			if (data.embedding && data.embedding.length > 0) {
				this.setCache(text, data.embedding);
				return data.embedding;
			}

			throw new Error('Empty embedding response');
		} catch (error) {
			this.logService.warn('[Embedding] Ollama embed failed, trying Xenova:', error instanceof Error ? error.message : String(error));
			// Try Xenova as emergency fallback
			try {
				await this.ensureXenovaModel();
				const result = await this.embedXenova(text);
				return result;
			} catch {
				throw error; // Throw original Ollama error
			}
		}
	}

	// --- Xenova Embedding ---

	private async embedXenova(text: string): Promise<number[]> {
		await this.ensureXenovaModel();

		try {
			const result = await this.embedModel(text, { pooling: 'mean', normalize: true });
			const embedding = Array.from(result.data) as number[];
			this.setCache(text, embedding);
			return embedding;
		} catch (error) {
			this.logService.error('[Embedding] Xenova embed failed:', error);
			this._onDidError.fire(error instanceof Error ? error.message : String(error));
			return new Array(XENOVA_DIMENSION).fill(0);
		}
	}

	private async ensureXenovaModel(): Promise<void> {
		if (this.modelLoaded) { return; }
		if (this.loadPromise) { return this.loadPromise; }

		this.loadPromise = this.loadXenovaModel();
		return this.loadPromise;
	}

	private async loadXenovaModel(): Promise<void> {
		try {
			this.logService.info('[Embedding] Loading Xenova model ' + XENOVA_MODEL + '...');

			const transformers = await import('@xenova/transformers');
			const pipeline = transformers.pipeline;

			this.embedModel = await pipeline('feature-extraction', XENOVA_MODEL, {
				quantized: true
			});

			this.modelLoaded = true;
			this.logService.info('[Embedding] Xenova model loaded successfully');
			this._onDidLoadModel.fire();
		} catch (error) {
			this.logService.error('[Embedding] Failed to load Xenova model:', error);
			this._onDidError.fire(error instanceof Error ? error.message : String(error));
			// No pseudo-embedding fallback — we'd rather report the error
			this.modelLoaded = false;
			throw error;
		}
	}

	// --- Helpers ---

	private tensorToArrays(tensor: any, batchSize: number, dimension: number): number[][] {
		const data = tensor.data ?? tensor;
		const arrays: number[][] = [];

		for (let i = 0; i < batchSize; i++) {
			const start = i * dimension;
			const end = start + dimension;
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
