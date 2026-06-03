/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Launch & Integration Type Definitions
 *  Phase 28: Final integration + GOD Mode launch
 *
 *  Types for the launch checklist, GOD mode activation, and
 *  integration test infrastructure.
 *--------------------------------------------------------------------------------------------*/

/**
 * Result of a single launch checklist check.
 */
export interface ILaunchCheckResult {
	/** Whether the check passed. */
	readonly passed: boolean;
	/** Which phase this check belongs to. */
	readonly phase: string;
	/** Human-readable description of the check. */
	readonly check: string;
	/** How long the check took in milliseconds. */
	readonly durationMs: number;
	/** Error message if the check failed. */
	readonly error?: string;
}

/**
 * Overall launch readiness status.
 */
export interface ILaunchStatus {
	/** All checklist results. */
	readonly results: ILaunchCheckResult[];
	/** Number of passing checks. */
	readonly passedCount: number;
	/** Total number of checks. */
	readonly totalCount: number;
	/** Whether the system is ready for launch (all checks pass). */
	readonly readyForLaunch: boolean;
	/** Timestamp of the last run. */
	readonly lastRunTimestamp: number;
}

/**
 * GOD Mode activation state.
 */
export enum GodModeState {
	/** GOD Mode is not active. */
	Inactive = 'inactive',
	/** Countdown animation is playing. */
	Activating = 'activating',
	/** GOD Mode is active and running. */
	Active = 'active',
	/** GOD Mode is paused at a milestone. */
	Paused = 'paused',
	/** GOD Mode is stopping (cleanup in progress). */
	Stopping = 'stopping',
}

/**
 * GOD Mode configuration options.
 */
export interface IGodModeConfig {
	/** The high-level goal to accomplish. */
	readonly goal: string;
	/** The model to use for the planner agent. */
	readonly model?: string;
	/** Whether to auto-open the timeline panel. */
	readonly autoOpenTimeline?: boolean;
	/** Whether to create a git checkpoint before activation. */
	readonly createCheckpoint?: boolean;
	/** Maximum credits to spend in this session (0 = unlimited). */
	readonly maxCredits?: number;
}

/**
 * GOD Mode session summary, provided when GOD Mode stops.
 */
export interface IGodModeSummary {
	/** The original goal. */
	readonly goal: string;
	/** Number of milestones completed. */
	readonly milestonesCompleted: number;
	/** Total milestones planned. */
	readonly milestonesTotal: number;
	/** Credits consumed during the session. */
	readonly creditsConsumed: number;
	/** Number of files changed. */
	readonly filesChanged: number;
	/** Number of agents that were active. */
	readonly agentsUsed: number;
	/** Duration of the session in milliseconds. */
	readonly durationMs: number;
	/** Git checkpoint hash (if created). */
	readonly checkpointHash?: string;
}

/**
 * Integration test identifier.
 */
export type IntegrationTestId = 'react-auth' | '3d-portfolio' | 'fix-bugs' | 'collaborative';

/**
 * Result of an integration test run.
 */
export interface IIntegrationTestResult {
	/** The test identifier. */
	readonly id: IntegrationTestId;
	/** Human-readable test name. */
	readonly name: string;
	/** Whether the test passed. */
	readonly passed: boolean;
	/** Duration in milliseconds. */
	readonly durationMs: number;
	/** Step-by-step results. */
	readonly steps: Array<{
		readonly name: string;
		readonly passed: boolean;
		readonly durationMs: number;
		readonly error?: string;
	}>;
	/** Error message if the test failed. */
	readonly error?: string;
}

/**
 * Welcome screen demo types.
 */
export type WelcomeDemoType = 'multi-agent' | 'mcp-marketplace' | 'memory' | 'timeline' | 'godmode';

/**
 * Recent project entry.
 */
export interface IRecentProject {
	readonly path: string;
	readonly name: string;
	readonly lastOpened: number;
	readonly icon?: string;
}
