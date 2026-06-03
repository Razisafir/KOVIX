/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Timeline Types
 *  Visual execution timeline / Gantt chart types for agent execution monitoring.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AgentType, AgentStatus } from './../../../construct/common/orchestration/agentTypes.js';

// ─── Timeline Entry ────────────────────────────────────────────────────────

export const enum TimelineEntryStatus {
	Pending = 'pending',
	Running = 'running',
	Completed = 'completed',
	Failed = 'failed',
	Paused = 'paused'
}

export interface ITimelineEntry {
	readonly id: string;
	readonly agentId: string;
	readonly agentType: AgentType;
	readonly task: string;
	readonly startTime: number;
	readonly endTime?: number;
	readonly duration?: number;
	status: TimelineEntryStatus;
	readonly color: string;
	progress: number; // 0-100
}

// ─── Timeline Milestone ────────────────────────────────────────────────────

export const enum MilestoneStatus {
	Pending = 'pending',
	Reached = 'reached',
	Approved = 'approved',
	Rejected = 'rejected',
	Skipped = 'skipped'
}

export interface ITimelineMilestone {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly timestamp: number;
	status: MilestoneStatus;
	readonly requiredAgents: string[];
	readonly autoApprove: boolean;
	readonly order: number;
}

// ─── Timeline Dependency ───────────────────────────────────────────────────

export const enum DependencyType {
	FinishToStart = 'finish-to-start',
	StartToStart = 'start-to-start',
	FinishToFinish = 'finish-to-finish'
}

export interface ITimelineDependency {
	readonly from: string; // agentId
	readonly to: string;   // agentId
	readonly type: DependencyType;
}

// ─── View State ────────────────────────────────────────────────────────────

export type GroupByOption = 'none' | 'type' | 'status';

export interface ITimelineViewState {
	zoom: number;          // 0.1 to 10
	scrollPosition: number;
	selectedAgentId?: string;
	selectedMilestoneId?: string;
	showCompleted: boolean;
	showFailed: boolean;
	groupBy: GroupByOption;
}

// ─── Timeline Stats ────────────────────────────────────────────────────────

export interface ITimelineStats {
	readonly totalDuration: number;
	readonly activeAgents: number;
	readonly completedAgents: number;
	readonly failedAgents: number;
	readonly avgAgentDuration: number;
	readonly parallelismPeak: number;
	readonly creditsConsumed: number;
	readonly estimatedRemaining: number;
}

// ─── Execution History ─────────────────────────────────────────────────────

export const enum ExecutionHistoryStatus {
	Running = 'running',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled'
}

export interface IExecutionHistory {
	readonly planId: string;
	readonly goal: string;
	readonly startTime: number;
	readonly endTime?: number;
	readonly status: ExecutionHistoryStatus;
	readonly agents: ITimelineEntry[];
	readonly milestones: ITimelineMilestone[];
	readonly stats: ITimelineStats;
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const TIMELINE_STORAGE_KEY = 'construct.timeline.history';
export const TIMELINE_VIEW_STATE_KEY = 'construct.timeline.viewState';
export const DEFAULT_ZOOM = 1.0;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
export const AGENT_ROW_HEIGHT = 40;
export const TIMELINE_LEFT_MARGIN = 200;
export const MILESTONE_DIAMOND_SIZE = 12;
export const TIME_TICK_MINIMUM_PX = 80;

export const AGENT_TYPE_COLORS: Record<string, string> = {
	[AgentType.Planner]: '#8b5cf6',   // purple
	[AgentType.Coder]: '#3b82f6',     // blue
	[AgentType.Tester]: '#22c55e',    // green
	[AgentType.Reviewer]: '#f59e0b',  // amber
	[AgentType.Browser]: '#06b6d4',   // cyan
	[AgentType.DevOps]: '#ef4444',    // red
	[AgentType.Researcher]: '#ec4899', // pink
	[AgentType.DocWriter]: '#14b8a6'  // teal
};

export const STATUS_COLORS: Record<string, string> = {
	[TimelineEntryStatus.Running]: '#3b82f6',
	[TimelineEntryStatus.Completed]: '#22c55e',
	[TimelineEntryStatus.Failed]: '#ef4444',
	[TimelineEntryStatus.Paused]: '#f59e0b',
	[TimelineEntryStatus.Pending]: '#9ca3af'
};
