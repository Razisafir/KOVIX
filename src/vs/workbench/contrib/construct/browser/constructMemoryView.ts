/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Memory Panel View
 *  Visual tree view for browsing and managing persistent memory.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions } from '../../../../workbench/browser/parts/views/viewPane.js';
import { ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IConstructMemoryService, IConstructMemoryItem, IConstructMemoryProfile } from '../../../../platform/construct/common/memory/constructMemory.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IMemoryStats } from '../../../../platform/construct/common/memory/memoryTypes.js';

/**
 * Categories for the memory tree view.
 */
enum MemoryCategory {
	ProfileStatic = 'profile-static',
	ProfileDynamic = 'profile-dynamic',
	RecentMemories = 'recent-memories',
	WorkspaceContext = 'workspace-context'
}

/**
 * A single item in the memory tree.
 */
interface IMemoryTreeItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon: string;
	readonly iconColor: string;
	readonly backgroundColor?: string;
	readonly category: MemoryCategory;
	readonly fullContent?: string;
	readonly memoryId?: string;
	readonly timestamp?: number;
}

export class ConstructMemoryViewPane extends ViewPane {

	private treeContainer!: HTMLElement;
	private searchBox!: HTMLInputElement;
	private treeContent!: HTMLElement;
	private statsBar!: HTMLElement;

	private profile: IConstructMemoryProfile = { static: [], dynamic: [] };
	private recentMemories: IConstructMemoryItem[] = [];
	private currentFilter: string = '';
	private localStats: IMemoryStats | null = null;

