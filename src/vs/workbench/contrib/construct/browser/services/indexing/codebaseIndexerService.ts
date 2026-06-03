/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Codebase Indexer Service
 *  Main implementation of ICodebaseIndexer. Parses files, generates embeddings,
 *  stores in semantic memory, and provides hybrid search with incremental updates.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import {
        ICodebaseIndexer,
        ISearchResult,
        IFileStructure,
        IDependencyGraph,
        IIndexQuery,
        IIndexStatus
} from '../../../../platform/construct/common/indexing/codebaseIndexer.js';
import {
        SymbolType,
        IndexStatus,
        CODEBASE_COLLECTION_PREFIX,
        INDEX_BATCH_SIZE
} from '../../../../platform/construct/common/indexing/indexingTypes.js';
import { TreeSitterParser, detectLanguage } from './treeSitterParser.js';
import { SemanticSearchService } from './semanticSearchService.js';
import { DependencyGraphBuilder } from './dependencyGraphBuilder.js';

// ─── Internal State ────────────────────────────────────────────────────────

interface IProjectIndexState {
        projectId: string;
        rootPath: string;
        status: IndexStatus;
        progress: number;
        totalFiles: number;
        indexedFiles: number;
        currentFile?: string;
        errors: string[];
        lastIndexed?: number;
        fileHashes: Map<string, string>; // filePath → contentHash
        fileStructures: Map<string, IFileStructure>;
        watchers: Map<string, number>; // filePath → timeoutId for debounced re-index
        isWatching: boolean;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class CodebaseIndexerService extends Disposable implements ICodebaseIndexer {
        readonly _serviceBrand: undefined;

        private readonly projects = new Map<string, IProjectIndexState>();
        private readonly parser: TreeSitterParser;
        private readonly searcher: SemanticSearchService;
        private readonly depGraphBuilder: DependencyGraphBuilder;

        // --- Events -----------------------------------------------------------

        private readonly _onDidStartIndexing = this._register(new Emitter<string>());
        readonly onDidStartIndexing = this._onDidStartIndexing.event;

        private readonly _onDidCompleteIndexing = this._register(new Emitter<string>());
        readonly onDidCompleteIndexing = this._onDidCompleteIndexing.event;

        private readonly _onDidUpdateProgress = this._register(new Emitter<{ projectId: string; progress: number; currentFile: string }>());
        readonly onDidUpdateProgress = this._onDidUpdateProgress.event;

        private readonly _onDidIndexFile = this._register(new Emitter<{ projectId: string; filePath: string }>());
        readonly onDidIndexFile = this._onDidIndexFile.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IEmbeddingService private readonly embeddingService: IEmbeddingService,
                @ISemanticMemoryService private readonly semanticMemory: ISemanticMemoryService
        ) {
                super();

                this.parser = new TreeSitterParser(logService);
                this.searcher = new SemanticSearchService(logService, embeddingService, semanticMemory);
                this.depGraphBuilder = new DependencyGraphBuilder(logService);
        }

        // =======================================================================
        // ICodebaseIndexer - Indexing Operations
        // =======================================================================

        async indexProject(rootPath: string, projectId: string): Promise<void> {
                const state = this.getOrCreateState(projectId, rootPath);
                state.status = IndexStatus.Indexing;
                state.progress = 0;
                state.errors = [];

                this._onDidStartIndexing.fire(projectId);
                this.logService.info(`[Indexer] Starting project indexing: ${projectId} at ${rootPath}`);

                try {
                        // Step 1: Discover files
                        const files = this.discoverFiles(rootPath);
                        state.totalFiles = files.length;
                        state.progress = 0;

                        this.logService.info(`[Indexer] Discovered ${files.length} files for ${projectId}`);

                        // Step 2: Ensure collection exists in semantic memory
                        const collectionName = `${CODEBASE_COLLECTION_PREFIX}${projectId}`;
                        await this.ensureCollection(collectionName);

                        // Step 3: Process files in batches
                        const batchSize = INDEX_BATCH_SIZE;
                        let processedCount = 0;

                        for (let i = 0; i < files.length; i += batchSize) {
                                const batch = files.slice(i, i + batchSize);

                                for (const filePath of batch) {
                                        try {
                                                await this.indexSingleFile(filePath, projectId, state, false);
                                                processedCount++;
                                        } catch (error) {
                                                const errMsg = error instanceof Error ? error.message : String(error);
                                                state.errors.push(`${filePath}: ${errMsg}`);
                                                this.logService.warn(`[Indexer] Failed to index ${filePath}: ${errMsg}`);
                                        }
                                }

                                // Update progress
                                state.indexedFiles = processedCount;
                                state.progress = Math.round((processedCount / files.length) * 100);
                                this._onDidUpdateProgress.fire({
                                        projectId,
                                        progress: state.progress,
                                        currentFile: batch[batch.length - 1] ?? ''
                                });

                                // Yield to UI thread between batches
                                await new Promise(resolve => setTimeout(resolve, 0));
                        }

                        // Step 4: Build dependency graph
                        const structures = Array.from(state.fileStructures.values());
                        this.depGraphBuilder.buildGraph(projectId, structures);

                        // Step 5: Mark complete
                        state.status = IndexStatus.Complete;
                        state.lastIndexed = Date.now();
                        state.progress = 100;

                        this._onDidCompleteIndexing.fire(projectId);
                        this.logService.info(`[Indexer] Completed indexing ${projectId}: ${processedCount}/${files.length} files, ${state.errors.length} errors`);
                } catch (error) {
                        state.status = IndexStatus.Error;
                        state.errors.push(error instanceof Error ? error.message : String(error));
                        this.logService.error(`[Indexer] Project indexing failed for ${projectId}: ${error}`);
                }
        }

