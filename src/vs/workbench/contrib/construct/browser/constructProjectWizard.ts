// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import * as dom from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { IConstructProjectService } from '../../../../platform/construct/common/project/constructProjectService.js';
import { IProjectCreationInput } from '../../../../platform/construct/common/project/constructProjectTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as Nls from './constructNls.js';

// ─── Theme constants (consistent with agent view) ────────────────────────────

const COLORS = {
        bg: '#0D1117',
        text: '#E0E7FF',
        accent: '#00E5FF',
        border: '#1A1F2E',
        dimText: '#8B949E',
        inputBg: '#0A0E1A',
        inputBorder: '#1A1F2E',
        inputFocusBorder: '#00E5FF',
        chipSelectedBg: 'rgba(0, 229, 255, 0.12)',
        chipSelectedBorder: '#00E5FF',
        chipUnselectedBg: 'transparent',
        chipUnselectedBorder: '#1A1F2E',
        dangerText: '#F85149',
        successAccent: '#00C853',
};

const STEP_COUNT = 4;

const STEP_TITLES: string[] = [
        Nls.STEP_NAME_PROJECT,
        Nls.STEP_DESCRIBE_IDEA,
        Nls.STEP_TECH_STACK,
        Nls.STEP_SUCCESS_CRITERIA,
];

const STEP_SUBTITLES: string[] = [
        Nls.STEP_SUBTITLE_NAME,
        Nls.STEP_SUBTITLE_DESCRIBE,
        Nls.STEP_SUBTITLE_TECH,
        Nls.STEP_SUBTITLE_GOALS,
];

// ─── Wizard ──────────────────────────────────────────────────────────────────

export class ConstructProjectWizard extends Disposable {

        // ── State ─────────────────────────────────────────────────────────────

        private currentStep = 1;
        private projectName = '';
        private projectDescription = '';
        private techStack: string[] = [];
        private goals: string[] = [];
        private suggestedTech: string[] = [];

        // ── DOM references ────────────────────────────────────────────────────

        private container: HTMLElement | null = null;
        private _overlayElement: HTMLElement | null = null;
        private indicatorContainer: HTMLElement | null = null;
        private contentContainer: HTMLElement | null = null;
        private _navContainer: HTMLElement | null = null;
        private previousButton: HTMLButtonElement | null = null;
        private nextButton: HTMLButtonElement | null = null;
        private createButton: HTMLButtonElement | null = null;
        private techSuggestionsContainer: HTMLElement | null = null;

        /**
         * Step-specific event listeners that are recreated on every step change.
         * Cleared via `stepDisposables.clear()` before rendering a new step.
         */
        private readonly stepDisposables = this._register(new DisposableStore());

        // ── Events ────────────────────────────────────────────────────────────

        private readonly _onDidCreateProject = this._register(new Emitter<void>());
        readonly onDidCreateProject = this._onDidCreateProject.event;

        // ── Constructor (DI) ──────────────────────────────────────────────────

        constructor(
                @IConstructProjectService private readonly projectService: IConstructProjectService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IFileService private readonly fileService: IFileService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                // Suppress TS6133 — these DOM references are placeholders for future cleanup/updates
                void this._overlayElement;
                void this._navContainer;
        }

        // ── Public API ────────────────────────────────────────────────────────

        /**
         * Show the project wizard. Opens the construct panel and renders
         * the wizard overlay inside it.
         */
        async show(): Promise<void> {
                // The wizard is rendered inside the construct agent panel.
                // The agent view will call render(container) when it's ready.
                // For command-palette invocation, we signal readiness.
        }

        render(container: HTMLElement): void {
                this.container = container;
                dom.clearNode(container);

                // Create the full-size overlay inside the agent panel
                const overlay = dom.$('div.construct-project-wizard-overlay');
                overlay.setAttribute('role', 'dialog');
                overlay.setAttribute('aria-modal', 'true');
                overlay.setAttribute('aria-label', 'Project creation wizard');
                overlay.style.cssText = [
                        'position: absolute',
                        'top: 0; left: 0; right: 0; bottom: 0',
                        `background: ${COLORS.bg}`,
                        'display: flex',
                        'flex-direction: column',
                        'z-index: 1000',
                        'overflow: hidden',
                        "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
                ].join('; ');
                container.style.position = 'relative';
                container.appendChild(overlay);
                this._overlayElement = overlay;

                // Render the three main sections
                this.renderStepIndicator(overlay);
                this.renderContentArea(overlay);
                this.renderNavBar(overlay);

                // Populate current step content
                this.refreshContent();

                // Kick off async workspace tech detection
                this.detectTechStack();
        }

        override dispose(): void {
                this.container = null;
                this._overlayElement = null;
                this.indicatorContainer = null;
                this.contentContainer = null;
                this._navContainer = null;
                this.previousButton = null;
                this.nextButton = null;
                this.createButton = null;
                this.techSuggestionsContainer = null;
                super.dispose();
        }

