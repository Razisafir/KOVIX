/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Timeline View
 *  ViewPane subclass that renders the visual execution timeline / Gantt chart.
 *  Integrates with TimelineService for real-time updates and milestone control.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IViewPaneOptions } from '../../../../workbench/browser/parts/views/viewPane.js';
import { ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITimelineService } from '../../../../platform/construct/common/timeline/timelineService.js';
import {
	ITimelineEntry,
	ITimelineMilestone,
	ITimelineViewState,
	MilestoneStatus,
	DEFAULT_ZOOM,
	MIN_ZOOM,
	MAX_ZOOM
} from '../../../../platform/construct/common/timeline/timelineTypes.js';
import { TimelineRenderer } from '../services/timeline/timelineRenderer.js';

// ─── View Constants ────────────────────────────────────────────────────────

export class ConstructTimelineView extends ViewPane {
	static readonly ID = 'workbench.view.construct.timeline';
	static readonly TITLE = 'Execution Timeline';

	private container: HTMLElement | undefined;
	private toolbarContainer: HTMLElement | undefined;
	private chartContainer: HTMLElement | undefined;
	private detailsPanel: HTMLElement | undefined;
	private milestonePanel: HTMLElement | undefined;
	private historyDropdown: HTMLSelectElement | undefined;

	private currentPlanId: string | undefined;
	private viewState: ITimelineViewState = {
		zoom: DEFAULT_ZOOM,
		scrollPosition: 0,
		showCompleted: true,
		showFailed: true,
		groupBy: 'none'
	};

	private readonly renderer: TimelineRenderer;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@ILogService private readonly logService: ILogService,
		@ITimelineService private readonly timelineService: ITimelineService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

		this.renderer = new TimelineRenderer();

		// Subscribe to timeline updates for real-time rendering
		this._register(this.timelineService.onTimelineUpdate((planId) => {
			if (planId === this.currentPlanId) {
				this.renderTimeline();
			}
		}));

		this._register(this.timelineService.onMilestoneReached((milestone) => {
			this.logService.info(`[TimelineView] Milestone reached: ${milestone.name}`);
		}));

		this._register(this.timelineService.onStatsUpdate(() => {
			this.renderTimeline();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.container = container;
		container.classList.add('construct-timeline-view');

		// -- Toolbar -------------------------------------------------------
		this.toolbarContainer = dom.$('.construct-timeline-toolbar');
		container.appendChild(this.toolbarContainer);

		// -- History Dropdown -----------------------------------------------
		const historyContainer = dom.$('.construct-timeline-history');
		this.historyDropdown = document.createElement('select');
		this.historyDropdown.classList.add('construct-timeline-history-select');
		this.historyDropdown.addEventListener('change', () => {
			this.currentPlanId = this.historyDropdown?.value || undefined;
			this.renderTimeline();
		});
		historyContainer.appendChild(this.historyDropdown);
		container.appendChild(historyContainer);

		// -- Main Content Area (chart + details) ----------------------------
		const contentArea = dom.$('.construct-timeline-content');
		container.appendChild(contentArea);

		// Gantt chart scrollable area
		this.chartContainer = dom.$('.construct-timeline-chart');
		contentArea.appendChild(this.chartContainer);

		// Agent details sidebar
		this.detailsPanel = dom.$('.construct-timeline-details');
		this.detailsPanel.style.display = 'none';
		contentArea.appendChild(this.detailsPanel);

		// -- Milestone Panel (bottom) ---------------------------------------
		this.milestonePanel = dom.$('.construct-timeline-milestones');
		container.appendChild(this.milestonePanel);

		// -- Render initial state -------------------------------------------
		this.renderToolbar();
		this.updateHistoryDropdown();
		this.renderTimeline();
	}

	// =======================================================================
	// Toolbar
	// =======================================================================

	private renderToolbar(): void {
		if (!this.toolbarContainer) { return; }

		this.toolbarContainer.innerHTML = this.renderer.renderToolbar(
			this.viewState,
			this.currentPlanId !== undefined
		);

		// Bind toolbar actions
		this.toolbarContainer.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			const action = target.dataset.action;
			if (!action) { return; }

			switch (action) {
				case 'zoomIn':
					this.viewState.zoom = Math.min(MAX_ZOOM, this.viewState.zoom * 1.25);
					this.renderTimeline();
					break;
				case 'zoomOut':
					this.viewState.zoom = Math.max(MIN_ZOOM, this.viewState.zoom / 1.25);
					this.renderTimeline();
					break;
				case 'zoomFit':
					this.viewState.zoom = DEFAULT_ZOOM;
					this.renderTimeline();
					break;
				case 'showCompleted':
					this.viewState.showCompleted = !this.viewState.showCompleted;
					this.renderTimeline();
					break;
				case 'showFailed':
					this.viewState.showFailed = !this.viewState.showFailed;
					this.renderTimeline();
					break;
				case 'export':
					this.handleExport();
					break;
			}
		});

		// Group-by dropdown
		const select = this.toolbarContainer.querySelector('.timeline-toolbar-select');
		if (select) {
			select.addEventListener('change', (e) => {
				this.viewState.groupBy = (e.target as HTMLSelectElement).value as any;
				this.renderTimeline();
			});
		}
	}

