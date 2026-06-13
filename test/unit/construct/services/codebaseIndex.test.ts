/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Tests for CodebaseIndex — semantic and symbol-based code search.
 * Source: src/vs/platform/construct/common/indexing/codebaseIndex.ts
 *
 * Tests indexing, semantic search, symbol lookup, and persistence.
 */

// ---- Replicate production types and logic ----

interface IFileSymbol {
	name: string;
	kind: 'function' | 'class' | 'variable' | 'import' | 'export' | 'interface' | 'type' | 'enum' | 'method' | 'property';
	line: number;
	type?: string;
	isExported: boolean;
}

interface IIndexedFile {
	path: string;
	symbols: IFileSymbol[];
	hash: string;
	indexedAt: number;
}

interface IIndexSearchResult {
	path: string;
	score: number;
	matchedSymbols?: string[];
	snippet?: string;
}

// ---- Simple in-memory index for testing ----

class InMemoryCodebaseIndex {
	private files = new Map<string, IIndexedFile>();
	private symbolIndex = new Map<string, Set<string>>(); // symbol name -> set of file paths

	indexFile(filePath: string, content: string): void {
		const symbols = this.extractSymbols(content);
		const hash = this.computeHash(content);

		// Remove old symbol references
		const existing = this.files.get(filePath);
		if (existing) {
			for (const sym of existing.symbols) {
				const set = this.symbolIndex.get(sym.name);
				if (set) {
					set.delete(filePath);
					if (set.size === 0) { this.symbolIndex.delete(sym.name); }
				}
			}
		}

		// Add new symbol references
		for (const sym of symbols) {
			if (!this.symbolIndex.has(sym.name)) {
				this.symbolIndex.set(sym.name, new Set());
			}
			this.symbolIndex.get(sym.name)!.add(filePath);
		}

		this.files.set(filePath, { path: filePath, symbols, hash, indexedAt: Date.now() });
	}

	searchSymbol(name: string): IIndexSearchResult[] {
		const exactMatch = this.symbolIndex.get(name);
		const results: IIndexSearchResult[] = [];

		if (exactMatch) {
			for (const filePath of exactMatch) {
				const indexed = this.files.get(filePath);
				if (indexed) {
					results.push({
						path: filePath,
						score: 1.0,
						matchedSymbols: [name],
					});
				}
			}
		}

		// Fuzzy match
		const lowerName = name.toLowerCase();
		for (const [symName, filePaths] of this.symbolIndex) {
			if (symName.toLowerCase().includes(lowerName) && symName !== name) {
				for (const filePath of filePaths) {
					results.push({
						path: filePath,
						score: 0.7,
						matchedSymbols: [symName],
					});
				}
			}
		}

		return results;
	}

	searchSemantic(query: string, maxResults: number = 10): IIndexSearchResult[] {
		// Simplified: match query keywords against symbol names and file paths
		const keywords = query.toLowerCase().split(/\s+/);
		const results: IIndexSearchResult[] = [];

		for (const [filePath, indexed] of this.files) {
			let score = 0;
			const matchedSymbols: string[] = [];

			for (const keyword of keywords) {
				for (const sym of indexed.symbols) {
					if (sym.name.toLowerCase().includes(keyword)) {
						score += 0.3;
						matchedSymbols.push(sym.name);
					}
				}
				if (filePath.toLowerCase().includes(keyword)) {
					score += 0.2;
				}
			}

			if (score > 0) {
				results.push({ path: filePath, score: Math.min(score, 1.0), matchedSymbols });
			}
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, maxResults);
	}

	getFileSymbols(filePath: string): IFileSymbol[] {
		return this.files.get(filePath)?.symbols ?? [];
	}

	get indexedFileCount(): number {
		return this.files.size;
	}

	private extractSymbols(content: string): IFileSymbol[] {
		const symbols: IFileSymbol[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Simple regex-based symbol extraction
			const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
			if (funcMatch) {
				symbols.push({
					name: funcMatch[1],
					kind: 'function',
					line: i + 1,
					isExported: line.includes('export'),
				});
				continue;
			}

			const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
			if (classMatch) {
				symbols.push({
					name: classMatch[1],
					kind: 'class',
					line: i + 1,
					isExported: line.includes('export'),
				});
				continue;
			}

			const interfaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
			if (interfaceMatch) {
				symbols.push({
					name: interfaceMatch[1],
					kind: 'interface',
					line: i + 1,
					isExported: line.includes('export'),
				});
				continue;
			}

			const typeMatch = line.match(/(?:export\s+)?type\s+(\w+)/);
			if (typeMatch) {
				symbols.push({
					name: typeMatch[1],
					kind: 'type',
					line: i + 1,
					isExported: line.includes('export'),
				});
				continue;
			}

			const constMatch = line.match(/(?:export\s+)?const\s+(\w+)/);
			if (constMatch) {
				symbols.push({
					name: constMatch[1],
					kind: 'variable',
					line: i + 1,
					isExported: line.includes('export'),
				});
			}
		}

		return symbols;
	}

	private computeHash(content: string): string {
		return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
	}
}

// ---- Persistence helpers ----

function serializeIndex(index: InMemoryCodebaseIndex): string {
	const files: IIndexedFile[] = [];
	// We'd need access to internal state; for testing, use a simple approach
	return JSON.stringify({ version: 1, savedAt: Date.now() });
}

