// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Position } from '../../../../editor/common/core/position.js';
import {
	InlineCompletion,
	InlineCompletions,
	InlineCompletionsProvider,
	InlineCompletionContext,
} from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * ConstructInlineSuggestionProvider — AI-powered inline code completions.
 *
 * Implements VS Code's InlineCompletionsProvider interface to provide
 * tab-completion suggestions powered by the Construct AI service.
 *
 * On trigger (typing pause), sends context (current file, cursor position,
 * surrounding code) to the AI service and returns inline completion suggestions.
 * Supports multi-line completions.
 */
export class ConstructInlineSuggestionProvider extends Disposable implements InlineCompletionsProvider<InlineCompletions> {
	declare readonly groupId: string;

	constructor(
		@IConstructAIService private readonly aiService: IConstructAIService,
		@IConfigurationService private readonly configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.groupId = 'constructInlineSuggestions';
	}

	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken,
	): Promise<InlineCompletions | undefined> {
		// Check if inline suggestions are enabled
		const enabled = this.configService.getValue<boolean>('construct.inlineSuggestions.enabled');
		if (!enabled) {
			return undefined;
		}

		if (token.isCancellationRequested) {
			return undefined;
		}

		// Get context around the cursor
		const lineNumber = position.lineNumber;
		const column = position.column;

		// Get prefix (code before cursor)
		const prefixLineCount = Math.min(20, lineNumber - 1);
		const prefixStartLine = Math.max(1, lineNumber - prefixLineCount);
		const prefixRange = new Range(prefixStartLine, 1, lineNumber, column);
		const prefix = model.getValueInRange(prefixRange);

		// Get suffix (code after cursor)
		const lineCount = model.getLineCount();
		const suffixLineCount = Math.min(10, lineCount - lineNumber);
		const suffixEndLine = Math.min(lineCount, lineNumber + suffixLineCount);
		const suffixRange = new Range(lineNumber, column, suffixEndLine, model.getLineMaxColumn(suffixEndLine));
		const suffix = model.getValueInRange(suffixRange);

		// Skip if prefix is too short (user just started typing)
		if (prefix.trim().length < 10) {
			return undefined;
		}

		try {
			const result = await this.aiService.complete(prefix, suffix, {
				maxTokens: 200,
				temperature: 0.2,
			});

			if (token.isCancellationRequested || !result.text) {
				return undefined;
			}

			// Clean up the completion text
			const completionText = result.text.trim();
			if (!completionText) {
				return undefined;
			}

			// Create the inline completion
			const replaceRange = new Range(lineNumber, column, lineNumber, column);

			const items: InlineCompletion[] = [{
				insertText: completionText,
				range: replaceRange,
				completeBracketPairs: true,
			}];

			return {
				items,
				suppressSuggestions: true,
				enableForwardStability: true,
			};
		} catch (error) {
			this.logService.debug('[ConstructInline] Completion failed:', error);
			return undefined;
		}
	}

	handleItemDidShow?(
		completions: InlineCompletions,
		item: InlineCompletion,
		updatedInsertText: string,
	): void {
		// No-op: could track analytics
	}

	freeInlineCompletions(completions: InlineCompletions): void {
		// No-op: nothing to free
	}
}
