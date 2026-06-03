/*---------------------------------------------------------------------------------------------
 *  Repository Intelligence Engine -- Implementation
 *  AI Execution Kernel -- Repository Analysis Service
 *  Construct IDE — AI-Native IDE
 *
 *  RepositoryIntelligenceService -- Concrete implementation of IRepositoryIntelligenceService.
 *  Scans repositories using VS Code's file service, reads manifest files,
 *  analyzes import patterns, and ranks files by structural importance.
 *
 *  HONEST limitations:
 *    - All analysis is text-based and regex-based. No AST parsing.
 *    - Dependency graph only covers static import/require in TS/JS files.
 *    - Framework detection reads package.json/requirements.txt but cannot
 *      detect frameworks loaded dynamically at runtime.
 *    - Architecture detection is heuristic (directory naming conventions).
 *    - Semantic map extraction uses regex, which may miss edge cases.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import {
	IRepositoryIntelligenceService,
	ProjectType,
	Language,
	Framework,
	FileImportance,
	DependencyNode,
	RepositoryScanResult,
	ArchitectureSummary,
} from '../../../../../platform/construct/common/repositoryIntelligence.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
	'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
	'coverage', '.cache', '.vscode', '__pycache__', '.tox', 'vendor',
	'target', 'bin', 'obj', '.gradle', '.idea', '.vs',
]);

const MAX_SCAN_DEPTH = 3;
const MAX_FILES_FOR_IMPORT_SCAN = 500;

/**
 * Map of file extension to Language enum value.
 */
const EXTENSION_LANGUAGE_MAP = new Map<string, Language>([
	['.ts', Language.TypeScript],
	['.tsx', Language.TypeScript],
	['.js', Language.JavaScript],
	['.jsx', Language.JavaScript],
	['.mjs', Language.JavaScript],
	['.cjs', Language.JavaScript],
	['.py', Language.Python],
	['.pyw', Language.Python],
	['.rs', Language.Rust],
	['.go', Language.Go],
	['.java', Language.Java],
	['.cs', Language.CSharp],
	['.rb', Language.Ruby],
	['.php', Language.PHP],
]);

/**
 * Known entry point file names (relative to project root or src/).
 */
const ENTRY_POINT_NAMES = new Set([
	'index.ts', 'index.js', 'index.tsx', 'index.jsx',
	'main.ts', 'main.js', 'main.tsx', 'main.jsx',
	'app.ts', 'app.js', 'app.tsx', 'app.jsx',
	'server.ts', 'server.js',
	'cli.ts', 'cli.js',
	'mod.rs', 'lib.rs', 'main.rs',
	'main.py', 'app.py', 'manage.py', '__main__.py',
	'main.go',
	'Main.java', 'Application.java',
	'Program.cs',
]);

/**
 * Known config file names.
 */
const CONFIG_FILE_NAMES = new Set([
	'package.json', 'tsconfig.json', 'jsconfig.json',
	'.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
	'.prettierrc', '.prettierrc.js', '.prettierrc.json',
	'webpack.config.js', 'webpack.config.ts',
	'vite.config.ts', 'vite.config.js',
	'rollup.config.js', 'rollup.config.ts',
	'jest.config.js', 'jest.config.ts',
	'vitest.config.ts', 'vitest.config.js',
	'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
	'Gemfile', 'composer.json',
	'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
	'.env', '.env.local', '.env.production',
	'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile',
]);

/**
 * Framework detection rules for package.json dependencies.
 * Each entry: [dependency name prefix, framework name, category, isDevDep?]
 */
const JS_FRAMEWORK_RULES: readonly (readonly [string, string, Framework['category'], boolean])[] = [
	['react', 'React', 'frontend', false],
	['react-dom', 'React DOM', 'frontend', false],
	['vue', 'Vue', 'frontend', false],
	['@vue/cli', 'Vue CLI', 'build', true],
	['angular', 'Angular', 'frontend', false],
	['@angular/core', 'Angular', 'frontend', false],
	['svelte', 'Svelte', 'frontend', false],
	['next', 'Next.js', 'fullstack', false],
	['nuxt', 'Nuxt', 'fullstack', false],
	['express', 'Express', 'backend', false],
	['fastify', 'Fastify', 'backend', false],
	['@nestjs/core', 'NestJS', 'backend', false],
	['@hapi/hapi', 'Hapi', 'backend', false],
	['koa', 'Koa', 'backend', false],
	['electron', 'Electron', 'fullstack', false],
	['@capacitor/core', 'Capacitor', 'frontend', false],
	['react-native', 'React Native', 'frontend', false],
	['expo', 'Expo', 'frontend', false],
	['jest', 'Jest', 'testing', true],
	['vitest', 'Vitest', 'testing', true],
	['mocha', 'Mocha', 'testing', true],
	['@playwright/test', 'Playwright', 'testing', true],
	['cypress', 'Cypress', 'testing', true],
	['webpack', 'Webpack', 'build', true],
	['vite', 'Vite', 'build', true],
	['rollup', 'Rollup', 'build', true],
	['esbuild', 'esbuild', 'build', true],
	['turbo', 'Turborepo', 'build', true],
	['docker', 'Docker', 'deploy', true],
	['kubernetes', 'Kubernetes', 'deploy', true],
	['@vercel/node', 'Vercel', 'deploy', true],
];

