/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 2 Execution Event Stream
 *
 *  Execution event types for the real execution event stream.
 *  These events flow from services to the UI, enabling live observation
 *  of command execution, verification, repair, and milestone progress.
 *
 *  Adapted from Real-construct for Construct IDE.
 *  Branding: construct → construct, Construct IDE → Construct IDE
 *--------------------------------------------------------------------------------------------*/

// -- Event Types -- -----------------------------------------------------------

export enum ExecutionEventType {
	CommandStarted = 'commandStarted',
	CommandOutput = 'commandOutput',
	CommandCompleted = 'commandCompleted',
	CommandFailed = 'commandFailed',

	VerificationStarted = 'verificationStarted',
	VerificationPassed = 'verificationPassed',
	VerificationFailed = 'verificationFailed',

	RepairStarted = 'repairStarted',
	RepairSucceeded = 'repairSucceeded',
	RepairFailed = 'repairFailed',
	RepairRolledBack = 'repairRolledBack',

	CheckpointCreated = 'checkpointCreated',
	RollbackTriggered = 'rollbackTriggered',

	MilestoneStarted = 'milestoneStarted',
	MilestoneCompleted = 'milestoneCompleted',
	MilestoneFailed = 'milestoneFailed',

	EditApplied = 'editApplied',
	EditRolledBack = 'editRolledBack',

	GitOperationStarted = 'gitOperationStarted',
	GitOperationCompleted = 'gitOperationCompleted',

	ExecutionPaused = 'executionPaused',
	ExecutionResumed = 'executionResumed',
	ExecutionStopped = 'executionStopped',
	ExecutionCrashed = 'executionCrashed',
	ExecutionRecovered = 'executionRecovered',

	TokenUsageUpdated = 'tokenUsageUpdated',
	ContextWindowChanged = 'contextWindowChanged'
}

// -- Event Payload -- ---------------------------------------------------------

export interface ExecutionEvent {
	type: ExecutionEventType;
	timestamp: number;
	data: Record<string, any>;
	source: string;
	projectId?: string;
	milestoneId?: string;
}

// -- Event Stream Interface -- ------------------------------------------------

export interface ExecutionEventStream {
	/**
	 * Register a listener for execution events.
	 * Called for every event that flows through the stream.
	 */
	onEvent: (event: ExecutionEvent) => void;

	/**
	 * Get the N most recent events from the stream buffer.
	 */
	getRecentEvents(count: number): ExecutionEvent[];

	/**
	 * Get all buffered events matching the given type.
	 */
	getEventsByType(type: ExecutionEventType): ExecutionEvent[];

	/**
	 * Get all buffered events matching the given project ID.
	 */
	getEventsByProject(projectId: string): ExecutionEvent[];

	/**
	 * Clear the event buffer.
	 */
	clear(): void;
}
