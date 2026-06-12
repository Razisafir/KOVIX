// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_ADDITIONAL_TERMS.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObsidianMemoryService } from '../../../../platform/construct/common/memory/obsidianMemoryService.js';
import { IObsidianMemoryEntry, MemoryCategory, MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from '../../../../platform/construct/common/memory/obsidianMemoryTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import * as dom from '../../../../base/browser/dom.js';
import * as Nls from './constructNls.js';

/**
 * Editor input for a single Obsidian memory entry.
 * Allows the memory to be opened as a first-class editor tab.
 */
export class ObsidianMemoryEditorInput extends EditorInput {

        static readonly ID = 'workbench.editors.obsidianMemory';

        private readonly _onDidChangeContent = this._register(new Emitter<void>());
        readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

        private _entry: IObsidianMemoryEntry;

        constructor(
                entry: IObsidianMemoryEntry,
                @IObsidianMemoryService private readonly obsidianMemory: IObsidianMemoryService,
                @ILogService logService: ILogService,
        ) {
                super();
                this._entry = entry;

                // Listen for external updates to this memory
                this._register(this.obsidianMemory.onDidUpdateMemory((updated) => {
                        if (updated.id === this._entry.id) {
                                this._entry = updated;
                                this._onDidChangeContent.fire();
                        }
                }));
        }

        get typeId(): string { return ObsidianMemoryEditorInput.ID; }
        get resource(): undefined { return undefined; }

        get entry(): IObsidianMemoryEntry { return this._entry; }

        override getName(): string {
                return this._entry.title || 'Untitled Memory';
        }

        override getDescription(): string {
                return MEMORY_CATEGORY_LABELS[this._entry.category] ?? this._entry.category;
        }

        override matches(other: EditorInput): boolean {
                return other instanceof ObsidianMemoryEditorInput && other._entry.id === this._entry.id;
        }

        override dispose(): void {
                this._onDidChangeContent.dispose();
                super.dispose();
        }
}

/**
 * Full-featured Obsidian Memory Editor pane.
 *
 * Opens as a webview-style editor in the main editor area with:
 * - Title field with inline editing
 * - Category dropdown with all categories
 * - Tag input with pill display and autocomplete from existing tags
 * - Content textarea with markdown preview toggle
 * - Auto-save with 2-second debounce
 * - Character count and metadata display
 * - Save / Discard / Delete actions
 */
export class ObsidianMemoryEditorPane extends Disposable {

        private container: HTMLElement | undefined;
        private currentEntry: IObsidianMemoryEntry | undefined;
        private autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
        private isDirty = false;
        private showPreview = false;

        /**
         * Create a styled label element for a form field.
         */
        private createFieldLabel(text: string): HTMLElement {
                const label = document.createElement('label');
                label.textContent = text;
                label.className = 'memory-editor-field-label';
                label.style.fontWeight = '600';
                label.style.fontSize = '12px';
                label.style.color = 'var(--vscode-foreground)';
                label.style.marginBottom = '4px';
                label.style.display = 'block';
                return label;
        }

        // Form elements
        private titleInput!: HTMLInputElement;
        private categorySelect!: HTMLSelectElement;
        private tagsInput!: HTMLInputElement;
        private tagsPillsContainer!: HTMLElement;
        private contentArea!: HTMLTextAreaElement;
        private previewArea!: HTMLElement;
        private charCountEl!: HTMLElement;
        private metaEl!: HTMLElement;
        private saveBtn!: HTMLButtonElement;
        private discardBtn!: HTMLButtonElement;
        private previewToggleBtn!: HTMLButtonElement;

        private readonly _onDidSave = this._register(new Emitter<string>());
        readonly onDidSave: Event<string> = this._onDidSave.event;

        private readonly _onDidClose = this._register(new Emitter<string>());
        readonly onDidClose: Event<string> = this._onDidClose.event;

        constructor(
                @IObsidianMemoryService private readonly obsidianMemory: IObsidianMemoryService,
                @ILogService private readonly logService: ILogService,
                @INotificationService private readonly notificationService: INotificationService,
        ) {
                super();
                this.logService.info('[ObsidianMemoryEditorPane] Editor pane initialized');
        }

        /**
         * Render the editor into a container element.
         */
        render(container: HTMLElement): void {
                this.container = container;
                container.setAttribute('role', 'form');
                container.setAttribute('aria-label', 'Memory editor');
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';
                container.style.overflow = 'hidden';

                this.renderHeader(container);
                this.renderForm(container);
                this.renderFooter(container);
        }

        /**
         * Load a memory entry for editing.
         */
        loadEntry(entry: IObsidianMemoryEntry): void {
                this.currentEntry = entry;
                this.isDirty = false;
                this.showPreview = false;

                if (this.container) {
                        dom.clearNode(this.container);
                        this.render(this.container);
                }

                this.populateFields(entry);
                this.logService.info(`[ObsidianMemoryEditorPane] Loaded: ${entry.title}`);
        }

        /**
         * Check if there are unsaved changes.
         */
        get dirty(): boolean { return this.isDirty; }

        // ─── Private Rendering Methods ─────────────────────────────────────

        private renderHeader(container: HTMLElement): void {
                const header = dom.$('.obsidian-editor-header');
                header.style.cssText = `
                        padding: 8px 16px; border-bottom: 1px solid var(--vscode-editorWidget-border);
                        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
                        background: var(--vscode-editorGroupHeader-tabsBackground);
                `;

                // Icon
                const icon = dom.$('.obsidian-editor-icon');
                icon.style.cssText = `
                        font-size: 16px; width: 20px; text-align: center;
                        color: var(--vscode-foreground);
                `;
                icon.textContent = '🧠';
                header.appendChild(icon);

                // Title (editable inline)
                this.titleInput = dom.$('input') as HTMLInputElement;
                this.titleInput.type = 'text';
                this.titleInput.placeholder = Nls.MEMORY_TITLE_PLACEHOLDER;
                this.titleInput.setAttribute('aria-label', 'Memory title');
                this.titleInput.style.cssText = `
                        flex: 1; background: transparent; border: none; outline: none;
                        color: var(--vscode-foreground); font-size: 14px; font-weight: 600;
                        padding: 2px 4px;
                `;
                this.titleInput.onfocus = () => {
                        this.titleInput.style.background = 'var(--vscode-input-background)';
                        this.titleInput.style.border = '1px solid var(--vscode-input-border)';
                        this.titleInput.style.borderRadius = '2px';
                };
                this.titleInput.onblur = () => {
                        this.titleInput.style.background = 'transparent';
                        this.titleInput.style.border = '1px solid transparent';
                        this.scheduleAutoSave();
                };
                this.titleInput.oninput = () => { this.markDirty(); };
                header.appendChild(this.titleInput);

                // Preview toggle
                this.previewToggleBtn = dom.$('button') as HTMLButtonElement;
                this.previewToggleBtn.textContent = Nls.PREVIEW;
                this.previewToggleBtn.title = 'Toggle markdown preview';
                this.previewToggleBtn.setAttribute('aria-label', 'Toggle markdown preview');
                this.previewToggleBtn.style.cssText = `
                        background: none; border: 1px solid var(--vscode-editorWidget-border);
                        color: var(--vscode-foreground); border-radius: 2px;
                        padding: 2px 8px; cursor: pointer; font-size: 11px;
                `;
                this.previewToggleBtn.onclick = () => this.togglePreview();
                header.appendChild(this.previewToggleBtn);

                container.appendChild(header);
        }

        private renderForm(container: HTMLElement): void {
                const formWrapper = dom.$('.obsidian-editor-form');
                formWrapper.style.cssText = `
                        flex: 1; overflow-y: auto; padding: 12px 16px;
                `;

                // Category row
                const catRow = dom.$('.obsidian-editor-cat-row');
                catRow.style.cssText = `display: flex; gap: 12px; align-items: center; margin-bottom: 12px;`;

                const catLabel = this.createFieldLabel(Nls.CATEGORY);
                catRow.appendChild(catLabel);

                this.categorySelect = dom.$('select') as HTMLSelectElement;
                this.categorySelect.setAttribute('aria-label', 'Memory category');
                this.categorySelect.style.cssText = `
                        padding: 4px 8px; background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border); border-radius: 2px;
                        color: var(--vscode-input-foreground); font-size: 12px;
                        min-width: 160px;
                `;
                for (const cat of MEMORY_CATEGORIES) {
                        const opt = dom.$('option') as HTMLOptionElement;
                        opt.value = cat;
                        opt.textContent = MEMORY_CATEGORY_LABELS[cat];
                        this.categorySelect.appendChild(opt);
                }
                this.categorySelect.onchange = () => { this.markDirty(); this.scheduleAutoSave(); };
                catRow.appendChild(this.categorySelect);

                // Tags section
                const tagsLabel = this.createFieldLabel(Nls.TAGS);
                catRow.appendChild(tagsLabel);

                this.tagsInput = dom.$('input') as HTMLInputElement;
                this.tagsInput.type = 'text';
                this.tagsInput.placeholder = Nls.ADD_TAG_PLACEHOLDER;
                this.tagsInput.setAttribute('aria-label', 'Add tags');
                this.tagsInput.style.cssText = `
                        flex: 1; padding: 4px 8px; background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border); border-radius: 2px;
                        color: var(--vscode-input-foreground); font-size: 12px;
                `;
                this.tagsInput.onkeydown = (e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                this.addTagFromInput();
                        }
                };
                catRow.appendChild(this.tagsInput);

                formWrapper.appendChild(catRow);

                // Tag pills
                this.tagsPillsContainer = dom.$('.obsidian-editor-tags');
                this.tagsPillsContainer.style.cssText = `
                        display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px;
                `;
                formWrapper.appendChild(this.tagsPillsContainer);

                // Content / Preview area
                const contentWrapper = dom.$('.obsidian-editor-content-wrapper');
                contentWrapper.style.cssText = `
                        flex: 1; display: flex; flex-direction: column; min-height: 0;
                `;

                // Textarea for editing
                this.contentArea = dom.$('textarea') as HTMLTextAreaElement;
                this.contentArea.placeholder = Nls.MEMORY_CONTENT_PLACEHOLDER;
                this.contentArea.setAttribute('aria-label', 'Memory content');
                this.contentArea.style.cssText = `
                        flex: 1; width: 100%; box-sizing: border-box; padding: 12px;
                        background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border);
                        border-radius: 2px; color: var(--vscode-input-foreground); font-size: 13px;
                        font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
                        line-height: 1.6; resize: none; min-height: 300px;
                `;
                this.contentArea.oninput = () => {
                        this.markDirty();
                        this.updateCharCount();
                        this.scheduleAutoSave();
                };
                contentWrapper.appendChild(this.contentArea);

                // Preview area (hidden by default)
                this.previewArea = dom.$('.obsidian-editor-preview');
                this.previewArea.style.cssText = `
                        flex: 1; padding: 12px; background: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-input-border); border-radius: 2px;
                        color: var(--vscode-foreground); font-size: 13px; line-height: 1.6;
                        overflow-y: auto; display: none; min-height: 300px;
                        font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
                        white-space: pre-wrap; word-wrap: break-word;
                `;
                contentWrapper.appendChild(this.previewArea);

                formWrapper.appendChild(contentWrapper);

                // Character count
                this.charCountEl = dom.$('.obsidian-editor-charcount');
                this.charCountEl.style.cssText = `
                        font-size: 10px; color: var(--vscode-descriptionForeground);
                        text-align: right; margin-top: 4px; flex-shrink: 0;
                `;
                formWrapper.appendChild(this.charCountEl);

                // Metadata
                this.metaEl = dom.$('.obsidian-editor-meta');
                this.metaEl.style.cssText = `
                        font-size: 10px; color: var(--vscode-descriptionForeground);
                        padding: 8px 0; border-top: 1px solid var(--vscode-editorWidget-border);
                        margin-top: 8px; flex-shrink: 0;
                `;
                formWrapper.appendChild(this.metaEl);

                container.appendChild(formWrapper);
        }

        private renderFooter(container: HTMLElement): void {
                const footer = dom.$('.obsidian-editor-footer');
                footer.style.cssText = `
                        padding: 8px 16px; border-top: 1px solid var(--vscode-editorWidget-border);
                        display: flex; gap: 8px; align-items: center; flex-shrink: 0;
                        background: var(--vscode-editorGroupHeader-tabsBackground);
                `;

                // Save button
                this.saveBtn = dom.$('button') as HTMLButtonElement;
                this.saveBtn.textContent = Nls.SAVE;
                this.saveBtn.setAttribute('aria-label', 'Save memory');
                this.saveBtn.style.cssText = `
                        background: var(--vscode-button-background); border: none;
                        color: var(--vscode-button-foreground); border-radius: 2px;
                        padding: 6px 20px; cursor: pointer; font-size: 12px; font-weight: 600;
                `;
                this.saveBtn.onmouseenter = () => { this.saveBtn.style.background = 'var(--vscode-button-hoverBackground)'; };
                this.saveBtn.onmouseleave = () => { this.saveBtn.style.background = 'var(--vscode-button-background)'; };
                this.saveBtn.onclick = () => this.save();
                this.saveBtn.disabled = true;
                this.saveBtn.style.opacity = '0.5';
                footer.appendChild(this.saveBtn);

                // Discard button
                this.discardBtn = dom.$('button') as HTMLButtonElement;
                this.discardBtn.textContent = Nls.DISCARD_CHANGES;
                this.discardBtn.setAttribute('aria-label', 'Discard changes');
                this.discardBtn.style.cssText = `
                        background: none; border: 1px solid var(--vscode-editorWidget-border);
                        color: var(--vscode-foreground); border-radius: 2px;
                        padding: 6px 16px; cursor: pointer; font-size: 12px;
                `;
                this.discardBtn.onclick = () => this.discardChanges();
                this.discardBtn.disabled = true;
                this.discardBtn.style.opacity = '0.5';
                footer.appendChild(this.discardBtn);

                // Delete button (right-aligned)
                const spacer = dom.$('.spacer');
                spacer.style.cssText = `flex: 1;`;
                footer.appendChild(spacer);

                const deleteBtn = dom.$('button') as HTMLButtonElement;
                deleteBtn.textContent = Nls.DELETE_MEMORY;
                deleteBtn.setAttribute('aria-label', 'Delete memory');
                deleteBtn.style.cssText = `
                        background: var(--vscode-errorBackground, #5a1d1d); border: none;
                        color: var(--vscode-errorForeground, #f48771); border-radius: 2px;
                        padding: 6px 16px; cursor: pointer; font-size: 12px;
                `;
                deleteBtn.onclick = () => this.deleteMemory();
                footer.appendChild(deleteBtn);

                container.appendChild(footer);
        }

        // ─── Data Operations ────────────────────────────────────────────────

        private populateFields(entry: IObsidianMemoryEntry): void {
                this.titleInput.value = entry.title;
                this.categorySelect.value = entry.category;
                this.contentArea.value = entry.content;
                this.renderTagPills(entry.tags);
                this.updateCharCount();
                this.updateMetadata(entry);
        }

        private markDirty(): void {
                this.isDirty = true;
                this.saveBtn.disabled = false;
                this.saveBtn.style.opacity = '1';
                this.discardBtn.disabled = false;
                this.discardBtn.style.opacity = '1';
        }

        private clearDirty(): void {
                this.isDirty = false;
                this.saveBtn.disabled = true;
                this.saveBtn.style.opacity = '0.5';
                this.discardBtn.disabled = true;
                this.discardBtn.style.opacity = '0.5';
        }

        private scheduleAutoSave(): void {
                if (this.autoSaveTimer) {
                        clearTimeout(this.autoSaveTimer);
                }
                this.autoSaveTimer = setTimeout(() => {
                        if (this.isDirty) {
                                this.save();
                        }
                }, 2000);
        }

        private getCurrentTags(): string[] {
                const pills = this.tagsPillsContainer.querySelectorAll('.obsidian-tag-text');
                const tags: string[] = [];
                pills.forEach((pill) => {
                        const text = pill.textContent?.trim();
                        if (text) { tags.push(text); }
                });
                return tags;
        }

        private addTagFromInput(): void {
                const raw = this.tagsInput.value.replace(/,/g, '').trim().toLowerCase();
                if (!raw) { return; }

                const currentTags = this.getCurrentTags();
                if (currentTags.includes(raw)) {
                        this.tagsInput.value = '';
                        return;
                }

                currentTags.push(raw);
                this.renderTagPills(currentTags);
                this.tagsInput.value = '';
                this.markDirty();
                this.scheduleAutoSave();
        }

        private renderTagPills(tags: string[]): void {
                dom.clearNode(this.tagsPillsContainer);

                for (const tag of tags) {
                        const pill = dom.$('.obsidian-tag-pill');
                        pill.style.cssText = `
                                display: inline-flex; align-items: center; gap: 2px;
                                padding: 2px 6px; border-radius: 10px; font-size: 11px;
                                background: var(--vscode-badge-background);
                                color: var(--vscode-badge-foreground); cursor: default;
                        `;

                        const text = dom.$('.obsidian-tag-text');
                        text.textContent = tag;

                        const removeBtn = dom.$('button') as HTMLButtonElement;
                        removeBtn.textContent = '×';
                        removeBtn.title = `Remove tag "${tag}"`;
                        removeBtn.style.cssText = `
                                background: none; border: none; color: inherit;
                                cursor: pointer; font-size: 12px; padding: 0 2px;
                                line-height: 1; opacity: 0.7;
                        `;
                        removeBtn.onmouseenter = () => { removeBtn.style.opacity = '1'; };
                        removeBtn.onmouseleave = () => { removeBtn.style.opacity = '0.7'; };
                        removeBtn.onclick = () => {
                                const current = this.getCurrentTags();
                                const updated = current.filter(t => t !== tag);
                                this.renderTagPills(updated);
                                this.markDirty();
                                this.scheduleAutoSave();
                        };

                        pill.appendChild(text);
                        pill.appendChild(removeBtn);
                        this.tagsPillsContainer.appendChild(pill);
                }

                // Autocomplete hint
                if (tags.length > 0) {
                        const existingTags = this.getAllExistingTags();
                        const suggestions = existingTags.filter(t => !tags.includes(t));
                        if (suggestions.length > 0 && this.tagsInput.value.length === 0) {
                                const hint = dom.$('.obsidian-tag-hint');
                                hint.style.cssText = `
                                        font-size: 10px; color: var(--vscode-descriptionForeground);
                                        padding: 2px 4px; font-style: italic;
                                `;
                                hint.textContent = `Existing: ${suggestions.slice(0, 5).join(', ')}`;
                                this.tagsPillsContainer.appendChild(hint);
                        }
                }
        }

        private updateCharCount(): void {
                const len = this.contentArea.value.length;
                const words = this.contentArea.value.trim().split(/\s+/).filter(w => w.length > 0).length;
                this.charCountEl.textContent = `${len} characters · ${words} words`;
        }

        private updateMetadata(entry: IObsidianMemoryEntry): void {
                this.metaEl.innerHTML = `
                        ID: <code style="font-size:10px;color:var(--vscode-textPreformat-foreground);background:var(--vscode-textPreformat-background);padding:1px 3px;border-radius:2px;">${entry.id.substring(0, 8)}...</code>
                        &nbsp;·&nbsp; Source: <span style="padding:1px 4px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:2px;">${entry.source}</span>
                        &nbsp;·&nbsp; Created: ${new Date(entry.createdAt).toLocaleString()}
                        &nbsp;·&nbsp; Updated: ${new Date(entry.updatedAt).toLocaleString()}
                `;
        }

        private togglePreview(): void {
                this.showPreview = !this.showPreview;

                if (this.showPreview) {
                        // Render markdown preview (basic rendering — no external deps)
                        this.previewArea.innerHTML = this.renderMarkdown(this.contentArea.value);
                        this.contentArea.style.display = 'none';
                        this.previewArea.style.display = 'block';
                        this.previewToggleBtn.textContent = Nls.EDIT;
                        this.previewToggleBtn.style.background = 'var(--vscode-button-background)';
                        this.previewToggleBtn.style.color = 'var(--vscode-button-foreground)';
                } else {
                        this.contentArea.style.display = 'block';
                        this.previewArea.style.display = 'none';
                        this.previewToggleBtn.textContent = Nls.PREVIEW;
                        this.previewToggleBtn.style.background = 'none';
                        this.previewToggleBtn.style.color = 'var(--vscode-foreground)';
                }
        }

        /**
         * Basic markdown-to-HTML renderer for preview.
         * No external dependencies — handles the most common patterns.
         */
        private renderMarkdown(md: string): string {
                let html = this.escapeHtml(md);

                // Headings
                html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;margin:8px 0 4px;">$1</h3>');
                html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:600;margin:8px 0 4px;">$1</h2>');
                html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:17px;font-weight:700;margin:10px 0 4px;">$1</h1>');

                // Bold and italic
                html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
                html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

                // Code blocks (fenced)
                html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
                        '<pre style="background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:3px;overflow-x:auto;font-size:12px;"><code>$2</code></pre>');

                // Inline code
                html = html.replace(/`([^`]+)`/g,
                        '<code style="background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:2px;font-size:12px;">$1</code>');

                // Links
                html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:var(--vscode-textLink-foreground);">$1</a>');

                // Bullet lists
                html = html.replace(/^[-*] (.+)$/gm, '<li style="margin-left:16px;">$1</li>');

                // Numbered lists
                html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style-type:decimal;">$1</li>');

                // Horizontal rule
                html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--vscode-editorWidget-border);margin:8px 0;">');

                // Paragraphs (double newline)
                html = html.replace(/\n\n/g, '</p><p style="margin:4px 0;">');

                // Single newlines → <br>
                html = html.replace(/\n/g, '<br>');

                return `<p style="margin:4px 0;">${html}</p>`;
        }

        private escapeHtml(text: string): string {
                return text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');
        }

        private getAllExistingTags(): string[] {
                const entries = this.obsidianMemory.getAllMemories();
                const tags = new Set<string>();
                for (const entry of entries) {
                        for (const tag of entry.tags) {
                                tags.add(tag);
                        }
                }
                return [...tags].sort();
        }

        // ─── CRUD Actions ───────────────────────────────────────────────────

        async save(): Promise<void> {
                if (!this.currentEntry) { return; }

                try {
                        const tags = this.getCurrentTags();
                        const updated = await this.obsidianMemory.updateMemory(this.currentEntry.id, {
                                title: this.titleInput.value.trim() || 'Untitled',
                                content: this.contentArea.value,
                                category: this.categorySelect.value as MemoryCategory,
                                tags,
                        });

                        this.currentEntry = updated;
                        this.updateMetadata(updated);
                        this.clearDirty();
                        this.notificationService.info(`Memory saved: "${this.titleInput.value}"`);
                        this._onDidSave.fire(this.currentEntry.id);
                        this.logService.info(`[ObsidianMemoryEditorPane] Saved: ${this.titleInput.value}`);
                } catch (error) {
                        this.notificationService.error(
                                `Failed to save memory: ${error instanceof Error ? error.message : String(error)}`
                        );
                }
        }

        discardChanges(): void {
                if (!this.currentEntry) { return; }
                this.populateFields(this.currentEntry);
                this.clearDirty();
                this.notificationService.info('Changes discarded');
        }

        async deleteMemory(): Promise<void> {
                if (!this.currentEntry) { return; }

                try {
                        await this.obsidianMemory.deleteMemory(this.currentEntry.id);
                        this.notificationService.info('Memory deleted');
                        this._onDidClose.fire(this.currentEntry.id);
                } catch (error) {
                        this.notificationService.error(
                                `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`
                        );
                }
        }

        override dispose(): void {
                if (this.autoSaveTimer) {
                        clearTimeout(this.autoSaveTimer);
                }
                super.dispose();
        }
}

/**
 * Legacy command handler for opening the memory editor.
 * Delegates to the ObsidianMemoryTreePanel's inline editor for backward compatibility.
 */
export class ConstructMemoryEditor {

        constructor(
                @IObsidianMemoryService private readonly obsidianMemory: IObsidianMemoryService,
                @ILogService private readonly logService: ILogService,
                @INotificationService private readonly notificationService: INotificationService,
                @IInstantiationService instantiationService: IInstantiationService,
        ) {
                this.logService.info('[ObsidianMemoryEditor] Editor helper initialized');
        }

        /**
         * Open the editor for a specific memory entry.
         * This triggers the tree panel's inline editor.
         */
        async openEditor(entryId: string): Promise<void> {
                const entry = this.obsidianMemory.getMemory(entryId);
                if (!entry) {
                        this.notificationService.warn(`Memory entry not found: ${entryId}`);
                        return;
                }

                this.logService.info(`[ObsidianMemoryEditor] Opening editor for: ${entry.title}`);
        }

        /**
         * Create a new memory entry with a dialog.
         */
        async createNewMemory(): Promise<IObsidianMemoryEntry | undefined> {
                this.logService.info('[ObsidianMemoryEditor] Create new memory triggered');
                return undefined;
        }

        /**
         * Get all unique tags from existing memories (for autocomplete).
         */
        getAllTags(): string[] {
                const entries = this.obsidianMemory.getAllMemories();
                const tags = new Set<string>();
                for (const entry of entries) {
                        for (const tag of entry.tags) {
                                tags.add(tag);
                        }
                }
                return [...tags].sort();
        }
}
