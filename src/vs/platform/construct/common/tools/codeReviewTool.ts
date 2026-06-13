/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const ICodeReviewTool = createDecorator<ICodeReviewTool>('construct.codeReviewTool');

/**
 * Options for code review.
 */
export interface IReviewOptions {
	/** Filter findings by severity category */
	severity?: 'all' | 'bugs' | 'security' | 'style';
	/** Whether to include fix suggestions */
	includeSuggestions?: boolean;
}

/**
 * A single finding from a code review.
 */
export interface IReviewFinding {
	/** Severity level of the finding */
	severity: 'critical' | 'high' | 'medium' | 'low';
	/** Human-readable description of the issue */
	message: string;
	/** File where the issue was found */
	file: string;
	/** Optional line number */
	line?: number;
	/** Optional suggestion for fixing the issue */
	suggestion?: string;
}

/**
 * Result of a code review.
 */
export interface IReviewResult {
	/** All findings from the review */
	findings: IReviewFinding[];
}

/**
 * ICodeReviewTool — AI-powered code review.
 *
 * Reads a target file or diff, analyzes for bugs, security issues,
 * and style violations, and returns structured findings.
 */
export interface ICodeReviewTool {
	readonly _serviceBrand: undefined;

	/**
	 * Review code at the given target (file URI or diff).
	 *
	 * @param target File URI or diff content to review.
	 * @param options Review options for filtering and suggestions.
	 * @returns Structured review findings.
	 */
	reviewCode(target: string, options?: IReviewOptions): Promise<IReviewResult>;
}
