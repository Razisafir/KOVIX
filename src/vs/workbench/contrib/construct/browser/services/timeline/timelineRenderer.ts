/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Timeline Renderer
 *  Pure rendering logic for the Gantt chart timeline. No VS Code dependencies
 *  for testability. Generates DOM structure from timeline data.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
	ITimelineEntry,
	ITimelineMilestone,
	ITimelineDependency,
	ITimelineViewState,
	TimelineEntryStatus,
	MilestoneStatus,
	AGENT_TYPE_COLORS,
	AGENT_ROW_HEIGHT,
	TIMELINE_LEFT_MARGIN,
	MILESTONE_DIAMOND_SIZE,
	TIME_TICK_MINIMUM_PX,
	GroupByOption
} from '../../../../../../platform/construct/common/timeline/timelineTypes.js';

// ─── Rendering Options ─────────────────────────────────────────────────────

export interface IRenderOptions {
	containerWidth: number;
	containerHeight: number;
	timeOrigin: number;   // earliest start time in ms
	timeSpan: number;     // total time span in ms
}

export interface IRenderOutput {
	html: string;
	totalWidth: number;
	totalHeight: number;
	timeScale: number; // pixels per millisecond
}

// ─── Agent Type Labels ─────────────────────────────────────────────────────

const AGENT_TYPE_LABELS: Record<string, string> = {
	planner: 'Planner',
	coder: 'Coder',
	tester: 'Tester',
	reviewer: 'Reviewer',
	browser: 'Browser',
	devops: 'DevOps',
	researcher: 'Researcher',
	doc_writer: 'Doc Writer'
};

const AGENT_TYPE_ICONS: Record<string, string> = {
	planner: '\uD83D\uDCCB',
	coder: '\uD83D\uDCBB',
	tester: '\uD83E\uDDEA',
	reviewer: '\uD83D\uDC41\uFE0F',
	browser: '\uD83C\uDF10',
	devops: '\u2699\uFE0F',
	researcher: '\uD83D\uDD0D',
	doc_writer: '\uD83D\uDCDD'
};

// ─── Timeline Renderer ─────────────────────────────────────────────────────

export class TimelineRenderer {

	/**
	 * Render the full timeline as an HTML string.
	 */
	render(
		entries: ITimelineEntry[],
		milestones: ITimelineMilestone[],
		dependencies: ITimelineDependency[],
		viewState: ITimelineViewState,
		options: IRenderOptions
	): IRenderOutput {
		const filtered = this.filterEntries(entries, viewState);
		const grouped = this.groupEntries(filtered, viewState.groupBy);
		const timeRange = this.computeTimeRange(filtered, options);

		const timeScale = this.computeTimeScale(timeRange.span, options.containerWidth, viewState.zoom);
		const totalWidth = Math.max(options.containerWidth, TIMELINE_LEFT_MARGIN + timeRange.span * timeScale + 200);
		const totalHeight = Math.max(options.containerHeight, filtered.length * AGENT_ROW_HEIGHT + 120);

		const gridHtml = this.renderGrid(timeRange, timeScale, totalWidth, totalHeight, filtered.length);
		const barsHtml = this.renderAgentBars(grouped, timeRange, timeScale, viewState);
		const milestonesHtml = this.renderMilestones(milestones, timeRange, timeScale, totalHeight);
		const depsHtml = this.renderDependencies(dependencies, entries, timeRange, timeScale);
		const nowLineHtml = this.renderNowLine(timeRange, timeScale, totalHeight);
		const labelsHtml = this.renderAgentLabels(grouped, viewState);

		const html = `
			<div class="timeline-gantt" style="width:${totalWidth}px;height:${totalHeight}px;position:relative;">
				<div class="timeline-labels" style="position:sticky;left:0;z-index:3;width:${TIMELINE_LEFT_MARGIN}px;height:${totalHeight}px;">
					${labelsHtml}
				</div>
				<div class="timeline-chart-area" style="margin-left:${TIMELINE_LEFT_MARGIN}px;position:relative;">
					${gridHtml}
					${depsHtml}
					${barsHtml}
					${milestonesHtml}
					${nowLineHtml}
				</div>
			</div>`;

		return { html, totalWidth, totalHeight, timeScale };
	}

