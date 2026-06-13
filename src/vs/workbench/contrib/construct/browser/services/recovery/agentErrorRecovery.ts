/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../../platform/quickinput/common/quickInput.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import {
	IAgentErrorRecovery,
	IStepError,
	IRecoveryResult,
	RecoveryStrategy,
	StepErrorType,
	IErrorRecoveryConfig
} from '../../../../../../platform/construct/common/recovery/agentErrorRecovery.js';

/**
 * Default error recovery configuration.
 */
const DEFAULT_CONFIG: IErrorRecoveryConfig = {
	maxRetries: 3,
	autoRetry: true,
	retryDelayMs: 1000,
	injectErrorContext: true,
};

/**
 * Pattern map for classifying errors by their message content.
 * Each entry maps a case-insensitive regex pattern to a StepErrorType.
 */
const ERROR_CLASSIFICATION_PATTERNS: readonly [RegExp, StepErrorType][] = [
	[/permission denied|EACCES/i, 'file_permission'],
	[/ENOENT|not found|No such file/i, 'file_not_found'],
	[/SyntaxError|syntax error|unexpected token/i, 'syntax_error'],
	[/ECONNREFUSED|ETIMEDOUT|network/i, 'network_error'],
	[/timed out/i, 'timeout'],
];

/**
 * Service for recovering from errors during agent task execution.
 *
 * When a step in the agent loop fails, this service:
 * 1. Classifies the error type using pattern matching
 * 2. Attempts automatic retry with error context injected into the next LLM call
 * 3. After max retries, escalates to the user with specific failure details
 * 4. Offers: retry, skip, edit step, or abort task options
 */
export class AgentErrorRecoveryService extends Disposable implements IAgentErrorRecovery {
	declare readonly _serviceBrand: undefined;

	private _config: IErrorRecoveryConfig;

	private readonly _onStepError = this._register(new Emitter<IStepError>());
	readonly onStepError = this._onStepError.event;

	private readonly _onRecoveryAttempt = this._register(new Emitter<IRecoveryResult>());
	readonly onRecoveryAttempt = this._onRecoveryAttempt.event;

	private readonly _onUserInterventionRequested = this._register(new Emitter<IStepError>());
	readonly onUserInterventionRequested = this._onUserInterventionRequested.event;

	/** Tracks the next step index for errors that don't specify one. */
	private _stepCounter = 0;

	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		// Load config from VS Code settings if available, otherwise use defaults
		this._config = { ...DEFAULT_CONFIG };
		this.loadConfigFromSettings();

