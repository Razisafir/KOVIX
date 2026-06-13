/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IEmbeddingService } from '../../../../../../platform/construct/common/memory/embeddingService.js';
import { IFileWatcherService } from '../../../../../../platform/construct/common/watcher/fileWatcherService.js';
import {
        ICodebaseIndex, IFileSymbol, IIndexedFile, IIndexSearchResult
} from '../../../../../../platform/construct/common/indexing/codebaseIndex.js';

/**
 * Browser-layer implementation of ICodebaseIndex.
 * Uses IFileService for file access and the embedding service for vector similarity.
 */
export class CodebaseIndexService extends Disposable implements ICodebaseIndex {
        declare readonly _serviceBrand: undefined;

        private readonly _onDidStartIndexing = this._register(new Emitter<void>());
        readonly onDidStartIndexing: Event<void> = this._onDidStartIndexing.event;

        private readonly _onDidFinishIndexing = this._register(new Emitter<void>());
        readonly onDidFinishIndexing: Event<void> = this._onDidFinishIndexing.event;

        private _isIndexing = false;
        get isIndexing(): boolean { return this._isIndexing; }

        private indexedFiles: Map<string, IIndexedFile> = new Map();
        private embeddingCache: Map<string, number[]> = new Map();

        get indexedFileCount(): number { return this.indexedFiles.size; }

        constructor(
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IEmbeddingService private readonly embeddingService: IEmbeddingService,
                @IFileWatcherService private readonly fileWatcherService: IFileWatcherService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();

                // Re-index on file changes
                this._register(this.fileWatcherService.onDidChangeFiles(batch => {
                        for (const change of batch.changes) {
                                if (this.indexedFiles.has(change.uri.toString())) {
                                        this.indexSingleFile(change.uri).catch(err => {
                                                this.logService.debug('[CodebaseIndex] Re-index failed for', change.uri.toString(), err);
                                        });
                                }
                        }
                }));
        }

        async indexWorkspace(): Promise<void> {
                if (this._isIndexing) { return; }

                this._isIndexing = true;
                this._onDidStartIndexing.fire();

                try {
                        const workspace = this.workspaceContextService.getWorkspace();
                        if (!workspace.folders.length) { return; }

                        // Clear existing index
                        this.indexedFiles.clear();
                        this.embeddingCache.clear();

                        // Iterate through workspace folders
                        for (const folder of workspace.folders) {
                                try {
                                        await this.indexFolder(folder.uri);
                                } catch (error) {
                                        this.logService.warn('[CodebaseIndex] Failed to index folder:', folder.uri.toString(), error);
                                }
                        }

                        this.logService.info(`[CodebaseIndex] Indexed ${this.indexedFiles.size} files`);
                } finally {
                        this._isIndexing = false;
                        this._onDidFinishIndexing.fire();
                }
        }

        private async indexFolder(folderUri: URI): Promise<void> {
                try {
                        const stat = await this.fileService.resolve(folderUri, { resolveTo: [] });
                        if (stat.children) {
                                for (const child of stat.children) {
                                        if (child.isFile && this.isSourceFile(child.name)) {
                                                await this.indexSingleFile(child.resource);
                                        } else if (child.isDirectory && !this.shouldSkipDirectory(child.name)) {
                                                await this.indexFolder(child.resource);
                                        }
                                }
                        }
                } catch (error) {
                        this.logService.debug('[CodebaseIndex] Folder scan failed:', error);
                }
        }

        private async indexSingleFile(uri: URI): Promise<void> {
                try {
                        const content = await this.fileService.readFile(uri);
                        const text = content.value.toString();
                        const symbols = this.extractSymbols(text, uri.path);
                        const hash = this.simpleHash(text);

                        this.indexedFiles.set(uri.toString(), {
                                uri,
                                symbols,
                                hash,
                                indexedAt: Date.now(),
                        });

                        // Generate embedding for semantic search (best-effort)
                        try {
                                // Use a truncated version for embedding
                                const truncated = text.substring(0, 2000);
                                const embedding = await this.embeddingService.embed(truncated);
                                this.embeddingCache.set(uri.toString(), embedding);
                        } catch {
                                // Embedding may not be available, that's OK
                        }
                } catch (error) {
                        this.logService.debug('[CodebaseIndex] Failed to index file:', uri.toString(), error);
                }
        }

        async searchSemantic(query: string, maxResults: number = 10): Promise<IIndexSearchResult[]> {
                if (this.embeddingCache.size === 0) {
                        return [];
                }

                try {
                        const queryEmbedding = await this.embeddingService.embed(query);
                        const results: IIndexSearchResult[] = [];

                        for (const [uriStr, fileEmbedding] of this.embeddingCache) {
                                const score = this.cosineSimilarity(queryEmbedding, fileEmbedding);
                                const indexed = this.indexedFiles.get(uriStr);
                                if (indexed && score > 0.3) {
                                        results.push({
                                                uri: indexed.uri,
                                                score,
                                                matchedSymbols: indexed.symbols.filter(s => s.isExported).map(s => s.name),
                                        });
                                }
                        }

                        results.sort((a, b) => b.score - a.score);
                        return results.slice(0, maxResults);
                } catch {
                        return [];
                }
        }

