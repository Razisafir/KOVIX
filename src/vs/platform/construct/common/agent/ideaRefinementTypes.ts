// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * KOVIX — Idea Refinement Types
 *
 * Defines the data structures for the idea refinement phase — a
 * conversational loop between the user and the AI that runs BEFORE
 * planning. The agent asks clarifying questions to help the user
 * think through their idea more clearly before any code is written.
 */

/**
 * A single question-answer turn during the idea refinement conversation.
 * Each turn captures what the agent asked and the user's response.
 */
export interface IRefinementQuestion {
        /** Unique identifier for this question turn */
        id: string;
        /** What the agent asks the user */
        question: string;
        /** Internal: why this question matters (for debugging/transparency) */
        purpose: string;
        /** Filled when the user responds */
        userAnswer?: string;
}

/**
 * The output of the idea refinement phase — a structured, clarified
 * version of the user's original project description.
 *
 * This is produced after 3-5 conversational turns with the agent and
 * is used as input to the planning phase. It captures scope,
 * constraints, success criteria, and assumptions to ensure the
 * generated plan is well-targeted.
 */
export interface IRefinedIdea {
        /** What the user first wrote in the project wizard */
        originalDescription: string;
        /** After the conversation — clearer, more specific description */
        refinedDescription: string;
        /** What's IN scope for this project */
        scope: string;
        /** Explicitly out of scope */
        outOfScope: string[];
        /** Technical or business constraints */
        constraints: string[];
        /** Specific, measurable success criteria */
        successCriteria: string[];
        /** Things we're assuming are true */
        assumptions: string[];
        /** The full Q&A history from the refinement conversation */
        questionsAndAnswers: IRefinementQuestion[];
        /** Agent signals this when refinement is complete */
        readyForPlanning: boolean;
}