        // ── Tech-stack detection from workspace files ─────────────────────────

        private async detectTechStack(): Promise<void> {
                try {
                        const workspace = this.workspaceContextService.getWorkspace();
                        const rootFolder = workspace.folders[0];
                        if (!rootFolder) {
                                return;
                        }
                        const rootUri = rootFolder.uri;

                        const checks: Array<{ fileName: string; techs: string[] }> = [
                                { fileName: 'package.json', techs: ['Node.js', 'TypeScript', 'JavaScript'] },
                                { fileName: 'requirements.txt', techs: ['Python'] },
                                { fileName: 'pyproject.toml', techs: ['Python'] },
                                { fileName: 'Cargo.toml', techs: ['Rust'] },
                                { fileName: 'go.mod', techs: ['Go'] },
                                { fileName: 'pom.xml', techs: ['Java'] },
                                { fileName: 'build.gradle', techs: ['Java'] },
                                { fileName: 'Gemfile', techs: ['Ruby'] },
                                { fileName: 'composer.json', techs: ['PHP'] },
                        ];

                        const detected: string[] = [];
                        for (const check of checks) {
                                const fileUri = URI.joinPath(rootUri, check.fileName);
                                try {
                                        const exists = await this.fileService.exists(fileUri);
                                        if (exists) {
                                                for (const tech of check.techs) {
                                                        if (!detected.includes(tech)) {
                                                                detected.push(tech);
                                                        }
                                                }
                                        }
                                } catch {
                                        // File not accessible — skip silently
                                }
                        }

                        this.suggestedTech = detected;

                        // If we're currently on the tech-stack step, update the suggestions UI
                        if (this.currentStep === 3 && this.techSuggestionsContainer) {
                                this.renderTechSuggestions(this.techSuggestionsContainer);
                        }
                } catch (e) {
                        this.logService.error('[ConstructProjectWizard] Failed to detect tech stack', e);
                }
        }

        // ── Step indicator (circles + title) ──────────────────────────────────

        private renderStepIndicator(parent: HTMLElement): void {
                const wrapper = dom.$('div.construct-wizard-indicator');
                wrapper.style.cssText = [
                        'padding: 20px 24px 12px',
                        'display: flex',
                        'flex-direction: column',
                        'align-items: center',
                        'flex-shrink: 0',
                ].join('; ');
                parent.appendChild(wrapper);
                this.indicatorContainer = wrapper;

                this.refreshIndicator();
        }

        private refreshIndicator(): void {
                if (!this.indicatorContainer) { return; }
                dom.clearNode(this.indicatorContainer);

                // Circles row
                const circlesRow = dom.$('div');
                circlesRow.style.cssText = 'display: flex; align-items: center; gap: 0; margin-bottom: 12px;';

                for (let i = 1; i <= STEP_COUNT; i++) {
                        const isCompleted = i < this.currentStep;
                        const isCurrent = i === this.currentStep;

                        const circle = dom.$('div');
                        const size = isCurrent ? 14 : 10;
                        circle.style.cssText = [
                                `width: ${size}px`,
                                `height: ${size}px`,
                                'border-radius: 50%',
                                'display: flex',
                                'align-items: center',
                                'justify-content: center',
                                'flex-shrink: 0',
                                'transition: all 0.2s ease',
                                isCurrent
                                        ? `background: ${COLORS.accent}; box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);`
                                        : isCompleted
                                                ? `background: ${COLORS.accent};`
                                                : `background: transparent; border: 2px solid ${COLORS.border};`,
                        ].join('; ');

                        if (isCompleted) {
                                const check = dom.$('span');
                                check.style.cssText = `color: ${COLORS.bg}; font-size: 8px; font-weight: 700; line-height: 1;`;
                                check.textContent = '\u2713'; // ✓
                                circle.appendChild(check);
                        }

                        circlesRow.appendChild(circle);

                        // Connector line between circles
                        if (i < STEP_COUNT) {
                                const line = dom.$('div');
                                const lineFilled = i < this.currentStep;
                                line.style.cssText = [
                                        'width: 40px',
                                        'height: 2px',
                                        'flex-shrink: 0',
                                        'transition: background 0.2s ease',
                                        lineFilled ? `background: ${COLORS.accent};` : `background: ${COLORS.border};`,
                                ].join('; ');
                                circlesRow.appendChild(line);
                        }
                }

                this.indicatorContainer.appendChild(circlesRow);

                // Step title text
                const titleRow = dom.$('div');
                titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

                const stepLabel = dom.$('span');
                stepLabel.style.cssText = `color: ${COLORS.accent}; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;`;
                stepLabel.textContent = `Step ${this.currentStep} of ${STEP_COUNT}`;
                titleRow.appendChild(stepLabel);

                const separator = dom.$('span');
                separator.style.cssText = `color: ${COLORS.border}; font-size: 12px;`;
                separator.textContent = '\u2022'; // •
                titleRow.appendChild(separator);

                const titleLabel = dom.$('span');
                titleLabel.style.cssText = `color: ${COLORS.text}; font-size: 13px; font-weight: 500;`;
                titleLabel.textContent = STEP_TITLES[this.currentStep - 1];
                titleRow.appendChild(titleLabel);

                this.indicatorContainer.appendChild(titleRow);
        }

