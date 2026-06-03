/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Timeline Service Implementation
 *  Visual execution timeline service that subscribes to AgentPoolService events
 *  and provides real-time timeline data, stats, history, and export.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEnhancedAgentOrchestrator } from '../../../../platform/construct/common/orchestration/agentOrchestrator.js';
import { IAgentExecutionPlan, AgentStatus } from '../../../../platform/construct/common/orchestration/agentTypes.js';
import {
	ITimelineService,
	ITimelineEntry,
	ITimelineMilestone,
	ITimelineDependency,
	ITimelineStats,
	IExecutionHistory,
	TimelineEntryStatus,
	MilestoneStatus,
	DependencyType,
	AGENT_TYPE_COLORS,
	TIMELINE_STORAGE_KEY,
	ExecutionHistoryStatus
} from '../../../../platform/construct/common/timeline/timelineTypes.js';

// ─── Internal State ────────────────────────────────────────────────────────

interface IPlanTimelineState {
	planId: string;
	goal: string;
	entries: Map<string, ITimelineEntry>; // agentId → entry
	milestones: Map<string, ITimelineMilestone>; // milestoneId → milestone
	dependencies: ITimelineDependency[];
	startTime: number;
	endTime?: number;
	status: ExecutionHistoryStatus;
	creditsConsumed: number;
	selectedAgentId?: string;
	selectedMilestoneId?: string;
	zoom: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class TimelineService extends Disposable implements ITimelineService {
	readonly _serviceBrand: undefined;

	private readonly plans = new Map<string, IPlanTimelineState>();
	private readonly history: IExecutionHistory[] = [];

	// --- Events -----------------------------------------------------------

	private readonly _onTimelineUpdate = this._register(new Emitter<string>());
	readonly onTimelineUpdate = this._onTimelineUpdate.event;

	private readonly _onMilestoneReached = this._register(new Emitter<ITimelineMilestone>());
	readonly onMilestoneReached = this._onMilestoneReached.event;

	private readonly _onStatsUpdate = this._register(new Emitter<ITimelineStats>());
	readonly onStatsUpdate = this._onStatsUpdate.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@IEnhancedAgentOrchestrator private readonly agentOrchestrator: IEnhancedAgentOrchestrator
	) {
		super();

		// Load persisted history
		this.loadHistory();

		this.logService.info('[Timeline] Service initialized');
	}

	// =======================================================================
	// ITimelineService - Timeline Creation & Updates
	// =======================================================================

	createTimeline(planId: string, plan: IAgentExecutionPlan): ITimelineEntry[] {
		const entries: ITimelineEntry[] = [];

		// Create timeline entries from plan agents
		for (const agent of plan.agents) {
			const entry: ITimelineEntry = {
				id: `timeline-${agent.id}`,
				agentId: agent.id,
				agentType: agent.type,
				task: agent.task,
				startTime: agent.startTime ?? Date.now(),
				endTime: agent.endTime,
				duration: agent.endTime && agent.startTime ? agent.endTime - agent.startTime : undefined,
				status: this.mapAgentStatus(agent.status),
				color: AGENT_TYPE_COLORS[agent.type] ?? '#6b7280',
				progress: 0
			};
			entries.push(entry);
		}

		// Build dependencies from agent dependency lists
		const dependencies: ITimelineDependency[] = [];
		for (const agent of plan.agents) {
			for (const depId of agent.dependencies) {
				dependencies.push({
					from: depId,
					to: agent.id,
					type: DependencyType.FinishToStart
				});
			}
		}

		// Create milestones from plan milestones
		const milestones = new Map<string, ITimelineMilestone>();
		for (const ms of plan.milestones) {
			milestones.set(ms.id, {
				id: ms.id,
				name: ms.name,
				description: ms.description,
				timestamp: Date.now(),
				status: MilestoneStatus.Pending,
				requiredAgents: ms.requiredAgents,
				autoApprove: ms.autoApprove,
				order: ms.order
			});
		}

		// Store plan state
		const state: IPlanTimelineState = {
			planId,
			goal: plan.goal,
			entries: new Map(entries.map(e => [e.agentId, e])),
			milestones,
			dependencies,
			startTime: Date.now(),
			status: ExecutionHistoryStatus.Running,
			creditsConsumed: 0,
			zoom: 1.0
		};
		this.plans.set(planId, state);

		// Auto-subscribe to agent events
		this.subscribeToPlan(planId);

		this._onTimelineUpdate.fire(planId);
		this.logService.info(`[Timeline] Created timeline for plan ${planId} with ${entries.length} agents`);

		return entries;
	}

