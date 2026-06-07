// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IConstructVectorStore, IVectorChunk, IVectorSearchResult } from '../common/memory/vectorStore.js';

const QDRANT_URL = 'http://localhost:6333';
const OLLAMA_EMBED_URL = 'http://localhost:11434/api/embeddings';
const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIMENSION = 768; // nomic-embed-text dimension
const CHUNK_TOKEN_SIZE = 512;
const CHUNK_OVERLAP_TOKENS = 64;
const CHARS_PER_TOKEN = 4; // Approximate

/**
 * ConstructVectorStore — Qdrant-backed vector store for workspace file chunks.
 *
 * This service runs on the Node.js side and connects to a local Qdrant instance
 * at localhost:6333. It indexes workspace files by chunking them into 512-token
 * windows with 64-token overlap, generating embeddings, and storing them in Qdrant.
 *
 * Embedding strategy (offline-first):
 * 1. **Ollama embeddings** (primary): Calls GET /api/embeddings with nomic-embed-text.
 *    Requires Ollama running and the model pulled (`ollama pull nomic-embed-text`).
 * 2. **BM25 keyword search** (fallback): When Ollama is not available or the model
 *    isn't pulled, uses a pure TypeScript BM25 scorer for keyword-based retrieval.
 *    No external dependencies — works fully offline.
 *
 * OFFLINE FIRST: If Qdrant is not running, all operations are no-ops that return
 * empty results. The user is warned once via the log service.
 *
 * Graceful degradation:
 * - Qdrant not running → isConnected() returns false, search returns []
 * - Ollama not running → BM25 fallback, warn once about missing embedding model
 * - Embedding model not pulled → BM25 fallback, warn about pulling nomic-embed-text
 * - File read fails → individual file skipped, other files continue
 */
export class ConstructVectorStoreService extends Disposable implements IConstructVectorStore {
        readonly _serviceBrand: undefined;

        private _connected = false;
        private _collectionName: string = '';
        private _qdrantClient: unknown = null;
        private _warnedNotConnected = false;

        /** Embedding mode: 'ollama' (real embeddings), 'bm25' (keyword fallback) */
        private _embedMode: 'ollama' | 'bm25' = 'ollama';
        private _warnedEmbedFallback = false;

        /** BM25 index for keyword search fallback */
        private _bm25Index: BM25Index | null = null;

        constructor(
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[VectorStore] Service created');
        }

        async initialize(workspaceRoot: string): Promise<boolean> {
                try {
                        // Try to import the Qdrant client
                        const { QdrantClient } = await import('@qdrant/js-client-rest');
                        this._qdrantClient = new QdrantClient({ url: QDRANT_URL });

                        // Test connection
                        const client = this._qdrantClient as { getCollections: () => Promise<unknown> };
                        await client.getCollections();

                        // Derive collection name from workspace path
                        this._collectionName = 'construct_' + this.hashPath(workspaceRoot);

                        // Create collection if it doesn't exist
                        await this.ensureCollection();

                        this._connected = true;

                        // Check if Ollama embeddings are available
                        await this.checkEmbeddingAvailability();

                        // Initialize BM25 index as backup
                        this._bm25Index = new BM25Index();

                        this.logService.info('[VectorStore] Connected to Qdrant, collection: ' + this._collectionName + ', embed mode: ' + this._embedMode);
                        return true;
                } catch (error) {
                        this._connected = false;
                        if (!this._warnedNotConnected) {
                                this.logService.warn('[VectorStore] Qdrant not available at ' + QDRANT_URL + '. Vector search will be disabled. Install Qdrant: https://qdrant.tech/');
                                this._warnedNotConnected = true;
                        }
                        return false;
                }
        }

        isConnected(): boolean {
                return this._connected;
        }