        // ── Content area (scrollable middle) ──────────────────────────────────

        private renderContentArea(parent: HTMLElement): void {
                const wrapper = dom.$('div.construct-wizard-content');
                wrapper.style.cssText = [
                        'flex: 1',
                        'overflow-y: auto',
                        'padding: 8px 32px 16px',
                        'display: flex',
                        'flex-direction: column',
                        'align-items: center',
                ].join('; ');
                parent.appendChild(wrapper);
                this.contentContainer = wrapper;
        }

        private refreshContent(): void {
                if (!this.contentContainer) { return; }
                this.stepDisposables.clear();
                dom.clearNode(this.contentContainer);

                // Max-width inner container for readability
                const inner = dom.$('div');
                inner.style.cssText = 'width: 100%; max-width: 560px; display: flex; flex-direction: column;';

                // Subtitle / helper text
                const subtitle = dom.$('div');
                subtitle.style.cssText = `color: ${COLORS.dimText}; font-size: 13px; margin-bottom: 20px; line-height: 1.5;`;
                subtitle.textContent = STEP_SUBTITLES[this.currentStep - 1];
                inner.appendChild(subtitle);

                // Render current step
                switch (this.currentStep) {
                        case 1: this.renderStep1(inner); break;
                        case 2: this.renderStep2(inner); break;
                        case 3: this.renderStep3(inner); break;
                        case 4: this.renderStep4(inner); break;
                }

                this.contentContainer.appendChild(inner);

                // Also refresh the indicator and nav buttons
                this.refreshIndicator();
                this.refreshNavButtons();
        }

        // ── Step 1: Name Your Project ─────────────────────────────────────────

        private renderStep1(parent: HTMLElement): void {
                const label = dom.$('label');
                label.style.cssText = `color: ${COLORS.text}; font-size: 13px; font-weight: 500; margin-bottom: 8px; display: block;`;
                label.textContent = Nls.PROJECT_NAME;
                parent.appendChild(label);

                const input = dom.$('input') as HTMLInputElement;
                input.type = 'text';
                input.maxLength = 80;
                input.value = this.projectName;
                input.placeholder = Nls.PROJECT_NAME_PLACEHOLDER;
                input.setAttribute('aria-label', 'Project Name');
                input.style.cssText = [
                        'width: 100%',
                        'box-sizing: border-box',
                        `background: ${COLORS.inputBg}`,
                        `border: 1px solid ${COLORS.inputBorder}`,
                        'border-radius: 8px',
                        'padding: 14px 16px',
                        `color: ${COLORS.text}`,
                        'font-size: 18px',
                        'font-weight: 500',
                        'outline: none',
                        'transition: border-color 0.15s ease',
                ].join('; ');

                this.stepDisposables.add(dom.addDisposableListener(input, dom.EventType.FOCUS, () => {
                        input.style.borderColor = COLORS.inputFocusBorder;
                }));
                this.stepDisposables.add(dom.addDisposableListener(input, dom.EventType.BLUR, () => {
                        input.style.borderColor = COLORS.inputBorder;
                }));
                this.stepDisposables.add(dom.addDisposableListener(input, dom.EventType.INPUT, () => {
                        this.projectName = input.value;
                        charCounter.textContent = `${this.projectName.length}/80`;
                        charCounter.style.color = this.projectName.length > 70 ? COLORS.dangerText : COLORS.dimText;
                        this.refreshNavButtons();
                }));
                this.stepDisposables.add(dom.addDisposableListener(input, dom.EventType.KEY_DOWN, (e) => {
                        if (e.key === 'Enter' && this.canAdvance()) {
                                this.goToStep(2);
                        }
                }));

                parent.appendChild(input);

                // Character counter
                const counterRow = dom.$('div');
                counterRow.style.cssText = 'display: flex; justify-content: space-between; margin-top: 6px;';

                const hint = dom.$('span');
                hint.style.cssText = `color: ${COLORS.dimText}; font-size: 11px;`;
                hint.textContent = Nls.PROJECT_NAME_HINT;
                counterRow.appendChild(hint);

                const charCounter = dom.$('span');
                charCounter.style.cssText = `color: ${COLORS.dimText}; font-size: 11px;`;
                charCounter.textContent = `${this.projectName.length}/80`;
                counterRow.appendChild(charCounter);

                parent.appendChild(counterRow);

                // Auto-focus
                setTimeout(() => input.focus(), 50);
        }

        // ── Step 2: Describe Your Idea ────────────────────────────────────────

