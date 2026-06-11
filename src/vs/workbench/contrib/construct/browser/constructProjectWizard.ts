// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConstructProjectService } from '../../../../platform/construct/common/project/constructProjectService.js';
import {
        ProjectTemplate,
        IKovixProject,
        IProjectCreationInput,
        ITechStackEntry,
        PROJECT_TEMPLATE_LABELS,
        PROJECT_TEMPLATE_DESCRIPTIONS,
        PROJECT_TEMPLATE_ICONS,
} from '../../../../platform/construct/common/project/constructProjectTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';

// --- Types --------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4;

interface IWizardState {
        step: WizardStep;
        name: string;
        description: string;
        template: ProjectTemplate | null;
        techStack: ITechStackEntry[];
        goals: string[];
}

// --- Predefined tech stack options --------------------------------------------

const TECH_OPTIONS: Array<{ category: ITechStackEntry['category']; name: string; icon: string }> = [
        { category: 'language', name: 'TypeScript', icon: '\uD83D\uDCBB' },
        { category: 'language', name: 'JavaScript', icon: '\u26A1' },
        { category: 'language', name: 'Python', icon: '\uD83D\uDC0D' },
        { category: 'language', name: 'Rust', icon: '\uD83E\uDD80' },
        { category: 'language', name: 'Go', icon: '\uD83D\uDC22' },
        { category: 'language', name: 'Java', icon: '\u2615' },
        { category: 'framework', name: 'React', icon: '\u269B\uFE0F' },
        { category: 'framework', name: 'Vue', icon: '\uD83D\uDE8C' },
        { category: 'framework', name: 'Svelte', icon: '\uD83E\uDD8A' },
        { category: 'framework', name: 'Next.js', icon: '\u25B2' },
        { category: 'framework', name: 'Express', icon: '\uD83D\uDE87' },
        { category: 'framework', name: 'Fastify', icon: '\u26A1' },
        { category: 'framework', name: 'NestJS', icon: '\uD83D\uDE3A' },
        { category: 'database', name: 'PostgreSQL', icon: '\uD83D\uDC18' },
        { category: 'database', name: 'MongoDB', icon: '\uD83C\uDF43' },
        { category: 'database', name: 'SQLite', icon: '\uD83D\uDDC3' },
        { category: 'database', name: 'Redis', icon: '\uD83D\uDFE5' },
        { category: 'runtime', name: 'Node.js', icon: '\uD83D\uDE38' },
        { category: 'runtime', name: 'Bun', icon: '\uD83E\uDD5B' },
        { category: 'runtime', name: 'Deno', icon: '\uD83E\uDD8A' },
        { category: 'tool', name: 'Docker', icon: '\uD83D\uDC33' },
        { category: 'tool', name: 'ESLint', icon: '\uD83D\uDD0D' },
        { category: 'tool', name: 'Prettier', icon: '\u2728' },
        { category: 'tool', name: 'Vitest', icon: '\uD83E\uDDEA' },
];

// --- CSS Styles ---------------------------------------------------------------