        async indexFile(filePath: string, content?: string): Promise<void> {
                if (!this._connected || !this._qdrantClient) { return; }

                try {
                        const fileContent = content ?? await this.readFileContent(filePath);
                        if (!fileContent) { return; }

                        const chunks = this.chunkText(fileContent, filePath);

                        // Add to BM25 index regardless of embedding mode
                        if (this._bm25Index) {
                                for (const chunk of chunks) {
                                        this._bm25Index.addDocument(chunk.id, chunk.content, {
                                                filePath: chunk.filePath,
                                                startOffset: chunk.startOffset,
                                                endOffset: chunk.endOffset,
                                                extension: chunk.metadata.extension,
                                                lastModified: chunk.metadata.lastModified,
                                                chunkIndex: chunk.metadata.chunkIndex,
                                        });
                                }
                        }

                        // Only store in Qdrant if using Ollama embeddings
                        if (this._embedMode !== 'ollama') { return; }

                        const client = this._qdrantClient as { upsert: (collection: string, points: Array<Record<string, unknown>>) => Promise<unknown> };

                        const points = [];
                        for (let i = 0; i < chunks.length; i++) {
                                const chunk = chunks[i];
                                const embedding = await this.embed(chunk.content);
                                // Skip chunks with zero embeddings (embedding failed)
                                if (embedding.every(v => v === 0)) { continue; }

                                points.push({
                                        id: chunk.id,
                                        vector: embedding,
                                        payload: {
                                                content: chunk.content,
                                                filePath: chunk.filePath,
                                                startOffset: chunk.startOffset,
                                                endOffset: chunk.endOffset,
                                                extension: chunk.metadata.extension,
                                                lastModified: chunk.metadata.lastModified,
                                                chunkIndex: chunk.metadata.chunkIndex,
                                        },
                                });
                        }

                        if (points.length > 0) {
                                await client.upsert(this._collectionName, points);
                                this.logService.info('[VectorStore] Indexed ' + filePath + ' (' + points.length + ' chunks with embeddings)');
                        }
                } catch (error) {
                        this.logService.error('[VectorStore] Failed to index file ' + filePath + ': ' + (error instanceof Error ? error.message : String(error)));
                }
        }

        async removeFile(filePath: string): Promise<void> {
                if (!this._connected || !this._qdrantClient) { return; }

                try {
                        const client = this._qdrantClient as { delete: (collection: string, filter: Record<string, unknown>) => Promise<unknown> };
                        await client.delete(this._collectionName, {
                                filter: {
                                        must: [
                                                { key: 'filePath', match: { value: filePath } },
                                        ],
                                },
                        });
                        this.logService.info('[VectorStore] Removed file: ' + filePath);
                } catch (error) {
                        this.logService.error('[VectorStore] Failed to remove file ' + filePath + ': ' + (error instanceof Error ? error.message : String(error)));
                }
        }