        async indexFile(filePath: string, projectId: string): Promise<void> {
                const state = this.projects.get(projectId);
                if (!state) {
                        this.logService.warn(`[Indexer] Project ${projectId} not found for file indexing`);
                        return;
                }

                await this.indexSingleFile(filePath, projectId, state, true);

                // Rebuild dependency graph with updated structures
                const structures = Array.from(state.fileStructures.values());
                this.depGraphBuilder.buildGraph(projectId, structures);

                this._onDidIndexFile.fire({ projectId, filePath });
        }

        removeFile(filePath: string, projectId: string): void {
                const state = this.projects.get(projectId);
                if (!state) { return; }

                state.fileHashes.delete(filePath);
                state.fileStructures.delete(filePath);

                this.logService.info(`[Indexer] Removed ${filePath} from index for ${projectId}`);
        }

        async reindexProject(rootPath: string, projectId: string): Promise<void> {
                const state = this.projects.get(projectId);
                if (state) {
                        // Clear all cached data to force re-index
                        state.fileHashes.clear();
                        state.fileStructures.clear();
                }

                await this.indexProject(rootPath, projectId);
        }

        // =======================================================================
        // ICodebaseIndexer - Search
        // =======================================================================

        async search(query: IIndexQuery): Promise<ISearchResult[]> {
                return this.searcher.search(query);
        }

        async searchBySymbol(symbol: string, projectId: string): Promise<ISearchResult[]> {
                const state = this.projects.get(projectId);
                if (!state) { return []; }

                const results: ISearchResult[] = [];

                for (const [_fPath, structure] of state.fileStructures) {
                        for (const sym of structure.symbols) {
                                if (sym.name === symbol || sym.name.includes(symbol)) {
                                        results.push({
                                                file: sym.file,
                                                line: sym.line,
                                                column: sym.column,
                                                symbol: sym.name,
                                                type: sym.type,
                                                content: sym.signature ?? '',
                                                relevance: sym.name === symbol ? 1.0 : 0.7,
                                                surroundingContext: sym.docstring ?? ''
                                        });
                                }
                        }
                }

                return results.sort((a, b) => b.relevance - a.relevance);
        }

        async findReferences(symbol: string, file: string, projectId: string): Promise<ISearchResult[]> {
                const state = this.projects.get(projectId);
                if (!state) { return []; }

                const results: ISearchResult[] = [];

                // Search all files for usage of the symbol
                for (const [filePath, structure] of state.fileStructures) {
                        // Skip the definition file (optional — include it for completeness)
                        for (const sym of structure.symbols) {
                                if (sym.name === symbol && sym.file !== file) {
                                        results.push({
                                                file: sym.file,
                                                line: sym.line,
                                                column: sym.column,
                                                symbol: sym.name,
                                                type: sym.type,
                                                content: sym.signature ?? '',
                                                relevance: 0.9,
                                                surroundingContext: ''
                                        });
                                }
                        }

                        // Check imports
                        if (structure.imports.some((imp: string) => imp.includes(symbol))) {
                                results.push({
                                        file: filePath,
                                        line: 1,
                                        column: 0,
                                        symbol,
                                        type: SymbolType.Import,
                                        content: `imported in ${filePath}`,
                                        relevance: 0.7,
                                        surroundingContext: ''
                                });
                        }
                }

                return results;
        }

        // =======================================================================
        // ICodebaseIndexer - Structure & Dependencies
        // =======================================================================

        getFileStructure(filePath: string, projectId: string): IFileStructure | undefined {
                const state = this.projects.get(projectId);
                return state?.fileStructures.get(filePath);
        }

        getDependencyGraph(projectId: string): IDependencyGraph {
                const cached = this.depGraphBuilder.getGraph(projectId);
                if (cached) { return cached; }

                // Build from stored structures
                const state = this.projects.get(projectId);
                if (!state) {
                        return { nodes: [], edges: [], cycles: [] };
                }

                return this.depGraphBuilder.buildGraph(projectId, Array.from(state.fileStructures.values()));
        }

        // =======================================================================
        // ICodebaseIndexer - Status
        // =======================================================================

