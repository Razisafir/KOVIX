/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Timeline Service Interface
 *  Visual execution timeline service for real-time agent monitoring.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ITimelineEntry,
	ITimelineMilestone,
	ITimelineDependency,
	ITimelineStats,
	IExecutionHistory,
	MilestoneStatus
} from './timelineTypes.js';
import { IAgentExecutionPlan } from '../orchestration/agentTypes.js';

export const ITimelineService = createDecorator<ITimelineService>('construct.timelineService');

export interface ITimelineService extends IDisposable {
	readonly _serviceBrand: undefined;

	// ─── Timeline Creation & Updates ──────────────────────────────────

	/** Create a timeline from an execution plan. Returns entries for all agents. */
	createTimeline(planId: string, plan: IAgentExecutionPlan): ITimelineEntry[];

	/** Update an agent's progress (0-100). */
	updateAgentProgress(agentId: string, progress: number): void;

	/** Mark an agent as complete (success or failure). */
	markAgentComplete(agentId: string, success: boolean): void;

	/** Add a milestone to the timeline. */
	addMilestone(milestone: ITimelineMilestone): void;

	/** Update a milestone's status. */
	updateMilestoneStatus(id: string, status: MilestoneStatus): void;

	// ─── Data Access ──────────────────────────────────────────────────

	/** Get all timeline entries for a plan. */
	getTimeline(planId: string): ITimelineEntry[];

	/** Get all milestones for a plan. */
	getMilestones(planId: string): ITimelineMilestone[];

	/** Get all dependencies for a plan. */
	getDependencies(planId: string): ITimelineDependency[];

	/** Get execution history (completed and in-progress). */
	getHistory(): IExecutionHistory[];

	/** Compute and return stats for a plan. */
	getStats(planId: string): ITimelineStats;

	// ─── Export ───────────────────────────────────────────────────────

	/** Export timeline data in the specified format. */
	exportTimeline(planId: string, format: 'json' | 'csv' | 'png'): Promise<string>;

	// ─── Plan Subscription ────────────────────────────────────────────

	/** Subscribe to a plan's agent events for real-time updates. */
	subscribeToPlan(planId: string): void;

	/** Unsubscribe from a plan's events. */
	unsubscribeFromPlan(planId: string): void;

	// ─── View State ───────────────────────────────────────────────────

	/** Select an agent in the timeline view. */
	selectAgent(agentId: string): void;

	/** Select a milestone in the timeline view. */
	selectMilestone(milestoneId: string): void;

	/** Set zoom level for the timeline. */
	setZoom(planId: string, level: number): void;

	// ─── Events ───────────────────────────────────────────────────────

	/** Fired when the timeline data is updated. */
	readonly onTimelineUpdate: Event<string>; // planId

	/** Fired when a milestone is reached. */
	readonly onMilestoneReached: Event<ITimelineMilestone>;

	/** Fired when stats are updated. */
	readonly onStatsUpdate: Event<ITimelineStats>;
}
