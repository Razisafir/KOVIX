/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Codebase Indexer Interface
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ISearchResult,
	IFileStructure,
	IDependencyGraph,
	IIndexQuery,
	IIndexStatus
} from './indexingTypes.js';

export const ICodebaseIndexer = createDecorator<ICodebaseIndexer>('construct.codebaseIndexer');

export interface ICodebaseIndexer extends IDisposable {
	readonly _serviceBrand: undefined;

	// ─── Indexing Operations ────────────────────────────────────────────

	/** Index an entire project. Discovers files, parses, embeds, stores. */
	indexProject(rootPath: string, projectId: string): Promise<void>;

	/** Index a single file (used for incremental updates). */
	indexFile(filePath: string, projectId: string): Promise<void>;

	/** Remove a file from the index. */
	removeFile(filePath: string, projectId: string): void;

	/** Force re-index of a project (ignores mtime/hash cache). */
	reindexProject(rootPath: string, projectId: string): Promise<void>;

	// ─── Search ─────────────────────────────────────────────────────────

	/** Search the index with a structured query (hybrid vector + keyword). */
	search(query: IIndexQuery): Promise<ISearchResult[]>;

	/** Search by exact symbol name (fast, keyword-based). */
	searchBySymbol(symbol: string, projectId: string): Promise<ISearchResult[]>;

	/** Find all references to a symbol across the codebase. */
	findReferences(symbol: string, file: string, projectId: string): Promise<ISearchResult[]>;

	// ─── Structure & Dependencies ───────────────────────────────────────

	/** Get the parsed structure of a file (symbols, imports, exports). */
	getFileStructure(filePath: string, projectId: string): IFileStructure | undefined;

	/** Get the import dependency graph for a project. */
	getDependencyGraph(projectId: string): IDependencyGraph;

	// ─── Status ─────────────────────────────────────────────────────────

	/** Get the current indexing status for a project. */
	getIndexStatus(projectId: string): IIndexStatus;

	// ─── Watch Mode ─────────────────────────────────────────────────────

	/** Start watching a project for file changes (incremental re-index). */
	watchProject(projectId: string): void;

	/** Stop watching a project. */
	stopWatching(projectId: string): void;

	// ─── Events ─────────────────────────────────────────────────────────

	/** Fired when indexing starts for a project. */
	readonly onDidStartIndexing: Event<string>; // projectId

	/** Fired when indexing completes for a project. */
	readonly onDidCompleteIndexing: Event<string>; // projectId

	/** Fired when indexing progress updates. */
	readonly onDidUpdateProgress: Event<{ projectId: string; progress: number; currentFile: string }>;

	/** Fired when a single file is indexed. */
	readonly onDidIndexFile: Event<{ projectId: string; filePath: string }>;
}
