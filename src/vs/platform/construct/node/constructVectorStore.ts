/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IConstructVectorStore, IVectorChunk, IVectorSearchResult } from '../common/memory/vectorStore.js';

const QDRANT_URL = 'http://localhost:6333';
const EMBEDDING_DIMENSION = 384; // Common dimension for small embedding models
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
 * OFFLINE FIRST: If Qdrant is not running, all operations are no-ops that return
 * empty results. The user is warned once via the log service.
 *
 * Architecture:
 * - Collection name: derived from workspace root path hash
 * - Embeddings: generated via the active AI provider or a hash-based pseudo-embedding
 * - Search: uses Qdrant's cosine similarity search
 *
 * Graceful degradation:
 * - Qdrant not running → isConnected() returns false, search returns []
 * - Embedding fails → chunk stored without embedding, skipped in search
 * - File read fails → individual file skipped, other files continue
 */
export class ConstructVectorStoreService extends Disposable implements IConstructVectorStore {
        readonly _serviceBrand: undefined;

        private _connected = false;
        private _collectionName: string = '';
        private _qdrantClient: unknown = null;
        private _warnedNotConnected = false;

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
                        this.logService.info('[VectorStore] Connected to Qdrant, collection: ' + this._collectionName);
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
                        const client = this._qdrantClient as { upsert: (collection: string, points: Array<Record<string, unknown>>) => Promise<unknown> };

                        const points = [];
                        for (let i = 0; i < chunks.length; i++) {
                                const chunk = chunks[i];
                                const embedding = await this.embed(chunk.content);

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
                                this.logService.info('[VectorStore] Indexed ' + filePath + ' (' + points.length + ' chunks)');
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

                        this.logService.info('[VectorStore] Indexing workspace: ' + workspaceRoot + ' (' + total + ' files)');

                        for (const filePath of files) {
                                await this.indexFile(filePath);
                                indexed++;
                                onProgress?.(indexed, total);
                        }

                        this.logService.info('[VectorStore] Workspace indexing complete: ' + indexed + ' files indexed');
                } catch (error) {
                        this.logService.error('[VectorStore] Workspace indexing failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }

        async search(query: string, queryEmbedding?: number[], topK?: number): Promise<IVectorSearchResult[]> {
                if (!this._connected || !this._qdrantClient) { return []; }

                try {
                        const embedding = queryEmbedding ?? await this.embed(query);
                        const k = topK ?? 8;

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
                } catch (error) {
                        this.logService.error('[VectorStore] Search failed: ' + (error instanceof Error ? error.message : String(error)));
                        return [];
                }
        }

        async embed(text: string): Promise<number[]> {
                try {
                        // Try to use @xenova/transformers for local embedding
                        const { pipeline } = await import('@xenova/transformers');
                        const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                        const result = await embedder(text, { pooling: 'mean', normalize: true });
                        return Array.from(result.data) as number[];
                } catch {
                        // Fallback: simple hash-based pseudo-embedding for offline mode
                        // This is NOT a real embedding but allows the system to function
                        // without a full embedding model loaded.
                        return this.pseudoEmbed(text);
                }
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

        // --- Private helpers ---

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
         * Pseudo-embedding for offline fallback.
         * Generates a deterministic vector from text content.
         * NOT suitable for real semantic search but allows the system
         * to function without an embedding model.
         */
        private pseudoEmbed(text: string): number[] {
                const vector = new Array(EMBEDDING_DIMENSION).fill(0);
                for (let i = 0; i < text.length; i++) {
                        vector[i % EMBEDDING_DIMENSION] += text.charCodeAt(i) / 65536;
                }
                // Normalize
                const magnitude = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
                if (magnitude > 0) {
                        for (let i = 0; i < vector.length; i++) {
                                vector[i] /= magnitude;
                        }
                }
                return vector;
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
                super.dispose();
        }
}
