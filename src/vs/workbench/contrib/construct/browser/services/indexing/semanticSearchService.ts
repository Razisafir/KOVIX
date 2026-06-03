/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Semantic Search Service
 *  Natural language → embedding → vector search with hybrid keyword matching.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import {
        ISearchResult,
        IIndexQuery,
        SymbolType,
        CODEBASE_COLLECTION_PREFIX,
        DEFAULT_TOP_K,
        VECTOR_WEIGHT,
        KEYWORD_WEIGHT
} from '../../../../platform/construct/common/indexing/indexingTypes.js';

// ─── Query Intent Parsing ──────────────────────────────────────────────────

interface IQueryIntent {
        keywords: string[];
        symbolType?: SymbolType;
        language?: string;
        isDefinition: boolean;
        isUsage: boolean;
}

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: Partial<IQueryIntent> }> = [
        { pattern: /where\s+(?:is|are|does)\s+(\w+)/i, intent: { isDefinition: true } },
        { pattern: /how\s+(?:does|do)\s+(\w+)/i, intent: { isUsage: true } },
        { pattern: /find\s+(?:all\s+)?(?:references\s+to\s+)?(\w+)/i, intent: { isUsage: true } },
        { pattern: /what\s+(?:is|are)\s+(\w+)/i, intent: { isDefinition: true } },
        { pattern: /show\s+me\s+(?:the\s+)?(\w+)/i, intent: { isDefinition: true } },
        { pattern: /class\s+(\w+)/i, intent: { symbolType: SymbolType.Class } },
        { pattern: /function\s+(\w+)/i, intent: { symbolType: SymbolType.Function } },
        { pattern: /interface\s+(\w+)/i, intent: { symbolType: SymbolType.Interface } },
        { pattern: /type\s+(\w+)/i, intent: { symbolType: SymbolType.Type } },
        { pattern: /enum\s+(\w+)/i, intent: { symbolType: SymbolType.Enum } },
        { pattern: /method\s+(\w+)/i, intent: { symbolType: SymbolType.Method } }
];

// ─── Service ───────────────────────────────────────────────────────────────

export class SemanticSearchService extends Disposable {
        constructor(
                @ILogService private readonly logService: ILogService,
                @IEmbeddingService private readonly embeddingService: IEmbeddingService,
                @ISemanticMemoryService private readonly semanticMemory: ISemanticMemoryService
        ) {
                super();
        }

        /**
         * Perform a hybrid search: vector similarity + keyword matching.
         */
        async search(query: IIndexQuery): Promise<ISearchResult[]> {
                const topK = query.topK ?? DEFAULT_TOP_K;
                const intent = this.parseQueryIntent(query.query);
                const collectionName = `${CODEBASE_COLLECTION_PREFIX}${query.projectId}`;

                // Get vector search results
                const vectorResults = await this.vectorSearch(query.query, collectionName, topK * 2);

                // Get keyword search results
                const keywordResults = this.keywordSearch(
                        intent.keywords,
                        query.projectId,
                        topK * 2,
                        query
                );

                // Merge and rank results
                const merged = this.mergeResults(vectorResults, keywordResults, topK);

                // Apply filters
                const filtered = this.applyFilters(merged, query);

                // Add surrounding context to results
                const withContext = await this.addSurroundingContext(filtered);

                this.logService.info(`[SemanticSearch] Query "${query.query}" returned ${withContext.length} results ` +
                        `(vector: ${vectorResults.length}, keyword: ${keywordResults.length})`);

                return withContext;
        }