        private renderStep2(parent: HTMLElement): void {
                const label = dom.$('label');
                label.style.cssText = `color: ${COLORS.text}; font-size: 13px; font-weight: 500; margin-bottom: 8px; display: block;`;
                label.textContent = Nls.PROJECT_DESCRIPTION;
                parent.appendChild(label);

                const textarea = dom.$('textarea') as HTMLTextAreaElement;
                textarea.value = this.projectDescription;
                textarea.placeholder = Nls.PROJECT_DESCRIPTION_PLACEHOLDER;
                textarea.rows = 8;
                textarea.setAttribute('aria-label', 'Project Description');
                textarea.style.cssText = [
                        'width: 100%',
                        'box-sizing: border-box',
                        `background: ${COLORS.inputBg}`,
                        `border: 1px solid ${COLORS.inputBorder}`,
                        'border-radius: 8px',
                        'padding: 14px 16px',
                        `color: ${COLORS.text}`,
                        'font-size: 14px',
                        'line-height: 1.6',
                        'outline: none',
                        'resize: vertical',
                        'min-height: 160px',
                        'font-family: inherit',
                        'transition: border-color 0.15s ease',
                ].join('; ');

                this.stepDisposables.add(dom.addDisposableListener(textarea, dom.EventType.FOCUS, () => {
                        textarea.style.borderColor = COLORS.inputFocusBorder;
                }));
                this.stepDisposables.add(dom.addDisposableListener(textarea, dom.EventType.BLUR, () => {
                        textarea.style.borderColor = COLORS.inputBorder;
                }));
                this.stepDisposables.add(dom.addDisposableListener(textarea, dom.EventType.INPUT, () => {
                        this.projectDescription = textarea.value;
                }));

                parent.appendChild(textarea);

                const hint = dom.$('span');
                hint.style.cssText = `color: ${COLORS.dimText}; font-size: 11px; margin-top: 6px; display: block;`;
                hint.textContent = Nls.PROJECT_DESCRIPTION_HINT;
                parent.appendChild(hint);

                // Auto-focus
                setTimeout(() => textarea.focus(), 50);
        }

        // ── Step 3: Tech Stack ────────────────────────────────────────────────

        private renderStep3(parent: HTMLElement): void {
                // ── Selected technologies section ──
                const selectedLabel = dom.$('div');
                selectedLabel.style.cssText = `color: ${COLORS.text}; font-size: 13px; font-weight: 500; margin-bottom: 8px;`;
                selectedLabel.textContent = Nls.SELECTED_TECHNOLOGIES;
                parent.appendChild(selectedLabel);

                const selectedContainer = dom.$('div');
                selectedContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; min-height: 38px; margin-bottom: 20px;';
                this.renderSelectedTechChips(selectedContainer);
                parent.appendChild(selectedContainer);

                // ── Workspace suggestions section ──
                const suggestionsLabel = dom.$('div');
                suggestionsLabel.style.cssText = `color: ${COLORS.dimText}; font-size: 12px; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;`;
                suggestionsLabel.textContent = Nls.SUGGESTED_FROM_WORKSPACE;
                parent.appendChild(suggestionsLabel);

                const suggestionsContainer = dom.$('div');
                suggestionsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;';
                this.techSuggestionsContainer = suggestionsContainer;
                this.renderTechSuggestions(suggestionsContainer);
                parent.appendChild(suggestionsContainer);

                // ── Custom input ──
                const customLabel = dom.$('div');
                customLabel.style.cssText = `color: ${COLORS.dimText}; font-size: 12px; font-weight: 500; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;`;
                customLabel.textContent = Nls.ADD_CUSTOM_TECHNOLOGY;
                parent.appendChild(customLabel);

                const inputRow = dom.$('div');
                inputRow.style.cssText = 'display: flex; gap: 8px;';

                const customInput = dom.$('input') as HTMLInputElement;
                customInput.type = 'text';
                customInput.placeholder = Nls.CUSTOM_TECH_PLACEHOLDER;
                customInput.setAttribute('aria-label', 'Add custom technology');
                customInput.style.cssText = [
                        'flex: 1',
                        `background: ${COLORS.inputBg}`,
                        `border: 1px solid ${COLORS.inputBorder}`,
                        'border-radius: 6px',
                        'padding: 10px 14px',
                        `color: ${COLORS.text}`,
                        'font-size: 13px',
                        'outline: none',
                        'transition: border-color 0.15s ease',
                ].join('; ');

                this.stepDisposables.add(dom.addDisposableListener(customInput, dom.EventType.FOCUS, () => {
                        customInput.style.borderColor = COLORS.inputFocusBorder;
                }));
                this.stepDisposables.add(dom.addDisposableListener(customInput, dom.EventType.BLUR, () => {
                        customInput.style.borderColor = COLORS.inputBorder;
                }));

                const addBtn = dom.$('button') as HTMLButtonElement;
                addBtn.textContent = Nls.ADD;
                addBtn.setAttribute('aria-label', 'Add technology');
                addBtn.style.cssText = [
                        `background: ${COLORS.accent}`,
                        `color: ${COLORS.bg}`,
                        'border: none',
                        'border-radius: 6px',
                        'padding: 10px 18px',
                        'font-size: 13px',
                        'font-weight: 600',
                        'cursor: pointer',
                        'flex-shrink: 0',
                        'transition: opacity 0.15s ease',
                ].join('; ');

                const addCustomTech = () => {
                        const value = customInput.value.trim();
                        if (value && !this.techStack.includes(value)) {
                                this.techStack.push(value);
                                customInput.value = '';
                                this.renderSelectedTechChips(selectedContainer);
                                this.renderTechSuggestions(suggestionsContainer);
                                this.refreshNavButtons();
                        }
                };

                this.stepDisposables.add(dom.addDisposableListener(addBtn, dom.EventType.CLICK, addCustomTech));
                this.stepDisposables.add(dom.addDisposableListener(customInput, dom.EventType.KEY_DOWN, (e) => {
                        if (e.key === 'Enter') {
                                e.preventDefault();
                                addCustomTech();
                        }
                }));

                inputRow.appendChild(customInput);
                inputRow.appendChild(addBtn);
                parent.appendChild(inputRow);

                // Hint
                const hint = dom.$('span');
                hint.style.cssText = `color: ${COLORS.dimText}; font-size: 11px; margin-top: 8px; display: block;`;
                hint.textContent = Nls.ADD_TECH_HINT;
                parent.appendChild(hint);

                // Auto-focus
                setTimeout(() => customInput.focus(), 50);
        }