	updateAgentProgress(agentId: string, progress: number): void {
		for (const [planId, state] of this.plans) {
			const entry = state.entries.get(agentId);
			if (entry) {
				entry.progress = Math.min(100, Math.max(0, progress));
				if (entry.status === TimelineEntryStatus.Pending && progress > 0) {
					entry.status = TimelineEntryStatus.Running;
				}
				this._onTimelineUpdate.fire(planId);
				this._onStatsUpdate.fire(this.getStats(planId));
				return;
			}
		}
	}

	markAgentComplete(agentId: string, success: boolean): void {
		for (const [planId, state] of this.plans) {
			const entry = state.entries.get(agentId);
			if (entry) {
				entry.status = success ? TimelineEntryStatus.Completed : TimelineEntryStatus.Failed;
				entry.endTime = Date.now();
				entry.duration = entry.endTime - entry.startTime;
				entry.progress = success ? 100 : entry.progress;
				this._onTimelineUpdate.fire(planId);
				this._onStatsUpdate.fire(this.getStats(planId));
				return;
			}
		}
	}

	addMilestone(milestone: ITimelineMilestone): void {
		for (const [planId, state] of this.plans) {
			state.milestones.set(milestone.id, milestone);
			this._onTimelineUpdate.fire(planId);
			return;
		}
	}

	updateMilestoneStatus(id: string, status: MilestoneStatus): void {
		for (const [planId, state] of this.plans) {
			const milestone = state.milestones.get(id);
			if (milestone) {
				milestone.status = status;

				// Delegate to agent orchestrator for approve/reject/skip
				if (status === MilestoneStatus.Approved) {
					this.agentOrchestrator.approveMilestone(planId, id);
				} else if (status === MilestoneStatus.Skipped) {
					this.agentOrchestrator.skipMilestone(planId, id);
				}

				this._onTimelineUpdate.fire(planId);
				if (status === MilestoneStatus.Reached) {
					this._onMilestoneReached.fire(milestone);
				}
				return;
			}
		}
	}

	// =======================================================================
	// ITimelineService - Data Access
	// =======================================================================

	getTimeline(planId: string): ITimelineEntry[] {
		const state = this.plans.get(planId);
		return state ? Array.from(state.entries.values()) : [];
	}

	getMilestones(planId: string): ITimelineMilestone[] {
		const state = this.plans.get(planId);
		return state ? Array.from(state.milestones.values()).sort((a, b) => a.order - b.order) : [];
	}

	getDependencies(planId: string): ITimelineDependency[] {
		const state = this.plans.get(planId);
		return state?.dependencies ?? [];
	}

	getHistory(): IExecutionHistory[] {
		return [...this.history, ...this.getActiveHistories()];
	}

	getStats(planId: string): ITimelineStats {
		const state = this.plans.get(planId);
		if (!state) {
			return this.emptyStats();
		}

		const entries = Array.from(state.entries.values());
		const completed = entries.filter(e => e.status === TimelineEntryStatus.Completed);
		const failed = entries.filter(e => e.status === TimelineEntryStatus.Failed);
		const active = entries.filter(e => e.status === TimelineEntryStatus.Running);

		const totalDuration = state.endTime
			? state.endTime - state.startTime
			: Date.now() - state.startTime;

		const avgDuration = completed.length > 0
			? completed.reduce((sum, e) => sum + (e.duration ?? 0), 0) / completed.length
			: 0;

		// Estimate remaining time based on average duration of remaining agents
		const remaining = entries.filter(e => e.status === TimelineEntryStatus.Pending || e.status === TimelineEntryStatus.Running);
		const estimatedRemaining = remaining.length > 0
			? remaining.length * avgDuration / Math.max(1, active.length)
			: 0;

		// Calculate peak parallelism by checking overlapping time windows
		const parallelismPeak = this.calculatePeakParallelism(entries);

		return {
			totalDuration,
			activeAgents: active.length,
			completedAgents: completed.length,
			failedAgents: failed.length,
			avgAgentDuration: avgDuration,
			parallelismPeak,
			creditsConsumed: state.creditsConsumed,
			estimatedRemaining
		};
	}

	// =======================================================================
	// ITimelineService - Export
	// =======================================================================