const WIZARD_STYLES = `
        .kovix-wizard-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(8px);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: kovix-wizard-fadeIn 0.2s ease;
        }
        @keyframes kovix-wizard-fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
        }
        .kovix-wizard-modal {
                background: #0D1117;
                border: 1px solid #1A1F2E;
                border-radius: 12px;
                width: 720px;
                max-height: 85vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 1px rgba(0, 229, 255, 0.2);
                animation: kovix-wizard-slideIn 0.3s ease;
        }
        @keyframes kovix-wizard-slideIn {
                from { opacity: 0; transform: translateY(20px) scale(0.97); }
                to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .kovix-wizard-header {
                padding: 20px 24px 16px;
                border-bottom: 1px solid #1A1F2E;
                display: flex;
                align-items: center;
                justify-content: space-between;
        }
        .kovix-wizard-title {
                font-size: 18px;
                font-weight: 700;
                color: #E0E7FF;
                letter-spacing: -0.3px;
        }
        .kovix-wizard-close {
                background: transparent;
                border: none;
                color: #4A5568;
                font-size: 20px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 4px;
                transition: color 0.15s ease;
        }
        .kovix-wizard-close:hover { color: #FF4444; }
        .kovix-wizard-progress {
                display: flex;
                align-items: center;
                padding: 16px 24px;
                gap: 4px;
        }
        .kovix-wizard-progress-step {
                flex: 1;
                height: 3px;
                border-radius: 2px;
                background: #1A1F2E;
                transition: background 0.3s ease;
        }
        .kovix-wizard-progress-step.active {
                background: #00E5FF;
                box-shadow: 0 0 8px rgba(0, 229, 255, 0.3);
        }
        .kovix-wizard-progress-step.completed {
                background: #00C853;
        }
        .kovix-wizard-step-label {
                font-size: 11px;
                color: #4A5568;
                margin-right: 12px;
                white-space: nowrap;
        }
        .kovix-wizard-body {
                flex: 1;
                overflow-y: auto;
                padding: 20px 24px;
        }
        .kovix-wizard-body::-webkit-scrollbar {
                width: 6px;
        }
        .kovix-wizard-body::-webkit-scrollbar-track {
                background: transparent;
        }
        .kovix-wizard-body::-webkit-scrollbar-thumb {
                background: #1A1F2E;
                border-radius: 3px;
        }
        .kovix-wizard-footer {
                padding: 16px 24px;
                border-top: 1px solid #1A1F2E;
                display: flex;
                justify-content: space-between;
                align-items: center;
        }
        .kovix-wizard-btn {
                padding: 8px 20px;
                border-radius: 6px;
                border: none;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
                display: inline-flex;
                align-items: center;
                gap: 6px;
        }
        .kovix-wizard-btn:active { transform: scale(0.97); }
        .kovix-wizard-btn-primary {
                background: #00E5FF;
                color: #0D1117;
        }
        .kovix-wizard-btn-primary:hover { background: #33ECFF; }
        .kovix-wizard-btn-primary:disabled {
                opacity: 0.4;
                cursor: not-allowed;
        }
        .kovix-wizard-btn-secondary {
                background: #141B2D;
                color: #E0E7FF;
                border: 1px solid #1A1F2E;
        }
        .kovix-wizard-btn-secondary:hover { border-color: #00E5FF; color: #00E5FF; }
        .kovix-wizard-btn-create {
                background: #00C853;
                color: white;
        }
        .kovix-wizard-btn-create:hover { background: #00D85A; }
        .kovix-wizard-btn-create:disabled {
                opacity: 0.4;
                cursor: not-allowed;
        }
        /* Step 1: Project Info */
        .kovix-wizard-label {
                display: block;
                font-size: 12px;
                font-weight: 600;
                color: #8B949E;
                margin-bottom: 6px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
        }
        .kovix-wizard-input {
                width: 100%;
                background: #0A0E1A;
                border: 1px solid #1A1F2E;
                border-radius: 6px;
                padding: 10px 14px;
                color: #E0E7FF;
                font-size: 14px;
                outline: none;
                transition: border-color 0.15s ease;
                font-family: inherit;
                resize: vertical;
        }
        .kovix-wizard-input:focus { border-color: #00E5FF; }
        .kovix-wizard-input::placeholder { color: #4A5568; }
        .kovix-wizard-field { margin-bottom: 20px; }
        /* Step 2: Template Grid */
        .kovix-wizard-template-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
        }
        .kovix-wizard-template-card {
                background: #141B2D;
                border: 1px solid #1A1F2E;
                border-radius: 8px;
                padding: 16px;
                cursor: pointer;
                transition: all 0.15s ease;
                display: flex;
                align-items: flex-start;
                gap: 12px;
        }
        .kovix-wizard-template-card:hover {
                border-color: #00E5FF40;
                background: #1A2744;
        }
        .kovix-wizard-template-card.selected {
                border-color: #00E5FF;
                background: #1A2744;
                box-shadow: 0 0 12px rgba(0, 229, 255, 0.15);
        }
        .kovix-wizard-template-icon {
                font-size: 24px;
                flex-shrink: 0;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 8px;
                background: #0A0E1A;
        }
        .kovix-wizard-template-info {
                flex: 1;
                min-width: 0;
        }
        .kovix-wizard-template-name {
                font-size: 13px;
                font-weight: 600;
                color: #E0E7FF;
                margin-bottom: 3px;
        }
        .kovix-wizard-template-desc {
                font-size: 11px;
                color: #8B949E;
                line-height: 1.4;
        }
        /* Step 3: Tech Stack & Goals */
        .kovix-wizard-tech-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-bottom: 20px;
        }
        .kovix-wizard-tech-chip {
                background: #141B2D;
                border: 1px solid #1A1F2E;
                border-radius: 16px;
                padding: 5px 12px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.15s ease;
                color: #8B949E;
                display: inline-flex;
                align-items: center;
                gap: 4px;
        }
        .kovix-wizard-tech-chip:hover {
                border-color: #00E5FF40;
                color: #E0E7FF;
        }
        .kovix-wizard-tech-chip.selected {
                border-color: #00E5FF;
                background: #1A2744;
                color: #00E5FF;
        }
        .kovix-wizard-section-title {
                font-size: 13px;
                font-weight: 600;
                color: #E0E7FF;
                margin-bottom: 10px;
        }
        .kovix-wizard-goals-input {
                width: 100%;
                min-height: 80px;
        }
        .kovix-wizard-goals-hint {
                font-size: 11px;
                color: #4A5568;
                margin-top: 4px;
        }
        /* Step 4: Review */
        .kovix-wizard-review-section {
                margin-bottom: 16px;
        }
        .kovix-wizard-review-label {
                font-size: 11px;
                font-weight: 600;
                color: #4A5568;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 4px;
        }
        .kovix-wizard-review-value {
                font-size: 14px;
                color: #E0E7FF;
                line-height: 1.5;
        }
        .kovix-wizard-review-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
        }
        .kovix-wizard-review-tag {
                background: #141B2D;
                border: 1px solid #1A1F2E;
                border-radius: 4px;
                padding: 2px 8px;
                font-size: 11px;
                color: #00E5FF;
        }
        .kovix-wizard-divider {
                border: none;
                border-top: 1px solid #1A1F2E;
                margin: 16px 0;
        }
        .kovix-wizard-success {
                text-align: center;
                padding: 20px 0;
        }
        .kovix-wizard-success-icon {
                font-size: 48px;
                color: #00C853;
                margin-bottom: 12px;
                animation: kovix-wizard-scaleIn 0.5s ease;
        }
        @keyframes kovix-wizard-scaleIn {
                from { transform: scale(0); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
        }
        .kovix-wizard-success-title {
                font-size: 18px;
                font-weight: 700;
                color: #E0E7FF;
                margin-bottom: 4px;
        }
        .kovix-wizard-success-subtitle {
                font-size: 13px;
                color: #8B949E;
        }
`;

