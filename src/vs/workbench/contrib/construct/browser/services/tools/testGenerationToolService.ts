// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import {
	ITestGenerationTool, ITestGenerationResult, TestFramework
} from '../../../../../../platform/construct/common/tools/testGenerationTool.js';
import * as pathModule from '../../../../../../base/common/path.js';

export class TestGenerationToolService extends Disposable implements ITestGenerationTool {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConstructAIService private readonly aiService: IConstructAIService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async generateTests(fileUri: string): Promise<ITestGenerationResult> {
		const uri = URI.parse(fileUri);
		const framework = await this.detectTestFramework();

		// Read the target file content
		let fileContent: string;
		try {
			const content = await this.fileService.readFile(uri);
			fileContent = content.value.toString();
		} catch (error) {
			this.logService.error('[TestGeneration] Failed to read file:', fileUri, error);
			throw new Error(`Failed to read file: ${fileUri}`);
		}

		// Build the prompt for the LLM
		const prompt = this.buildTestPrompt(fileContent, uri.path, framework);

		// Use the AI service to generate tests
		let testCode = '';
		try {
			const stream = this.aiService.chat(
				[{ role: 'user', content: prompt }],
				[],
				{
					systemPrompt: 'You are an expert test engineer. Generate comprehensive unit tests following best practices for the detected framework. Only output the test code, no explanations outside the code.',
				},
			);
			for await (const event of stream) {
				if (event.type === 'token') {
					testCode += event.text;
				}
				if (event.type === 'error') {
					throw new Error(`AI generation failed: ${event.text}`);
				}
			}
		} catch (error) {
			this.logService.error('[TestGeneration] AI generation failed:', error);
			throw error;
		}

		// Determine the suggested test file path
		const suggestedFilePath = this.suggestTestFilePath(uri.path, framework);

		return { testCode, suggestedFilePath, framework };
	}

	async detectTestFramework(): Promise<TestFramework> {
		const workspace = this.workspaceContextService.getWorkspace();
		if (!workspace.folders.length) {
			return 'unknown';
		}

		try {
			const packageJsonUri = URI.joinPath(workspace.folders[0].uri, 'package.json');
			const content = await this.fileService.readFile(packageJsonUri);
			const packageJson = JSON.parse(content.value.toString());

			const devDeps = packageJson.devDependencies ?? {};
			const deps = packageJson.dependencies ?? {};
			const allDeps = { ...devDeps, ...deps };

			if (allDeps['vitest']) { return 'vitest'; }
			if (allDeps['jest']) { return 'jest'; }
			if (allDeps['mocha']) { return 'mocha'; }
		} catch {
			// package.json may not exist
		}

		return 'unknown';
	}

	buildTestPrompt(fileContent: string, filePath: string, framework: TestFramework): string {
		const frameworkGuide: Record<TestFramework, string> = {
			jest: 'Use Jest (describe, it, expect, beforeEach/afterEach). Use jest.mock for mocking.',
			mocha: 'Use Mocha (describe, it, before/after hooks) with Chai expect assertions.',
			vitest: 'Use Vitest (describe, it, expect, vi.mock/vi.fn). Compatible with Jest API.',
			unknown: 'Use a generic testing style with describe/it blocks and expect-style assertions.',
		};

		return `Generate comprehensive unit tests for the following file.

File: ${filePath}
Test Framework: ${framework}
Framework Guide: ${frameworkGuide[framework]}

Requirements:
- Test all exported functions, classes, and methods
- Include edge cases and error handling tests
- Use appropriate mocking for external dependencies
- Follow the naming convention: describe block per function/class, it blocks per behavior
- Include both positive and negative test cases

Source code:
\`\`\`
${fileContent}
\`\`\`

Generate the complete test file:`;
	}

	private suggestTestFilePath(originalPath: string, framework: TestFramework): string {
		const ext = pathModule.extname(originalPath);
		const baseName = pathModule.basename(originalPath, ext);
		const dirName = pathModule.dirname(originalPath);

		// Common test file patterns
		const testSuffixes: Record<TestFramework, string[]> = {
			jest: [`.test${ext}`, `.spec${ext}`],
			mocha: [`.test${ext}`, `.spec${ext}`],
			vitest: [`.test${ext}`, `.spec${ext}`],
			unknown: [`.test${ext}`],
		};

		const suffixes = testSuffixes[framework];
		const testFileName = baseName + suffixes[0];

		// Prefer __tests__ directory or test/ directory
		if (dirName.includes('src')) {
			return dirName.replace('/src', '/__tests__') + '/' + testFileName;
		}

		return dirName + '/' + testFileName;
	}
}
