/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Refactoring Service (Cross-File Symbol Operations)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { MCPClient } from './MCPClient';

export interface RenameResult {
	success: boolean;
	filesModified: string[];
	errors: string[];
}

export class RefactoringError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RefactoringError';
	}
}

export class RefactoringService {
	constructor(
		private readonly mcp: MCPClient,
		private readonly workspaceRoot: string,
	) {}

	/**
	 * Rename a symbol across files using regex-based search.
	 * Updates import statements for TypeScript/JavaScript files.
	 */
	async renameSymbol(
		oldName: string,
		newName: string,
		options?: { filePattern?: string; dryRun?: boolean },
	): Promise<RenameResult> {
		const filePattern = options?.filePattern ?? '*.ts';
		const dryRun = options?.dryRun ?? false;

		const filesModified: string[] = [];
		const errors: string[] = [];

		// List all matching files in the workspace
		let files: string[];
		try {
			files = await this.mcp.listDirectory(this.workspaceRoot);
		} catch (err) {
			throw new RefactoringError(`Failed to list workspace: ${(err as Error).message}`);
		}

		// Filter by pattern
		const matchingFiles = files.filter(f => this.matchesPattern(f, filePattern));

		for (const file of matchingFiles) {
			try {
				const content = await this.mcp.readFile(file);

				// Create regex for symbol boundaries
				const symbolRegex = new RegExp(`\\b${this.escapeRegex(oldName)}\\b`, 'g');
				const hasMatch = symbolRegex.test(content);

				if (!hasMatch) {
					continue;
				}

				if (dryRun) {
					filesModified.push(file);
					continue;
				}

				// Replace the symbol
				const newContent = content.replace(symbolRegex, newName);

				// For TypeScript files, also update import statements
				let finalContent = newContent;
				if (file.endsWith('.ts') || file.endsWith('.tsx')) {
					finalContent = this.updateImportPaths(newContent, oldName, newName);
				}

				await this.mcp.writeFile(file, finalContent);
				filesModified.push(file);
			} catch (err) {
				errors.push(`${file}: ${(err as Error).message}`);
			}
		}

		return {
			success: errors.length === 0,
			filesModified,
			errors,
		};
	}

	/**
	 * Update import paths when a module is renamed.
	 */
	private updateImportPaths(content: string, oldName: string, newName: string): string {
		// Match import from paths containing the old name
		const importRegex = new RegExp(
			`(from\\s+['"\`][^'"\`]*?)${this.escapeRegex(oldName)}([^'"\`]*?['"\`])`,
			'g',
		);
		return content.replace(importRegex, `$1${newName}$2`);
	}

	/**
	 * Search for a symbol across the workspace.
	 */
	async findSymbol(symbolName: string, options?: { filePattern?: string }): Promise<{ file: string; line: number; context: string }[]> {
		const filePattern = options?.filePattern ?? '*.ts';
		const results: { file: string; line: number; context: string }[] = [];

		let files: string[];
		try {
			files = await this.mcp.listDirectory(this.workspaceRoot);
		} catch {
			return results;
		}

		const matchingFiles = files.filter(f => this.matchesPattern(f, filePattern));
		const symbolRegex = new RegExp(`\\b${this.escapeRegex(symbolName)}\\b`);

		for (const file of matchingFiles) {
			try {
				const content = await this.mcp.readFile(file);
				const lines = content.split('\n');

				for (let i = 0; i < lines.length; i++) {
					if (symbolRegex.test(lines[i])) {
						results.push({
							file,
							line: i + 1,
							context: lines[i].trim(),
						});
					}
				}
			} catch {
				// Skip files that can't be read
			}
		}

		return results;
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	private matchesPattern(filename: string, pattern: string): boolean {
		if (pattern === '*.ts') {
			return filename.endsWith('.ts') || filename.endsWith('.tsx');
		}
		if (pattern === '*.js') {
			return filename.endsWith('.js') || filename.endsWith('.jsx');
		}
		if (pattern === '*') {
			return true;
		}
		// Simple glob matching
		const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
		return regex.test(filename);
	}
}
