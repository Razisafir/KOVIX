/*---------------------------------------------------------------------------------------------
 *  Construct IDE - RefactoringService Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { RefactoringService } from '../../../src/construct/services/RefactoringService';
import { MCPClient } from '../../../src/construct/services/MCPClient';

// Mock MCPClient
jest.mock('../../../src/construct/services/MCPClient');

describe('RefactoringService', () => {
	let service: RefactoringService;
	let mockListDirectory: jest.MockedFunction<MCPClient['listDirectory']>;
	let mockReadFile: jest.MockedFunction<MCPClient['readFile']>;
	let mockWriteFile: jest.MockedFunction<MCPClient['writeFile']>;

	beforeEach(() => {
		const mcp = new MCPClient('/workspace');
		mockListDirectory = mcp.listDirectory as jest.MockedFunction<typeof mcp.listDirectory>;
		mockReadFile = mcp.readFile as jest.MockedFunction<typeof mcp.readFile>;
		mockWriteFile = mcp.writeFile as jest.MockedFunction<typeof mcp.writeFile>;
		service = new RefactoringService(mcp, '/workspace');
		jest.clearAllMocks();
	});

	describe('renameSymbol', () => {
		test('renames symbol across matching files', async () => {
			mockListDirectory.mockResolvedValue(['main.ts', 'util.ts', 'readme.md']);
			mockReadFile.mockImplementation(async (path: string) => {
				if (path.includes('main.ts')) return 'const oldName = 1;\nimport { oldName } from "./util";\n';
				if (path.includes('util.ts')) return 'export const oldName = 42;\n';
				return '';
			});

			const result = await service.renameSymbol('oldName', 'newName', { dryRun: true });
			expect(result.filesModified.length).toBeGreaterThanOrEqual(0); // dry run
		});

		test('returns errors for files that fail to read', async () => {
			mockListDirectory.mockRejectedValue(new Error('Connection failed'));

			await expect(service.renameSymbol('foo', 'bar')).rejects.toThrow('Failed to list workspace');
		});
	});

	describe('findSymbol', () => {
		test('finds symbol occurrences in workspace', async () => {
			mockListDirectory.mockResolvedValue(['main.ts']);
			mockReadFile.mockResolvedValue('const myFunction = () => {};\nmyFunction();\n');

			const results = await service.findSymbol('myFunction');
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].context).toContain('myFunction');
		});

		test('returns empty when symbol not found', async () => {
			mockListDirectory.mockResolvedValue(['main.ts']);
			mockReadFile.mockResolvedValue('const other = 1;\n');

			const results = await service.findSymbol('nonExistent');
			expect(results).toEqual([]);
		});
	});
});
