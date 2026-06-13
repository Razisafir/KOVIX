// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

/**
 * Granular loading phases for the CONSTRUCT IDE agent loop.
 * Each phase represents a distinct operation with its own visual indicator.
 */
export type LoadingPhase =
	| 'idle'
	| 'planning'
	| 'planning-reading'
	| 'planning-listing'
	| 'planning-complete'
	| 'executing-step'
	| 'reading-file'
	| 'writing-file'
	| 'creating-directory'
	| 'running-command'
	| 'applying-diff'
	| 'verifying'
	| 'waiting-llm'
	| 'complete'
	| 'error';

/**
 * Represents the current loading state of the agent loop.
 * Emitted via IAgentLoop.onLoadingStateChange for real-time UI updates.
 */
export interface LoadingState {
	readonly phase: LoadingPhase;
	readonly message: string;
	readonly detail?: string;
	readonly progress?: number; // 0-100 for operations with known progress
	readonly stepNumber?: number;
	readonly totalSteps?: number;
	readonly startTime: number;
	readonly toolName?: string;
	readonly filePath?: string;
}

/**
 * A single file change tracked during agent execution.
 * Used for the real-time file tree diff in the progress panel.
 */
export interface FileChangeEntry {
	readonly path: string;
	readonly status: 'created' | 'modified' | 'deleted' | 'reading' | 'writing';
	readonly timestamp: number;
}

/**
 * Metrics for a single execution step.
 * Tracks sub-operations (file reads, writes, commands) within a step.
 */
export interface StepMetric {
	readonly stepNumber: number;
	readonly label: string;
	startTime: number;
	endTime?: number;
	readonly subSteps: Array<{
		readonly label: string;
		readonly startTime: number;
		endTime?: number;
	}>;
}

/**
 * Aggregate performance metrics for a complete agent task.
 * Displayed in the metrics panel upon task completion.
 */
export interface TaskMetrics {
	readonly totalStartTime: number;
	totalEndTime?: number;
	planningStartTime?: number;
	planningEndTime?: number;
	readonly steps: StepMetric[];
	llmCallCount: number;
}

/**
 * Human-readable labels for each loading phase.
 */
export const LOADING_PHASE_LABELS: Record<LoadingPhase, string> = {
	'idle': 'Ready',
	'planning': 'Analyzing your request...',
	'planning-reading': 'Reading files for context',
	'planning-listing': 'Listing directory contents',
	'planning-complete': 'Plan ready',
	'executing-step': 'Executing step',
	'reading-file': 'Reading file',
	'writing-file': 'Writing file',
	'creating-directory': 'Creating directory',
	'running-command': 'Running command',
	'applying-diff': 'Applying diff',
	'verifying': 'Verifying result',
	'waiting-llm': 'Thinking...',
	'complete': 'Task complete',
	'error': 'Error',
};

/**
 * Phase-to-tool mapping for determining which phase a tool call triggers.
 */
export const TOOL_PHASE_MAP: Record<string, LoadingPhase> = {
	'read_file': 'reading-file',
	'write_file': 'writing-file',
	'list_directory': 'planning-listing',
	'create_directory': 'creating-directory',
	'run_command': 'running-command',
	'edit_file': 'applying-diff',
};
