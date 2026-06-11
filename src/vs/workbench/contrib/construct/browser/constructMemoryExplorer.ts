// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IObsidianMemoryService } from '../../../../platform/construct/common/memory/obsidianMemoryService.js';
import { IObsidianMemoryEntry, MemoryCategory, MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from '../../../../platform/construct/common/memory/obsidianMemoryTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../workbench/common/views';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';

/**
 * Obsidian-like Memory Explorer view panel.
 *
 * Displays memories in a hierarchical tree structure grouped by category.
 * Provides search, add, import, export, and edit capabilities.
 */
export class ObsidianMemoryTreePanel extends ViewPane {

        private searchBox!: HTMLInputElement;
        private treeContent!: HTMLElement;
        private statsBar!: HTMLElement;
        private currentFilter: string = '';
        private selectedEntryId: string | undefined;
        private editContainer: HTMLElement | undefined;

        constructor(
                options: IViewPaneOptions,
                @IObsidianMemoryService private readonly obsidianMemory: IObsidianMemoryService,
                @ILogService private readonly logService: ILogService,
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
                @IQuickInputService private readonly quickInputService: IQuickInputService,
                @INotificationService private readonly notificationService: INotificationService,
                @IContextViewService contextViewService: IContextViewService,
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';

                // --- Header toolbar ---
                const header = dom.$('.obsidian-memory-header');
                header.style.cssText = `
                        padding: 6px 8px; border-bottom: 1px solid var(--vscode-editorWidget-border);
                        display: flex; gap: 4px; align-items: center; flex-shrink: 0;
                `;

                const addBtn = this.createToolbarButton('+', 'Add Memory', () => this.addMemory());
                const searchBtn = this.createToolbarButton('🔍', 'Search', () => this.focusSearch());
                const importBtn = this.createToolbarButton('📥', 'Import', () => this.importMemories());
                const exportBtn = this.createToolbarButton('📤', 'Export', () => this.exportMemories());
                const refreshBtn = this.createToolbarButton('🔄', 'Refresh', () => this.refresh());

                header.appendChild(addBtn);
                header.appendChild(searchBtn);
                header.appendChild(importBtn);
                header.appendChild(exportBtn);
                header.appendChild(refreshBtn);
                container.appendChild(header);

                // --- Search box ---
                const searchContainer = dom.$('.obsidian-memory-search');
                searchContainer.style.cssText = `padding: 4px 8px; flex-shrink: 0;`;

                this.searchBox = dom.$('input') as HTMLInputElement;
                this.searchBox.type = 'text';
                this.searchBox.placeholder = 'Search memories...';
                this.searchBox.style.cssText = `
                        width: 100%; background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 2px; padding: 4px 8px;
                        color: var(--vscode-input-foreground);
                        font-size: 12px; outline: none; box-sizing: border-box;
                `;
                this.searchBox.oninput = () => {
                        this.currentFilter = this.searchBox.value.trim();
                        this.renderTree();
                };

                searchContainer.appendChild(this.searchBox);
                container.appendChild(searchContainer);

                // --- Tree content ---
                this.treeContent = dom.$('.obsidian-memory-tree');
                this.treeContent.style.cssText = `flex: 1; overflow-y: auto; padding: 4px 8px;`;
                container.appendChild(this.treeContent);

                // --- Stats bar ---
                this.statsBar = dom.$('.obsidian-memory-stats');
                this.statsBar.style.cssText = `
                        padding: 4px 8px; border-top: 1px solid var(--vscode-editorWidget-border);
                        font-size: 10px; color: var(--vscode-descriptionForeground); flex-shrink: 0;
                `;
                container.appendChild(this.statsBar);

                // --- Initial load ---
                this.refresh();

                // --- Listen for memory changes ---
                this._register(this.obsidianMemory.onDidAddMemory(() => this.refresh()));
                this._register(this.obsidianMemory.onDidUpdateMemory(() => this.refresh()));
                this._register(this.obsidianMemory.onDidDeleteMemory(() => this.refresh()));
                this._register(this.obsidianMemory.onDidImportMemories(() => this.refresh()));
        }

        protected override layoutBody(height: number, width: number): void {
                // Layout handled by flexbox
        }

        private createToolbarButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
                const btn = dom.$('button') as HTMLButtonElement;
                btn.textContent = label;
                btn.title = title;
                btn.style.cssText = `
                        background: none; border: 1px solid var(--vscode-editorWidget-border);
                        color: var(--vscode-foreground); border-radius: 2px;
                        padding: 2px 6px; cursor: pointer; font-size: 12px;
                        line-height: 1;
                `;
                btn.onmouseenter = () => { btn.style.background = 'var(--vscode-toolbar-hoverBackground)'; };
                btn.onmouseleave = () => { btn.style.background = 'none'; };
                btn.onclick = onClick;
                return btn;
        }

        async refresh(): Promise<void> {
                try {
                        this.renderTree();
                        this.renderStats();
                } catch (error) {
                        this.logService.warn('[ObsidianMemoryExplorer] Refresh failed:', error);
                }
        }

        private renderTree(): void {
                dom.clearNode(this.treeContent);

                const allEntries = this.obsidianMemory.getAllMemories();
                const filter = this.currentFilter.toLowerCase();

                // Filter entries if search is active
                let filteredEntries = allEntries;
                if (filter) {
                        filteredEntries = allEntries.filter(e =>
                                e.title.toLowerCase().includes(filter) ||
                                e.content.toLowerCase().includes(filter) ||
                                e.tags.some(t => t.toLowerCase().includes(filter)) ||
                                e.category.toLowerCase().includes(filter)
                        );
                }

                // Group by category
                const grouped = new Map<MemoryCategory, IObsidianMemoryEntry[]>();
                for (const cat of MEMORY_CATEGORIES) {
                        grouped.set(cat, []);
                }
                for (const entry of filteredEntries) {
                        const group = grouped.get(entry.category);
                        if (group) {
                                group.push(entry);
                        }
                }

                if (filteredEntries.length === 0) {
                        const empty = dom.$('.obsidian-memory-empty');
                        empty.style.cssText = `
                                padding: 20px; text-align: center;
                                color: var(--vscode-descriptionForeground); font-size: 12px;
                        `;
                        empty.textContent = filter
                                ? 'No memories match your search.'
                                : 'No memories yet. Click + to add one, or start a conversation to auto-extract.';
                        this.treeContent.appendChild(empty);
                        return;
                }

                // Render each category
                for (const category of MEMORY_CATEGORIES) {
                        const entries = grouped.get(category) ?? [];
                        if (entries.length === 0) { continue; }

                        // Category header (collapsible)
                        const catHeader = dom.$('.obsidian-memory-cat-header');
                        catHeader.style.cssText = `
                                display: flex; align-items: center; gap: 4px;
                                padding: 6px 4px 2px 4px; font-size: 11px; font-weight: 600;
                                color: var(--vscode-descriptionForeground);
                                text-transform: uppercase; letter-spacing: 0.5px;
                                cursor: pointer; user-select: none;
                        `;

                        const arrow = dom.$('.obsidian-memory-arrow');
                        arrow.style.cssText = `font-size: 8px; transition: transform 0.15s;`;
                        arrow.textContent = '▶';

                        const catLabel = dom.$('.obsidian-memory-cat-label');
                        catLabel.textContent = `${MEMORY_CATEGORY_LABELS[category]} (${entries.length})`;

                        const catEntries = dom.$('.obsidian-memory-cat-entries');

                        catHeader.appendChild(arrow);
                        catHeader.appendChild(catLabel);
                        this.treeContent.appendChild(catHeader);

                        let collapsed = false;
                        catHeader.onclick = () => {
                                collapsed = !collapsed;
                                catEntries.style.display = collapsed ? 'none' : 'block';
                                arrow.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(90deg)';
                        };

                        // Set initial arrow rotation (expanded)
                        arrow.style.transform = 'rotate(90deg)';

                        // Render entries
                        for (const entry of entries) {
                                this.renderTreeItem(entry, catEntries);
                        }

                        this.treeContent.appendChild(catEntries);
                }
        }

        private renderTreeItem(entry: IObsidianMemoryEntry, container: HTMLElement): void {
                const row = dom.$('.obsidian-memory-item');
                row.style.cssText = `
                        display: flex; align-items: flex-start; padding: 4px 6px 4px 16px;
                        margin: 1px 0; border-radius: 2px; cursor: pointer;
                        border-left: 2px solid var(--vscode-activityBarBadge-background);
                        font-size: 12px; position: relative;
                `;
                row.title = entry.content;

                // Selected state
                if (this.selectedEntryId === entry.id) {
                        row.style.background = 'var(--vscode-list-activeSelectionBackground)';
                        row.style.color = 'var(--vscode-list-activeSelectionForeground)';
                } else {
                        row.onmouseenter = () => { row.style.background = 'var(--vscode-list-hoverBackground)'; };
                        row.onmouseleave = () => { row.style.background = 'transparent'; };
                }

                // Content
                const content = dom.$('.obsidian-memory-item-content');
                content.style.cssText = `flex: 1; min-width: 0;`;

                const label = dom.$('.obsidian-memory-item-label');
                label.style.cssText = `
                        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                        color: var(--vscode-foreground);
                `;
                label.textContent = entry.title;
                content.appendChild(label);

                // Description (truncated content)
                if (entry.content) {
                        const desc = dom.$('.obsidian-memory-item-desc');
                        desc.style.cssText = `
                                font-size: 10px; color: var(--vscode-descriptionForeground);
                                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                        `;
                        desc.textContent = entry.content.length > 80
                                ? entry.content.substring(0, 80) + '...'
                                : entry.content;
                        content.appendChild(desc);
                }

                // Source badge
                const sourceBadge = dom.$('.obsidian-memory-source');
                sourceBadge.style.cssText = `
                        font-size: 9px; padding: 1px 4px; border-radius: 2px;
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground); flex-shrink: 0;
                `;
                const sourceLabels: Record<string, string> = {
                        'auto-extract': '🤖',
                        'user-created': '✏️',
                        'imported': '📥',
                        'session-recording': '💬',
                };
                sourceBadge.textContent = sourceLabels[entry.source] ?? entry.source;
                sourceBadge.title = entry.source;

                row.appendChild(content);
                row.appendChild(sourceBadge);

                // Delete button
                const deleteBtn = dom.$('button') as HTMLButtonElement;
                deleteBtn.textContent = '×';
                deleteBtn.title = 'Delete';
                deleteBtn.style.cssText = `
                        background: none; border: none; color: var(--vscode-descriptionForeground);
                        cursor: pointer; font-size: 14px; padding: 0 2px;
                        min-width: 16px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0;
                `;
                row.onmouseenter = () => { deleteBtn.style.opacity = '1'; };
                row.onmouseleave = () => { deleteBtn.style.opacity = '0'; };
                deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.deleteMemory(entry.id);
                };
                row.appendChild(deleteBtn);

                // Click to edit
                row.onclick = () => {
                        this.selectedEntryId = entry.id;
                        this.showMemoryEditor(entry);
                        this.renderTree();
                };

                // Right-click context menu
                row.oncontextmenu = (e) => {
                        e.preventDefault();
                        this.showContextMenu(entry, e);
                };

                container.appendChild(row);
        }

        private showContextMenu(entry: IObsidianMemoryEntry, event: MouseEvent): void {
                const actions: { label: string; action: () => void }[] = [
                        { label: 'Edit', action: () => this.showMemoryEditor(entry) },
                        { label: 'Delete', action: () => this.deleteMemory(entry.id) },
                        { label: 'Copy Content', action: () => this.copyToClipboard(entry.content) },
                        { label: 'Add Tag...', action: () => this.addTagToEntry(entry) },
                ];

                // Simple context menu using the contextMenuService
                this.contextMenuService.showContextMenu({
                        getAnchor: () => ({ x: event.clientX, y: event.clientY }),
                        getActions: () => actions.map(a => ({
                                id: `obsidian-memory-${a.label}`,
                                label: a.label,
                                tooltip: '',
                                class: undefined,
                                enabled: true,
                                run: () => a.action(),
                        })),
                });
        }

        private showMemoryEditor(entry: IObsidianMemoryEntry): void {
                // Clear the edit container if it exists
                if (this.editContainer) {
                        dom.clearNode(this.editContainer);
                } else {
                        this.editContainer = dom.$('.obsidian-memory-editor');
                        this.editContainer.style.cssText = `
                                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                                background: var(--vscode-editor-background);
                                z-index: 10; display: flex; flex-direction: column;
                        `;
                }

                dom.clearNode(this.editContainer);

                // Back button
                const backBtn = dom.$('button') as HTMLButtonElement;
                backBtn.textContent = '← Back';
                backBtn.style.cssText = `
                        background: none; border: 1px solid var(--vscode-editorWidget-border);
                        color: var(--vscode-foreground); border-radius: 2px;
                        padding: 4px 8px; cursor: pointer; font-size: 11px;
                        margin: 8px; flex-shrink: 0;
                `;
                backBtn.onclick = () => {
                        if (this.editContainer && this.editContainer.parentElement) {
                                this.editContainer.parentElement.removeChild(this.editContainer);
                        }
                        this.editContainer = undefined;
                        this.selectedEntryId = undefined;
                        this.renderTree();
                };
                this.editContainer.appendChild(backBtn);

                // Edit form
                const form = dom.$('.obsidian-memory-form');
                form.style.cssText = `padding: 8px; overflow-y: auto; flex: 1;`;

                // Title field
                form.appendChild(this.createLabel('Title'));
                const titleInput = dom.$('input') as HTMLInputElement;
                titleInput.type = 'text';
                titleInput.value = entry.title;
                titleInput.style.cssText = `
                        width: 100%; box-sizing: border-box; padding: 4px 8px;
                        background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground); border-radius: 2px; font-size: 12px;
                `;
                form.appendChild(titleInput);

                // Category dropdown
                form.appendChild(this.createLabel('Category'));
                const categorySelect = dom.$('select') as HTMLSelectElement;
                categorySelect.style.cssText = `
                        width: 100%; box-sizing: border-box; padding: 4px 8px;
                        background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground); border-radius: 2px; font-size: 12px;
                `;
                for (const cat of MEMORY_CATEGORIES) {
                        const option = dom.$('option') as HTMLOptionElement;
                        option.value = cat;
                        option.textContent = MEMORY_CATEGORY_LABELS[cat];
                        option.selected = cat === entry.category;
                        categorySelect.appendChild(option);
                }
                form.appendChild(categorySelect);

                // Tags field
                form.appendChild(this.createLabel('Tags (comma-separated)'));
                const tagsInput = dom.$('input') as HTMLInputElement;
                tagsInput.type = 'text';
                tagsInput.value = entry.tags.join(', ');
                tagsInput.style.cssText = `
                        width: 100%; box-sizing: border-box; padding: 4px 8px;
                        background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground); border-radius: 2px; font-size: 12px;
                `;
                form.appendChild(tagsInput);

                // Content textarea
                form.appendChild(this.createLabel('Content'));
                const contentArea = dom.$('textarea') as HTMLTextAreaElement;
                contentArea.value = entry.content;
                contentArea.style.cssText = `
                        width: 100%; box-sizing: border-box; padding: 8px;
                        background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground); border-radius: 2px;
                        font-size: 12px; font-family: var(--vscode-editor-font-family, monospace);
                        min-height: 200px; resize: vertical;
                `;
                form.appendChild(contentArea);

                // Metadata section (read-only)
                form.appendChild(this.createLabel('Metadata'));
                const metaDiv = dom.$('.obsidian-memory-meta');
                metaDiv.style.cssText = `
                        font-size: 10px; color: var(--vscode-descriptionForeground);
                        padding: 4px 0;
                `;
                metaDiv.innerHTML = `
                        Created: ${new Date(entry.createdAt).toLocaleString()}<br>
                        Updated: ${new Date(entry.updatedAt).toLocaleString()}<br>
                        Source: <span style="padding:1px 4px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:2px;">${entry.source}</span>
                `;
                form.appendChild(metaDiv);

                // Action buttons
                const actions = dom.$('.obsidian-memory-actions');
                actions.style.cssText = `display: flex; gap: 8px; margin-top: 12px;`;

                const saveBtn = dom.$('button') as HTMLButtonElement;
                saveBtn.textContent = 'Save';
                saveBtn.style.cssText = `
                        background: var(--vscode-button-background); border: none;
                        color: var(--vscode-button-foreground); border-radius: 2px;
                        padding: 6px 16px; cursor: pointer; font-size: 12px;
                `;
                saveBtn.onclick = async () => {
                        try {
                                const tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
                                await this.obsidianMemory.updateMemory(entry.id, {
                                        title: titleInput.value,
                                        content: contentArea.value,
                                        category: categorySelect.value as MemoryCategory,
                                        tags,
                                });
                                this.notificationService.info(`Memory updated: "${titleInput.value}"`);
                                this.refresh();
                        } catch (error) {
                                this.notificationService.error(`Failed to update memory: ${error instanceof Error ? error.message : String(error)}`);
                        }
                };

                const deleteBtn = dom.$('button') as HTMLButtonElement;
                deleteBtn.textContent = 'Delete';
                deleteBtn.style.cssText = `
                        background: var(--vscode-errorBackground, #5a1d1d); border: none;
                        color: var(--vscode-errorForeground, #f48771); border-radius: 2px;
                        padding: 6px 16px; cursor: pointer; font-size: 12px;
                `;
                deleteBtn.onclick = () => this.deleteMemory(entry.id);

                const cancelBtn = dom.$('button') as HTMLButtonElement;
                cancelBtn.textContent = 'Cancel';
                cancelBtn.style.cssText = `
                        background: none; border: 1px solid var(--vscode-editorWidget-border);
                        color: var(--vscode-foreground); border-radius: 2px;
                        padding: 6px 16px; cursor: pointer; font-size: 12px;
                `;
                cancelBtn.onclick = () => {
                        if (this.editContainer && this.editContainer.parentElement) {
                                this.editContainer.parentElement.removeChild(this.editContainer);
                        }
                        this.editContainer = undefined;
                        this.selectedEntryId = undefined;
                        this.renderTree();
                };

                actions.appendChild(saveBtn);
                actions.appendChild(deleteBtn);
                actions.appendChild(cancelBtn);
                form.appendChild(actions);

                this.editContainer.appendChild(form);

                // Add to the tree content container (overlay)
                this.treeContent.style.position = 'relative';
                this.treeContent.appendChild(this.editContainer);
        }

        private createLabel(text: string): HTMLElement {
                const label = dom.$('.obsidian-memory-label');
                label.style.cssText = `
                        font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground);
                        margin-top: 8px; margin-bottom: 4px; display: block;
                `;
                label.textContent = text;
                return label;
        }

        private renderStats(): void {
                dom.clearNode(this.statsBar);
                const stats = this.obsidianMemory.getStats();
                const parts: string[] = [];

                parts.push(`${stats.totalEntries} entries`);

                const nonZeroCategories = MEMORY_CATEGORIES
                        .filter(c => stats.entriesByCategory[c] > 0)
                        .map(c => `${MEMORY_CATEGORY_LABELS[c]}: ${stats.entriesByCategory[c]}`);

                if (nonZeroCategories.length > 0) {
                        parts.push(nonZeroCategories.join(', '));
                }

                if (stats.lastUpdated > 0) {
                        parts.push(`Last updated: ${this.formatTimestamp(stats.lastUpdated)}`);
                }

                this.statsBar.textContent = parts.join(' | ');
        }

        // --- Actions ----------------------------------------------------------------

        private async addMemory(): Promise<void> {
                const title = await this.quickInputService.input({
                        prompt: 'Memory title',
                        placeHolder: 'e.g., "John - Project Manager"',
                });
                if (!title) { return; }

                const categoryPick = await this.quickInputService.pick(
                        MEMORY_CATEGORIES.map(cat => ({
                                label: MEMORY_CATEGORY_LABELS[cat],
                                description: cat,
                        })),
                        { placeHolder: 'Select category' },
                );
                if (!categoryPick) { return; }

                const content = await this.quickInputService.input({
                        prompt: 'Memory content',
                        placeHolder: 'Enter the memory content...',
                });
                if (!content) { return; }

                try {
                        await this.obsidianMemory.addMemory(
                                title,
                                content,
                                categoryPick.description as MemoryCategory,
                                [],
                                'user-created',
                        );
                        this.notificationService.info(`Memory added: "${title}"`);
                        this.refresh();
                } catch (error) {
                        this.notificationService.error(`Failed to add memory: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private async deleteMemory(id: string): Promise<void> {
                try {
                        await this.obsidianMemory.deleteMemory(id);
                        this.notificationService.info('Memory deleted');
                        this.selectedEntryId = undefined;
                        if (this.editContainer && this.editContainer.parentElement) {
                                this.editContainer.parentElement.removeChild(this.editContainer);
                                this.editContainer = undefined;
                        }
                        this.refresh();
                } catch (error) {
                        this.notificationService.error(`Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private async addTagToEntry(entry: IObsidianMemoryEntry): Promise<void> {
                const tag = await this.quickInputService.input({
                        prompt: 'Add tag',
                        placeHolder: 'e.g., "important"',
                });
                if (!tag) { return; }

                const newTags = [...entry.tags, tag.trim().toLowerCase()];
                try {
                        await this.obsidianMemory.updateMemory(entry.id, { tags: newTags });
                        this.notificationService.info(`Tag "${tag}" added to "${entry.title}"`);
                        this.refresh();
                } catch (error) {
                        this.notificationService.error(`Failed to add tag: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private focusSearch(): void {
                this.searchBox.focus();
        }

        private async importMemories(): Promise<void> {
                const formatPick = await this.quickInputService.pick(
                        [
                                { label: 'JSON', description: 'Import from JSON format' },
                                { label: 'Markdown', description: 'Import from Markdown with YAML frontmatter' },
                        ],
                        { placeHolder: 'Select import format' },
                );
                if (!formatPick) { return; }

                const content = await this.quickInputService.input({
                        prompt: `Paste ${formatPick.label} content to import`,
                        placeHolder: 'Paste your content here...',
                });
                if (!content) { return; }

                try {
                        let count: number;
                        if (formatPick.label === 'JSON') {
                                count = await this.obsidianMemory.importFromJson(content);
                        } else {
                                count = await this.obsidianMemory.importFromMarkdown(content);
                        }
                        this.notificationService.info(`Imported ${count} memories`);
                        this.refresh();
                } catch (error) {
                        this.notificationService.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private async exportMemories(): Promise<void> {
                const formatPick = await this.quickInputService.pick(
                        [
                                { label: 'JSON', description: 'Export as JSON format' },
                                { label: 'Markdown', description: 'Export as Markdown with YAML frontmatter' },
                        ],
                        { placeHolder: 'Select export format' },
                );
                if (!formatPick) { return; }

                try {
                        let output: string;
                        if (formatPick.label === 'JSON') {
                                output = await this.obsidianMemory.exportToJson();
                        } else {
                                output = await this.obsidianMemory.exportToMarkdown();
                        }

                        // Copy to clipboard
                        await this.copyToClipboard(output);
                        const stats = this.obsidianMemory.getStats();
                        this.notificationService.info(`Exported ${stats.totalEntries} memories to clipboard (${formatPick.label})`);
                } catch (error) {
                        this.notificationService.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private async copyToClipboard(text: string): Promise<void> {
                try {
                        await navigator.clipboard.writeText(text);
                } catch {
                        // Fallback — ignore
                }
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