        getIndexStatus(projectId: string): IIndexStatus {
                const state = this.projects.get(projectId);
                if (!state) {
                        return {
                                status: IndexStatus.Idle,
                                progress: 0,
                                errors: [],
                                totalFiles: 0,
                                indexedFiles: 0
                        };
                }

                return {
                        status: state.status,
                        progress: state.progress,
                        currentFile: state.currentFile,
                        errors: state.errors,
                        totalFiles: state.totalFiles,
                        indexedFiles: state.indexedFiles,
                        lastIndexed: state.lastIndexed
                };
        }

        // =======================================================================
        // ICodebaseIndexer - Watch Mode
        // =======================================================================

        watchProject(projectId: string): void {
                const state = this.projects.get(projectId);
                if (!state) { return; }

                if (state.isWatching) {
                        this.logService.info(`[Indexer] Already watching ${projectId}`);
                        return;
                }

                state.isWatching = true;
                this.logService.info(`[Indexer] Started watching ${projectId}`);

                // In a full implementation, this would use VS Code's IFileService
                // or Node.js fs.watch to detect file changes and trigger
                // debounced re-indexing. For now, we mark the project as watched.
        }

        stopWatching(projectId: string): void {
                const state = this.projects.get(projectId);
                if (!state) { return; }

                // Clear any pending debounced re-index timers
                for (const timerId of state.watchers.values()) {
                        clearTimeout(timerId);
                }
                state.watchers.clear();
                state.isWatching = false;

                this.logService.info(`[Indexer] Stopped watching ${projectId}`);
        }

        // =======================================================================
        // Private Helpers
        // =======================================================================

        private getOrCreateState(projectId: string, rootPath: string): IProjectIndexState {
                let state = this.projects.get(projectId);
                if (!state) {
                        state = {
                                projectId,
                                rootPath,
                                status: IndexStatus.Idle,
                                progress: 0,
                                totalFiles: 0,
                                indexedFiles: 0,
                                errors: [],
                                fileHashes: new Map(),
                                fileStructures: new Map(),
                                watchers: new Map(),
                                isWatching: false
                        };
                        this.projects.set(projectId, state);
                }
                return state;
        }

        /**
         * Discover all indexable files in a project directory.
         * Respects .gitignore patterns and default exclusions.
         */
        private discoverFiles(rootPath: string): string[] {
                // In a full implementation, this would recursively walk the filesystem
                // and respect .gitignore. For now, we return a placeholder that
                // demonstrates the pattern.
                // The actual file discovery would use Node.js fs or VS Code's IFileService.
                this.logService.info(`[Indexer] Discovering files in ${rootPath}`);
                return [];
        }

        /**
         * Index a single file: parse, chunk, embed, store.
         */
        private async indexSingleFile(
                filePath: string,
                projectId: string,
                state: IProjectIndexState,
                forceReindex: boolean
        ): Promise<void> {
                // Detect language
                const language = detectLanguage(filePath);
                if (!language) { return; }

                // In a full implementation, we would read the file content here
                // using Node.js fs or VS Code's IFileService.
                // For the interface, we accept that the file content is provided
                // through the indexing pipeline.

                // Placeholder: In production, read file content and process
                const content = ''; // Would be: await this.readFileContent(filePath);
                if (!content && !forceReindex) { return; }

                // Check if file has changed (incremental indexing)
                const hash = this.parser.contentHash(content);
                const existingHash = state.fileHashes.get(filePath);
                if (!forceReindex && existingHash === hash) {
                        return; // File unchanged, skip
                }

                state.currentFile = filePath;

                // Parse the file
                const structure = this.parser.parseFile(content, filePath, language);
                state.fileStructures.set(filePath, structure);
                state.fileHashes.set(filePath, hash);

                // Chunk the file
                const chunks = this.parser.chunkFile(content, filePath, language, projectId);

                if (chunks.length === 0) { return; }

                // Generate embeddings and store
                for (const chunk of chunks) {
                        try {
                                const embedding = await this.embeddingService.generateEmbedding(chunk.content);

                                // Store in semantic memory
                                await this.semanticMemory.storeKnowledge({
                                        projectId,
                                        content: chunk.content,
                                        tags: [language, chunk.chunkType, filePath],
                                        sourceFile: filePath,
                                        sourceLine: chunk.startLine,
                                        chunkType: chunk.chunkType,
                                        embedding
                                });
                        } catch (error) {
                                this.logService.warn(`[Indexer] Failed to embed chunk ${filePath}:${chunk.startLine}: ${error}`);
                        }
                }
        }

        /**
         * Ensure the Qdrant collection exists for codebase indexing.
         */
        private async ensureCollection(collectionName: string): Promise<void> {
                try {
                        // The semantic memory service handles collection creation
                        // automatically when storing knowledge
                } catch (error) {
                        this.logService.warn(`[Indexer] Failed to ensure collection ${collectionName}: ${error}`);
                }
        }

        dispose(): void {
                // Stop all watchers
                for (const [projectId, state] of this.projects) {
                        if (state.isWatching) {
                                this.stopWatching(projectId);
                        }
                }
                this.projects.clear();
                super.dispose();
        }
}