/**
 * Framework detection rules for Python requirements.
 */
const PYTHON_FRAMEWORK_RULES: readonly (readonly [string, string, Framework['category']])[] = [
	['django', 'Django', 'backend'],
	['flask', 'Flask', 'backend'],
	['fastapi', 'FastAPI', 'backend'],
	['celery', 'Celery', 'backend'],
	['pytest', 'pytest', 'testing'],
	['selenium', 'Selenium', 'testing'],
	['scikit-learn', 'scikit-learn', 'backend'],
	['tensorflow', 'TensorFlow', 'backend'],
	['torch', 'PyTorch', 'backend'],
];

/**
 * Regex patterns for extracting import/require statements from TS/JS files.
 * NOTE: These cover the most common patterns. Dynamic imports and computed
 * require() calls are NOT handled.
 */
const IMPORT_PATTERNS = [
	// import ... from 'module'
	/import\s+(?:type\s+)?(?:[\w{}\s,]*\s+from\s+)?['"]([^'"]+)['"]/g,
	// require('module')
	/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	// export ... from 'module'
	/export\s+(?:type\s+)?(?:[\w{}\s,]*\s+from\s+)?['"]([^'"]+)['"]/g,
];

/**
 * Regex patterns for extracting exported symbols from source files.
 * NOTE: This is text-based extraction. It will miss re-exports,
 * default exports with computed names, and namespace imports.
 */
const EXPORT_SYMBOL_PATTERNS = [
	/export\s+class\s+(\w+)/g,
	/export\s+function\s+(\w+)/g,
	/export\s+const\s+(\w+)/g,
	/export\s+let\s+(\w+)/g,
	/export\s+interface\s+(\w+)/g,
	/export\s+type\s+(\w+)/g,
	/export\s+enum\s+(\w+)/g,
];

/**
 * Regex for detecting a JSDoc-style or single-line comment at the top of a file
 * or just before a symbol, used to create brief summaries.
 */
const COMMENT_SUMMARY_PATTERN = /(?:\/\/\s*(.+)|\/\*\s*\*?\s*(.+?)\s*(?:\*\/|$))/;

/**
 * Indicators for monorepo projects.
 */
const MONOREPO_INDICATORS = new Set([
	'lerna.json', 'nx.json', 'turbo.json',
]);

// ─── Implementation ───────────────────────────────────────────────────────────

