/*---------------------------------------------------------------------------------------------
 *  Construct IDE - AgentEngine Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AgentEngine } from '../../../src/construct/services/AgentEngine';
import { ServiceLocator } from '../../../src/construct/services/ServiceLocator';
import { LLMBridge } from '../../../src/construct/services/LLMBridge';
import { MCPClient } from '../../../src/construct/services/MCPClient';
import { TerminalExecutor } from '../../../src/construct/services/TerminalExecutor';
import { ContextBudget } from '../../../src/construct/services/ContextBudget';
import { DiffService } from '../../../src/construct/services/DiffService';
import { GitService } from '../../../src/construct/services/GitService';
import { RefactoringService } from '../../../src/construct/services/RefactoringService';

// Mock implementations
const mockLLM = {
	streamCompletion: jest.fn(),
	getTokenEstimator: jest.fn(() => LLMBridge.estimateTokens),
};

const mockMCP = {
	readFile: jest.fn(),
	writeFile: jest.fn(),
	listDirectory: jest.fn(),
	createDirectory: jest.fn(),
	deleteFile: jest.fn(),
	start: jest.fn(),
	stop: jest.fn(),
};

const mockTerminal = {
	run: jest.fn(),
};

const mockBudget = new ContextBudget();
const mockDiff = new DiffService();
const mockGit = {
	getStatus: jest.fn(),
	add: jest.fn(),
	addAll: jest.fn(),
	commit: jest.fn(),
	undoLastCommit: jest.fn(),
	revertFile: jest.fn(),
	getStagedDiff: jest.fn(),
	getUnstagedDiff: jest.fn(),
	getLastCommitFiles: jest.fn(),
	autoCommit: jest.fn(),
};

const mockRefactor = {
	renameSymbol: jest.fn(),
	findSymbol: jest.fn(),
};

describe('AgentEngine', () => {
	let locator: ServiceLocator;
	let engine: AgentEngine;

	beforeEach(() => {
		// Reset singleton
		(ServiceLocator as any).instance = undefined;
		locator = ServiceLocator.getInstance();

		// Register all mocks
		locator.register(Symbol.for('LLMBridge'), mockLLM as any);
		locator.register(Symbol.for('MCPClient'), mockMCP as any);
		locator.register(Symbol.for('TerminalExecutor'), mockTerminal as any);
		locator.register(Symbol.for('ContextBudget'), mockBudget as any);
		locator.register(Symbol.for('DiffService'), mockDiff as any);
		locator.register(Symbol.for('GitService'), mockGit as any);
		locator.register(Symbol.for('RefactoringService'), mockRefactor as any);

		engine = new AgentEngine(locator);

		// Reset mocks
		jest.clearAllMocks();
		mockBudget.reset();
	});

	describe('parsePlan', () => {
		test('parses numbered list into PlanSteps', () => {
			const output = `1. Create project directory
2. Initialize npm package
3. Write main.ts file`;
			const steps = engine.parsePlan(output);
			expect(steps).toHaveLength(3);
			expect(steps[0].description).toBe('Create project directory');
			expect(steps[1].description).toBe('Initialize npm package');
			expect(steps[2].description).toBe('Write main.ts file');
		});

		test('returns empty array for non-list text', () => {
			const output = 'This is just some text without numbered steps.';
			const steps = engine.parsePlan(output);
			expect(steps).toHaveLength(0);
		});

		test('handles mixed content', () => {
			const output = `Here's my plan:
1. First step
Some commentary
2. Second step`;
			const steps = engine.parsePlan(output);
			expect(steps).toHaveLength(2);
		});
	});

	describe('plan', () => {
		test('calls LLM and parses plan', async () => {
			mockLLM.streamCompletion.mockImplementation(async function* () {
				yield '1. Step one\n2. Step two\n3. Step three';
			});

			const steps = await engine.plan('Create a React app');
			expect(steps).toHaveLength(3);
			expect(mockLLM.streamCompletion).toHaveBeenCalled();
		});
	});

	describe('execute', () => {
		test('returns when no tool use detected', async () => {
			mockLLM.streamCompletion.mockImplementation(async function* () {
				yield 'Task completed successfully. All files have been created.';
			});

			const steps = [{ description: 'Do something', tool: 'bash' }];
			const result = await engine.execute(steps, 1);
			expect(result).toContain('Task completed');
		});

		test('throws AgentError after max rounds', async () => {
			// Always produce a tool use to force max rounds
			mockLLM.streamCompletion.mockImplementation(async function* () {
				yield '```tool\n{"tool": "read", "args": {"path": "test.ts"}}\n```';
			});

			mockMCP.readFile.mockResolvedValue('file content');

			const steps = [{ description: 'Do something', tool: 'bash' }];
			await expect(engine.execute(steps, 2)).rejects.toThrow('Max rounds');
		});
	});
});
