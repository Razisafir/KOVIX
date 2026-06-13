// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IRefinedIdea } from './ideaRefinementTypes.js';

export const IIdeaRefinementService = createDecorator<IIdeaRefinementService>('ideaRefinementService');

export interface IIdeaRefinementTurn {
	role: 'agent' | 'user';
	content: string;
}

/**
 * Service for the idea refinement phase — a conversational loop
 * that runs BEFORE planning. The agent helps the user clarify,
 * scope, and pressure-test their idea through 3-5 back-and-forth
 * exchanges before generating a plan.
 *
 * This is what separates KOVIX from every other AI coding tool:
 * the user doesn't just describe an idea and get code — they
 * refine it with the AI first.
 */
export interface IIdeaRefinementService {
	readonly _serviceBrand: undefined;

	/**
	 * Start a new refinement session for a project's initial description.
	 * Returns the agent's first question as a string.
	 */
	startRefinement(projectId: string, initialDescription: string, techStack: string[]): Promise<string>;

	/**
	 * Submit a user's answer to the agent's question.
	 * Returns either the agent's next question OR signals readyForPlanning.
	 */
	submitAnswer(projectId: string, answer: string): Promise<{
		nextQuestion?: string;
		readyForPlanning: boolean;
		refinedIdea?: IRefinedIdea;
	}>;

	/**
	 * Force-complete refinement with whatever has been gathered so far.
	 * Useful when the user clicks "Skip refinement → Plan now".
	 */
	forceComplete(projectId: string): Promise<IRefinedIdea>;

	/**
	 * Get the current conversation history for a project.
	 */
	getHistory(projectId: string): IIdeaRefinementTurn[];

	/**
	 * Get the final refined idea (after readyForPlanning = true).
	 * Returns null if refinement has not completed.
	 */
	getRefinedIdea(projectId: string): IRefinedIdea | null;

	/**
	 * Whether a refinement session is currently active for the given project.
	 */
	isRefinementActive(projectId: string): boolean;
}