	constructor(
		options: IViewPaneOptions,
		@IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
		@IMemoryOrchestrator private readonly memoryOrchestrator: IMemoryOrchestrator,
		@ILogService private readonly logService: ILogService,
	) {
		super(options);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';

		// Header with connection status
		const header = dom.$('.construct-memory-header');
		header.style.cssText = `
			padding: 8px 12px; border-bottom: 1px solid #1A1F2E;
			display: flex; justify-content: space-between; align-items: center;
		`;

		const statusText = dom.$('.construct-memory-status');
		statusText.style.cssText = `font-size: 11px; color: #4A5568;`;
		statusText.textContent = this.constructMemory.isInitialized ? '🧠 Connected' : '🧠 Local only';

		const refreshBtn = dom.$('button') as HTMLButtonElement;
		refreshBtn.textContent = '↻';
		refreshBtn.title = 'Refresh memories';
		refreshBtn.style.cssText = `
			background: none; border: 1px solid #1A1F2E; color: #4A5568;
			border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px;
		`;
		refreshBtn.onclick = () => this.refresh();

		header.appendChild(statusText);
		header.appendChild(refreshBtn);
		container.appendChild(header);

		// Search box
		const searchContainer = dom.$('.construct-memory-search');
		searchContainer.style.cssText = `padding: 6px 8px;`;

		this.searchBox = dom.$('input') as HTMLInputElement;
		this.searchBox.type = 'text';
		this.searchBox.placeholder = 'Search memories...';
		this.searchBox.style.cssText = `
			width: 100%; background: #0A0E1A; border: 1px solid #1A1F2E;
			border-radius: 3px; padding: 5px 8px; color: #E0E7FF;
			font-size: 11px; outline: none; box-sizing: border-box;
		`;
		this.searchBox.oninput = () => {
			this.currentFilter = this.searchBox.value.trim();
			this.renderTree();
		};

		searchContainer.appendChild(this.searchBox);
		container.appendChild(searchContainer);

		// Tree content
		this.treeContent = dom.$('.construct-memory-tree');
		this.treeContent.style.cssText = `
			flex: 1; overflow-y: auto; padding: 4px 8px;
		`;
		container.appendChild(this.treeContent);

		// Stats bar
		this.statsBar = dom.$('.construct-memory-stats');
		this.statsBar.style.cssText = `
			padding: 4px 12px; border-top: 1px solid #1A1F2E;
			font-size: 10px; color: #4A5568;
		`;
		container.appendChild(this.statsBar);

		// Initial load
		this.refresh();

		// Listen for initialization changes
		this._register(this.constructMemory.onDidChangeInitialization(() => {
			statusText.textContent = this.constructMemory.isInitialized ? '🧠 Connected' : '🧠 Local only';
			this.refresh();
		}));

		// Listen for new memories
		this._register(this.constructMemory.onDidAddMemory(() => {
			this.refresh();
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		// Layout handled by flexbox
	}

	async refresh(): Promise<void> {
		try {
			// Load profile
			if (this.constructMemory.isInitialized && this.constructMemory.config.enabled) {
				this.profile = await this.constructMemory.getProfile();
				this.recentMemories = await this.constructMemory.getRecentMemories(20);
			} else {
				this.profile = { static: [], dynamic: [] };
				this.recentMemories = [];
			}

			// Load local stats
			const projectId = 'default';
			try {
				this.localStats = this.memoryOrchestrator.getMemoryStats(projectId);
			} catch {
				this.localStats = null;
			}

			this.renderTree();
			this.renderStats();
		} catch (error) {
			this.logService.warn('[ConstructMemoryView] Refresh failed:', error);
		}
	}

	private renderTree(): void {
		// Clear existing content
		dom.clearNode(this.treeContent);

		const items = this.getFilteredItems();

		if (items.length === 0) {
			const empty = dom.$('.construct-memory-empty');
			empty.style.cssText = `
				padding: 20px; text-align: center; color: #4A5568; font-size: 11px;
			`;
			empty.textContent = this.constructMemory.isInitialized
				? 'No memories yet. Start a conversation to build your memory.'
				: 'Connect Supermemory to enable persistent memory across sessions.';
			this.treeContent.appendChild(empty);
			return;
		}

		// Group items by category
		const grouped = new Map<MemoryCategory, IMemoryTreeItem[]>();
		for (const item of items) {
			const group = grouped.get(item.category) ?? [];
			group.push(item);
			grouped.set(item.category, group);
		}

		// Render each category
		const categoryOrder: MemoryCategory[] = [
			MemoryCategory.ProfileStatic,
			MemoryCategory.ProfileDynamic,
			MemoryCategory.RecentMemories,
			MemoryCategory.WorkspaceContext
		];

		const categoryLabels: Record<MemoryCategory, string> = {
			[MemoryCategory.ProfileStatic]: '🧠 Preferences & Facts',
			[MemoryCategory.ProfileDynamic]: '⚡ Recent Activity',
			[MemoryCategory.RecentMemories]: '📝 Recent Memories',
			[MemoryCategory.WorkspaceContext]: '📁 Workspace Context'
		};

		for (const category of categoryOrder) {
			const groupItems = grouped.get(category);
			if (!groupItems || groupItems.length === 0) { continue; }

			// Category header
			const catHeader = dom.$('.construct-memory-cat-header');
			catHeader.style.cssText = `
				padding: 6px 4px 2px 4px; font-size: 11px; font-weight: 600;
				color: #4A5568; text-transform: uppercase; letter-spacing: 0.5px;
			`;
			catHeader.textContent = categoryLabels[category];
			this.treeContent.appendChild(catHeader);

			// Items
			for (const item of groupItems) {
				this.renderTreeItem(item);
			}
		}
	}

	private renderTreeItem(item: IMemoryTreeItem): void {
		const row = dom.$('.construct-memory-item');
		const bgColor = item.backgroundColor ?? 'transparent';
		row.style.cssText = `
			display: flex; align-items: flex-start; padding: 4px 6px;
			margin: 1px 0; border-radius: 3px; cursor: pointer;
			background: ${bgColor}; border-left: 2px solid ${item.iconColor};
			font-size: 11px;
		`;
		row.title = item.fullContent ?? item.label;

		// Icon
		const icon = dom.$('.construct-memory-item-icon');
		icon.style.cssText = `
			min-width: 16px; margin-right: 4px; font-size: 11px;
		`;
		icon.textContent = item.icon;
		row.appendChild(icon);

		// Content
		const content = dom.$('.construct-memory-item-content');
		content.style.cssText = `flex: 1; min-width: 0; color: #E0E7FF;`;

		const label = dom.$('.construct-memory-item-label');
		label.style.cssText = `
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		`;
		label.textContent = item.label;
		content.appendChild(label);

		if (item.description) {
			const desc = dom.$('.construct-memory-item-desc');
			desc.style.cssText = `
				font-size: 9px; color: #4A5568; overflow: hidden;
				text-overflow: ellipsis; white-space: nowrap;
			`;
			desc.textContent = item.description;
			content.appendChild(desc);
		}

		row.appendChild(content);

		// Delete button (only for Supermemory items)
		if (item.memoryId && this.constructMemory.isInitialized) {
			const deleteBtn = dom.$('button') as HTMLButtonElement;
			deleteBtn.textContent = '×';
			deleteBtn.title = 'Delete this memory';
			deleteBtn.style.cssText = `
				background: none; border: none; color: #4A5568;
				cursor: pointer; font-size: 12px; padding: 0 2px;
				min-width: 16px; opacity: 0;
				transition: opacity 0.15s;
			`;
			row.onmouseenter = () => { deleteBtn.style.opacity = '1'; };
			row.onmouseleave = () => { deleteBtn.style.opacity = '0'; };
			deleteBtn.onclick = (e) => {
				e.stopPropagation();
				if (item.memoryId && confirm('Delete this memory?')) {
					this.constructMemory.forgetMemory(item.memoryId).then(() => {
						this.refresh();
					}).catch(err => {
						this.logService.warn('[ConstructMemoryView] Failed to delete memory:', err);
					});
				}
			};
			row.appendChild(deleteBtn);
		}

		// Click to see full content
		row.onclick = () => {
			if (item.fullContent) {
				this.showMemoryDetail(item);
			}
		};

		this.treeContent.appendChild(row);
	}

	private showMemoryDetail(item: IMemoryTreeItem): void {
		// Replace tree with detail view temporarily
		dom.clearNode(this.treeContent);

		const detail = dom.$('.construct-memory-detail');
		detail.style.cssText = `padding: 8px;`;

		const backBtn = dom.$('button') as HTMLButtonElement;
		backBtn.textContent = '← Back';
		backBtn.style.cssText = `
			background: none; border: 1px solid #1A1F2E; color: #00E5FF;
			border-radius: 3px; padding: 3px 8px; cursor: pointer;
			font-size: 11px; margin-bottom: 8px;
		`;
		backBtn.onclick = () => this.renderTree();
		detail.appendChild(backBtn);

		const title = dom.$('.construct-memory-detail-title');
		title.style.cssText = `
			font-size: 12px; font-weight: 600; color: #E0E7FF; margin-bottom: 4px;
		`;
		title.textContent = item.label;
		detail.appendChild(title);

		if (item.timestamp) {
			const time = dom.$('.construct-memory-detail-time');
			time.style.cssText = `font-size: 9px; color: #4A5568; margin-bottom: 8px;`;
			time.textContent = new Date(item.timestamp).toLocaleString();
			detail.appendChild(time);
		}

		const content = dom.$('.construct-memory-detail-content');
		content.style.cssText = `
			font-size: 11px; color: #B0BEC5; white-space: pre-wrap;
			line-height: 1.5; word-break: break-word;
		`;
		content.textContent = item.fullContent ?? '';
		detail.appendChild(content);

		this.treeContent.appendChild(detail);
	}

	private renderStats(): void {
		dom.clearNode(this.statsBar);

		const parts: string[] = [];

		if (this.localStats) {
			parts.push(`Local: ${this.localStats.totalEntries} entries`);
		}

		if (this.constructMemory.isInitialized) {
			const profileCount = this.profile.static.length + this.profile.dynamic.length;
			parts.push(`Profile: ${profileCount} facts`);
			parts.push(`Memories: ${this.recentMemories.length}`);
		}

		this.statsBar.textContent = parts.join(' • ') || 'No memory data';
	}

	private getFilteredItems(): IMemoryTreeItem[] {
		const items: IMemoryTreeItem[] = [];
		const filter = this.currentFilter.toLowerCase();

		// Static profile facts
		for (const fact of this.profile.static) {
			const item: IMemoryTreeItem = {
				id: `static-${items.length}`,
				label: fact,
				icon: '🧠',
				iconColor: '#4A5568',
				backgroundColor: '#0A0E1A',
				category: MemoryCategory.ProfileStatic,
				fullContent: fact,
			};
			if (!filter || fact.toLowerCase().includes(filter)) {
				items.push(item);
			}
		}

		// Dynamic profile facts
		for (const activity of this.profile.dynamic) {
			const item: IMemoryTreeItem = {
				id: `dynamic-${items.length}`,
				label: activity,
				icon: '⚡',
				iconColor: '#00E5FF',
				backgroundColor: '#0A0E2A',
				category: MemoryCategory.ProfileDynamic,
				fullContent: activity,
			};
			if (!filter || activity.toLowerCase().includes(filter)) {
				items.push(item);
			}
		}

		// Recent memories
		for (const memory of this.recentMemories) {
			const memoryType = memory.metadata?.type as string | undefined;
			let icon = '📝';
			let iconColor = '#E0E7FF';

			if (memoryType === 'tool_result') {
				icon = '🔧';
				iconColor = '#4CAF50';
			} else if (memoryType === 'error') {
				icon = '⚠️';
				iconColor = '#F44336';
			} else if (memoryType === 'task_summary') {
				icon = '📋';
				iconColor = '#00E5FF';
			} else if (memoryType === 'user_message') {
				icon = '💬';
				iconColor = '#00E5FF';
			}

			const item: IMemoryTreeItem = {
				id: memory.id,
				label: memory.content.length > 80 ? memory.content.substring(0, 80) + '...' : memory.content,
				description: this.formatTimestamp(memory.createdAt),
				icon,
				iconColor,
				category: MemoryCategory.RecentMemories,
				fullContent: memory.content,
				memoryId: memory.id,
				timestamp: memory.createdAt,
			};

			if (!filter || memory.content.toLowerCase().includes(filter)) {
				items.push(item);
			}
		}

		// Workspace context (from local stats)
		if (this.localStats) {
			const layers = this.localStats.entriesByLayer;
			if (layers.working > 0) {
				items.push({
					id: 'ws-working',
					label: `Working Memory: ${layers.working} active context`,
					icon: '📁',
					iconColor: '#4A5568',
					category: MemoryCategory.WorkspaceContext,
					fullContent: `Working memory has ${layers.working} active context(s) with ${this.localStats.totalEntries} total entries across all layers.`,
				});
			}
			if (layers.episodic > 0) {
				items.push({
					id: 'ws-episodic',
					label: `Episodic: ${layers.episodic} recorded events`,
					icon: '📁',
					iconColor: '#4A5568',
					category: MemoryCategory.WorkspaceContext,
				});
			}
			if (layers.semantic > 0) {
				items.push({
					id: 'ws-semantic',
					label: `Semantic: ${layers.semantic} knowledge entries`,
					icon: '📁',
					iconColor: '#4A5568',
					category: MemoryCategory.WorkspaceContext,
				});
			}
			if (layers.procedural > 0) {
				items.push({
					id: 'ws-procedural',
					label: `Procedural: ${layers.procedural} learned patterns`,
					icon: '📁',
					iconColor: '#4A5568',
					category: MemoryCategory.WorkspaceContext,
				});
			}
		}

		return items;
	}

	private formatTimestamp(ts: number): string {
		if (!ts) { return ''; }
		const now = Date.now();
		const diff = now - ts;

		if (diff < 60000) { return 'just now'; }
		if (diff < 3600000) { return `${Math.floor(diff / 60000)}m ago`; }
		if (diff < 86400000) { return `${Math.floor(diff / 3600000)}h ago`; }
		return new Date(ts).toLocaleDateString();
	}
}
