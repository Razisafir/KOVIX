/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const ITestGenerationTool = createDecorator<ITestGenerationTool>('construct.testGenerationTool');

/**
 * Supported test frameworks detected from project configuration.
 */
export type TestFramework = 'jest' | 'mocha' | 'vitest' | 'unknown';

/**
 * Result of test generation.
 */
export interface ITestGenerationResult {
	/** The generated test code */
	testCode: string;
	/** The suggested file path for the test file */
	suggestedFilePath: string;
	/** The detected test framework */
	framework: TestFramework;
}

/**
 * ITestGenerationTool — generates unit tests for a given file.
 *
 * Workflow:
 * 1. Read the target file content
 * 2. Analyze exports and functions
 * 3. Auto-detect test framework from project config
 * 4. Return a prompt for the LLM to generate tests
 */
export interface ITestGenerationTool {
	readonly _serviceBrand: undefined;

	/**
	 * Generate unit tests for the given file.
	 *
	 * @param fileUri URI of the file to generate tests for.
	 * @returns The generated test code and metadata.
	 */
	generateTests(fileUri: string): Promise<ITestGenerationResult>;

	/**
	 * Detect the test framework used in the project.
	 * Looks for mocha, jest, vitest in package.json devDependencies.
	 */
	detectTestFramework(): Promise<TestFramework>;

	/**
	 * Build a prompt for the LLM to generate tests for the given file content.
	 *
	 * @param fileContent The source file content.
	 * @param filePath The file path (used for context).
	 * @param framework The detected test framework.
	 * @returns A prompt string for the LLM.
	 */
	buildTestPrompt(fileContent: string, filePath: string, framework: TestFramework): string;
}