        private renderSelectedTechChips(container: HTMLElement): void {
                dom.clearNode(container);

                if (this.techStack.length === 0) {
                        const empty = dom.$('span');
                        empty.style.cssText = `color: ${COLORS.dimText}; font-size: 12px; font-style: italic; line-height: 38px;`;
                        empty.textContent = Nls.NO_TECH_SELECTED;
                        container.appendChild(empty);
                        return;
                }

                for (const tech of this.techStack) {
                        const chip = dom.$('div');
                        chip.style.cssText = [
                                'display: inline-flex',
                                'align-items: center',
                                'gap: 6px',
                                'padding: 6px 12px',
                                'border-radius: 16px',
                                'font-size: 13px',
                                `border: 1px solid ${COLORS.chipSelectedBorder}`,
                                `background: ${COLORS.chipSelectedBg}`,
                                `color: ${COLORS.accent}`,
                        ].join('; ');

                        const label = dom.$('span');
                        label.textContent = tech;
                        chip.appendChild(label);

                        const removeBtn = dom.$('span');
                        removeBtn.style.cssText = [
                                'cursor: pointer',
                                'font-size: 14px',
                                'line-height: 1',
                                'opacity: 0.7',
                                'margin-left: 2px',
                                'transition: opacity 0.15s ease',
                        ].join('; ');
                        removeBtn.textContent = '\u00D7'; // ×
                        this.stepDisposables.add(dom.addDisposableListener(removeBtn, dom.EventType.CLICK, () => {
                                this.removeTech(tech);
                                this.renderSelectedTechChips(container);
                                if (this.techSuggestionsContainer) {
                                        this.renderTechSuggestions(this.techSuggestionsContainer);
                                }
                                this.refreshNavButtons();
                        }));
                        chip.appendChild(removeBtn);

                        container.appendChild(chip);
                }
        }

        private renderTechSuggestions(container: HTMLElement): void {
                dom.clearNode(container);

                if (this.suggestedTech.length === 0) {
                        const detecting = dom.$('span');
                        detecting.style.cssText = `color: ${COLORS.dimText}; font-size: 12px; font-style: italic;`;
                        detecting.textContent = Nls.DETECTING_TECH;
                        container.appendChild(detecting);
                        return;
                }

                // Only show suggestions that are not already selected
                const unselected = this.suggestedTech.filter(t => !this.techStack.includes(t));
                if (unselected.length === 0) {
                        const allAdded = dom.$('span');
                        allAdded.style.cssText = `color: ${COLORS.dimText}; font-size: 12px; font-style: italic;`;
                        allAdded.textContent = Nls.ALL_TECH_ADDED;
                        container.appendChild(allAdded);
                        return;
                }

                for (const tech of unselected) {
                        const chip = dom.$('div');
                        chip.style.cssText = [
                                'display: inline-flex',
                                'align-items: center',
                                'padding: 6px 12px',
                                'border-radius: 16px',
                                'font-size: 13px',
                                'cursor: pointer',
                                'transition: all 0.15s ease',
                                'user-select: none',
                                `border: 1px solid ${COLORS.chipUnselectedBorder}`,
                                `background: ${COLORS.chipUnselectedBg}`,
                                `color: ${COLORS.text}`,
                        ].join('; ');
                        chip.textContent = tech;

                        // Hover effects
                        this.stepDisposables.add(dom.addDisposableListener(chip, dom.EventType.MOUSE_OVER, () => {
                                chip.style.borderColor = COLORS.accent;
                                chip.style.color = COLORS.accent;
                        }));
                        this.stepDisposables.add(dom.addDisposableListener(chip, dom.EventType.MOUSE_OUT, () => {
                                chip.style.borderColor = COLORS.chipUnselectedBorder;
                                chip.style.color = COLORS.text;
                        }));

                        // Click to add — refreshContent() re-renders both chip containers
                        this.stepDisposables.add(dom.addDisposableListener(chip, dom.EventType.CLICK, () => {
                                this.addTech(tech);
                                this.refreshContent();
                        }));

                        container.appendChild(chip);
                }
        }