		this.logService.info('[AgentErrorRecovery] Service created');
	}

	/**
	 * Get the current error recovery configuration.
	 */
	get config(): IErrorRecoveryConfig {
		return this._config;
	}

	/**
	 * Update the error recovery configuration with partial values.
	 */
	updateConfig(config: Partial<IErrorRecoveryConfig>): void {
		this._config = { ...this._config, ...config };
		this.logService.info(`[AgentErrorRecovery] Config updated: ${JSON.stringify(config)}`);
	}

	/**
	 * Classify an error from a tool execution.
	 *
	 * Uses pattern matching on the error message, exit code, and stderr to
	 * determine the error type. Classification priority:
	 * 1. Exit code 124 → timeout
	 * 2. Non-zero exit code → non_zero_exit (unless matched by message patterns)
	 * 3. Message/stderr pattern matching for specific error types
	 * 4. Fallback → unknown
	 */
	classifyError(
		toolName: string,
		toolInput: unknown,
		errorMessage: string,
		exitCode?: number,
		stderr?: string
	): IStepError {
		const errorType = this.doClassify(errorMessage, exitCode, stderr);

		const error: IStepError = {
			stepIndex: this._stepCounter++,
			toolName,
			toolInput,
			errorType,
			message: errorMessage,
			stderr,
			exitCode,
			retryCount: 0,
			maxRetries: this._config.maxRetries,
			timestamp: Date.now(),
		};

		this._onStepError.fire(error);
		this.logService.info(`[AgentErrorRecovery] Classified error as "${errorType}" for tool "${toolName}": ${errorMessage.substring(0, 200)}`);

		return error;
	}

	/**
	 * Attempt to recover from a step error by retrying with error context.
	 *
	 * If autoRetry is enabled and retryCount < maxRetries:
	 * - Waits retryDelayMs before returning
	 * - Returns a retry strategy with the next attempt number
	 * - The actual retry execution is handled by the agent loop
	 *
	 * If retries are exhausted or autoRetry is disabled, delegates to
	 * requestUserIntervention().
	 */
	async attemptRecovery(error: IStepError): Promise<IRecoveryResult> {
		if (this._config.autoRetry && error.retryCount < this._config.maxRetries) {
			const nextAttempt = error.retryCount + 1;

			this.logService.info(`[AgentErrorRecovery] Auto-retry attempt ${nextAttempt}/${this._config.maxRetries} for step ${error.stepIndex}`);

			// Wait the configured delay before returning the retry decision
			await this.delay(this._config.retryDelayMs);

			const result: IRecoveryResult = {
				strategy: 'retry',
				success: false,
				retryAttempt: nextAttempt,
			};

			this._onRecoveryAttempt.fire(result);
			return result;
		}

		// Retries exhausted or auto-retry disabled — ask the user
		this.logService.info(`[AgentErrorRecovery] Retries exhausted for step ${error.stepIndex}, requesting user intervention`);
		const strategy = await this.requestUserIntervention(error);

		const result: IRecoveryResult = {
			strategy,
			success: false,
		};

		this._onRecoveryAttempt.fire(result);
		return result;
	}

	/**
	 * Request user intervention when automatic recovery is exhausted.
	 *
	 * Presents a quick pick with four options:
	 * - "Retry step" → retry
	 * - "Skip and continue" → skip
	 * - "Edit step and retry" → edit
	 * - "Abort task" → abort
	 */
	async requestUserIntervention(error: IStepError): Promise<RecoveryStrategy> {
		this._onUserInterventionRequested.fire(error);

		const errorLabel = this.getErrorTypeLabel(error.errorType);

		const picks: IQuickPickItem[] = [
			{
				label: '$(redo) Retry step',
				description: `Attempt step ${error.stepIndex} again`,
				detail: `Retry with error context injected into the next LLM call`,
			},
			{
				label: '$(skip-forward) Skip and continue',
				description: `Skip step ${error.stepIndex}`,
				detail: `Skip this step and proceed with remaining steps`,
			},
			{
				label: '$(edit) Edit step and retry',
				description: `Modify the step input`,
				detail: `Edit the tool input before retrying`,
			},
			{
				label: '$(close) Abort task',
				description: 'Stop the entire task',
				detail: `Cancel the entire agent task execution`,
			},
		];

		const result = await this.quickInputService.pick(picks, {
			placeHolder: `Step ${error.stepIndex} failed (${errorLabel}): ${error.message.substring(0, 100)}. Choose a recovery strategy:`,
			title: `Error Recovery — Step ${error.stepIndex}`,
		});

		if (!result) {
			// User dismissed the quick pick — default to abort
			this.logService.info('[AgentErrorRecovery] User dismissed intervention prompt, defaulting to abort');
			return 'abort';
		}

		const strategyMap: Record<string, RecoveryStrategy> = {
			'$(redo) Retry step': 'retry',
			'$(skip-forward) Skip and continue': 'skip',
			'$(edit) Edit step and retry': 'edit',
			'$(close) Abort task': 'abort',
		};

		const strategy = strategyMap[result.label] ?? 'abort';

		this.logService.info(`[AgentErrorRecovery] User chose strategy: ${strategy} for step ${error.stepIndex}`);

		return strategy;
	}

	/**
	 * Build an error context message to inject into the next LLM call.
	 *
	 * This gives the model information about what went wrong so it can
	 * adjust its approach in subsequent attempts.
	 */
	buildErrorContext(error: IStepError, previousAttempts?: string[]): string {
		const lines: string[] = [];

		lines.push(`[ERROR RECOVERY - Step ${error.stepIndex} failed]`);
		lines.push(`Tool: ${error.toolName}`);
		lines.push(`Input: ${JSON.stringify(error.toolInput)}`);
		lines.push(`Error type: ${error.errorType}`);
		lines.push(`Error message: ${error.message}`);

		if (error.exitCode !== undefined) {
			lines.push(`Exit code: ${error.exitCode}`);
		}

		if (error.stderr) {
			lines.push(`stderr output: ${error.stderr}`);
		}

		lines.push(`Retry attempt: ${error.retryCount}/${error.maxRetries}`);

		if (previousAttempts && previousAttempts.length > 0) {
			lines.push(`Previous attempts failed: ${previousAttempts.join('; ')}`);
		}

		lines.push('Please adjust your approach based on this error information.');

		return lines.join('\n');
	}

	override dispose(): void {
		super.dispose();
	}

	// ──────────────────────────────────────────────────────────────────────
	// Private helpers
	// ──────────────────────────────────────────────────────────────────────

	/**
	 * Perform the actual error classification based on pattern matching.
	 */
	private doClassify(errorMessage: string, exitCode?: number, stderr?: string): StepErrorType {
		// Check exit code 124 (timeout coreutil) first — it's unambiguous
		if (exitCode === 124) {
			return 'timeout';
		}

		// Combine message and stderr for pattern matching
		const combinedMessage = [errorMessage, stderr].filter(Boolean).join(' ');

		// Check specific patterns in priority order
		for (const [pattern, errorType] of ERROR_CLASSIFICATION_PATTERNS) {
			if (pattern.test(combinedMessage)) {
				return errorType;
			}
		}

		// Non-zero exit code without a specific pattern match
		if (exitCode !== undefined && exitCode !== 0) {
			return 'non_zero_exit';
		}

		// Nothing matched
		return 'unknown';
	}

	/**
	 * Get a human-readable label for an error type.
	 */
	private getErrorTypeLabel(errorType: StepErrorType): string {
		switch (errorType) {
			case 'non_zero_exit': return 'Non-zero Exit';
			case 'file_permission': return 'Permission Denied';
			case 'file_not_found': return 'File Not Found';
			case 'syntax_error': return 'Syntax Error';
			case 'network_error': return 'Network Error';
			case 'timeout': return 'Timeout';
			case 'unknown': return 'Unknown Error';
		}
	}

	/**
	 * Delay helper that respects the retry delay configuration.
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Load configuration from VS Code settings.
	 */
	private loadConfigFromSettings(): void {
		try {
			const configSection = this.configurationService.getValue<{ errorRecovery?: IErrorRecoveryConfig }>('construct');
			if (configSection?.errorRecovery) {
				this._config = { ...DEFAULT_CONFIG, ...configSection.errorRecovery };
			}
		} catch {
			// Config not available yet — use defaults
		}
	}
}