        async indexWorkspace(workspaceRoot: string, onProgress?: (indexed: number, total: number) => void): Promise<void> {
                if (!this._connected) {
                        const initialized = await this.initialize(workspaceRoot);
                        if (!initialized) { return; }
                }

                try {
                        const fs = await import('fs');
                        const path = await import('path');

                        const files = this.walkDirectory(workspaceRoot, fs, path);
                        const total = files.length;
                        let indexed = 0;

                        this.logService.info('[VectorStore] Indexing workspace: ' + workspaceRoot + ' (' + total + ' files, mode: ' + this._embedMode + ')');

                        for (const filePath of files) {
                                await this.indexFile(filePath);
                                indexed++;
                                onProgress?.(indexed, total);
                        }

                        this.logService.info('[VectorStore] Workspace indexing complete: ' + indexed + ' files indexed (' + this._embedMode + ' mode)');
                } catch (error) {
                        this.logService.error('[VectorStore] Workspace indexing failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }

        async search(query: string, queryEmbedding?: number[], topK?: number): Promise<IVectorSearchResult[]> {
                const k = topK ?? 8;

                // If Qdrant is connected and we have Ollama embeddings, use vector search
                if (this._connected && this._qdrantClient && this._embedMode === 'ollama') {
                        try {
                                const embedding = queryEmbedding ?? await this.embed(query);
                                if (!embedding.every(v => v === 0)) {
                                        const client = this._qdrantClient as { search: (collection: string, query: number[], options: Record<string, unknown>) => Promise<Array<Record<string, unknown>>> };
                                        const results = await client.search(this._collectionName, embedding, {
                                                limit: k,
                                                with_payload: true,
                                        });

                                        return results.map((r: Record<string, unknown>) => ({
                                                chunk: {
                                                        id: String(r.id),
                                                        content: String((r.payload as Record<string, unknown>)?.content ?? ''),
                                                        filePath: String((r.payload as Record<string, unknown>)?.filePath ?? ''),
                                                        startOffset: Number((r.payload as Record<string, unknown>)?.startOffset ?? 0),
                                                        endOffset: Number((r.payload as Record<string, unknown>)?.endOffset ?? 0),
                                                        embedding: [],
                                                        metadata: {
                                                                extension: String((r.payload as Record<string, unknown>)?.extension ?? ''),
                                                                lastModified: Number((r.payload as Record<string, unknown>)?.lastModified ?? 0),
                                                                chunkIndex: Number((r.payload as Record<string, unknown>)?.chunkIndex ?? 0),
                                                        },
                                                },
                                                score: Number(r.score ?? 0),
                                        }));
                                }
                        } catch (error) {
                                this.logService.warn('[VectorStore] Qdrant search failed, falling back to BM25: ' + (error instanceof Error ? error.message : String(error)));
                        }
                }

                // Fallback: BM25 keyword search
                if (this._bm25Index) {
                        return this._bm25Index.search(query, k);
                }

                return [];
        }

        async embed(text: string): Promise<number[]> {
                if (this._embedMode === 'ollama') {
                        try {
                                const response = await fetch(OLLAMA_EMBED_URL, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                                model: EMBEDDING_MODEL,
                                                prompt: text,
                                        }),
                                });

                                if (!response.ok) {
                                        throw new Error('Ollama embedding API returned ' + response.status);
                                }

                                const data = await response.json() as { embedding: number[] };
                                if (data.embedding && data.embedding.length > 0) {
                                        return data.embedding;
                                }

                                throw new Error('Empty embedding response from Ollama');
                        } catch (error) {
                                // Fall back to BM25 mode for this and future calls
                                if (!this._warnedEmbedFallback) {
                                        this.logService.warn('[VectorStore] Ollama embeddings unavailable (' + (error instanceof Error ? error.message : String(error)) + '). Falling back to BM25 keyword search. Pull embedding model: ollama pull ' + EMBEDDING_MODEL);
                                        this._warnedEmbedFallback = true;
                                }
                                this._embedMode = 'bm25';
                                // Return zero vector — caller should skip Qdrant storage for this chunk
                                return new Array(EMBEDDING_DIMENSION).fill(0);
                        }
                }

                // BM25 mode: no real embeddings needed
                return new Array(EMBEDDING_DIMENSION).fill(0);
        }

        async getChunkCount(): Promise<number> {
                if (!this._connected || !this._qdrantClient) { return 0; }

                try {
                        const client = this._qdrantClient as { getCollection: (name: string) => Promise<Record<string, unknown>> };
                        const info = await client.getCollection(this._collectionName);
                        const pointsCount = (info as Record<string, unknown>)?.points_count;
                        return typeof pointsCount === 'number' ? pointsCount : 0;
                } catch {
                        return 0;
                }
        }

        /**
         * Get the current embedding mode for status display.
         */
        getEmbedMode(): 'ollama' | 'bm25' {
                return this._embedMode;
        }

        // --- Private helpers ---

        /**
         * Check if Ollama embeddings are available by testing the API endpoint.
         */
        private async checkEmbeddingAvailability(): Promise<void> {
                try {
                        // First check if Ollama is running at all
                        const healthResponse = await fetch('http://localhost:11434/api/tags', {
                                method: 'GET',
                                signal: AbortSignal.timeout(5000),
                        });

                        if (!healthResponse.ok) {
                                this._embedMode = 'bm25';
                                this.logService.info('[VectorStore] Ollama not running, using BM25 fallback');
                                return;
                        }

                        // Check if nomic-embed-text model is available
                        const data = await healthResponse.json() as { models?: Array<{ name: string }> };
                        const modelNames = data.models?.map(m => m.name) ?? [];
                        const hasEmbedModel = modelNames.some(n => n.startsWith(EMBEDDING_MODEL));

                        if (hasEmbedModel) {
                                this._embedMode = 'ollama';
                                this.logService.info('[VectorStore] Ollama embedding model (' + EMBEDDING_MODEL + ') available');
                        } else {
                                this._embedMode = 'bm25';
                                this.logService.warn('[VectorStore] Ollama running but ' + EMBEDDING_MODEL + ' not found. Pull it: ollama pull ' + EMBEDDING_MODEL + '. Using BM25 fallback.');
                        }
                } catch {
                        this._embedMode = 'bm25';
                        this.logService.info('[VectorStore] Ollama not reachable, using BM25 fallback');
                }
        }