        private addTech(tech: string): void {
                if (!this.techStack.includes(tech)) {
                        this.techStack.push(tech);
                }
        }

        private removeTech(tech: string): void {
                const idx = this.techStack.indexOf(tech);
                if (idx >= 0) {
                        this.techStack.splice(idx, 1);
                }
        }

        // ── Step 4: Success Criteria (Goals) ──────────────────────────────────

        private renderStep4(parent: HTMLElement): void {
                const label = dom.$('div');
                label.style.cssText = `color: ${COLORS.text}; font-size: 13px; font-weight: 500; margin-bottom: 10px;`;
                label.textContent = Nls.GOALS;
                parent.appendChild(label);

                // Existing goals list
                const goalsList = dom.$('div');
                goalsList.style.cssText = 'margin-bottom: 16px;';
                this.renderGoalsList(goalsList);
                parent.appendChild(goalsList);

                // Input for new goal
                const inputRow = dom.$('div');
                inputRow.style.cssText = 'display: flex; gap: 8px;';

                const goalInput = dom.$('input') as HTMLInputElement;
                goalInput.type = 'text';
                goalInput.placeholder = Nls.GOAL_PLACEHOLDER;
                goalInput.setAttribute('aria-label', 'Add a goal');
                goalInput.style.cssText = [
                        'flex: 1',
                        `background: ${COLORS.inputBg}`,
                        `border: 1px solid ${COLORS.inputBorder}`,
                        'border-radius: 6px',
                        'padding: 10px 14px',
                        `color: ${COLORS.text}`,
                        'font-size: 13px',
                        'outline: none',
                        'transition: border-color 0.15s ease',
                ].join('; ');

                this.stepDisposables.add(dom.addDisposableListener(goalInput, dom.EventType.FOCUS, () => {
                        goalInput.style.borderColor = COLORS.inputFocusBorder;
                }));
                this.stepDisposables.add(dom.addDisposableListener(goalInput, dom.EventType.BLUR, () => {
                        goalInput.style.borderColor = COLORS.inputBorder;
                }));

                const addGoalBtn = dom.$('button') as HTMLButtonElement;
                addGoalBtn.textContent = Nls.ADD;
                addGoalBtn.setAttribute('aria-label', 'Add goal');
                addGoalBtn.style.cssText = [
                        `background: ${COLORS.accent}`,
                        `color: ${COLORS.bg}`,
                        'border: none',
                        'border-radius: 6px',
                        'padding: 10px 18px',
                        'font-size: 13px',
                        'font-weight: 600',
                        'cursor: pointer',
                        'flex-shrink: 0',
                        'transition: opacity 0.15s ease',
                ].join('; ');

                const addGoal = () => {
                        const value = goalInput.value.trim();
                        if (value && !this.goals.includes(value)) {
                                this.goals.push(value);
                                goalInput.value = '';
                                this.renderGoalsList(goalsList);
                                this.refreshNavButtons();
                        }
                };

                this.stepDisposables.add(dom.addDisposableListener(addGoalBtn, dom.EventType.CLICK, addGoal));
                this.stepDisposables.add(dom.addDisposableListener(goalInput, dom.EventType.KEY_DOWN, (e) => {
                        if (e.key === 'Enter') {
                                e.preventDefault();
                                addGoal();
                        }
                }));

                inputRow.appendChild(goalInput);
                inputRow.appendChild(addGoalBtn);
                parent.appendChild(inputRow);

                // Validation hint
                const hint = dom.$('div');
                hint.style.cssText = `color: ${COLORS.dimText}; font-size: 11px; margin-top: 8px;`;
                hint.textContent = this.goals.length === 0
                        ? 'Add at least 1 goal to create your project.'
                        : `${this.goals.length} goal${this.goals.length > 1 ? 's' : ''} added. You can add more or proceed.`;
                parent.appendChild(hint);

                // Auto-focus
                setTimeout(() => goalInput.focus(), 50);
        }

