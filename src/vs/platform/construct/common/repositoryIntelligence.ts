/*---------------------------------------------------------------------------------------------
 *  Repository Intelligence Engine
 *  AI Execution Kernel -- Repository Analysis Service
 *  Construct IDE -- AI-Native IDE
 *
 *  IRepositoryIntelligenceService -- Scans, classifies, and maps code repositories.
 *  Provides project type detection, framework identification, dependency graphing,
 *  file importance ranking, architecture summarization, and semantic mapping.
 *
 *  HONEST limitation: This is text-based and regex-based analysis, NOT full AST
 *  semantic analysis. It can detect common patterns but cannot fully understand
 *  dynamic imports, computed require() calls, or runtime module resolution.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

// ─── Enumerations ─────────────────────────────────────────────────────────────

/**
 * The type of project detected in the repository.
 */
export enum ProjectType {
	WebApp = 'web-app',
	CLITool = 'cli-tool',
	Library = 'library',
	Extension = 'extension',
	MobileApp = 'mobile-app',
	DesktopApp = 'desktop-app',
	API = 'api',
	Monorepo = 'monorepo',
	Unknown = 'unknown',
}

/**
 * Programming languages detected in the repository.
 */
export enum Language {
	TypeScript = 'typescript',
	JavaScript = 'javascript',
	Python = 'python',
	Rust = 'rust',
	Go = 'go',
	Java = 'java',
	CSharp = 'csharp',
	Ruby = 'ruby',
	PHP = 'php',
	Other = 'other',
}

// ─── Data Types ───────────────────────────────────────────────────────────────

/**
 * A detected framework with its name, optional version, and category.
 */
export type Framework = {
	name: string;
	version?: string;
	category: 'frontend' | 'backend' | 'fullstack' | 'testing' | 'build' | 'deploy';
};

/**
 * How important a file is within the repository structure.
 * Based on how many other files depend on it, whether it is an entry point, etc.
 */
export enum FileImportance {
	Critical = 'critical',
	High = 'high',
	Medium = 'medium',
	Low = 'low',
	Generated = 'generated',
}

/**
 * A node in the dependency graph representing a single file.
 */
export type DependencyNode = {
	path: string;
	imports: string[];
	importedBy: string[];
	importance: FileImportance;
};

/**
 * The result of scanning a repository. Contains all detected metadata.
 */
export type RepositoryScanResult = {
	rootPath: string;
	projectType: ProjectType;
	languages: Language[];
	frameworks: Framework[];
	entryPoints: string[];
	configFiles: string[];
	buildSystem: string | null;
	dependencyGraph: DependencyNode[];
	fileCount: number;
	totalSizeBytes: number;
	scannedAt: number;
};

/**
 * A summary of the repository architecture.
 */
export type ArchitectureSummary = {
	description: string;
	moduleCount: number;
	layerPattern: string | null;
	keyModules: { name: string; path: string; role: string }[];
};

// ─── Service Interface ────────────────────────────────────────────────────────

/**
 * IRepositoryIntelligenceService -- Repository Intelligence Engine.
 *
 * Scans and analyzes code repositories to extract structural metadata:
 *   - Project type classification (web app, CLI, library, etc.)
 *   - Framework detection from dependency manifests
 *   - Language detection from file extensions
 *   - Dependency graph construction from import/require analysis
 *   - File importance ranking based on dependency centrality
 *   - Architecture pattern detection (MVC, layered, monorepo, etc.)
 *   - Semantic map extraction (exported symbols, file summaries)
 *
 * HONEST limitations:
 *   - Dependency graph is built from text/regex analysis of import statements,
 *     NOT from a full AST or TypeScript compiler API. Dynamic imports and
 *     computed require() calls will be missed.
 *   - Architecture detection is heuristic-based, not semantically verified.
 *   - Semantic map uses regex to find exported symbols, which may miss
 *     re-exports, default exports with computed names, or namespace imports.
 */
export interface IRepositoryIntelligenceService {
	readonly _serviceBrand: undefined;

	/**
	 * Perform a full scan of the repository at the given root path.
	 * Returns a complete RepositoryScanResult with all detected metadata.
	 */
	scanRepository(rootPath: string): Promise<RepositoryScanResult>;

	/**
	 * Detect frameworks used in the repository by reading package.json,
	 * requirements.txt, Pipfile, Cargo.toml, go.mod, and other manifest files.
	 */
	detectFrameworks(rootPath: string): Promise<Framework[]>;

	/**
	 * Detect programming languages used in the repository by scanning
	 * file extensions and counting occurrences. Returns sorted by file count.
	 */
	detectLanguages(rootPath: string): Promise<Language[]>;

	/**
	 * Build a dependency graph by scanning TypeScript/JavaScript files
	 * for import and require statements. Returns a list of DependencyNodes.
	 */
	buildDependencyGraph(rootPath: string): Promise<DependencyNode[]>;

	/**
	 * Rank files by importance based on how many other files depend on them,
	 * whether they are entry points, config files, test files, or generated.
	 */
	rankFileImportance(rootPath: string): Promise<Map<string, FileImportance>>;

	/**
	 * Summarize the architecture of the repository: detect common patterns,
	 * identify key modules, and describe the layer structure.
	 */
	summarizeArchitecture(rootPath: string): Promise<ArchitectureSummary>;

	/**
	 * Detect the project type by checking for specific config files,
	 * manifest fields, and directory structure indicators.
	 */
	detectProjectType(rootPath: string): Promise<ProjectType>;

	/**
	 * Build a semantic map of the repository: for each source file, extract
	 * exported symbol names using regex and create brief summaries.
	 *
	 * NOTE: This is text-based extraction using regex patterns on
	 * export class/function/const/interface/type/enum declarations.
	 * It does NOT perform AST-level analysis.
	 */
	getSemanticMap(rootPath: string): Promise<{ files: { path: string; summary: string; symbols: string[] }[] }>;
}

// ─── Service Decorator ────────────────────────────────────────────────────────

export const IRepositoryIntelligenceService = createDecorator<IRepositoryIntelligenceService>('construct.repositoryIntelligenceService');