        /**
         * Parse natural language query to extract search intent.
         */
        parseQueryIntent(query: string): IQueryIntent {
                const intent: IQueryIntent = {
                        keywords: [],
                        isDefinition: false,
                        isUsage: false
                };

                // Extract meaningful keywords (remove stop words)
                const stopWords = new Set([
                        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
                        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
                        'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
                        'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
                        'how', 'what', 'where', 'which', 'who', 'whom', 'whose', 'when', 'why',
                        'this', 'that', 'these', 'those', 'it', 'its', 'me', 'my', 'we', 'our'
                ]);

                const words = query.split(/[\s,.!?;:]+/).filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));
                intent.keywords = words;

                // Check intent patterns
                for (const { pattern, intent: partialIntent } of INTENT_PATTERNS) {
                        const match = query.match(pattern);
                        if (match) {
                                if (partialIntent.isDefinition) { intent.isDefinition = true; }
                                if (partialIntent.isUsage) { intent.isUsage = true; }
                                if (partialIntent.symbolType) { intent.symbolType = partialIntent.symbolType; }
                                // Add the captured group as a priority keyword
                                if (match[1] && !intent.keywords.includes(match[1])) {
                                        intent.keywords.unshift(match[1]);
                                }
                        }
                }

                return intent;
        }

        /**
         * Vector similarity search using embeddings.
         */
        private async vectorSearch(query: string, collectionName: string, topK: number): Promise<ISearchResult[]> {
                try {
                        const queryEmbedding = await this.embeddingService.generateEmbedding(query);
                        if (queryEmbedding.length === 0) {
                                this.logService.warn('[SemanticSearch] Empty embedding for query');
                                return [];
                        }

                        // Search using semantic memory (Qdrant)
                        const results = await this.semanticMemory.searchSimilar(
                                collectionName,
                                queryEmbedding,
                                topK
                        );

                        return results.map((r: any) => ({
                                file: r.payload?.file ?? '',
                                line: r.payload?.startLine ?? 0,
                                column: 0,
                                symbol: r.payload?.symbol ?? '',
                                type: (r.payload?.symbolType as SymbolType) ?? SymbolType.Function,
                                content: r.payload?.content?.substring(0, 200) ?? '',
                                relevance: r.score ?? 0,
                                surroundingContext: ''
                        }));
                } catch (error) {
                        this.logService.warn(`[SemanticSearch] Vector search failed: ${error}`);
                        return [];
                }
        }

        /**
         * Simple keyword matching search.
         */
        private keywordSearch(keywords: string[], projectId: string, topK: number, query: IIndexQuery): ISearchResult[] {
                // This is a simplified in-memory keyword search.
                // In production, this would use a proper inverted index (e.g., BM25).
                const results: ISearchResult[] = [];
                const scored = new Map<string, number>();

                for (const keyword of keywords) {
                        const lowerKeyword = keyword.toLowerCase();
                        // Score based on keyword match
                        const baseScore = keyword === keywords[0] ? 0.8 : 0.5; // First keyword gets higher weight
                        scored.set(lowerKeyword, (scored.get(lowerKeyword) ?? 0) + baseScore);
                }

                // Convert scored keywords to placeholder results
                // Real implementation would search an inverted index
                for (const [keyword, score] of scored) {
                        results.push({
                                file: '',
                                line: 0,
                                column: 0,
                                symbol: keyword,
                                type: query.symbolType ?? SymbolType.Function,
                                content: '',
                                relevance: score * KEYWORD_WEIGHT,
                                surroundingContext: ''
                        });
                }

                return results.slice(0, topK);
        }

        /**
         * Merge vector and keyword results with weighted scoring.
         */
        private mergeResults(vectorResults: ISearchResult[], keywordResults: ISearchResult[], topK: number): ISearchResult[] {
                const merged = new Map<string, ISearchResult & { score: number }>();

                // Add vector results
                for (const result of vectorResults) {
                        const key = `${result.file}:${result.line}:${result.symbol}`;
                        const existing = merged.get(key);
                        const score = result.relevance * VECTOR_WEIGHT;

                        if (existing) {
                                existing.score += score;
                                existing.relevance = existing.score;
                        } else {
                                merged.set(key, { ...result, relevance: score, score });
                        }
                }

                // Add keyword results
                for (const result of keywordResults) {
                        if (!result.file) { continue; }
                        const key = `${result.file}:${result.line}:${result.symbol}`;
                        const existing = merged.get(key);
                        const score = result.relevance * KEYWORD_WEIGHT;

                        if (existing) {
                                existing.score += score;
                                existing.relevance = existing.score;
                        } else {
                                merged.set(key, { ...result, relevance: score, score });
                        }
                }

                // Sort by combined score and return top K
                return Array.from(merged.values())
                        .sort((a, b) => b.score - a.score)
                        .slice(0, topK)
                        .map(({ score, ...result }) => result);
        }

        /**
         * Apply query filters (language, symbol type, directory).
         */
        private applyFilters(results: ISearchResult[], query: IIndexQuery): ISearchResult[] {
                let filtered = results;

                if (query.language) {
                        filtered = filtered.filter(r => r.file.endsWith(`.${query.language}`) ||
                                r.file.includes(`/${query.language}/`));
                }

                if (query.symbolType) {
                        filtered = filtered.filter(r => r.type === query.symbolType);
                }

                if (query.directory) {
                        filtered = filtered.filter(r => r.file.startsWith(query.directory!));
                }

                if (query.fileType) {
                        filtered = filtered.filter(r => r.file.endsWith(query.fileType!));
                }

                return filtered;
        }

        /**
         * Add surrounding context (±5 lines) to search results.
         */
        private async addSurroundingContext(results: ISearchResult[]): Promise<ISearchResult[]> {
                // In a full implementation, this would read the actual file content
                // and extract ±5 lines around the match. For now, we pass through
                // the content we already have.
                return results.map(r => ({
                        ...r,
                        surroundingContext: r.content || r.surroundingContext
                }));
        }
}