        private renderGoalsList(container: HTMLElement): void {
                dom.clearNode(container);

                if (this.goals.length === 0) {
                        const empty = dom.$('div');
                        empty.style.cssText = [
                                'padding: 16px',
                                'text-align: center',
                                `border: 1px dashed ${COLORS.border}`,
                                'border-radius: 8px',
                                `color: ${COLORS.dimText}`,
                                'font-size: 12px',
                        ].join('; ');
                        empty.textContent = Nls.NO_GOALS_YET;
                        container.appendChild(empty);
                        return;
                }

                for (let i = 0; i < this.goals.length; i++) {
                        const goal = this.goals[i];
                        const item = dom.$('div');
                        item.style.cssText = [
                                'display: flex',
                                'align-items: center',
                                'gap: 10px',
                                'padding: 10px 14px',
                                `background: ${COLORS.inputBg}`,
                                `border: 1px solid ${COLORS.border}`,
                                'border-radius: 8px',
                                'margin-bottom: 8px',
                                'transition: border-color 0.15s ease',
                        ].join('; ');

                        const num = dom.$('span');
                        num.style.cssText = `color: ${COLORS.accent}; font-size: 13px; font-weight: 600; min-width: 22px;`;
                        num.textContent = `${i + 1}.`;
                        item.appendChild(num);

                        const goalText = dom.$('span');
                        goalText.style.cssText = `color: ${COLORS.text}; font-size: 13px; flex: 1; line-height: 1.4;`;
                        goalText.textContent = goal;
                        item.appendChild(goalText);

                        const removeBtn = dom.$('span');
                        removeBtn.style.cssText = [
                                'cursor: pointer',
                                `color: ${COLORS.dimText}`,
                                'font-size: 16px',
                                'line-height: 1',
                                'padding: 2px 4px',
                                'border-radius: 3px',
                                'transition: color 0.15s ease',
                        ].join('; ');
                        removeBtn.textContent = '\u00D7'; // ×
                        this.stepDisposables.add(dom.addDisposableListener(removeBtn, dom.EventType.MOUSE_OVER, () => {
                                removeBtn.style.color = COLORS.dangerText;
                        }));
                        this.stepDisposables.add(dom.addDisposableListener(removeBtn, dom.EventType.MOUSE_OUT, () => {
                                removeBtn.style.color = COLORS.dimText;
                        }));
                        this.stepDisposables.add(dom.addDisposableListener(removeBtn, dom.EventType.CLICK, () => {
                                this.removeGoal(goal);
                                this.renderGoalsList(container);
                                this.refreshNavButtons();
                        }));
                        item.appendChild(removeBtn);

                        container.appendChild(item);
                }
        }

        private removeGoal(goal: string): void {
                const idx = this.goals.indexOf(goal);
                if (idx >= 0) {
                        this.goals.splice(idx, 1);
                }
        }

        // ── Navigation bar ────────────────────────────────────────────────────

        private renderNavBar(parent: HTMLElement): void {
                const bar = dom.$('div.construct-wizard-nav');
                bar.style.cssText = [
                        'padding: 12px 24px 16px',
                        'display: flex',
                        'justify-content: space-between',
                        'align-items: center',
                        'flex-shrink: 0',
                        `border-top: 1px solid ${COLORS.border}`,
                ].join('; ');
                parent.appendChild(bar);
                this._navContainer = bar;

                // Previous button (left side)
                const prevBtn = dom.$('button') as HTMLButtonElement;
                prevBtn.style.cssText = [
                        'background: transparent',
                        `border: 1px solid ${COLORS.border}`,
                        'border-radius: 6px',
                        'padding: 8px 20px',
                        `color: ${COLORS.text}`,
                        'font-size: 13px',
                        'cursor: pointer',
                        'transition: all 0.15s ease',
                ].join('; ');
                prevBtn.textContent = Nls.PREVIOUS;
                prevBtn.setAttribute('aria-label', 'Previous step');
                this.stepDisposables.add(dom.addDisposableListener(prevBtn, dom.EventType.CLICK, () => {
                        this.goToStep(this.currentStep - 1);
                }));
                this.stepDisposables.add(dom.addDisposableListener(prevBtn, dom.EventType.MOUSE_OVER, () => {
                        prevBtn.style.borderColor = COLORS.text;
                }));
                this.stepDisposables.add(dom.addDisposableListener(prevBtn, dom.EventType.MOUSE_OUT, () => {
                        prevBtn.style.borderColor = COLORS.border;
                }));
                bar.appendChild(prevBtn);
                this.previousButton = prevBtn;

                // Right-side: Next or Create Project
                const nextBtn = dom.$('button') as HTMLButtonElement;
                nextBtn.style.cssText = [
                        `background: ${COLORS.accent}`,
                        `color: ${COLORS.bg}`,
                        'border: none',
                        'border-radius: 6px',
                        'padding: 8px 24px',
                        'font-size: 13px',
                        'font-weight: 600',
                        'cursor: pointer',
                        'transition: all 0.15s ease',
                ].join('; ');
                nextBtn.textContent = Nls.NEXT;
                nextBtn.setAttribute('aria-label', 'Next step');
                this.stepDisposables.add(dom.addDisposableListener(nextBtn, dom.EventType.CLICK, () => {
                        if (this.currentStep < STEP_COUNT) {
                                this.goToStep(this.currentStep + 1);
                        }
                }));
                bar.appendChild(nextBtn);
                this.nextButton = nextBtn;

                // Create Project button (hidden initially, shown on step 4)
                const createBtn = dom.$('button') as HTMLButtonElement;
                createBtn.style.cssText = [
                        `background: ${COLORS.successAccent}`,
                        'color: white',
                        'border: none',
                        'border-radius: 6px',
                        'padding: 8px 24px',
                        'font-size: 13px',
                        'font-weight: 600',
                        'cursor: pointer',
                        'display: none',
                        'transition: all 0.15s ease',
                ].join('; ');
                createBtn.textContent = Nls.CREATE_PROJECT;
                createBtn.setAttribute('aria-label', 'Create project');
                this.stepDisposables.add(dom.addDisposableListener(createBtn, dom.EventType.CLICK, () => {
                        this.createProject();
                }));
                bar.appendChild(createBtn);
                this.createButton = createBtn;

                this.refreshNavButtons();
        }