	async exportTimeline(planId: string, format: 'json' | 'csv' | 'png'): Promise<string> {
		const entries = this.getTimeline(planId);
		const milestones = this.getMilestones(planId);
		const dependencies = this.getDependencies(planId);
		const stats = this.getStats(planId);

		switch (format) {
			case 'json': {
				return JSON.stringify({ planId, entries, milestones, dependencies, stats }, null, 2);
			}

			case 'csv': {
				const header = 'AgentID,Type,Task,Status,StartTime,EndTime,Duration,Progress\n';
				const rows = entries.map(e =>
					`${e.agentId},${e.agentType},"${e.task.replace(/"/g, '""')}",${e.status},${e.startTime},${e.endTime ?? ''},${e.duration ?? ''},${e.progress}`
				).join('\n');
				return header + rows;
			}

			case 'png': {
				// PNG export would use Phase 18 browser automation to screenshot
				// the timeline view. For now, return a placeholder.
				this.logService.info('[Timeline] PNG export would use browser automation to screenshot');
				return 'PNG export requires browser automation (Phase 18)';
			}

			default:
				return '';
		}
	}

	// =======================================================================
	// ITimelineService - Plan Subscription
	// =======================================================================

	subscribeToPlan(planId: string): void {
		// Subscribe to agent orchestrator events for this plan
		this._register(this.agentOrchestrator.onAgentStatusChange((agent) => {
			const state = this.plans.get(planId);
			if (!state) { return; }

			const entry = state.entries.get(agent.id);
			if (!entry) { return; }

			entry.status = this.mapAgentStatus(agent.status);

			if (agent.status === AgentStatus.Executing || agent.status === AgentStatus.Planning) {
				entry.startTime = agent.startTime ?? Date.now();
				entry.status = TimelineEntryStatus.Running;
			} else if (agent.status === AgentStatus.Completed) {
				entry.endTime = agent.endTime ?? Date.now();
				entry.duration = entry.endTime - entry.startTime;
				entry.progress = 100;
				entry.status = TimelineEntryStatus.Completed;
			} else if (agent.status === AgentStatus.Failed) {
				entry.endTime = agent.endTime ?? Date.now();
				entry.duration = entry.endTime - entry.startTime;
				entry.status = TimelineEntryStatus.Failed;
			} else if (agent.status === AgentStatus.Paused) {
				entry.status = TimelineEntryStatus.Paused;
			}

			this._onTimelineUpdate.fire(planId);
			this._onStatsUpdate.fire(this.getStats(planId));
		}));

		this._register(this.agentOrchestrator.onMilestoneReached(({ planId: pid, milestone }) => {
			if (pid !== planId) { return; }

			const state = this.plans.get(planId);
			if (!state) { return; }

			const ms = state.milestones.get(milestone.id);
			if (ms) {
				ms.status = MilestoneStatus.Reached;
				this._onMilestoneReached.fire(ms);
				this._onTimelineUpdate.fire(planId);
			}
		}));

		this._register(this.agentOrchestrator.onExecutionComplete(({ planId: pid, success }) => {
			if (pid !== planId) { return; }

			const state = this.plans.get(planId);
			if (!state) { return; }

			state.endTime = Date.now();
			state.status = success ? ExecutionHistoryStatus.Completed : ExecutionHistoryStatus.Failed;
			this._onTimelineUpdate.fire(planId);

			// Save to history
			this.saveToHistory(state);
		}));

		this._register(this.agentOrchestrator.onCreditsConsumed(({ planId: pid, amount }) => {
			if (pid !== planId) { return; }

			const state = this.plans.get(planId);
			if (!state) { return; }

			state.creditsConsumed += amount;
			this._onStatsUpdate.fire(this.getStats(planId));
		}));

		this.logService.info(`[Timeline] Subscribed to plan ${planId}`);
	}

	unsubscribeFromPlan(planId: string): void {
		this.logService.info(`[Timeline] Unsubscribed from plan ${planId}`);
		// Event listeners are auto-disposed via _register when plan is removed
		this.plans.delete(planId);
	}

	// =======================================================================
	// ITimelineService - View State
	// =======================================================================

	selectAgent(agentId: string): void {
		for (const [planId, state] of this.plans) {
			if (state.entries.has(agentId)) {
				state.selectedAgentId = agentId;
				this._onTimelineUpdate.fire(planId);
				return;
			}
		}
	}

