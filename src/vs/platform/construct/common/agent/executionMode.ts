/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * KOVIX — Execution Mode
 *
 * Defines how autonomous the agent should be during execution.
 * After approving a plan, the user picks one of these four modes
 * to control when the agent pauses for review.
 */

/**
 * Controls how autonomous the agent is during plan execution.
 *
 * After the user approves a plan, they select one of these modes to
 * determine when the agent pauses for human review. The mode is stored
 * in {@link IExecutionModeConfig} and referenced by the milestone
 * state machine to decide whether to continue or pause.
 */
export enum ExecutionMode {
        /**
         * EVERY_MILESTONE — Agent pauses after completing each milestone step.
         * User must click "Continue" to proceed to the next segment.
         * Best for: new users, unfamiliar codebases, high-risk changes
         */
        EVERY_MILESTONE = 'EVERY_MILESTONE',

        /**
         * MAJOR_MILESTONE — Agent pauses only at major milestones (steps where
         * isMilestone: true AND the agent internally judges significance > 3/5).
         * Best for: users who trust the agent but want periodic review
         */
        MAJOR_MILESTONE = 'MAJOR_MILESTONE',

        /**
         * SELECTIVE — User picks specific milestones to stop at before execution starts.
         * Best for: experienced users who know exactly which checkpoints matter
         */
        SELECTIVE = 'SELECTIVE',

        /**
         * FULL_AUTO — Agent runs to completion without stopping.
         * User can still abort at any time via the Stop button.
         * Best for: well-understood tasks, simple changes, power users
         */
        FULL_AUTO = 'FULL_AUTO',
}

/**
 * Full configuration for the agent's execution autonomy.
 *
 * Combines an {@link ExecutionMode} with mode-specific options.
 * For `SELECTIVE` mode, `selectedMilestoneIds` must be populated with
 * the milestone IDs the user chose to pause at.
 */
export interface IExecutionModeConfig {
        /** The chosen execution mode */
        mode: ExecutionMode;
        /** For SELECTIVE mode: which milestone IDs to pause at */
        selectedMilestoneIds?: string[];
}
