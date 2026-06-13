// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import {
	ICodeReviewTool, IReviewOptions, IReviewResult, IReviewFinding
} from '../../../../../../platform/construct/common/tools/codeReviewTool.js';

export class CodeReviewToolService extends Disposable implements ICodeReviewTool {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IConstructAIService private readonly aiService: IConstructAIService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async reviewCode(target: string, options?: IReviewOptions): Promise<IReviewResult> {
		const severity = options?.severity ?? 'all';
		const includeSuggestions = options?.includeSuggestions ?? true;

		// Read the target content
		let codeContent: string;
		let filePath: string;

		try {
			const uri = URI.parse(target);
			const content = await this.fileService.readFile(uri);
			codeContent = content.value.toString();
			filePath = uri.path;
		} catch {
			// Assume target is diff content
			codeContent = target;
			filePath = 'diff';
		}

		// Build the review prompt
		const prompt = this.buildReviewPrompt(codeContent, filePath, severity, includeSuggestions);

		// Use AI to analyze
		let response = '';
		try {
			const stream = this.aiService.chat(
				[{ role: 'user', content: prompt }],
				[],
				{
					systemPrompt: 'You are a senior code reviewer. Analyze code for bugs, security issues, and style violations. Respond ONLY with valid JSON matching the schema provided. No other text.',
				},
			);
			for await (const event of stream) {
				if (event.type === 'token') {
					response += event.text;
				}
				if (event.type === 'error') {
					throw new Error(`AI review failed: ${event.text}`);
				}
			}
		} catch (error) {
			this.logService.error('[CodeReview] AI analysis failed:', error);
			throw error;
		}

		// Parse the response
		return this.parseReviewResponse(response, filePath);
	}

	private buildReviewPrompt(
		codeContent: string,
		filePath: string,
		severity: string,
		includeSuggestions: boolean,
	): string {
		const severityFilter: Record<string, string> = {
			all: 'Review for all categories: bugs, security vulnerabilities, and style issues.',
			bugs: 'Focus ONLY on bugs and logic errors.',
			security: 'Focus ONLY on security vulnerabilities (injection, XSS, auth issues, etc.).',
			style: 'Focus ONLY on code style, naming conventions, and maintainability.',
		};

		return `Review the following code and identify issues.

File: ${filePath}
Review Focus: ${severityFilter[severity] || severityFilter.all}
${includeSuggestions ? 'Include fix suggestions for each finding.' : 'Do not include fix suggestions.'}

Code to review:
\`\`\`
${codeContent}
\`\`\`

Respond with ONLY a JSON object in this exact format (no markdown, no backticks):
{
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "message": "Description of the issue",
      "line": <line number or null>,
      "suggestion": "How to fix it" ${includeSuggestions ? '' : ' (omit this field)'}
    }
  ]
}`;
	}

	private parseReviewResponse(response: string, defaultFile: string): IReviewResult {
		try {
			// Try to extract JSON from the response (handle potential markdown wrapping)
			let jsonStr = response.trim();
			const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (jsonMatch) {
				jsonStr = jsonMatch[1].trim();
			}

			const parsed = JSON.parse(jsonStr);
			const findings: IReviewFinding[] = (parsed.findings ?? []).map((f: any) => ({
				severity: ['critical', 'high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
				message: String(f.message ?? 'Unknown issue'),
				file: defaultFile,
				line: typeof f.line === 'number' ? f.line : undefined,
				suggestion: f.suggestion ? String(f.suggestion) : undefined,
			}));

			return { findings };
		} catch (error) {
			this.logService.warn('[CodeReview] Failed to parse AI response as JSON:', error);
			// Return a single finding with the raw response
			return {
				findings: [{
					severity: 'low',
					message: 'Code review completed but results could not be parsed. Raw response: ' + response.substring(0, 500),
					file: defaultFile,
				}],
			};
		}
	}
}
