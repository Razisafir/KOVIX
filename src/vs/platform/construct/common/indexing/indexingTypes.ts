/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Codebase Indexing Types
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// ─── Symbol Types ──────────────────────────────────────────────────────────

export const enum SymbolType {
	Function = 'function',
	Class = 'class',
	Variable = 'variable',
	Import = 'import',
	Comment = 'comment',
	Interface = 'interface',
	Enum = 'enum',
	Type = 'type',
	Method = 'method',
	Property = 'property',
	Constant = 'constant'
}

// ─── Index Status ──────────────────────────────────────────────────────────

export const enum IndexStatus {
	Idle = 'idle',
	Indexing = 'indexing',
	Complete = 'complete',
	Error = 'error'
}

// ─── Core Interfaces ───────────────────────────────────────────────────────

export interface ISymbol {
	readonly name: string;
	readonly type: SymbolType;
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly signature?: string;
	readonly docstring?: string;
	readonly parent?: string;
}

export interface ICodeChunk {
	readonly id: string;
	readonly content: string;
	readonly file: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly symbol?: string;
	readonly embedding: number[];
	readonly language: string;
	readonly chunkType: 'function' | 'class' | 'module' | 'block';
	readonly projectId: string;
	readonly hash: string;
}

export interface ISearchResult {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly symbol: string;
	readonly type: SymbolType;
	readonly content: string;
	readonly relevance: number;
	readonly surroundingContext: string;
}

export interface IFileStructure {
	readonly file: string;
	readonly language: string;
	readonly symbols: ISymbol[];
	readonly imports: string[];
	readonly exports: string[];
	readonly size: number;
	readonly lastModified: number;
}

export interface IDependencyEdge {
	readonly from: string;
	readonly to: string;
	readonly importNames: string[];
}

export interface IDependencyGraph {
	readonly nodes: string[];
	readonly edges: IDependencyEdge[];
	readonly cycles: string[][];
}

export interface IIndexQuery {
	readonly query: string;
	readonly language?: string;
	readonly fileType?: string;
	readonly directory?: string;
	readonly symbolType?: SymbolType;
	readonly topK?: number;
	readonly semantic?: boolean;
	readonly projectId: string;
}

export interface IIndexStatus {
	readonly status: IndexStatus;
	readonly progress: number;
	readonly currentFile?: string;
	readonly errors: string[];
	readonly totalFiles: number;
	readonly indexedFiles: number;
	readonly lastIndexed?: number;
}

export interface ICodebaseIndex {
	readonly projectId: string;
	readonly rootPath: string;
	readonly status: IndexStatus;
	readonly progressPercent: number;
	readonly lastIndexed: number;
	readonly totalFiles: number;
	readonly indexedFiles: number;
}

// ─── Supported Languages ───────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES: Record<string, string> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.py': 'python',
	'.rs': 'rust',
	'.go': 'go',
	'.java': 'java',
	'.cpp': 'cpp',
	'.cc': 'cpp',
	'.cxx': 'cpp',
	'.h': 'cpp',
	'.hpp': 'cpp',
	'.rb': 'ruby',
	'.php': 'php',
	'.cs': 'csharp',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.vue': 'vue',
	'.svelte': 'svelte'
};

// ─── Exclusion Patterns ────────────────────────────────────────────────────

export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
	'node_modules',
	'.git',
	'dist',
	'build',
	'out',
	'.next',
	'.nuxt',
	'coverage',
	'.cache',
	'.vscode',
	'__pycache__',
	'.DS_Store',
	'target',
	'bin',
	'obj',
	'.gradle',
	'.idea',
	'vendor',
	'.venv',
	'env'
];

// ─── Constants ─────────────────────────────────────────────────────────────

export const CODEBASE_COLLECTION_PREFIX = 'construct_codebase_';
export const INDEX_STORAGE_KEY = 'construct.index.status';
export const INDEX_BATCH_SIZE = 10;
export const INDEX_DEBOUNCE_MS = 500;
export const CONTEXT_LINES_BEFORE = 5;
export const CONTEXT_LINES_AFTER = 5;
export const DEFAULT_TOP_K = 20;
export const VECTOR_WEIGHT = 0.7;
export const KEYWORD_WEIGHT = 0.3;