// --- Wizard Implementation ----------------------------------------------------

class ProjectWizard extends Disposable {
        private overlay!: HTMLElement;
        private modal!: HTMLElement;
        private body!: HTMLElement;
        private stepLabel!: HTMLElement;
        private progressSteps: HTMLElement[] = [];
        private backBtn!: HTMLButtonElement;
        private nextBtn!: HTMLButtonElement;

        private state: IWizardState = {
                step: 1,
                name: '',
                description: '',
                template: null,
                techStack: [],
                goals: [],
        };

        private resolve: ((result: IKovixProject | null) => void) | null = null;

        constructor(
                private readonly instantiationService: IInstantiationService,
                private readonly workspaceContextService: IWorkspaceContextService,
                private readonly notificationService: INotificationService,
                private readonly logService: ILogService,
        ) {
                super();
        }

        /**
         * Show the wizard and return a promise that resolves with the created project
         * or null if the user cancelled.
         */
        show(): Promise<IKovixProject | null> {
                return new Promise<IKovixProject | null>((resolve) => {
                        this.resolve = resolve;
                        this.render();
                });
        }

        // --- Rendering ------------------------------------------------------------

        private render(): void {
                // Inject styles once
                if (!document.getElementById('kovix-wizard-styles')) {
                        const styleEl = document.createElement('style');
                        styleEl.id = 'kovix-wizard-styles';
                        styleEl.textContent = WIZARD_STYLES;
                        document.head.appendChild(styleEl);
                }

                // Overlay
                this.overlay = dom.$('.kovix-wizard-overlay');
                this.overlay.addEventListener('click', (e) => {
                        if (e.target === this.overlay) {
                                this.cancel();
                        }
                });

                // Modal
                this.modal = dom.$('.kovix-wizard-modal');

                // Header
                const header = dom.$('.kovix-wizard-header');
                const title = dom.$('.kovix-wizard-title');
                title.textContent = 'New Project';
                const closeBtn = dom.$('button.kovix-wizard-close') as HTMLButtonElement;
                closeBtn.textContent = '\u2715'; // ✕
                closeBtn.onclick = () => this.cancel();
                header.appendChild(title);
                header.appendChild(closeBtn);
                this.modal.appendChild(header);

                // Progress bar
                const progressContainer = dom.$('.kovix-wizard-progress');
                this.stepLabel = dom.$('.kovix-wizard-step-label');
                this.stepLabel.textContent = 'Step 1 of 4';
                progressContainer.appendChild(this.stepLabel);

                this.progressSteps = [];
                for (let i = 0; i < 4; i++) {
                        const step = dom.$('.kovix-wizard-progress-step');
                        this.progressSteps.push(step);
                        progressContainer.appendChild(step);
                }
                this.updateProgress();
                this.modal.appendChild(progressContainer);

                // Body
                this.body = dom.$('.kovix-wizard-body');
                this.renderCurrentStep();
                this.modal.appendChild(this.body);

                // Footer
                const footer = dom.$('.kovix-wizard-footer');
                this.backBtn = dom.$('button.kovix-wizard-btn.kovix-wizard-btn-secondary') as HTMLButtonElement;
                this.backBtn.textContent = '\u2190 Back';
                this.backBtn.onclick = () => this.goBack();
                this.backBtn.style.display = 'none';

                this.nextBtn = dom.$('button.kovix-wizard-btn.kovix-wizard-btn-primary') as HTMLButtonElement;
                this.nextBtn.textContent = 'Next \u2192';
                this.nextBtn.onclick = () => this.goForward();

                footer.appendChild(this.backBtn);
                footer.appendChild(this.nextBtn);
                this.modal.appendChild(footer);

                this.overlay.appendChild(this.modal);
                document.body.appendChild(this.overlay);

                // Focus the first input
                setTimeout(() => {
                        const firstInput = this.body.querySelector('input, textarea') as HTMLElement;
                        firstInput?.focus();
                }, 100);
        }