        private async ensureCollection(): Promise<void> {
                if (!this._qdrantClient) { return; }

                try {
                        const client = this._qdrantClient as { getCollection: (name: string) => Promise<unknown>; createCollection: (name: string, config: Record<string, unknown>) => Promise<unknown> };
                        await client.getCollection(this._collectionName);
                } catch {
                        // Collection doesn't exist, create it
                        const client = this._qdrantClient as { createCollection: (name: string, config: Record<string, unknown>) => Promise<unknown> };
                        await client.createCollection(this._collectionName, {
                                vectors: {
                                        size: EMBEDDING_DIMENSION,
                                        distance: 'Cosine',
                                },
                        });
                        this.logService.info('[VectorStore] Created collection: ' + this._collectionName);
                }
        }

        /**
         * Chunk text into 512-token windows with 64-token overlap.
         * Uses a simple character-based approximation (~4 chars per token).
         */
        private chunkText(content: string, filePath: string): IVectorChunk[] {
                const chunkSize = CHUNK_TOKEN_SIZE * CHARS_PER_TOKEN; // ~2048 characters
                const overlapSize = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN; // ~256 characters
                const step = chunkSize - overlapSize; // ~1792 characters

                const chunks: IVectorChunk[] = [];
                const ext = filePath.substring(filePath.lastIndexOf('.'));

                for (let offset = 0; offset < content.length; offset += step) {
                        const chunkContent = content.substring(offset, Math.min(offset + chunkSize, content.length));
                        if (chunkContent.trim().length === 0) { continue; }

                        chunks.push({
                                id: this.hashPath(filePath) + '_chunk_' + chunks.length,
                                content: chunkContent,
                                filePath,
                                startOffset: offset,
                                endOffset: Math.min(offset + chunkSize, content.length),
                                embedding: [], // Will be computed during indexing
                                metadata: {
                                        extension: ext,
                                        lastModified: Date.now(),
                                        chunkIndex: chunks.length,
                                },
                        });

                        // If we've reached the end of the content, stop
                        if (offset + chunkSize >= content.length) { break; }
                }

                return chunks;
        }

        /**
         * Simple hash function for deriving collection names and chunk IDs.
         */
        private hashPath(input: string): string {
                let hash = 0;
                for (let i = 0; i < input.length; i++) {
                        const char = input.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash; // Convert to 32-bit integer
                }
                return Math.abs(hash).toString(36);
        }

        /**
         * Walk a directory recursively and return all file paths.
         * Skips binary files, node_modules, .git, and other common ignore patterns.
         */
        private walkDirectory(root: string, fs: typeof import('fs'), path: typeof import('path')): string[] {
                const files: string[] = [];
                const ignoreDirs = new Set([
                        'node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build',
                        '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.env',
                        '.tox', '.mypy_cache', '.pytest_cache', 'target', 'bin',
                        '.construct', '.vscode', '.idea',
                ]);

                const binaryExts = new Set([
                        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
                        '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac',
                        '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
                        '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
                        '.woff', '.woff2', '.ttf', '.eot', '.otf',
                        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                        '.sqlite', '.db', '.sqlite3',
                ]);

                const walk = (dir: string): void => {
                        try {
                                const entries = fs.readdirSync(dir, { withFileTypes: true });
                                for (const entry of entries) {
                                        const fullPath = path.join(dir, entry.name);
                                        if (entry.isDirectory()) {
                                                if (!ignoreDirs.has(entry.name)) {
                                                        walk(fullPath);
                                                }
                                        } else if (entry.isFile()) {
                                                const ext = path.extname(entry.name).toLowerCase();
                                                if (!binaryExts.has(ext) && !entry.name.startsWith('.')) {
                                                        files.push(fullPath);
                                                }
                                        }
                                }
                        } catch {
                                // Skip directories we can't read
                        }
                };

                walk(root);
                return files;
        }