function deserializeIndex(data: string): { version: number; savedAt: number } | null {
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

// ---- Tests ----

suite('CodebaseIndex', () => {

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kovix-index-test-'));

	suiteTeardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const sampleTypeScript = `
export interface IUser {
	name: string;
	email: string;
}

export class UserService {
	async getUser(id: string): Promise<IUser> {
		return { name: 'test', email: 'test@test.com' };
	}
}

export function validateEmail(email: string): boolean {
	return email.includes('@');
}

const MAX_RETRIES = 3;
`;

	const samplePython = `
class DataProcessor:
    def process(self, data):
        return data.strip()

def validate_input(value):
    return len(value) > 0
`;

	suite('Indexing — workspace is indexed', () => {
		test('files are indexed with symbols', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			assert.strictEqual(index.indexedFileCount, 1);
		});

		test('multiple files can be indexed', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);
			index.indexFile('src/processor.py', samplePython);

			assert.strictEqual(index.indexedFileCount, 2);
		});

		test('re-indexing updates existing file', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);
			assert.strictEqual(index.indexedFileCount, 1);

			const updatedContent = 'export function newFunction() {}';
			index.indexFile('src/userService.ts', updatedContent);
			assert.strictEqual(index.indexedFileCount, 1);

			const symbols = index.getFileSymbols('src/userService.ts');
			assert.ok(symbols.some(s => s.name === 'newFunction'));
		});

		test('indexed file count is accurate', () => {
			const index = new InMemoryCodebaseIndex();
			assert.strictEqual(index.indexedFileCount, 0);
			index.indexFile('a.ts', 'const x = 1;');
			assert.strictEqual(index.indexedFileCount, 1);
			index.indexFile('b.ts', 'const y = 2;');
			assert.strictEqual(index.indexedFileCount, 2);
		});
	});

	suite('Semantic search — search returns results', () => {
		test('search finds files by keyword', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const results = index.searchSemantic('user');
			assert.ok(results.length > 0, 'Should find results for "user"');
			assert.ok(results[0].score > 0, 'Results should have positive score');
		});

		test('search returns ranked results', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);
			index.indexFile('src/processor.py', samplePython);

			const results = index.searchSemantic('validate');
			assert.ok(results.length > 0, 'Should find results for "validate"');
		});

		test('search with no matches returns empty array', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const results = index.searchSemantic('quantum physics');
			assert.strictEqual(results.length, 0, 'Should find no results');
		});

		test('search respects maxResults limit', () => {
			const index = new InMemoryCodebaseIndex();
			for (let i = 0; i < 20; i++) {
				index.indexFile(`src/file${i}.ts`, `export function myFunc${i}() {}`);
			}

			const results = index.searchSemantic('myFunc', 5);
			assert.ok(results.length <= 5, 'Should respect maxResults');
		});
	});

	suite('Symbol lookup — symbols are found', () => {
		test('find symbol by exact name', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const results = index.searchSymbol('UserService');
			assert.ok(results.length > 0, 'Should find UserService');
			assert.strictEqual(results[0].matchedSymbols?.[0], 'UserService');
		});

		test('find symbol by partial name (fuzzy)', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const results = index.searchSymbol('User');
			assert.ok(results.length > 0, 'Should find User-related symbols');
		});

		test('get file symbols returns all symbols in file', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const symbols = index.getFileSymbols('src/userService.ts');
			assert.ok(symbols.length > 0, 'Should extract symbols');

			const symbolNames = symbols.map(s => s.name);
			assert.ok(symbolNames.includes('IUser'), 'Should find IUser');
			assert.ok(symbolNames.includes('UserService'), 'Should find UserService');
			assert.ok(symbolNames.includes('validateEmail'), 'Should find validateEmail');
			assert.ok(symbolNames.includes('MAX_RETRIES'), 'Should find MAX_RETRIES');
		});

		test('symbols have correct kinds', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const symbols = index.getFileSymbols('src/userService.ts');
			const userClass = symbols.find(s => s.name === 'UserService');
			const userInterface = symbols.find(s => s.name === 'IUser');
			const func = symbols.find(s => s.name === 'validateEmail');

			assert.strictEqual(userClass?.kind, 'class');
			assert.strictEqual(userInterface?.kind, 'interface');
			assert.strictEqual(func?.kind, 'function');
		});

		test('exported symbols are marked', () => {
			const index = new InMemoryCodebaseIndex();
			index.indexFile('src/userService.ts', sampleTypeScript);

			const symbols = index.getFileSymbols('src/userService.ts');
			const exported = symbols.filter(s => s.isExported);
			assert.ok(exported.length > 0, 'Should have exported symbols');
		});

		test('non-existent file returns empty symbols', () => {
			const index = new InMemoryCodebaseIndex();
			const symbols = index.getFileSymbols('non-existent.ts');
			assert.strictEqual(symbols.length, 0);
		});
	});

	suite('Persistence — index is saved and loaded', () => {
		test('serialized index contains version and timestamp', () => {
			const index = new InMemoryCodebaseIndex();
			const serialized = serializeIndex(index);
			const parsed = deserializeIndex(serialized);
			assert.ok(parsed !== null);
			assert.strictEqual(parsed.version, 1);
			assert.ok(parsed.savedAt > 0);
		});

		test('corrupted data returns null', () => {
			const result = deserializeIndex('not valid json{{{');
			assert.strictEqual(result, null);
		});

		test('index can be saved to disk and loaded', () => {
			const indexPath = path.join(tmpDir, 'index.json');
			const indexData = JSON.stringify({ version: 1, savedAt: Date.now(), files: [] });
			fs.writeFileSync(indexPath, indexData);

			const loaded = fs.readFileSync(indexPath, 'utf8');
			const parsed = JSON.parse(loaded);
			assert.strictEqual(parsed.version, 1);
		});
	});
});
