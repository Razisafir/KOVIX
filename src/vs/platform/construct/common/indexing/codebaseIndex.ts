// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';

export const ICodebaseIndex = createDecorator<ICodebaseIndex>('construct.codebaseIndex');

/**
 * A symbol extracted from a source file.
 */
export interface IFileSymbol {
	/** Symbol name */
	name: string;
	/** Symbol kind */
	kind: 'function' | 'class' | 'variable' | 'import' | 'export' | 'interface' | 'type' | 'enum' | 'method' | 'property';
	/** Line number where the symbol is defined */
	line: number;
	/** Optional type annotation */
	type?: string;
	/** Whether this symbol is exported */
	isExported: boolean;
}

/**
 * A file entry in the codebase index.
 */
export interface IIndexedFile {
	/** File URI */
	uri: URI;
	/** Symbols found in this file */
	symbols: IFileSymbol[];
	/** File hash for change detection */
	hash: string;
	/** Last indexed timestamp */
	indexedAt: number;
}

/**
 * Search result from the codebase index.
 */
export interface IIndexSearchResult {
	/** File URI */
	uri: URI;
	/** Relevance score (0-1) */
	score: number;
	/** Matching symbol names, if any */
	matchedSymbols?: string[];
	/** Matching text snippet */
	snippet?: string;
}

/**
 * ICodebaseIndex — semantic and symbol-based code search.
 *
 * Provides:
 * - Full-text search using ripgrep (via VS Code's search service)
 * - Semantic search using embeddings
 * - Symbol table: functions, classes, variables, imports, exports per file
 * - Persistent index stored in ~/.kovix/index/
 * - Auto-reindex on file changes (via file watcher)
 */
export interface ICodebaseIndex {
	readonly _serviceBrand: undefined;

	/**
	 * Index the entire workspace.
	 * Scans all source files, extracts symbols, and generates embeddings.
	 */
	indexWorkspace(): Promise<void>;

	/**
	 * Perform semantic search using embeddings.
	 * Returns files most similar to the given query.
	 *
	 * @param query Natural language search query.
	 * @param maxResults Maximum number of results to return.
	 */
	searchSemantic(query: string, maxResults?: number): Promise<IIndexSearchResult[]>;

	/**
	 * Search for a symbol by name (exact or fuzzy).
	 *
	 * @param name Symbol name to search for.
	 */
	searchSymbol(name: string): Promise<IIndexSearchResult[]>;

	/**
	 * Get all symbols for a specific file.
	 *
	 * @param uri File URI.
	 */
	getFileSymbols(uri: URI): IFileSymbol[];

	/**
	 * Event fired when indexing starts.
	 */
	readonly onDidStartIndexing: Event<void>;

	/**
	 * Event fired when indexing completes.
	 */
	readonly onDidFinishIndexing: Event<void>;

	/**
	 * Whether the index is currently being built.
	 */
	readonly isIndexing: boolean;

	/**
	 * Get the total number of indexed files.
	 */
	readonly indexedFileCount: number;
}