	// =======================================================================
	// Timeline Rendering
	// =======================================================================

	private renderTimeline(): void {
		if (!this.chartContainer || !this.milestonePanel) { return; }

		// If no active plan, show empty state
		if (!this.currentPlanId) {
			this.chartContainer.innerHTML = this.renderer.renderEmptyState();
			this.milestonePanel.innerHTML = '';
			this.hideDetailsPanel();
			return;
		}

		const entries = this.timelineService.getTimeline(this.currentPlanId);
		const milestones = this.timelineService.getMilestones(this.currentPlanId);
		const dependencies = this.timelineService.getDependencies(this.currentPlanId);

		// If plan has no entries yet, show empty state
		if (entries.length === 0) {
			this.chartContainer.innerHTML = this.renderer.renderEmptyState();
			this.milestonePanel.innerHTML = this.renderer.renderMilestonePanel(milestones);
			return;
		}

		// Render Gantt chart
		const rect = this.chartContainer.getBoundingClientRect();
		const output = this.renderer.render(entries, milestones, dependencies, this.viewState, {
			containerWidth: rect.width || 800,
			containerHeight: rect.height || 400,
			timeOrigin: Date.now() - 3600000, // 1 hour ago
			timeSpan: 7200000 // 2 hours
		});

		this.chartContainer.innerHTML = output.html;

		// Render milestone panel
		this.milestonePanel.innerHTML = this.renderer.renderMilestonePanel(milestones);

		// Bind click handlers on agent bars
		this.bindChartInteractions();

		// Bind milestone action buttons
		this.bindMilestoneActions();

		// Update toolbar to reflect current zoom
		this.renderToolbar();
	}

	private bindChartInteractions(): void {
		if (!this.chartContainer) { return; }

		// Agent bar click → show details
		this.chartContainer.querySelectorAll('.timeline-bar').forEach(bar => {
			bar.addEventListener('click', (e) => {
				const agentId = (bar as HTMLElement).dataset.agentId;
				if (agentId) {
					this.viewState.selectedAgentId = agentId;
					this.timelineService.selectAgent(agentId);
					this.showAgentDetails(agentId);
					this.renderTimeline();
				}
			});

			// Keyboard accessibility
			bar.addEventListener('keydown', (e) => {
				if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
					const agentId = (bar as HTMLElement).dataset.agentId;
					if (agentId) {
						this.viewState.selectedAgentId = agentId;
						this.showAgentDetails(agentId);
					}
				}
			});
		});

		// Agent label click → select
		this.chartContainer.querySelectorAll('.timeline-agent-label').forEach(label => {
			label.addEventListener('click', () => {
				const agentId = (label as HTMLElement).dataset.agentId;
				if (agentId) {
					this.viewState.selectedAgentId = agentId;
					this.timelineService.selectAgent(agentId);
					this.showAgentDetails(agentId);
					this.renderTimeline();
				}
			});
		});