        private renderCurrentStep(): void {
                // Clear body
                while (this.body.firstChild) {
                        this.body.removeChild(this.body.firstChild);
                }

                switch (this.state.step) {
                        case 1:
                                this.renderStep1();
                                break;
                        case 2:
                                this.renderStep2();
                                break;
                        case 3:
                                this.renderStep3();
                                break;
                        case 4:
                                this.renderStep4();
                                break;
                }

                this.updateProgress();
                this.updateButtons();
        }

        // --- Step 1: Project Info --------------------------------------------------

        private renderStep1(): void {
                const heading = dom.$('div');
                heading.style.cssText = 'font-size: 16px; font-weight: 700; color: #E0E7FF; margin-bottom: 4px;';
                heading.textContent = 'Project Information';
                const subtitle = dom.$('div');
                subtitle.style.cssText = 'font-size: 12px; color: #8B949E; margin-bottom: 24px;';
                subtitle.textContent = 'Give your project a name and description.';
                this.body.appendChild(heading);
                this.body.appendChild(subtitle);

                // Name
                const nameField = dom.$('.kovix-wizard-field');
                const nameLabel = dom.$('.kovix-wizard-label');
                nameLabel.textContent = 'Project Name';
                nameLabel.setAttribute('for', 'kovix-project-name');
                const nameInput = dom.$('input.kovix-wizard-input') as HTMLInputElement;
                nameInput.id = 'kovix-project-name';
                nameInput.type = 'text';
                nameInput.placeholder = 'my-awesome-project';
                nameInput.value = this.state.name;
                nameInput.addEventListener('input', () => {
                        this.state.name = nameInput.value.trim();
                        this.updateButtons();
                });
                nameInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { this.goForward(); }
                });
                nameField.appendChild(nameLabel);
                nameField.appendChild(nameInput);
                this.body.appendChild(nameField);

                // Description
                const descField = dom.$('.kovix-wizard-field');
                const descLabel = dom.$('.kovix-wizard-label');
                descLabel.textContent = 'Description';
                descLabel.setAttribute('for', 'kovix-project-desc');
                const descInput = dom.$('textarea.kovix-wizard-input') as HTMLTextAreaElement;
                descInput.id = 'kovix-project-desc';
                descInput.placeholder = 'A brief description of your project...';
                descInput.rows = 3;
                descInput.value = this.state.description;
                descInput.addEventListener('input', () => {
                        this.state.description = descInput.value;
                });
                descField.appendChild(descLabel);
                descField.appendChild(descInput);
                this.body.appendChild(descField);
        }

        // --- Step 2: Template Grid -------------------------------------------------

        private renderStep2(): void {
                const heading = dom.$('div');
                heading.style.cssText = 'font-size: 16px; font-weight: 700; color: #E0E7FF; margin-bottom: 4px;';
                heading.textContent = 'Choose a Template';
                const subtitle = dom.$('div');
                subtitle.style.cssText = 'font-size: 12px; color: #8B949E; margin-bottom: 24px;';
                subtitle.textContent = 'Select a project template to get started.';
                this.body.appendChild(heading);
                this.body.appendChild(subtitle);

                const grid = dom.$('.kovix-wizard-template-grid');

                const templates = Object.values(ProjectTemplate);
                for (const template of templates) {
                        const card = dom.$('.kovix-wizard-template-card');
                        if (this.state.template === template) {
                                card.classList.add('selected');
                        }

                        const iconEl = dom.$('.kovix-wizard-template-icon');
                        iconEl.textContent = PROJECT_TEMPLATE_ICONS[template];

                        const infoEl = dom.$('.kovix-wizard-template-info');
                        const nameEl = dom.$('.kovix-wizard-template-name');
                        nameEl.textContent = PROJECT_TEMPLATE_LABELS[template];
                        const descEl = dom.$('.kovix-wizard-template-desc');
                        descEl.textContent = PROJECT_TEMPLATE_DESCRIPTIONS[template];

                        infoEl.appendChild(nameEl);
                        infoEl.appendChild(descEl);
                        card.appendChild(iconEl);
                        card.appendChild(infoEl);

                        card.addEventListener('click', () => {
                                this.state.template = template;
                                // Update visual selection
                                grid.querySelectorAll('.kovix-wizard-template-card').forEach(c => c.classList.remove('selected'));
                                card.classList.add('selected');
                                this.updateButtons();
                        });

                        grid.appendChild(card);
                }

                this.body.appendChild(grid);
        }

        // --- Step 3: Tech Stack & Goals -------------------------------------------

        private renderStep3(): void {
                const heading = dom.$('div');
                heading.style.cssText = 'font-size: 16px; font-weight: 700; color: #E0E7FF; margin-bottom: 4px;';
                heading.textContent = 'Tech Stack & Goals';
                const subtitle = dom.$('div');
                subtitle.style.cssText = 'font-size: 12px; color: #8B949E; margin-bottom: 24px;';
                subtitle.textContent = 'Select your technologies and define project goals.';
                this.body.appendChild(heading);
                this.body.appendChild(subtitle);

                // Tech Stack section
                const techTitle = dom.$('.kovix-wizard-section-title');
                techTitle.textContent = 'Technology Stack';
                this.body.appendChild(techTitle);

                const techGrid = dom.$('.kovix-wizard-tech-grid');
                const selectedNames = new Set(this.state.techStack.map(t => t.name));

                for (const opt of TECH_OPTIONS) {
                        const chip = dom.$('.kovix-wizard-tech-chip');
                        chip.textContent = `${opt.icon} ${opt.name}`;
                        if (selectedNames.has(opt.name)) {
                                chip.classList.add('selected');
                        }

                        chip.addEventListener('click', () => {
                                if (selectedNames.has(opt.name)) {
                                        selectedNames.delete(opt.name);
                                        chip.classList.remove('selected');
                                        this.state.techStack = this.state.techStack.filter(t => t.name !== opt.name);
                                } else {
                                        selectedNames.add(opt.name);
                                        chip.classList.add('selected');
                                        this.state.techStack.push({ category: opt.category, name: opt.name });
                                }
                        });

                        techGrid.appendChild(chip);
                }
                this.body.appendChild(techGrid);

                // Divider
                const divider = dom.$('hr.kovix-wizard-divider');
                this.body.appendChild(divider);

                // Goals section
                const goalsTitle = dom.$('.kovix-wizard-section-title');
                goalsTitle.textContent = 'Project Goals';
                this.body.appendChild(goalsTitle);

                const goalsInput = dom.$('textarea.kovix-wizard-input.kovix-wizard-goals-input') as HTMLTextAreaElement;
                goalsInput.placeholder = 'Build a fast, accessible web app...\nSupport real-time collaboration...\n';
                goalsInput.rows = 4;
                goalsInput.value = this.state.goals.join('\n');
                goalsInput.addEventListener('input', () => {
                        this.state.goals = goalsInput.value
                                .split('\n')
                                .map(g => g.trim())
                                .filter(g => g.length > 0);
                });
                this.body.appendChild(goalsInput);

                const hint = dom.$('.kovix-wizard-goals-hint');
                hint.textContent = 'One goal per line. These will guide the AI agent.';
                this.body.appendChild(hint);
        }

        // --- Step 4: Review & Create -----------------------------------------------

        private renderStep4(): void {
                const heading = dom.$('div');
                heading.style.cssText = 'font-size: 16px; font-weight: 700; color: #E0E7FF; margin-bottom: 4px;';
                heading.textContent = 'Review & Create';
                const subtitle = dom.$('div');
                subtitle.style.cssText = 'font-size: 12px; color: #8B949E; margin-bottom: 24px;';
                subtitle.textContent = 'Confirm your project settings before creating.';
                this.body.appendChild(heading);
                this.body.appendChild(subtitle);

                // Project Name
                this.addReviewSection('Project Name', this.state.name || '(untitled)');

                // Description
                this.addReviewSection('Description', this.state.description || '(no description)');

                // Template
                const templateLabel = this.state.template
                        ? `${PROJECT_TEMPLATE_ICONS[this.state.template]} ${PROJECT_TEMPLATE_LABELS[this.state.template]}`
                        : '(none selected)';
                this.addReviewSection('Template', templateLabel);

                // Tech Stack
                if (this.state.techStack.length > 0) {
                        const tagsContainer = dom.$('.kovix-wizard-review-tags');
                        for (const tech of this.state.techStack) {
                                const tag = dom.$('.kovix-wizard-review-tag');
                                tag.textContent = tech.name;
                                tagsContainer.appendChild(tag);
                        }
                        this.addReviewSection('Tech Stack', '', tagsContainer);
                } else {
                        this.addReviewSection('Tech Stack', '(none selected)');
                }

                // Goals
                if (this.state.goals.length > 0) {
                        this.addReviewSection('Goals', this.state.goals.map(g => `\u2022 ${g}`).join('\n'));
                } else {
                        this.addReviewSection('Goals', '(none)');
                }
        }

        private addReviewSection(label: string, value: string, customElement?: HTMLElement): void {
                const section = dom.$('.kovix-wizard-review-section');
                const labelEl = dom.$('.kovix-wizard-review-label');
                labelEl.textContent = label;

                section.appendChild(labelEl);

                if (customElement) {
                        section.appendChild(customElement);
                } else {
                        const valueEl = dom.$('.kovix-wizard-review-value');
                        valueEl.textContent = value;
                        if (value.includes('\n')) {
                                valueEl.style.whiteSpace = 'pre-wrap';
                        }
                        section.appendChild(valueEl);
                }

                this.body.appendChild(section);
        }

        // --- Navigation ------------------------------------------------------------

        private updateProgress(): void {
                this.stepLabel.textContent = `Step ${this.state.step} of 4`;

                for (let i = 0; i < this.progressSteps.length; i++) {
                        const stepEl = this.progressSteps[i];
                        stepEl.classList.remove('active', 'completed');
                        if (i + 1 < this.state.step) {
                                stepEl.classList.add('completed');
                        } else if (i + 1 === this.state.step) {
                                stepEl.classList.add('active');
                        }
                }
        }

        private updateButtons(): void {
                // Back button
                this.backBtn.style.display = this.state.step > 1 ? '' : 'none';

                // Next / Create button
                if (this.state.step === 4) {
                        this.nextBtn.textContent = '\u2713 Create Project';
                        this.nextBtn.className = 'kovix-wizard-btn kovix-wizard-btn-create';
                        this.nextBtn.disabled = !this.canProceed();
                } else {
                        this.nextBtn.textContent = 'Next \u2192';
                        this.nextBtn.className = 'kovix-wizard-btn kovix-wizard-btn-primary';
                        this.nextBtn.disabled = !this.canProceed();
                }
        }

        private canProceed(): boolean {
                switch (this.state.step) {
                        case 1:
                                return this.state.name.length > 0;
                        case 2:
                                return this.state.template !== null;
                        case 3:
                                return true; // Tech stack & goals are optional
                        case 4:
                                return this.state.name.length > 0 && this.state.template !== null;
                        default:
                                return false;
                }
        }

        private goBack(): void {
                if (this.state.step > 1) {
                        this.state.step = (this.state.step - 1) as WizardStep;
                        this.renderCurrentStep();
                }
        }

        private async goForward(): Promise<void> {
                if (!this.canProceed()) {
                        return;
                }

                if (this.state.step < 4) {
                        this.state.step = (this.state.step + 1) as WizardStep;
                        this.renderCurrentStep();
                } else {
                        // Final step — create the project
                        await this.createProject();
                }
        }

        private async createProject(): Promise<void> {
                if (!this.state.template) {
                        return;
                }

                // Disable buttons during creation
                this.nextBtn.disabled = true;
                this.backBtn.disabled = true;
                this.nextBtn.textContent = 'Creating...';

                const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';

                const input: IProjectCreationInput = {
                        name: this.state.name,
                        description: this.state.description,
                        template: this.state.template,
                        techStack: this.state.techStack,
                        goals: this.state.goals,
                        workspaceRoot,
                };

                try {
                        const projectService = this.instantiationService.invokeFunction((accessor) => {
                                return accessor.get(IConstructProjectService);
                        });

                        const project = await projectService.createProject(input);

                        // Show success state
                        this.showSuccess(project.name);

                        this.notificationService.info(`Kovix: Project "${project.name}" created successfully!`);
                        this.logService.info(`[ProjectWizard] Project "${project.name}" created (id: ${project.id})`);

                        // Resolve after a brief delay so the user sees the success state
                        setTimeout(() => {
                                this.close(project);
                        }, 1500);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[ProjectWizard] Failed to create project: ${msg}`);
                        this.notificationService.error(`Kovix: Failed to create project: ${msg}`);

                        // Re-enable buttons
                        this.nextBtn.disabled = false;
                        this.backBtn.disabled = false;
                        this.nextBtn.textContent = '\u2713 Create Project';
                }
        }

        private showSuccess(projectName: string): void {
                // Clear body and show success message
                while (this.body.firstChild) {
                        this.body.removeChild(this.body.firstChild);
                }

                const successContainer = dom.$('.kovix-wizard-success');
                const icon = dom.$('.kovix-wizard-success-icon');
                icon.textContent = '\u2705'; // ✅
                const title = dom.$('.kovix-wizard-success-title');
                title.textContent = 'Project Created!';
                const subtitle = dom.$('.kovix-wizard-success-subtitle');
                subtitle.textContent = `"${projectName}" is ready to go.`;

                successContainer.appendChild(icon);
                successContainer.appendChild(title);
                successContainer.appendChild(subtitle);
                this.body.appendChild(successContainer);
        }

        private cancel(): void {
                this.close(null);
        }

        private close(result: IKovixProject | null): void {
                this.overlay.remove();
                if (this.resolve) {
                        this.resolve(result);
                        this.resolve = null;
                }
                this.dispose();
        }

        override dispose(): void {
                this.overlay?.remove();
                super.dispose();
        }
}

// --- Public API ---------------------------------------------------------------

/**
 * Show the project creation wizard.
 *
 * @param instantiationService The VS Code instantiation service for DI.
 * @returns A promise that resolves with the created project, or null if cancelled.
 */
export async function showProjectWizard(
        instantiationService: IInstantiationService,
): Promise<IKovixProject | null> {
        return instantiationService.invokeFunction((accessor) => {
                const workspaceContextService = accessor.get(IWorkspaceContextService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                const wizard = new ProjectWizard(
                        instantiationService,
                        workspaceContextService,
                        notificationService,
                        logService,
                );

                return wizard.show();
        });
}
