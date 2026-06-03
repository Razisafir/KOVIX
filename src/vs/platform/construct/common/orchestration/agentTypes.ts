/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum AgentType {
	Planner = 'planner',
	Coder = 'coder',
	Tester = 'tester',
	Reviewer = 'reviewer',
	Browser = 'browser',
	DevOps = 'devops',
	Researcher = 'researcher',
	DocWriter = 'doc_writer'
}

export const enum AgentStatus {
	Idle = 'idle',
	Planning = 'planning',
	Executing = 'executing',
	Waiting = 'waiting',      // Waiting for dependencies
	Completed = 'completed',
	Failed = 'failed',
	Paused = 'paused'
}

export const enum ExecutionMode {
	GOD = 'god',              // No stops until complete
	Milestone = 'milestone',  // Stop at each milestone
	Step = 'step',            // Stop after every agent action
	Custom = 'custom'         // User-defined checkpoints
}

export interface IAgentInstance {
	id: string;
	type: AgentType;
	status: AgentStatus;
	task: string;
	dependencies: string[];     // Agent IDs this agent depends on
	dependents: string[];       // Agent IDs waiting on this agent
	output: string;
	startTime?: number;
	endTime?: number;
	error?: string;
	filesTouched: string[];
	creditsConsumed: number;
	model: string;
	systemPrompt: string;
}

export interface IMilestone {
	id: string;
	name: string;
	description: string;
	requiredAgents: string[];
	completionCriteria: string;
	autoApprove: boolean;
	status: 'pending' | 'in_progress' | 'completed' | 'blocked';
	order: number;
}

export interface IAgentExecutionPlan {
	id: string;
	goal: string;
	agents: IAgentInstance[];
	dependencyGraph: Map<string, string[]>;
	parallelGroups: string[][];  // Groups of agents that can run in parallel
	milestones: IMilestone[];
	executionMode: ExecutionMode;
	createdAt: number;
	estimatedCredits: number;
}

export interface IExecutionCheckpoint {
	id: string;
	type: 'file_pattern' | 'test_result' | 'time_elapsed' | 'milestone_reached' | 'custom';
	condition: string;
	triggered: boolean;
	triggeredAt?: number;
}

export interface IAgentPoolStats {
	totalAgents: number;
	activeAgents: number;
	completedAgents: number;
	failedAgents: number;
	waitingAgents: number;
	currentParallelism: number;
	maxParallelism: number;
	creditsConsumed: number;
	estimatedTotalCredits: number;
	progressPercent: number;
}