		// Milestone diamond click → select
		this.chartContainer.querySelectorAll('.timeline-milestone').forEach(ms => {
			ms.addEventListener('click', () => {
				const msId = (ms as HTMLElement).dataset.milestoneId;
				if (msId) {
					this.viewState.selectedMilestoneId = msId;
					this.timelineService.selectMilestone(msId);
				}
			});
		});
	}

	private bindMilestoneActions(): void {
		if (!this.milestonePanel) { return; }

		this.milestonePanel.querySelectorAll('.timeline-milestone-btn').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				const action = (btn as HTMLElement).dataset.action;
				const id = (btn as HTMLElement).dataset.id;
				if (!action || !id) { return; }

				switch (action) {
					case 'approveMilestone':
						this.timelineService.updateMilestoneStatus(id, MilestoneStatus.Approved);
						break;
					case 'rejectMilestone':
						this.timelineService.updateMilestoneStatus(id, MilestoneStatus.Rejected);
						break;
					case 'skipMilestone':
						this.timelineService.updateMilestoneStatus(id, MilestoneStatus.Skipped);
						break;
				}

				this.renderTimeline();
			});
		});
	}

	// =======================================================================
	// Agent Details Panel
	// =======================================================================

	private showAgentDetails(agentId: string): void {
		if (!this.detailsPanel || !this.currentPlanId) { return; }

		const entries = this.timelineService.getTimeline(this.currentPlanId);
		const entry = entries.find(e => e.agentId === agentId);
		if (!entry) { return; }

		const stats = this.timelineService.getStats(this.currentPlanId);

		this.detailsPanel.style.display = 'block';
		this.detailsPanel.innerHTML = `
			<div class="timeline-details-header">
				<span class="timeline-details-title">${entry.agentType} Agent</span>
				<button class="timeline-details-close" data-action="closeDetails">\u00D7</button>
			</div>
			<div class="timeline-details-section">
				<div class="timeline-details-label">Status</div>
				<div class="timeline-details-value status-${entry.status}">${entry.status}</div>
			</div>
			<div class="timeline-details-section">
				<div class="timeline-details-label">Task</div>
				<div class="timeline-details-value">${entry.task}</div>
			</div>
			<div class="timeline-details-section">
				<div class="timeline-details-label">Progress</div>
				<div class="timeline-details-value">
					<div class="timeline-details-progress-bar">
						<div class="timeline-details-progress-fill" style="width:${entry.progress}%"></div>
					</div>
					${entry.progress}%
				</div>
			</div>
			<div class="timeline-details-section">
				<div class="timeline-details-label">Duration</div>
				<div class="timeline-details-value">${entry.duration ? this.formatDuration(entry.duration) : 'In progress...'}</div>
			</div>
			<div class="timeline-details-section">
				<div class="timeline-details-label">Credits</div>
				<div class="timeline-details-value">${stats.creditsConsumed.toFixed(2)}</div>
			</div>
			<div class="timeline-details-section">
				<div class="timeline-details-label">Started</div>
				<div class="timeline-details-value">${new Date(entry.startTime).toLocaleTimeString()}</div>
			</div>`;

		// Close button
		const closeBtn = this.detailsPanel.querySelector('[data-action="closeDetails"]');
		if (closeBtn) {
			closeBtn.addEventListener('click', () => this.hideDetailsPanel());
		}
	}

	private hideDetailsPanel(): void {
		if (this.detailsPanel) {
			this.detailsPanel.style.display = 'none';
			this.viewState.selectedAgentId = undefined;
		}
	}

	// =======================================================================
	// History Dropdown
	// =======================================================================

	private updateHistoryDropdown(): void {
		if (!this.historyDropdown) { return; }

		const history = this.timelineService.getHistory();
		this.historyDropdown.innerHTML = '<option value="">Select execution...</option>';

		for (const entry of history) {
			const option = document.createElement('option');
			option.value = entry.planId;
			const goal = entry.goal.length > 40 ? entry.goal.substring(0, 40) + '...' : entry.goal;
			const date = new Date(entry.startTime).toLocaleDateString();
			const statusIcon = entry.status === 'completed' ? '\u2705' : entry.status === 'failed' ? '\u274C' : '\u23F3';
			option.textContent = `${statusIcon} ${goal} (${date})`;
			this.historyDropdown.appendChild(option);
		}

		// Auto-select current plan
		if (this.currentPlanId) {
			this.historyDropdown.value = this.currentPlanId;
		}
	}

	// =======================================================================
	// Export
	// =======================================================================

	private async handleExport(): Promise<void> {
		if (!this.currentPlanId) { return; }

		// Default to JSON export
		const data = await this.timelineService.exportTimeline(this.currentPlanId, 'json');

		// Create a download link
		const blob = new Blob([data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `timeline-${this.currentPlanId}.json`;
		a.click();
		URL.revokeObjectURL(url);

		this.logService.info(`[TimelineView] Exported timeline for ${this.currentPlanId}`);
	}

	// =======================================================================
	// Utility
	// =======================================================================

	private formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
		}
		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	}

	protected override layoutBody(height: number, width: number): void {
		// Layout is handled by flexbox CSS
		this.renderTimeline();
	}
}