	/**
	 * Render the empty state when no execution is active.
	 */
	renderEmptyState(): string {
		return `
			<div class="timeline-empty">
				<div class="timeline-empty-icon">\u23F3</div>
				<div class="timeline-empty-title">No Active Execution</div>
				<div class="timeline-empty-text">
					Start a GOD mode session to see the execution timeline here.
					You'll see a real-time Gantt chart showing agents, milestones,
					and dependencies as they execute.
				</div>
				<div class="timeline-empty-cta">Use Ctrl+Shift+G to start GOD mode</div>
			</div>`;
	}

	/**
	 * Render the toolbar with zoom controls, filters, and export.
	 */
	renderToolbar(viewState: ITimelineViewState, hasActivePlan: boolean): string {
		const zoomPercent = Math.round(viewState.zoom * 100);
		return `
			<div class="timeline-toolbar">
				<div class="timeline-toolbar-group">
					<button class="timeline-toolbar-btn" data-action="zoomOut" title="Zoom Out">-</button>
					<span class="timeline-toolbar-zoom-label">${zoomPercent}%</span>
					<button class="timeline-toolbar-btn" data-action="zoomIn" title="Zoom In">+</button>
					<button class="timeline-toolbar-btn" data-action="zoomFit" title="Fit to View">\u2922</button>
				</div>
				<div class="timeline-toolbar-separator"></div>
				<div class="timeline-toolbar-group">
					<button class="timeline-toolbar-btn" data-action="showCompleted" title="Toggle Completed" ${viewState.showCompleted ? 'data-active' : ''}>\u2713 Completed</button>
					<button class="timeline-toolbar-btn" data-action="showFailed" title="Toggle Failed" ${viewState.showFailed ? 'data-active' : ''}>\u2717 Failed</button>
				</div>
				<div class="timeline-toolbar-separator"></div>
				<div class="timeline-toolbar-group">
					<select class="timeline-toolbar-select" data-action="groupBy">
						<option value="none" ${viewState.groupBy === 'none' ? 'selected' : ''}>No Grouping</option>
						<option value="type" ${viewState.groupBy === 'type' ? 'selected' : ''}>By Type</option>
						<option value="status" ${viewState.groupBy === 'status' ? 'selected' : ''}>By Status</option>
					</select>
				</div>
				<div class="timeline-toolbar-spacer"></div>
				<div class="timeline-toolbar-group">
					<button class="timeline-toolbar-btn" data-action="export" title="Export Timeline">\u2B07 Export</button>
				</div>
			</div>`;
	}

	/**
	 * Render the milestone panel (bottom section).
	 */
	renderMilestonePanel(milestones: ITimelineMilestone[]): string {
		if (milestones.length === 0) {
			return '<div class="timeline-milestones-panel"><div class="timeline-milestones-empty">No milestones defined</div></div>';
		}

		const items = milestones
			.sort((a, b) => a.order - b.order)
			.map(ms => this.renderMilestoneItem(ms))
			.join('');

		return `
			<div class="timeline-milestones-panel">
				<div class="timeline-milestones-header">
					<span class="timeline-milestones-title">Milestones</span>
					<span class="timeline-milestones-count">${milestones.length}</span>
				</div>
				<div class="timeline-milestones-list">
					${items}
				</div>
			</div>`;
	}

	// =======================================================================
	// Private Rendering Methods
	// =======================================================================