        private refreshNavButtons(): void {
                if (!this.previousButton || !this.nextButton || !this.createButton) { return; }

                const isLastStep = this.currentStep === STEP_COUNT;

                // Previous button visibility
                this.previousButton.style.display = this.currentStep > 1 ? '' : 'none';
                this.previousButton.disabled = this.currentStep <= 1;
                this.previousButton.style.opacity = this.currentStep <= 1 ? '0.4' : '1';
                this.previousButton.style.cursor = this.currentStep <= 1 ? 'default' : 'pointer';

                // Next button (shown on steps 1-3)
                this.nextButton.style.display = isLastStep ? 'none' : '';
                this.nextButton.disabled = !this.canAdvance();
                this.nextButton.style.opacity = this.canAdvance() ? '1' : '0.5';
                this.nextButton.style.cursor = this.canAdvance() ? 'pointer' : 'default';

                // Create Project button (shown only on step 4)
                this.createButton.style.display = isLastStep ? '' : 'none';
                const canCreate = this.canCreate();
                this.createButton.disabled = !canCreate;
                this.createButton.style.opacity = canCreate ? '1' : '0.5';
                this.createButton.style.cursor = canCreate ? 'pointer' : 'default';
        }

        // ── Navigation logic ──────────────────────────────────────────────────

        private goToStep(step: number): void {
                if (step < 1 || step > STEP_COUNT) { return; }
                if (step > this.currentStep && !this.canAdvance()) { return; }
                this.currentStep = step;
                this.refreshContent();
        }

        private canAdvance(): boolean {
                switch (this.currentStep) {
                        case 1: return this.projectName.trim().length > 0 && this.projectName.length <= 80;
                        case 2: return true; // Description is optional
                        case 3: return true; // Tech stack is optional
                        case 4: return this.canCreate();
                        default: return false;
                }
        }

        private canCreate(): boolean {
                return this.goals.length >= 1
                        && this.projectName.trim().length > 0
                        && this.projectName.length <= 80;
        }

        // ── Create project ────────────────────────────────────────────────────

        private async createProject(): Promise<void> {
                if (!this.canCreate()) { return; }

                const workspace = this.workspaceContextService.getWorkspace();
                const rootFolder = workspace.folders[0];
                if (!rootFolder) {
                        this.logService.error('[ConstructProjectWizard] No workspace folder found — cannot create project.');
                        return;
                }
                const workspacePath = rootFolder.uri.fsPath;

                // Disable button to prevent double-clicks
                if (this.createButton) {
                        this.createButton.disabled = true;
                        this.createButton.textContent = Nls.CREATING;
                        this.createButton.style.opacity = '0.6';
                        this.createButton.style.cursor = 'wait';
                }

                try {
                        const input: IProjectCreationInput = {
                                name: this.projectName.trim(),
                                description: this.projectDescription.trim(),
                                techStack: [...this.techStack],
                                goals: [...this.goals],
                        };

                        await this.projectService.createProject(input, workspacePath);

                        this.logService.info('[ConstructProjectWizard] Project created successfully:', input.name);

                        // Fire event so the agent view can begin idea refinement
                        this._onDidCreateProject.fire();

                        // Clean up the wizard overlay
                        if (this.container) {
                                dom.clearNode(this.container);
                        }
                } catch (e) {
                        this.logService.error('[ConstructProjectWizard] Failed to create project', e);

                        // Re-enable button on failure
                        if (this.createButton) {
                                this.createButton.disabled = false;
                                this.createButton.textContent = Nls.CREATE_PROJECT;
                                this.createButton.style.opacity = '1';
                                this.createButton.style.cursor = 'pointer';
                        }
                }
        }
}