	selectMilestone(milestoneId: string): void {
		for (const [planId, state] of this.plans) {
			if (state.milestones.has(milestoneId)) {
				state.selectedMilestoneId = milestoneId;
				this._onTimelineUpdate.fire(planId);
				return;
			}
		}
	}

	setZoom(planId: string, level: number): void {
		const state = this.plans.get(planId);
		if (state) {
			state.zoom = Math.max(0.1, Math.min(10, level));
			this._onTimelineUpdate.fire(planId);
		}
	}

	// =======================================================================
	// Private Helpers
	// =======================================================================

	private mapAgentStatus(status: AgentStatus): TimelineEntryStatus {
		switch (status) {
			case AgentStatus.Executing:
			case AgentStatus.Planning:
				return TimelineEntryStatus.Running;
			case AgentStatus.Completed:
				return TimelineEntryStatus.Completed;
			case AgentStatus.Failed:
				return TimelineEntryStatus.Failed;
			case AgentStatus.Paused:
				return TimelineEntryStatus.Paused;
			case AgentStatus.Waiting:
			case AgentStatus.Idle:
			default:
				return TimelineEntryStatus.Pending;
		}
	}

	private calculatePeakParallelism(entries: ITimelineEntry[]): number {
		const activeEntries = entries.filter(e => e.startTime && (e.status === TimelineEntryStatus.Running || e.status === TimelineEntryStatus.Completed || e.status === TimelineEntryStatus.Failed));
		if (activeEntries.length <= 1) { return activeEntries.length; }

		// Create time events for starts and ends
		const events: Array<{ time: number; delta: number }> = [];
		for (const entry of activeEntries) {
			events.push({ time: entry.startTime, delta: 1 });
			if (entry.endTime) {
				events.push({ time: entry.endTime, delta: -1 });
			}
		}

		events.sort((a, b) => a.time - b.time || a.delta - b.delta);

		let current = 0;
		let peak = 0;
		for (const event of events) {
			current += event.delta;
			peak = Math.max(peak, current);
		}

		return peak;
	}

	private emptyStats(): ITimelineStats {
		return {
			totalDuration: 0,
			activeAgents: 0,
			completedAgents: 0,
			failedAgents: 0,
			avgAgentDuration: 0,
			parallelismPeak: 0,
			creditsConsumed: 0,
			estimatedRemaining: 0
		};
	}

	private getActiveHistories(): IExecutionHistory[] {
		return Array.from(this.plans.values()).map(state => ({
			planId: state.planId,
			goal: state.goal,
			startTime: state.startTime,
			endTime: state.endTime,
			status: state.status,
			agents: Array.from(state.entries.values()),
			milestones: Array.from(state.milestones.values()),
			stats: this.getStats(state.planId)
		}));
	}

	private saveToHistory(state: IPlanTimelineState): void {
		const entry: IExecutionHistory = {
			planId: state.planId,
			goal: state.goal,
			startTime: state.startTime,
			endTime: state.endTime,
			status: state.status,
			agents: Array.from(state.entries.values()),
			milestones: Array.from(state.milestones.values()),
			stats: this.getStats(state.planId)
		};

		this.history.push(entry);

		// Keep last 50 executions
		if (this.history.length > 50) {
			this.history.shift();
		}

		this.persistHistory();
	}

	private loadHistory(): void {
		try {
			const stored = this.storageService.get(TIMELINE_STORAGE_KEY, undefined);
			if (stored) {
				const parsed = JSON.parse(stored);
				if (Array.isArray(parsed)) {
					this.history.push(...parsed);
				}
			}
		} catch (error) {
			this.logService.warn(`[Timeline] Failed to load history: ${error}`);
		}
	}

	private persistHistory(): void {
		try {
			this.storageService.store(
				TIMELINE_STORAGE_KEY,
				JSON.stringify(this.history.slice(-50)),
				undefined,
				1 // StorageScope.WORKSPACE
			);
		} catch (error) {
			this.logService.warn(`[Timeline] Failed to persist history: ${error}`);
		}
	}

	dispose(): void {
		// Persist any active plans to history
		for (const [planId, state] of this.plans) {
			if (state.status === ExecutionHistoryStatus.Running) {
				state.endTime = Date.now();
				state.status = ExecutionHistoryStatus.Cancelled;
				this.saveToHistory(state);
			}
		}

		this.plans.clear();
		super.dispose();
		this.logService.info('[Timeline] Service disposed');
	}
}
