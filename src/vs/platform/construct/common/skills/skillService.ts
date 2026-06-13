/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const ISkillService = createDecorator<ISkillService>('construct.skillService');

/**
 * A skill that the agent can execute.
 * Skills are reusable workflows triggered by slash commands.
 */
export interface ISkill {
	/** Unique skill name (e.g., 'pr', 'review') */
	name: string;
	/** Human-readable description */
	description: string;
	/** Patterns that trigger this skill (e.g., ['/^pr$/i', '/^create.?pr/i']) */
	triggerPatterns: RegExp[];
	/** Instructions for the agent when this skill is activated */
	instructions: string;
	/** Tools this skill is allowed to use */
	allowedTools: string[];
}

/**
 * Context passed to a skill when it is executed.
 */
export interface ISkillContext {
	/** The user's original input */
	userInput: string;
	/** The matched skill name */
	skillName: string;
	/** Additional arguments parsed from the input */
	args: string[];
	/** The workspace root URI */
	workspaceRoot?: string;
}

/**
 * Result of executing a skill.
 */
export interface ISkillResult {
	/** Whether the skill execution was successful */
	success: boolean;
	/** Output message */
	message: string;
	/** Any additional data from the skill */
	data?: Record<string, unknown>;
}

/**
 * ISkillService — manages and executes agent skills.
 *
 * Skills are reusable workflows that can be triggered by slash commands
 * in the agent view. They are loaded from:
 * 1. Built-in skills defined in builtInSkills.ts
 * 2. Custom skills from .kovix/skills/ directory (Markdown files with frontmatter)
 */
export interface ISkillService {
	readonly _serviceBrand: undefined;

	/**
	 * Load all skills (built-in + custom from .kovix/skills/).
	 */
	loadSkills(): Promise<void>;

	/**
	 * Get a skill by name.
	 *
	 * @param name Skill name.
	 */
	getSkill(name: string): ISkill | undefined;

	/**
	 * Execute a skill by name.
	 *
	 * @param name Skill name.
	 * @param context Execution context.
	 * @returns Skill execution result.
	 */
	executeSkill(name: string, context: ISkillContext): Promise<ISkillResult>;

	/**
	 * List all available skills.
	 */
	listSkills(): ISkill[];

	/**
	 * Find a skill that matches the given user input.
	 *
	 * @param input User input (e.g., "/pr", "/review").
	 * @returns The matching skill, or undefined if no match.
	 */
	findMatchingSkill(input: string): ISkill | undefined;
}
