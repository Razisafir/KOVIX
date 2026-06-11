// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { LoadingState, FileChangeEntry } from './loadingState.js';
import { IRestoreResult } from '../snapshot/snapshotManager.js';
import { IApprovedPlan, IMilestone, ExecutionState } from './milestoneStateMachine.js';

export const IAgentLoop = createDecorator<IAgentLoop>('construct.agentLoop');

/**
 * Events emitted by the agent loop during execution.
 */
export type AgentLoopEvent =
        | { type: 'thinking'; text: string }
        | { type: 'token'; text: string }
        | { type: 'tool_start'; toolId: string; toolName: string; toolInput?: unknown }
        | { type: 'tool_executing'; toolId: string; toolName: string; detail?: string }
        | { type: 'tool_result'; toolId: string; toolName: string; result: string; success: boolean }
        | { type: 'file_written'; filePath: string }
        | { type: 'complete'; summary: string }
        | { type: 'error'; text: string; recoverable: boolean }
        | { type: 'milestone_reached'; milestone: IMilestone }
        | { type: 'milestone_paused'; milestone: IMilestone }
        | { type: 'milestone_resumed'; milestone: IMilestone }
        | { type: 'milestone_completed'; milestone: IMilestone };

/**
 * Plan step returned from the planning phase.
 */
export interface IPlanStep {
        index: number;
        action: 'Read' | 'Create' | 'Edit' | 'Run';
        target: string;
        description: string;
}

/**
 * Result of the planning phase.
 */
export interface IPlanResult {
        steps: IPlanStep[];
        summary: string;
        rawResponse: string;
}

/**
 * Agent loop service -- orchestrates LLM calls with tool execution.
 *
 * Flow:
 * 1. Accept a task from the user
 * 2. Run planning phase (read-only tools only)
 * 3. Return plan for user approval
 * 4. If approved, run execution phase (full tool access)
 * 5. Loop: LLM call -> detect tool_use -> execute tool -> feed result back -> repeat
 * 6. Stop when LLM returns end_turn or max rounds (15) reached
 */
export interface IAgentLoop {
        readonly _serviceBrand: undefined;

        /**
         * Run the planning phase -- uses read-only tools to understand the codebase
         * and generate a plan. Does NOT make any changes.
         *
         * @param task The user's task description.
         * @param signal Optional AbortSignal for cancellation.
         * @returns Plan with steps for user approval.
         */
        runPlanningPhase(task: string, signal?: AbortSignal): Promise<IPlanResult>;

        /**
         * Run the full execution phase with all tools available.
         * Yields AgentLoopEvents in real time for UI updates.
         *
         * @param task The user's task description.
         * @param signal Optional AbortSignal for cancellation.
         * @returns AsyncGenerator of events for real-time streaming.
         */
        run(task: string, signal?: AbortSignal): AsyncGenerator<AgentLoopEvent>;

        /**
         * Whether an agent loop is currently running.
         */
        readonly isRunning: boolean;

        /**
         * Event fired when the loop starts.
         */
        readonly onDidStart: Event<string>;

        /**
         * Event fired when the loop completes.
         */
        readonly onDidComplete: Event<{ summary: string }>;

        /**
         * Event fired when the loop encounters an error.
         */
        readonly onError: Event<{ text: string; recoverable: boolean }>;

        /**
         * Event fired when the loading state changes during planning or execution.
         * Provides granular, function-level progress information for the UI.
         */
        readonly onLoadingStateChange: Event<LoadingState>;

        /**
         * Event fired when a file is created, modified, or deleted during execution.
         * Used for the real-time file tree diff in the progress panel.
         */
        readonly onFileChange: Event<FileChangeEntry>;

        /**
         * Undo the last agent task by restoring the most recent snapshot.
         * Reverts all file changes made during the last task.
         *
         * @returns The restore result, or null if no active snapshot exists.
         */
        undoLastTask(): Promise<IRestoreResult | null>;

        /**
         * Run the planning phase with a pre-refined idea.
         * The refined idea provides a more detailed specification than a raw prompt.
         *
         * @param refinedDescription The refined idea description.
         * @param signal Optional AbortSignal for cancellation.
         * @returns Plan with steps for user approval.
         */
        runPlanningPhaseWithIdea(refinedDescription: string, signal?: AbortSignal): Promise<IPlanResult>;

        /**
         * Run execution with an approved plan and milestone-based pausing.
         * Yields AgentLoopEvents including milestone pause/resume events.
         *
         * @param approvedPlan The user-approved plan with selected steps and execution mode.
         * @param signal Optional AbortSignal for cancellation.
         * @returns AsyncGenerator of events for real-time streaming.
         */
        runWithApprovedPlan(approvedPlan: IApprovedPlan, signal?: AbortSignal): AsyncGenerator<AgentLoopEvent>;

        /**
         * Start milestone-aware execution from an approved plan.
         * The agent will pause at milestones based on the execution mode.
         *
         * @param approvedPlan The approved plan to execute.
         * @param signal Optional AbortSignal for cancellation.
         */
        startExecution(approvedPlan: IApprovedPlan, signal?: AbortSignal): void;

        /**
         * Resume execution from the current milestone.
         * Called after the user reviews and approves the milestone result.
         */
        resumeFromMilestone(): void;

        /**
         * Skip the current milestone and move to the next one.
         */
        skipCurrentMilestone(): void;

        /**
         * Current execution state for milestone-aware execution.
         */
        readonly executionState: ExecutionState;

        /**
         * The current milestone being executed, if paused.
         */
        readonly currentMilestone: IMilestone | null;

        /**
         * Extract milestones from a plan's steps.
         * Groups plan steps into logical milestones based on action type
         * and target patterns.
         *
         * @param steps The plan steps from a planning result.
         * @returns Array of milestones with their associated steps.
         */
        extractMilestonesFromPlan(steps: IPlanStep[]): IMilestone[];

        /**
         * H2: Clear the multi-turn conversation history.
         * Called when the user starts a new chat session to reset context.
         */
        clearConversationHistory(): void;
}