	private renderAgentLabels(
		grouped: Map<string, ITimelineEntry[]>,
		viewState: ITimelineViewState
	): string {
		let html = '';
		let y = 0;

		for (const [groupName, entries] of grouped) {
			// Group header
			if (groupName !== 'default') {
				html += `<div class="timeline-group-label" style="top:${y}px;height:${AGENT_ROW_HEIGHT}px;">
					${groupName}
				</div>`;
				y += AGENT_ROW_HEIGHT;
			}

			for (const entry of entries) {
				const isSelected = viewState.selectedAgentId === entry.agentId;
				const icon = AGENT_TYPE_ICONS[entry.agentType] ?? '\u25CF';
				const label = AGENT_TYPE_LABELS[entry.agentType] ?? entry.agentType;

				html += `<div class="timeline-agent-label ${isSelected ? 'selected' : ''}"
					style="top:${y}px;height:${AGENT_ROW_HEIGHT}px;"
					data-agent-id="${entry.agentId}"
					role="row"
					aria-label="${label}: ${entry.task}">
					<span class="timeline-agent-icon">${icon}</span>
					<span class="timeline-agent-name" title="${entry.task}">${label}</span>
				</div>`;

				y += AGENT_ROW_HEIGHT;
			}
		}

		return html;
	}

	private renderGrid(
		timeRange: { origin: number; span: number },
		timeScale: number,
		totalWidth: number,
		totalHeight: number,
		agentCount: number
	): string {
		// Compute time tick interval
		const tickInterval = this.computeTickInterval(timeRange.span, totalWidth - TIMELINE_LEFT_MARGIN, timeScale);
		const tickCount = Math.ceil(timeRange.span / tickInterval);

		let ticksHtml = '';
		for (let i = 0; i <= tickCount; i++) {
			const time = timeRange.origin + i * tickInterval;
			const x = (i * tickInterval) * timeScale;
			const label = this.formatTime(i * tickInterval);

			ticksHtml += `
				<div class="timeline-grid-line" style="left:${x}px;height:${totalHeight}px;"></div>
				<div class="timeline-grid-label" style="left:${x}px;">${label}</div>`;
		}

		// Horizontal row lines
		let rowsHtml = '';
		for (let i = 0; i <= agentCount; i++) {
			const y = i * AGENT_ROW_HEIGHT;
			rowsHtml += `<div class="timeline-grid-row" style="top:${y}px;width:${totalWidth}px;"></div>`;
		}

		return `
			<div class="timeline-grid">
				<div class="timeline-grid-time-axis">${ticksHtml}</div>
				${rowsHtml}
			</div>`;
	}

	private renderAgentBars(
		grouped: Map<string, ITimelineEntry[]>,
		timeRange: { origin: number; span: number },
		timeScale: number,
		viewState: ITimelineViewState
	): string {
		let html = '';
		let y = 0;

		for (const [groupName, entries] of grouped) {
			if (groupName !== 'default') {
				y += AGENT_ROW_HEIGHT;
			}

			for (const entry of entries) {
				const x = (entry.startTime - timeRange.origin) * timeScale;
				const duration = (entry.endTime ?? Date.now()) - entry.startTime;
				const width = Math.max(4, duration * timeScale);

				const isSelected = viewState.selectedAgentId === entry.agentId;
				const statusClass = `status-${entry.status}`;
				const progressWidth = (entry.progress / 100) * width;

				html += `
					<div class="timeline-bar ${statusClass} ${isSelected ? 'selected' : ''}"
						style="left:${x}px;top:${y + 8}px;width:${width}px;height:${AGENT_ROW_HEIGHT - 16}px;"
						data-agent-id="${entry.agentId}"
						role="button"
						aria-label="${AGENT_TYPE_LABELS[entry.agentType] ?? entry.agentType}: ${entry.status}, ${entry.progress}% complete"
						tabindex="0">
						<div class="timeline-bar-progress" style="width:${progressWidth}px;"></div>
						<div class="timeline-bar-label">${this.truncateTask(entry.task, width)}</div>
					</div>`;

				y += AGENT_ROW_HEIGHT;
			}
		}

		return html;
	}

