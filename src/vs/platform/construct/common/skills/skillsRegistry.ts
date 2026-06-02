/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISkill, ISkillExecutionContext, ISkillExecutionResult, ISkillStep } from './skillsTypes.js';

export const ISkillsRegistry = createDecorator<ISkillsRegistry>('construct.skillsRegistry');

export interface ISkillsRegistry extends IDisposable {
	readonly _serviceBrand: undefined;

	// Registration
	registerSkill(skill: ISkill): void;
	unregisterSkill(skillId: string): void;
	getSkill(skillId: string): ISkill | undefined;
	getAllSkills(): ISkill[];

	// Execution
	executeSkill(skillId: string, context: ISkillExecutionContext): Promise<ISkillExecutionResult>;
	executeStep(step: ISkillStep, context: ISkillExecutionContext): Promise<{ success: boolean; output: any }>;
	pauseExecution(executionId: string): void;
	resumeExecution(executionId: string): void;
	cancelExecution(executionId: string): void;

	// Validation
	validateSkill(skill: ISkill): { valid: boolean; errors: string[] };
	checkToolDependencies(skill: ISkill): { available: boolean; missing: string[] };

	// Auto-suggest
	suggestSkillsForProject(projectPath: string): Promise<ISkill[]>;

	// Events
	readonly onDidRegisterSkill: Event<ISkill>;
	readonly onDidUnregisterSkill: Event<string>;
	readonly onDidStartExecution: Event<{ executionId: string; skillId: string }>;
	readonly onDidCompleteExecution: Event<ISkillExecutionResult>;
	readonly onDidFailExecution: Event<{ executionId: string; error: string }>;
}
