/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAgentExecutionPlan, IAgentInstance, IMilestone, ExecutionMode } from './agentTypes.js';

export const IEnhancedAgentOrchestrator = createDecorator<IEnhancedAgentOrchestrator>('construct.enhancedOrchestrator');

export interface IEnhancedAgentOrchestrator extends IDisposable {
	readonly _serviceBrand: undefined;

	// Plan Creation
	createExecutionPlan(goal: string, mode?: ExecutionMode): Promise<IAgentExecutionPlan>;
	refinePlan(planId: string, modifications: Partial<IAgentExecutionPlan>): Promise<IAgentExecutionPlan>;

	// Execution Control
	executePlan(plan: IAgentExecutionPlan): Promise<void>;
	pauseExecution(planId: string): void;
	resumeExecution(planId: string): void;
	cancelExecution(planId: string): void;
	cancelAgent(agentId: string): void;

	// Status & Monitoring
	getExecutionStatus(planId: string): IAgentExecutionPlan | undefined;
	getAllActivePlans(): IAgentExecutionPlan[];
	getAgentOutput(agentId: string): string;
	getMilestoneStatus(planId: string, milestoneId: string): IMilestone | undefined;

	// Milestone Control
	approveMilestone(planId: string, milestoneId: string): void;
	rejectMilestone(planId: string, milestoneId: string, reason: string): void;
	skipMilestone(planId: string, milestoneId: string): void;

	// Events
	readonly onAgentStatusChange: Event<IAgentInstance>;
	readonly onMilestoneReached: Event<{ planId: string; milestone: IMilestone }>;
	readonly onExecutionComplete: Event<{ planId: string; success: boolean; summary: string }>;
	readonly onExecutionPaused: Event<{ planId: string; reason: string; milestoneId?: string }>;
	readonly onCreditsConsumed: Event<{ planId: string; agentId: string; amount: number }>;
}