        async searchSymbol(name: string): Promise<IIndexSearchResult[]> {
                const results: IIndexSearchResult[] = [];
                const lowerName = name.toLowerCase();

                for (const [, indexed] of this.indexedFiles) {
                        const matched = indexed.symbols.filter(s =>
                                s.name.toLowerCase().includes(lowerName)
                        );
                        if (matched.length > 0) {
                                results.push({
                                        uri: indexed.uri,
                                        score: matched.some(s => s.name.toLowerCase() === lowerName) ? 1.0 : 0.7,
                                        matchedSymbols: matched.map(s => s.name),
                                });
                        }
                }

                results.sort((a, b) => b.score - a.score);
                return results;
        }

        getFileSymbols(uri: URI): IFileSymbol[] {
                const indexed = this.indexedFiles.get(uri.toString());
                return indexed?.symbols ?? [];
        }

        // --- Symbol Extraction (regex-based) ---

        private extractSymbols(content: string, _filePath: string): IFileSymbol[] {
                const symbols: IFileSymbol[] = [];
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const lineNum = i + 1;

                        // Export patterns
                        const exportFuncMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)/);
                        if (exportFuncMatch) {
                                symbols.push({ name: exportFuncMatch[1], kind: 'function', line: lineNum, isExported: true });
                                continue;
                        }

                        const exportClassMatch = line.match(/export\s+(?:default\s+)?class\s+(\w+)/);
                        if (exportClassMatch) {
                                symbols.push({ name: exportClassMatch[1], kind: 'class', line: lineNum, isExported: true });
                                continue;
                        }

                        const exportConstMatch = line.match(/export\s+const\s+(\w+)/);
                        if (exportConstMatch) {
                                symbols.push({ name: exportConstMatch[1], kind: 'variable', line: lineNum, isExported: true });
                                continue;
                        }

                        const exportInterfaceMatch = line.match(/export\s+interface\s+(\w+)/);
                        if (exportInterfaceMatch) {
                                symbols.push({ name: exportInterfaceMatch[1], kind: 'interface', line: lineNum, isExported: true });
                                continue;
                        }

                        const exportTypeMatch = line.match(/export\s+type\s+(\w+)/);
                        if (exportTypeMatch) {
                                symbols.push({ name: exportTypeMatch[1], kind: 'type', line: lineNum, isExported: true });
                                continue;
                        }

                        const exportEnumMatch = line.match(/export\s+enum\s+(\w+)/);
                        if (exportEnumMatch) {
                                symbols.push({ name: exportEnumMatch[1], kind: 'enum', line: lineNum, isExported: true });
                                continue;
                        }

                        // Non-export patterns
                        const funcMatch = line.match(/(?:async\s+)?function\s+(\w+)/);
                        if (funcMatch && !line.includes('export')) {
                                symbols.push({ name: funcMatch[1], kind: 'function', line: lineNum, isExported: false });
                                continue;
                        }

                        const classMatch = line.match(/class\s+(\w+)/);
                        if (classMatch && !line.includes('export')) {
                                symbols.push({ name: classMatch[1], kind: 'class', line: lineNum, isExported: false });
                                continue;
                        }

                        // Import patterns
                        const importMatch = line.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
                        if (importMatch) {
                                symbols.push({ name: importMatch[1], kind: 'import', line: lineNum, isExported: false });
                                continue;
                        }
                }

                return symbols;
        }

        // --- Utility ---

        private isSourceFile(name: string): boolean {
                return /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|rb|php|cs|swift|kt)$/i.test(name);
        }

        private shouldSkipDirectory(name: string): boolean {
                return ['node_modules', '.git', 'dist', 'out', 'build', '__pycache__', '.svn', '.hg', 'vendor', '.tox'].includes(name);
        }

        private simpleHash(text: string): string {
                let hash = 0;
                for (let i = 0; i < text.length; i++) {
                        const char = text.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash |= 0; // Convert to 32bit integer
                }
                return hash.toString(16);
        }

        private cosineSimilarity(a: number[], b: number[]): number {
                if (a.length !== b.length) { return 0; }
                let dotProduct = 0;
                let normA = 0;
                let normB = 0;
                for (let i = 0; i < a.length; i++) {
                        dotProduct += a[i] * b[i];
                        normA += a[i] * a[i];
                        normB += b[i] * b[i];
                }
                const denominator = Math.sqrt(normA) * Math.sqrt(normB);
                return denominator === 0 ? 0 : dotProduct / denominator;
        }
}