	private renderMilestones(
		milestones: ITimelineMilestone[],
		timeRange: { origin: number; span: number },
		timeScale: number,
		totalHeight: number
	): string {
		if (milestones.length === 0) { return ''; }

		let html = '';
		for (const ms of milestones) {
			const x = (ms.timestamp - timeRange.origin) * timeScale;
			const statusClass = `milestone-${ms.status}`;

			html += `
				<div class="timeline-milestone ${statusClass}"
					style="left:${x - MILESTONE_DIAMOND_SIZE / 2}px;top:0;height:${totalHeight}px;"
					data-milestone-id="${ms.id}"
					role="button"
					aria-label="Milestone: ${ms.name} (${ms.status})"
					tabindex="0">
					<div class="timeline-milestone-diamond" style="left:${x - MILESTONE_DIAMOND_SIZE / 2}px;">
						${MILESTONE_DIAMOND_SIZE}
					</div>
					<div class="timeline-milestone-line" style="left:${x}px;height:${totalHeight}px;"></div>
					<div class="timeline-milestone-label" style="left:${x + 4}px;">${ms.name}</div>
				</div>`;
		}

		return html;
	}

	private renderDependencies(
		dependencies: ITimelineDependency[],
		entries: ITimelineEntry[],
		timeRange: { origin: number; span: number },
		timeScale: number
	): string {
		if (dependencies.length === 0) { return ''; }

		const entryMap = new Map(entries.map(e => [e.agentId, e]));
		let pathsHtml = '';

		for (const dep of dependencies) {
			const fromEntry = entryMap.get(dep.from);
			const toEntry = entryMap.get(dep.to);
			if (!fromEntry || !toEntry) { continue; }

			const fromX = ((fromEntry.endTime ?? Date.now()) - timeRange.origin) * timeScale;
			const fromY = this.getAgentY(entries, dep.from) + AGENT_ROW_HEIGHT / 2;
			const toX = (toEntry.startTime - timeRange.origin) * timeScale;
			const toY = this.getAgentY(entries, dep.to) + AGENT_ROW_HEIGHT / 2;

			// SVG curved arrow path
			const midX = (fromX + toX) / 2;
			pathsHtml += `
				<path d="M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}"
					class="timeline-dep-arrow"
					marker-end="url(#arrowhead)"
					data-from="${dep.from}"
					data-to="${dep.to}" />`;
		}

		if (!pathsHtml) { return ''; }

		return `
			<svg class="timeline-deps-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">
				<defs>
					<marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
						<polygon points="0 0, 8 3, 0 6" class="timeline-dep-arrowhead" />
					</marker>
				</defs>
				${pathsHtml}
			</svg>`;
	}

	private renderNowLine(
		timeRange: { origin: number; span: number },
		timeScale: number,
		totalHeight: number
	): string {
		const nowX = (Date.now() - timeRange.origin) * timeScale;
		return `
			<div class="timeline-now-line" style="left:${nowX}px;height:${totalHeight}px;">
				<div class="timeline-now-label">NOW</div>
			</div>`;
	}

	private renderMilestoneItem(ms: ITimelineMilestone): string {
		const statusIcons: Record<string, string> = {
			[MilestoneStatus.Pending]: '\u25CB',
			[MilestoneStatus.Reached]: '\u25CF',
			[MilestoneStatus.Approved]: '\u2705',
			[MilestoneStatus.Rejected]: '\u274C',
			[MilestoneStatus.Skipped]: '\u23ED'
		};

		const icon = statusIcons[ms.status] ?? '\u25CB';
		const canAct = ms.status === MilestoneStatus.Reached;

		return `
			<div class="timeline-milestone-item milestone-status-${ms.status}" data-milestone-id="${ms.id}">
				<span class="timeline-milestone-icon">${icon}</span>
				<span class="timeline-milestone-name">${ms.name}</span>
				<span class="timeline-milestone-desc">${ms.description}</span>
				<span class="timeline-milestone-time">${this.formatTime(ms.timestamp)}</span>
				${canAct ? `
					<div class="timeline-milestone-actions">
						<button class="timeline-milestone-btn approve" data-action="approveMilestone" data-id="${ms.id}" title="Approve">\u2705</button>
						<button class="timeline-milestone-btn reject" data-action="rejectMilestone" data-id="${ms.id}" title="Reject">\u274C</button>
						<button class="timeline-milestone-btn skip" data-action="skipMilestone" data-id="${ms.id}" title="Skip">\u23ED</button>
					</div>
				` : ''}
			</div>`;
	}

