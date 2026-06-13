// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const IAgentErrorRecovery = createDecorator<IAgentErrorRecovery>('construct.agentErrorRecovery');

/**
 * The type of error that occurred during a step execution.
 */
export type StepErrorType =
	| 'non_zero_exit'       // Command exited with non-zero code
	| 'file_permission'     // Cannot read/write file (permission denied)
	| 'file_not_found'      // File does not exist
	| 'syntax_error'        // Generated code has syntax errors
	| 'network_error'       // Network request failed (API, npm, etc.)
	| 'timeout'             // Command or operation timed out
	| 'unknown';            // Unclassified error

/**
 * Details about a step-level error.
 */
export interface IStepError {
	/** The step index in the plan. */
	stepIndex: number;
	/** The tool that was being executed. */
	toolName: string;
	/** The tool input that caused the error. */
	toolInput: unknown;
	/** Classification of the error type. */
	errorType: StepErrorType;
	/** The raw error message. */
	message: string;
	/** Standard output from the failed command (if applicable). */
	stdout?: string;
	/** Standard error from the failed command (if applicable). */
	stderr?: string;
	/** Exit code from the failed command (if applicable). */
	exitCode?: number;
	/** Number of retry attempts so far. */
	retryCount: number;
	/** Maximum retries allowed. */
	maxRetries: number;
	/** Timestamp when the error occurred. */
	timestamp: number;
}

/**
 * The recovery strategy chosen by the system or user.
 */
export type RecoveryStrategy =
	| 'retry'       // Retry the step with error context injected
	| 'skip'        // Skip this step and continue with remaining steps
	| 'edit'        // Allow user to edit the step/tool input and retry
	| 'abort';      // Stop the entire task

/**
 * Result of a recovery attempt.
 */
export interface IRecoveryResult {
	/** The strategy that was applied. */
	strategy: RecoveryStrategy;
	/** Whether the recovery was successful. */
	success: boolean;
	/** If retried, the number of the retry attempt. */
	retryAttempt?: number;
	/** If retried, the result of the retry. */
	retryResult?: string;
	/** Error message if recovery failed. */
	error?: string;
}

/**
 * Configuration for error recovery behavior.
 */
export interface IErrorRecoveryConfig {
	/** Maximum number of automatic retries before asking the user. Default: 3. */
	maxRetries: number;
	/** Whether to automatically retry without asking the user first. Default: true. */
	autoRetry: boolean;
	/** Delay in ms between retries. Default: 1000. */
	retryDelayMs: number;
	/** Whether to inject error context into the next LLM call. Default: true. */
	injectErrorContext: boolean;
}

/**
 * Service for recovering from errors during agent task execution.
 *
 * When a step in the agent loop fails, this service:
 * 1. Classifies the error type
 * 2. Attempts automatic retry with error context injected into the next LLM call
 * 3. After max retries, escalates to the user with specific failure details
 * 4. Offers: retry, skip, edit step, or abort task options
 */
export interface IAgentErrorRecovery {
	readonly _serviceBrand: undefined;

	/**
	 * Classify an error from a tool execution.
	 *
	 * @param toolName The tool that failed.
	 * @param toolInput The tool input.
	 * @param errorMessage The raw error message.
	 * @param exitCode Exit code (if from a command).
	 * @param stderr Standard error output (if from a command).
	 */
	classifyError(
		toolName: string,
		toolInput: unknown,
		errorMessage: string,
		exitCode?: number,
		stderr?: string
	): IStepError;

	/**
	 * Attempt to recover from a step error by retrying with error context.
	 *
	 * The error context is injected into the next LLM call so the model
	 * can adjust its approach. For example:
	 * - "npm install failed with exit code 1. stderr: E404 package 'bad-pkg' not found"
	 * - "File permission denied writing to /etc/config"
	 *
	 * @param error The step error to recover from.
	 * @returns Recovery result indicating what happened.
	 */
	attemptRecovery(error: IStepError): Promise<IRecoveryResult>;

	/**
	 * Request user intervention when automatic recovery is exhausted.
	 * Presents the error details and recovery options to the user.
	 *
	 * @param error The step error that couldn't be auto-recovered.
	 * @returns The recovery strategy chosen by the user.
	 */
	requestUserIntervention(error: IStepError): Promise<RecoveryStrategy>;

	/**
	 * Build an error context message to inject into the next LLM call.
	 * This gives the model information about what went wrong so it can
	 * adjust its approach.
	 *
	 * @param error The step error.
	 * @param previousAttempts Results from previous retry attempts.
	 * @returns A formatted context string for the LLM.
	 */
	buildErrorContext(error: IStepError, previousAttempts?: string[]): string;

	/**
	 * Get the current error recovery configuration.
	 */
	readonly config: IErrorRecoveryConfig;

	/**
	 * Update the error recovery configuration.
	 */
	updateConfig(config: Partial<IErrorRecoveryConfig>): void;

	/**
	 * Event fired when a step error occurs.
	 */
	readonly onStepError: Event<IStepError>;

	/**
	 * Event fired when a recovery attempt is made.
	 */
	readonly onRecoveryAttempt: Event<IRecoveryResult>;

	/**
	 * Event fired when user intervention is requested.
	 */
	readonly onUserInterventionRequested: Event<IStepError>;
}