export class RepositoryIntelligenceService extends Disposable implements IRepositoryIntelligenceService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this.logService.trace('[Construct RepositoryIntelligenceService] Initialized');
		void this._workspaceContextService;
	}

	// ─── scanRepository ─────────────────────────────────────────────────────────

	async scanRepository(rootPath: string): Promise<RepositoryScanResult> {
		this.logService.info(`[Construct RepositoryIntelligenceService] Scanning repository: ${rootPath}`);

		const rootUri = URI.file(rootPath);
		const allFiles = await this._listFilesRecursive(rootUri, MAX_SCAN_DEPTH);
		const configFiles = allFiles.filter(f => CONFIG_FILE_NAMES.has(this._basename(f)));

		// Count files and total size
		let totalSizeBytes = 0;
		for (const filePath of allFiles) {
			try {
				const stat = await this.fileService.stat(URI.file(filePath));
				totalSizeBytes += stat.size;
			} catch {
				// If stat fails, skip this file's size
			}
		}

		const [projectType, frameworks, languages, dependencyGraph] = await Promise.all([
			this.detectProjectType(rootPath),
			this.detectFrameworks(rootPath),
			this.detectLanguages(rootPath),
			this.buildDependencyGraph(rootPath),
		]);

		// Find entry points from the file list
		const entryPoints = allFiles.filter(f => {
			const base = this._basename(f);
			return ENTRY_POINT_NAMES.has(base);
		});

		// Detect build system
		const buildSystem = this._detectBuildSystem(configFiles);

		const result: RepositoryScanResult = {
			rootPath,
			projectType,
			languages,
			frameworks,
			entryPoints,
			configFiles,
			buildSystem,
			dependencyGraph,
			fileCount: allFiles.length,
			totalSizeBytes,
			scannedAt: Date.now(),
		};

		this.logService.info(`[Construct RepositoryIntelligenceService] Scan complete: ${allFiles.length} files, ${projectType}, ${frameworks.length} frameworks`);
		return result;
	}

	// ─── detectFrameworks ───────────────────────────────────────────────────────

	async detectFrameworks(rootPath: string): Promise<Framework[]> {
		const frameworks: Framework[] = [];
		const seen = new Set<string>();

		// Check package.json for JS/TS frameworks
		const packageJson = await this._readJsonFile(this._joinPath(rootPath, 'package.json'));
		if (packageJson) {
			const allDeps: Record<string, string> = {
				...(packageJson.dependencies ?? {}),
				...(packageJson.devDependencies ?? {}),
			};

			for (const [depPrefix, fwName, category, _isDev] of JS_FRAMEWORK_RULES) {
				for (const [depName, depVersion] of Object.entries(allDeps)) {
					if (depName === depPrefix || depName.startsWith(depPrefix + '/') || depName.startsWith('@' + depPrefix)) {
						if (!seen.has(fwName)) {
							seen.add(fwName);
							frameworks.push({
								name: fwName,
								version: this._cleanVersion(depVersion),
								category,
							});
						}
					}
				}
			}
		}

		// Check requirements.txt for Python frameworks
		const requirementsTxt = await this._readTextFile(this._joinPath(rootPath, 'requirements.txt'));
		if (requirementsTxt) {
			const lines = requirementsTxt.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#')) { continue; }

				for (const [depPrefix, fwName, category] of PYTHON_FRAMEWORK_RULES) {
					if (trimmed.toLowerCase().startsWith(depPrefix.toLowerCase())) {
						if (!seen.has(fwName)) {
							seen.add(fwName);
							const versionMatch = trimmed.match(/[><=!]+\s*([\d.]+)/);
							frameworks.push({
								name: fwName,
								version: versionMatch?.[1],
								category,
							});
						}
					}
				}
			}
		}

		// Check Pipfile for Python frameworks
		const pipfile = await this._readTextFile(this._joinPath(rootPath, 'Pipfile'));
		if (pipfile) {
			for (const [depPrefix, fwName, category] of PYTHON_FRAMEWORK_RULES) {
				if (pipfile.toLowerCase().includes(depPrefix.toLowerCase())) {
					if (!seen.has(fwName)) {
						seen.add(fwName);
						frameworks.push({ name: fwName, category });
					}
				}
			}
		}

		// Check pyproject.toml for Python frameworks
		const pyproject = await this._readTextFile(this._joinPath(rootPath, 'pyproject.toml'));
		if (pyproject) {
			for (const [depPrefix, fwName, category] of PYTHON_FRAMEWORK_RULES) {
				if (pyproject.toLowerCase().includes(depPrefix.toLowerCase())) {
					if (!seen.has(fwName)) {
						seen.add(fwName);
						frameworks.push({ name: fwName, category });
					}
				}
			}
		}

		return frameworks;
	}

	// ─── detectLanguages ─────────────────────────────────────────────────────────

	async detectLanguages(rootPath: string): Promise<Language[]> {
		const rootUri = URI.file(rootPath);
		const allFiles = await this._listFilesRecursive(rootUri, MAX_SCAN_DEPTH);

		const languageCounts = new Map<Language, number>();

		for (const filePath of allFiles) {
			const ext = this._extension(filePath);
			const language = EXTENSION_LANGUAGE_MAP.get(ext);
			if (language) {
				languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
			} else if (ext && ext.length > 0 && ext.length <= 5) {
				// Unknown extension with a reasonable length: count as Other
				languageCounts.set(Language.Other, (languageCounts.get(Language.Other) ?? 0) + 1);
			}
		}

		// Sort by file count descending
		const sorted = Array.from(languageCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([lang]) => lang);

		return sorted;
	}

	// ─── buildDependencyGraph ────────────────────────────────────────────────────

	async buildDependencyGraph(rootPath: string): Promise<DependencyNode[]> {
		const rootUri = URI.file(rootPath);
		const allFiles = await this._listFilesRecursive(rootUri, MAX_SCAN_DEPTH);

		// Filter to TS/JS files only for import scanning
		const tsJsFiles = allFiles.filter(f => {
			const ext = this._extension(f);
			return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs';
		});

		// Limit to prevent excessive processing on large repos
		const filesToScan = tsJsFiles.slice(0, MAX_FILES_FOR_IMPORT_SCAN);

		// Build import map: filePath -> set of imported module specifiers
		const importMap = new Map<string, Set<string>>();

		for (const filePath of filesToScan) {
			const content = await this._readTextFile(filePath);
			if (!content) { continue; }

			const imports = new Set<string>();

			for (const pattern of IMPORT_PATTERNS) {
				// Reset regex state for each file
				const regex = new RegExp(pattern.source, pattern.flags);
				let match: RegExpExecArray | null;
				while ((match = regex.exec(content)) !== null) {
					const importPath = match[1];
					if (importPath) {
						imports.add(importPath);
					}
				}
			}

			importMap.set(filePath, imports);
		}

		// Resolve relative imports to actual file paths
		const resolvedImportMap = new Map<string, Set<string>>();
		for (const [filePath, imports] of importMap) {
			const resolved = new Set<string>();
			const fileDir = this._dirname(filePath);

			for (const importSpecifier of imports) {
				if (importSpecifier.startsWith('.')) {
					// Relative import: resolve against file directory
					const resolvedPath = this._resolveRelativeImport(fileDir, importSpecifier, allFiles);
					if (resolvedPath) {
						resolved.add(resolvedPath);
					}
				}
				// Absolute/package imports are not resolved (would need module resolution)
			}

			resolvedImportMap.set(filePath, resolved);
		}

		// Build the imported-by reverse map
		const importedByMap = new Map<string, Set<string>>();
		for (const [filePath, imports] of resolvedImportMap) {
			for (const importedPath of imports) {
				if (!importedByMap.has(importedPath)) {
					importedByMap.set(importedPath, new Set());
				}
				importedByMap.get(importedPath)!.add(filePath);
			}
		}

		// Build DependencyNode array
		const allSourceFiles = new Set([...resolvedImportMap.keys(), ...importedByMap.keys()]);
		const nodes: DependencyNode[] = [];

		for (const filePath of allSourceFiles) {
			const imports = Array.from(resolvedImportMap.get(filePath) ?? []);
			const importedBy = Array.from(importedByMap.get(filePath) ?? []);

			// Determine importance based on how many files import this one
			let importance: FileImportance;
			if (importedBy.length >= 10) {
				importance = FileImportance.Critical;
			} else if (importedBy.length >= 5) {
				importance = FileImportance.High;
			} else if (importedBy.length >= 2) {
				importance = FileImportance.Medium;
			} else {
				importance = FileImportance.Low;
			}

			nodes.push({
				path: filePath,
				imports,
				importedBy,
				importance,
			});
		}

		return nodes;
	}

	// ─── rankFileImportance ──────────────────────────────────────────────────────

	async rankFileImportance(rootPath: string): Promise<Map<string, FileImportance>> {
		const rootUri = URI.file(rootPath);
		const allFiles = await this._listFilesRecursive(rootUri, MAX_SCAN_DEPTH);
		const dependencyGraph = await this.buildDependencyGraph(rootPath);

		const importanceMap = new Map<string, FileImportance>();

		// Build a quick lookup from the dependency graph
		const importedByCount = new Map<string, number>();
		for (const node of dependencyGraph) {
			importedByCount.set(node.path, node.importedBy.length);
		}

		for (const filePath of allFiles) {
			const base = this._basename(filePath);
						const lower = filePath.toLowerCase();

			// Generated files
			if (lower.includes('.generated.') || lower.includes('.auto.') ||
				lower.includes('/generated/') || lower.includes('/auto/') ||
				lower.endsWith('.d.ts') || lower.includes('.min.') ||
				lower.includes('/dist/') || lower.includes('/build/')) {
				importanceMap.set(filePath, FileImportance.Generated);
				continue;
			}

			// Entry points = Critical
			if (ENTRY_POINT_NAMES.has(base)) {
				importanceMap.set(filePath, FileImportance.Critical);
				continue;
			}

			// Config files = High
			if (CONFIG_FILE_NAMES.has(base)) {
				importanceMap.set(filePath, FileImportance.High);
				continue;
			}

			// Test files = Medium
			if (lower.includes('.test.') || lower.includes('.spec.') ||
				lower.includes('/test/') || lower.includes('/tests/') ||
				lower.includes('/__tests__/') || lower.includes('_test.')) {
				importanceMap.set(filePath, FileImportance.Medium);
				continue;
			}

			// Files imported by many others
			const importCount = importedByCount.get(filePath) ?? 0;
			if (importCount >= 10) {
				importanceMap.set(filePath, FileImportance.Critical);
			} else if (importCount >= 5) {
				importanceMap.set(filePath, FileImportance.High);
			} else if (importCount >= 2) {
				importanceMap.set(filePath, FileImportance.Medium);
			} else {
				importanceMap.set(filePath, FileImportance.Low);
			}
		}

		return importanceMap;
	}

	// ─── summarizeArchitecture ───────────────────────────────────────────────────

	async summarizeArchitecture(rootPath: string): Promise<ArchitectureSummary> {
		const rootUri = URI.file(rootPath);
		const allFiles = await this._listFilesRecursive(rootUri, MAX_SCAN_DEPTH);
		const dependencyGraph = await this.buildDependencyGraph(rootPath);

		// Identify top-level directories
		const topDirs = new Set<string>();
		for (const filePath of allFiles) {
			const relativePath = filePath.startsWith(rootPath)
				? filePath.slice(rootPath.length).replace(/^[/\\]/, '')
				: filePath;
			const parts = relativePath.split(/[/\\]/);
			if (parts.length > 1) {
				topDirs.add(parts[0]);
			}
		}

		// Detect architecture pattern based on directory structure
		let layerPattern: string | null = null;
		const lowerTopDirs = new Set(Array.from(topDirs).map(d => d.toLowerCase()));

		if (lowerTopDirs.has('models') && lowerTopDirs.has('views') && lowerTopDirs.has('controllers')) {
			layerPattern = 'MVC';
		} else if (lowerTopDirs.has('models') && lowerTopDirs.has('views') && lowerTopDirs.has('viewmodels')) {
			layerPattern = 'MVVM';
		} else if (lowerTopDirs.has('src') && lowerTopDirs.has('lib') && lowerTopDirs.has('test')) {
			layerPattern = 'Layered';
		} else if (lowerTopDirs.has('packages') || lowerTopDirs.has('apps') || lowerTopDirs.has('libs')) {
			layerPattern = 'Monorepo';
		} else if (lowerTopDirs.has('cmd') && lowerTopDirs.has('internal')) {
			layerPattern = 'Go Standard';
		} else if (lowerTopDirs.has('src') && lowerTopDirs.has('public')) {
			layerPattern = 'Frontend/Backend Split';
		} else if (lowerTopDirs.has('src') && (lowerTopDirs.has('components') || lowerTopDirs.has('pages'))) {
			layerPattern = 'Component-Based';
		} else if (lowerTopDirs.has('handlers') || lowerTopDirs.has('routes') || lowerTopDirs.has('services')) {
			layerPattern = 'Service-Oriented';
		}

		// Find key modules: directories that are imported by many files
		const dirImportCounts = new Map<string, number>();
		for (const node of dependencyGraph) {
			if (node.importedBy.length >= 3) {
				const relativePath = node.path.startsWith(rootPath)
					? node.path.slice(rootPath.length).replace(/^[/\\]/, '')
					: node.path;
				const parts = relativePath.split(/[/\\]/);
				if (parts.length > 1) {
					const dir = parts.slice(0, 2).join('/'); // top two levels
					dirImportCounts.set(dir, (dirImportCounts.get(dir) ?? 0) + node.importedBy.length);
				}
			}
		}

		const keyModules = Array.from(dirImportCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([dir, count]) => ({
				name: dir.split(/[/\\]/).pop() ?? dir,
				path: dir,
				role: count >= 20 ? 'Core shared module' : count >= 10 ? 'Shared utility module' : 'Supporting module',
			}));

		// Generate description
		const projectType = await this.detectProjectType(rootPath);
		const languages = await this.detectLanguages(rootPath);
		const langDesc = languages.length > 0
			? `Primarily ${languages.slice(0, 3).map(l => this._languageDisplayName(l)).join(', ')}`
			: 'Multi-language';

		const moduleCount = topDirs.size;
		let description = `${this._projectTypeDisplayName(projectType)} project with ${moduleCount} top-level directories. ${langDesc}.`;

		if (layerPattern) {
			description += ` Follows ${layerPattern} architecture pattern.`;
		}

		if (keyModules.length > 0) {
			description += ` Key modules: ${keyModules.slice(0, 3).map(m => m.name).join(', ')}.`;
		}

		return {
			description,
			moduleCount,
			layerPattern,
			keyModules,
		};
	}

	// ─── detectProjectType ───────────────────────────────────────────────────────

	async detectProjectType(rootPath: string): Promise<ProjectType> {
		// Check for monorepo indicators first (most specific)
		for (const indicator of MONOREPO_INDICATORS) {
			const exists = await this._fileExists(this._joinPath(rootPath, indicator));
			if (exists) {
				return ProjectType.Monorepo;
			}
		}

		// Check package.json for workspaces field (another monorepo indicator)
		const packageJson = await this._readJsonFile(this._joinPath(rootPath, 'package.json'));
		if (packageJson) {
			if (packageJson.workspaces) {
				return ProjectType.Monorepo;
			}

			// Check for Electron (DesktopApp)
			const allDeps: Record<string, string> = {
				...(packageJson.dependencies ?? {}),
				...(packageJson.devDependencies ?? {}),
			};
			if ('electron' in allDeps) {
				return ProjectType.DesktopApp;
			}

			// Check for Next.js/Nuxt (WebApp)
			if ('next' in allDeps || 'nuxt' in allDeps || '@nuxt/core' in allDeps) {
				return ProjectType.WebApp;
			}

			// Check for React Native / Capacitor (MobileApp)
			if ('react-native' in allDeps || '@capacitor/core' in allDeps) {
				return ProjectType.MobileApp;
			}

			// Check for CLI (bin field in package.json)
			if (packageJson.bin) {
				return ProjectType.CLITool;
			}

			// Check for backend framework (API)
			if ('express' in allDeps || 'fastify' in allDeps || '@nestjs/core' in allDeps ||
				'@hapi/hapi' in allDeps || 'koa' in allDeps) {
				return ProjectType.API;
			}

			// Check for VS Code extension
			if ((packageJson.engines as any)?.vscode || packageJson.activationEvents || packageJson.contributes) {
				return ProjectType.Extension;
			}

			// If it has main/module/exports but no specific framework, likely a library
			if (packageJson.main || packageJson.module || packageJson.exports) {
				return ProjectType.Library;
			}

			// Default for package.json projects without specific indicators
			return ProjectType.WebApp;
		}

		// Check for Python API frameworks
		const requirementsTxt = await this._readTextFile(this._joinPath(rootPath, 'requirements.txt'));
		if (requirementsTxt) {
			const lower = requirementsTxt.toLowerCase();
			if (lower.includes('fastapi') || lower.includes('flask') || lower.includes('django')) {
				return ProjectType.API;
			}
			if (lower.includes('click') || lower.includes('typer') || lower.includes('argparse')) {
				return ProjectType.CLITool;
			}
		}

		// Check for Rust project
		const cargoToml = await this._readTextFile(this._joinPath(rootPath, 'Cargo.toml'));
		if (cargoToml) {
			// Check if it has a binary target
			if (cargoToml.includes('[[bin]]') || cargoToml.includes('name = ') && !cargoToml.includes('[lib]')) {
				return ProjectType.CLITool;
			}
			return ProjectType.Library;
		}

		// Check for Go project
		const goMod = await this._readTextFile(this._joinPath(rootPath, 'go.mod'));
		if (goMod) {
			// Check for cmd/ directory which indicates a CLI or app
			const cmdExists = await this._fileExists(this._joinPath(rootPath, 'cmd'));
			if (cmdExists) {
				return ProjectType.CLITool;
			}
			return ProjectType.Library;
		}

		// Check for Java project
		const pomExists = await this._fileExists(this._joinPath(rootPath, 'pom.xml'));
		const gradleExists = await this._fileExists(this._joinPath(rootPath, 'build.gradle'));
		if (pomExists || gradleExists) {
			return ProjectType.Library;
		}

		return ProjectType.Unknown;
	}

	// ─── getSemanticMap ──────────────────────────────────────────────────────────

	async getSemanticMap(rootPath: string): Promise<{ files: { path: string; summary: string; symbols: string[] }[] }> {
		const rootUri = URI.file(rootPath);
		const allFiles = await this._listFilesRecursive(rootUri, MAX_SCAN_DEPTH);

		const files: { path: string; summary: string; symbols: string[] }[] = [];

		for (const filePath of allFiles) {
			const lower = filePath.toLowerCase();

			// Skip generated, node_modules, dist, build files
			if (lower.includes('node_modules') || lower.includes('/dist/') || lower.includes('/build/') ||
				lower.includes('/out/') || lower.includes('.generated.') || lower.includes('.d.ts') ||
				lower.includes('.min.') || lower.includes('/vendor/')) {
				continue;
			}

			// Only process source files (not images, binaries, etc.)
			const ext = this._extension(filePath);
			const sourceExtensions = new Set([
				'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
				'.py', '.rs', '.go', '.java', '.cs', '.rb', '.php',
			]);
			if (!sourceExtensions.has(ext)) {
				continue;
			}

			const content = await this._readTextFile(filePath);
			if (!content) { continue; }

			// Extract exported symbols using regex
			// NOTE: This is text-based extraction, NOT AST analysis.
			const symbols: string[] = [];
			for (const pattern of EXPORT_SYMBOL_PATTERNS) {
				const regex = new RegExp(pattern.source, pattern.flags);
				let match: RegExpExecArray | null;
				while ((match = regex.exec(content)) !== null) {
					if (match[1]) {
						symbols.push(match[1]);
					}
				}
			}

			// Create a brief summary from the first comment or the first significant symbol
			let summary = '';
			const lines = content.split('\n');
			for (const line of lines.slice(0, 20)) {
				const commentMatch = line.match(COMMENT_SUMMARY_PATTERN);
				if (commentMatch) {
					const commentText = commentMatch[1] || commentMatch[2];
					if (commentText && commentText.trim().length > 5 &&
						!commentText.includes('Copyright') && !commentMatch.includes('Licensed')) {
						summary = commentText.trim().slice(0, 200);
						break;
					}
				}
			}

			if (!summary && symbols.length > 0) {
				const symbolList = symbols.slice(0, 3).join(', ');
				summary = `Exports: ${symbolList}${symbols.length > 3 ? ` (+${symbols.length - 3} more)` : ''}`;
			}

			if (!summary) {
				const base = this._basename(filePath);
				summary = `Source file: ${base}`;
			}

			files.push({
				path: filePath,
				summary,
				symbols,
			});
		}

		return { files };
	}

	// ─── Private Helpers: File System ────────────────────────────────────────────

	/**
	 * Recursively list files up to maxDepth levels, skipping known unneeded directories.
	 */
	private async _listFilesRecursive(rootUri: URI, maxDepth: number, currentDepth: number = 0): Promise<string[]> {
		if (currentDepth > maxDepth) {
			return [];
		}

		const results: string[] = [];

		try {
			const stat = await this.fileService.stat(rootUri);
			if (!stat.isDirectory) {
				return [rootUri.fsPath];
			}

						// The fileService.stat for a directory may not list children directly.
			// We need to use resolveContents or similar. However, IFileService.stat
			// returns IFileStat which has children if resolved.
			const children = (stat as { children?: { name: string; isDirectory: boolean; resource: URI }[] }).children;

			if (!children) {
				return [];
			}

			for (const child of children) {
				const childName = child.name;

				// Skip known unneeded directories
				if (child.isDirectory && SKIP_DIRS.has(childName)) {
					continue;
				}

				if (child.isDirectory) {
					const subResults = await this._listFilesRecursive(child.resource, maxDepth, currentDepth + 1);
					results.push(...subResults);
				} else {
					results.push(child.resource.fsPath);
				}
			}
		} catch (err) {
			this.logService.trace(`[Construct RepositoryIntelligenceService] Cannot stat ${rootUri.fsPath}: ${err}`);
		}

		return results;
	}

	/**
	 * Read a JSON file and parse it. Returns null if file does not exist or is invalid.
	 */
	private async _readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
		try {
			const content = await this._readTextFile(filePath);
			if (!content) { return null; }
			return JSON.parse(content) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	/**
	 * Read a text file using IFileService. Returns null if file does not exist.
	 */
	private async _readTextFile(filePath: string): Promise<string | null> {
		try {
			const uri = URI.file(filePath);
			const content = await this.fileService.readFile(uri);
			return content.value.toString();
		} catch {
			return null;
		}
	}

	/**
	 * Check if a file exists using IFileService.
	 */
	private async _fileExists(filePath: string): Promise<boolean> {
		try {
			await this.fileService.stat(URI.file(filePath));
			return true;
		} catch {
			return false;
		}
	}

	// ─── Private Helpers: Path Utilities ─────────────────────────────────────────

	private _basename(filePath: string): string {
		const normalized = filePath.replace(/\\/g, '/');
		const parts = normalized.split('/');
		return parts[parts.length - 1] ?? '';
	}

	private _extension(filePath: string): string {
		const base = this._basename(filePath);
		const dotIndex = base.lastIndexOf('.');
		if (dotIndex <= 0) { return ''; }
		return base.slice(dotIndex);
	}

	private _dirname(filePath: string): string {
		const normalized = filePath.replace(/\\/g, '/');
		const parts = normalized.split('/');
		parts.pop();
		return parts.join('/');
	}

	private _joinPath(...parts: string[]): string {
		const joined = parts.join('/');
		// Normalize backslashes to forward slashes
		return joined.replace(/\\/g, '/');
	}

	/**
	 * Resolve a relative import specifier to an actual file path.
	 * Tries common extensions and index files.
	 */
	private _resolveRelativeImport(fromDir: string, importSpecifier: string, allFiles: string[]): string | null {
		const allFileSet = new Set(allFiles.map(f => f.replace(/\\/g, '/')));

		// Normalize the import path
		const normalizedDir = fromDir.replace(/\\/g, '/');
		const normalizedImport = importSpecifier.replace(/\\/g, '/');

		// Resolve the path
		let resolvedPath: string;
		if (normalizedImport.startsWith('./') || normalizedImport.startsWith('../')) {
			// Split the import path and resolve .. segments
			const importParts = normalizedImport.split('/');
			const dirParts = normalizedDir.split('/');

			for (const part of importParts) {
				if (part === '..') {
					dirParts.pop();
				} else if (part !== '.' && part !== '') {
					dirParts.push(part);
				}
			}

			resolvedPath = dirParts.join('/');
		} else {
			return null; // Non-relative imports cannot be resolved
		}

		// Try exact path
		if (allFileSet.has(resolvedPath)) {
			return resolvedPath;
		}

		// Try with extensions
		const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
		for (const ext of extensions) {
			if (allFileSet.has(resolvedPath + ext)) {
				return resolvedPath + ext;
			}
		}

		// Try as directory with index
		for (const ext of extensions) {
			const indexPath = `${resolvedPath}/index${ext}`;
			if (allFileSet.has(indexPath)) {
				return indexPath;
			}
		}

		return null;
	}

	/**
	 * Clean a version string from package.json (e.g., "^4.2.0" -> "4.2.0").
	 */
	private _cleanVersion(version: string): string {
		return version.replace(/^[~^>=<]+/, '').trim();
	}

	/**
	 * Detect build system from config files.
	 */
	private _detectBuildSystem(configFiles: string[]): string | null {
		for (const filePath of configFiles) {
			const base = this._basename(filePath);
			switch (base) {
				case 'webpack.config.js':
				case 'webpack.config.ts':
					return 'webpack';
				case 'vite.config.ts':
				case 'vite.config.js':
					return 'vite';
				case 'rollup.config.js':
				case 'rollup.config.ts':
					return 'rollup';
				case 'Cargo.toml':
					return 'cargo';
				case 'go.mod':
					return 'go';
				case 'pom.xml':
					return 'maven';
				case 'build.gradle':
					return 'gradle';
				case 'Gemfile':
					return 'bundler';
				case 'pyproject.toml':
					return 'python';
			}
		}
		return null;
	}

	private _languageDisplayName(language: Language): string {
		switch (language) {
			case Language.TypeScript: return 'TypeScript';
			case Language.JavaScript: return 'JavaScript';
			case Language.Python: return 'Python';
			case Language.Rust: return 'Rust';
			case Language.Go: return 'Go';
			case Language.Java: return 'Java';
			case Language.CSharp: return 'C#';
			case Language.Ruby: return 'Ruby';
			case Language.PHP: return 'PHP';
			case Language.Other: return 'Other';
		}
		// @ts-expect-error exhaustiveness check
		return 'Unknown';
	}

	private _projectTypeDisplayName(type: ProjectType): string {
		switch (type) {
			case ProjectType.WebApp: return 'Web Application';
			case ProjectType.CLITool: return 'CLI Tool';
			case ProjectType.Library: return 'Library';
			case ProjectType.Extension: return 'Extension';
			case ProjectType.MobileApp: return 'Mobile App';
			case ProjectType.DesktopApp: return 'Desktop App';
			case ProjectType.API: return 'API Service';
			case ProjectType.Monorepo: return 'Monorepo';
			case ProjectType.Unknown: return 'Unknown';
		}
		// @ts-expect-error exhaustiveness check
		return 'Unknown';
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────────

	override dispose(): void {
		super.dispose();
	}
}