	// =======================================================================
	// Utility Methods
	// =======================================================================

	private filterEntries(entries: ITimelineEntry[], viewState: ITimelineViewState): ITimelineEntry[] {
		return entries.filter(entry => {
			if (entry.status === TimelineEntryStatus.Completed && !viewState.showCompleted) { return false; }
			if (entry.status === TimelineEntryStatus.Failed && !viewState.showFailed) { return false; }
			return true;
		});
	}

	private groupEntries(entries: ITimelineEntry[], groupBy: GroupByOption): Map<string, ITimelineEntry[]> {
		const groups = new Map<string, ITimelineEntry[]>();

		if (groupBy === 'none') {
			groups.set('default', entries);
			return groups;
		}

		for (const entry of entries) {
			const key = groupBy === 'type'
				? (AGENT_TYPE_LABELS[entry.agentType] ?? entry.agentType)
				: entry.status;

			const group = groups.get(key) ?? [];
			group.push(entry);
			groups.set(key, group);
		}

		return groups;
	}

	private computeTimeRange(entries: ITimelineEntry[], options: IRenderOptions): { origin: number; span: number } {
		if (entries.length === 0) {
			return { origin: options.timeOrigin, span: options.timeSpan };
		}

		let minTime = Infinity;
		let maxTime = -Infinity;

		for (const entry of entries) {
			minTime = Math.min(minTime, entry.startTime);
			maxTime = Math.max(maxTime, entry.endTime ?? Date.now());
		}

		// Add some padding
		const span = Math.max(maxTime - minTime, 1000); // minimum 1 second
		return { origin: minTime - span * 0.05, span: span * 1.1 };
	}

	private computeTimeScale(timeSpan: number, availableWidth: number, zoom: number): number {
		const baseScale = (availableWidth - TIMELINE_LEFT_MARGIN) / timeSpan;
		return baseScale * zoom;
	}

	private computeTickInterval(timeSpan: number, availableWidth: number, timeScale: number): number {
		// Find a nice tick interval that results in ticks at least TIME_TICK_MINIMUM_PX apart
		const minIntervalMs = TIME_TICK_MINIMUM_PX / timeScale;

		const niceIntervals = [
			100,         // 100ms
			500,         // 500ms
			1000,        // 1s
			5000,        // 5s
			10000,       // 10s
			30000,       // 30s
			60000,       // 1min
			300000,      // 5min
			600000,      // 10min
			1800000,     // 30min
			3600000,     // 1hr
			7200000,     // 2hr
			14400000,    // 4hr
			28800000,    // 8hr
			86400000     // 24hr
		];

		for (const interval of niceIntervals) {
			if (interval >= minIntervalMs) {
				return interval;
			}
		}

		return 86400000; // fallback to 24hr
	}

	private formatTime(ms: number): string {
		if (ms < 0) { ms = 0; }
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		}
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	private getAgentY(entries: ITimelineEntry[], agentId: string): number {
		const index = entries.findIndex(e => e.agentId === agentId);
		return index >= 0 ? index * AGENT_ROW_HEIGHT : 0;
	}

	private truncateTask(task: string, barWidth: number): string {
		const maxChars = Math.floor(barWidth / 7); // ~7px per character
		if (task.length <= maxChars) { return task; }
		return maxChars > 3 ? task.substring(0, maxChars - 3) + '...' : '';
	}
}