        private async readFileContent(filePath: string): Promise<string> {
                try {
                        const fs = await import('fs');
                        return fs.readFileSync(filePath, 'utf-8');
                } catch {
                        return '';
                }
        }

        override dispose(): void {
                this._qdrantClient = null;
                this._connected = false;
                this._bm25Index = null;
                super.dispose();
        }
}

// ─── BM25 Index — Pure TypeScript keyword search fallback ────────────────────

/**
 * BM25Index — a simple BM25 scorer implemented in pure TypeScript.
 *
 * When Ollama is not available (or the embedding model isn't pulled),
 * this provides keyword-based document retrieval using term frequency
 * and inverse document frequency scoring. No external dependencies.
 *
 * Algorithm: Okapi BM25 with parameters k1=1.5, b=0.75 (standard defaults).
 */
class BM25Index {
        private documents: Array<{
                id: string;
                content: string;
                metadata: Record<string, unknown>;
                tokens: string[];
                tf: Map<string, number>; // term frequency per document
        }> = [];
        private df: Map<string, number> = new Map(); // document frequency
        private avgDocLen = 0;

        /** BM25 parameters */
        private readonly k1 = 1.5;
        private readonly b = 0.75;

        /**
         * Add a document to the BM25 index.
         */
        addDocument(id: string, content: string, metadata: Record<string, unknown>): void {
                const tokens = this.tokenize(content);
                const tf = new Map<string, number>();

                for (const token of tokens) {
                        tf.set(token, (tf.get(token) ?? 0) + 1);
                }

                // Update document frequency
                const uniqueTokens = new Set(tokens);
                for (const token of uniqueTokens) {
                        this.df.set(token, (this.df.get(token) ?? 0) + 1);
                }

                this.documents.push({ id, content, metadata, tokens, tf });

                // Update average document length
                const totalLen = this.documents.reduce((sum, doc) => sum + doc.tokens.length, 0);
                this.avgDocLen = totalLen / this.documents.length;
        }

        /**
         * Search for documents matching the query, returning top-K results.
         */
        search(query: string, topK: number): IVectorSearchResult[] {
                const queryTokens = this.tokenize(query);
                const N = this.documents.length;

                if (N === 0) { return []; }

                // Score each document
                const scored: Array<{ doc: { id: string; content: string; metadata: Record<string, unknown>; tokens: string[]; tf: Map<string, number> }; score: number }> = [];

                for (const doc of this.documents) {
                        let score = 0;

                        for (const qt of queryTokens) {
                                const tf = doc.tf.get(qt) ?? 0;
                                if (tf === 0) { continue; }

                                const df = this.df.get(qt) ?? 0;
                                if (df === 0) { continue; }

                                // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
                                const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

                                // TF component: (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen))
                                const docLen = doc.tokens.length;
                                const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * docLen / this.avgDocLen));

                                score += idf * tfNorm;
                        }

                        if (score > 0) {
                                scored.push({ doc, score });
                        }
                }

                // Sort by score descending, take top-K
                scored.sort((a, b) => b.score - a.score);
                const topResults = scored.slice(0, topK);

                return topResults.map(({ doc, score }) => ({
                        chunk: {
                                id: doc.id,
                                content: doc.content,
                                filePath: String(doc.metadata.filePath ?? ''),
                                startOffset: Number(doc.metadata.startOffset ?? 0),
                                endOffset: Number(doc.metadata.endOffset ?? 0),
                                embedding: [],
                                metadata: {
                                        extension: String(doc.metadata.extension ?? ''),
                                        lastModified: Number(doc.metadata.lastModified ?? 0),
                                        chunkIndex: Number(doc.metadata.chunkIndex ?? 0),
                                },
                        },
                        score,
                }));
        }

        /**
         * Simple tokenizer: lowercase, split on non-alphanumeric, remove empty tokens.
         * Also strips common programming noise (brackets, semicolons, etc.).
         */
        private tokenize(text: string): string[] {
                return text
                        .toLowerCase()
                        .replace(/[{}()[\];,<>=+\-*/\\|&^%$#@!~`'"]/g, ' ')
                        .split(/\s+/)
                        .filter(t => t.length > 1); // Skip single-char tokens
        }
}
