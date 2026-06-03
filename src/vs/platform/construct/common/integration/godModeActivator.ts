/*---------------------------------------------------------------------------------------------
 *  Construct IDE - GOD Mode Activator & Launch Checklist Interfaces
 *  Phase 28: Final integration + GOD Mode launch
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import {
	ILaunchCheckResult,
	ILaunchStatus,
	IGodModeConfig,
	IGodModeSummary,
	GodModeState,
	IIntegrationTestResult,
	IntegrationTestId,
} from './launchTypes.js';

// ── ILaunchChecklist ──────────────────────────────────────────

export const ILaunchChecklist = createDecorator<ILaunchChecklist>('launchChecklistService');

/**
 * ILaunchChecklist — Pre-launch validation checklist.
 *
 * Runs automated checks for each enhancement phase to verify
 * the system is ready for GOD Mode launch. Checks exercise
 * representative operations and verify results.
 */
export interface ILaunchChecklist {
	readonly _serviceBrand: undefined;

	/**
	 * Run the full launch checklist (15 checks).
	 * Returns results with pass/fail and timing for each check.
	 */
	runAllChecks(): Promise<ILaunchStatus>;

	/**
	 * Run a single phase check.
	 */
	runCheck(phase: string): Promise<ILaunchCheckResult>;

	/**
	 * Get the most recent launch status (without re-running).
	 */
	getStatus(): ILaunchStatus | undefined;

	/**
	 * Number of checks in the checklist.
	 */
	readonly checkCount: number;

	/**
	 * Fired when a check completes.
	 */
	readonly onCheckCompleted: Event<ILaunchCheckResult>;

	/**
	 * Fired when all checks complete.
	 */
	readonly onAllChecksCompleted: Event<ILaunchStatus>;
}

// ── IGodModeActivator ─────────────────────────────────────────

export const IGodModeActivator = createDecorator<IGodModeActivator>('godModeActivatorService');

/**
 * IGodModeActivator — GOD Mode activation, pause, resume, and stop.
 *
 * Validates prerequisites before activation, creates a git checkpoint,
 * triggers the activation animation, and manages the GOD Mode lifecycle.
 * On stop, restores the pre-GOD state and provides a session summary.
 */
export interface IGodModeActivator {
	readonly _serviceBrand: undefined;

	/**
	 * Current GOD Mode state.
	 */
	readonly state: GodModeState;

	/**
	 * Activate GOD Mode with the given configuration.
	 * Validates prerequisites, creates checkpoint, starts countdown.
	 * Returns true if activation was initiated successfully.
	 */
	activate(config: IGodModeConfig): Promise<boolean>;

	/**
	 * Pause GOD Mode at the current milestone.
	 * Returns false if not in Active state.
	 */
	pause(): boolean;

	/**
	 * Resume GOD Mode from a paused state.
	 * Returns false if not in Paused state.
	 */
	resume(): boolean;

	/**
	 * Stop GOD Mode and restore pre-GOD state.
	 * Creates a session summary.
	 */
	stop(): Promise<IGodModeSummary>;

	/**
	 * Get the current GOD Mode status for display.
	 */
	getStatus(): {
		state: GodModeState;
		goal: string;
		creditsRemaining: number;
		creditsConsumed: number;
		milestonesCompleted: number;
		milestonesTotal: number;
		elapsedMs: number;
	};

	/**
	 * Run an integration test by ID.
	 */
	runIntegrationTest(testId: IntegrationTestId): Promise<IIntegrationTestResult>;

	/**
	 * Fired when GOD Mode state changes.
	 */
	readonly onStateChanged: Event<GodModeState>;

	/**
	 * Fired when GOD Mode activation countdown progresses.
	 */
	readonly onCountdown: Event<number>;

	/**
	 * Fired when GOD Mode is stopped with a session summary.
	 */
	readonly onStopped: Event<IGodModeSummary>;
}

// Re-export types from launchTypes for convenience
export type {
	ILaunchCheckResult,
	ILaunchStatus,
	IGodModeConfig,
	IGodModeSummary,
	GodModeState,
	IIntegrationTestResult,
	IntegrationTestId,
	WelcomeDemoType,
	IRecentProject,
} from './launchTypes.js';
