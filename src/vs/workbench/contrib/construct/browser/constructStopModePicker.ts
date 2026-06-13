// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExecutionMode, IExecutionModeConfig } from '../../../../platform/construct/common/agent/executionMode.js';
import { IMilestone } from '../../../../platform/construct/common/agent/milestoneStateMachine.js';
import * as Nls from './constructNls.js';

/**
 * KOVIX — Stop Mode Picker
 *
 * Full-panel overlay rendered inside the agent view after the user approves
 * a plan with task deselection. Lets the user pick how autonomous the agent
 * should be during execution by selecting one of four stop modes.
 */

interface IModeOption {
        mode: ExecutionMode;
        label: string;
        badge: string;
        badgeColor: string;
        description: string;
        detailLines?: string[];
}

const MODE_OPTIONS: IModeOption[] = [
        {
                mode: ExecutionMode.EVERY_MILESTONE,
                label: Nls.MODE_EVERY_MILESTONE,
                badge: Nls.MODE_EVERY_MILESTONE_BADGE,
                badgeColor: '#4ADE80',
                description: Nls.MODE_EVERY_MILESTONE_DESC,
        },
        {
                mode: ExecutionMode.MAJOR_MILESTONE,
                label: Nls.MODE_MAJOR_MILESTONE,
                badge: Nls.MODE_MAJOR_MILESTONE_BADGE,
                badgeColor: '#00E5FF',
                description: Nls.MODE_MAJOR_MILESTONE_DESC,
        },
        {
                mode: ExecutionMode.SELECTIVE,
                label: Nls.MODE_SELECTIVE,
                badge: Nls.MODE_SELECTIVE_BADGE,
                badgeColor: '#FACC15',
                description: Nls.MODE_SELECTIVE_DESC,
        },
        {
                mode: ExecutionMode.FULL_AUTO,
                label: Nls.MODE_FULL_AUTO,
                badge: Nls.MODE_FULL_AUTO_BADGE,
                badgeColor: '#F87171',
                description: Nls.MODE_FULL_AUTO_DESC,
        },
];

export class ConstructStopModePicker extends Disposable {

        private readonly milestones: IMilestone[];
        private readonly onExecute: (mode: IExecutionModeConfig) => void;
        private readonly onBack: () => void;

        private selectedMode: ExecutionMode = ExecutionMode.MAJOR_MILESTONE;
        private selectedMilestoneIds: Set<string> = new Set();

        private rootElement!: HTMLElement;
        private selectiveChecklistElement!: HTMLElement;
        private fullAutoWarningElement!: HTMLElement;
        private executeButton!: HTMLElement;

        constructor(
                milestones: IMilestone[],
                onExecute: (mode: IExecutionModeConfig) => void,
                onBack: () => void,
        ) {
                super();
                this.milestones = milestones;
                this.onExecute = onExecute;
                this.onBack = onBack;

                // Pre-select all major milestones for the SELECTIVE mode default
                for (const m of this.milestones) {
                        if (m.isMajor) {
                                this.selectedMilestoneIds.add(m.id);
                        }
                }
        }

        render(container: HTMLElement): void {
                this.rootElement = dom.$('.construct-stop-mode-picker');
                this.rootElement.setAttribute('role', 'listbox');
                this.rootElement.setAttribute('aria-label', Nls.SELECT_EXECUTION_MODE);
                this.rootElement.style.cssText = `
                        background: #0D1117;
                        border: 1px solid #1A1F2E;
                        border-radius: 8px;
                        padding: 20px 24px;
                        font-size: 13px;
                        color: #E0E7FF;
                        display: flex;
                        flex-direction: column;
                        gap: 0;
                `;

                // ── Title ──
                const titleRow = dom.$('.construct-stop-mode-title');
                titleRow.style.cssText = `
                        display: flex; align-items: center; gap: 8px;
                        margin-bottom: 20px; font-size: 16px; font-weight: 600;
                        color: #E0E7FF;
                `;
                const titleIcon = dom.$('.construct-stop-mode-title-icon');
                titleIcon.textContent = '⚡';
                titleIcon.style.cssText = `font-size: 18px;`;
                const titleText = dom.$('.construct-stop-mode-title-text');
                titleText.textContent = Nls.HOW_AUTONOMOUS;
                titleRow.appendChild(titleIcon);
                titleRow.appendChild(titleText);
                this.rootElement.appendChild(titleRow);

                // ── Mode options ──
                const optionsContainer = dom.$('.construct-stop-mode-options');
                optionsContainer.setAttribute('role', 'presentation');
                optionsContainer.style.cssText = `
                        display: flex; flex-direction: column; gap: 4px;
                `;

                for (const option of MODE_OPTIONS) {
                        this.createModeOption(optionsContainer, option);
                }

                this.rootElement.appendChild(optionsContainer);

                // ── Footer buttons ──
                const footer = dom.$('.construct-stop-mode-footer');
                footer.style.cssText = `
                        display: flex; justify-content: center; align-items: center;
                        gap: 12px; margin-top: 24px; padding-top: 16px;
                        border-top: 1px solid #1A1F2E;
                `;

                const backButton = dom.$('button.construct-stop-mode-back');
                backButton.textContent = Nls.BACK_TO_PLAN;
                backButton.setAttribute('aria-label', 'Back to plan review');
                backButton.style.cssText = `
                        background: transparent;
                        border: 1px solid #1A1F2E;
                        color: #8892A8;
                        padding: 8px 18px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 13px;
                        font-family: inherit;
                        transition: background 0.15s, border-color 0.15s;
                `;
                backButton.addEventListener('mouseenter', () => {
                        backButton.style.background = '#1A1F2E';
                        backButton.style.borderColor = '#2D3548';
                });
                backButton.addEventListener('mouseleave', () => {
                        backButton.style.background = 'transparent';
                        backButton.style.borderColor = '#1A1F2E';
                });
                backButton.addEventListener('click', () => this.onBack());

                this.executeButton = dom.$('button.construct-stop-mode-execute');
                this.executeButton.textContent = Nls.EXECUTE;
                this.executeButton.setAttribute('aria-label', 'Execute with selected mode');
                this.executeButton.style.cssText = `
                        background: #00E5FF;
                        border: none;
                        color: #0D1117;
                        padding: 8px 22px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 13px;
                        font-weight: 600;
                        font-family: inherit;
                        transition: background 0.15s, opacity 0.15s;
                `;
                this.executeButton.addEventListener('mouseenter', () => {
                        this.executeButton.style.background = '#33EBFF';
                });
                this.executeButton.addEventListener('mouseleave', () => {
                        this.executeButton.style.background = '#00E5FF';
                });
                this.executeButton.addEventListener('click', () => this.handleExecute());

                footer.appendChild(backButton);
                footer.appendChild(this.executeButton);
                this.rootElement.appendChild(footer);

                container.appendChild(this.rootElement);

                // Set initial visibility for contextual panels
                this.updateContextualPanels();
        }

        private createModeOption(parent: HTMLElement, option: IModeOption): void {
                const row = dom.$('.construct-stop-mode-option');
                row.setAttribute('role', 'option');
                row.setAttribute('aria-selected', String(this.selectedMode === option.mode));
                row.setAttribute('aria-label', option.label);
                row.style.cssText = `
                        display: flex; flex-direction: column;
                        padding: 12px 14px; border-radius: 6px;
                        cursor: pointer; border: 1px solid transparent;
                        transition: background 0.15s, border-color 0.15s;
                `;
                row.dataset.mode = option.mode;

                // Header line: radio + label + badge
                const headerLine = dom.$('.construct-stop-mode-option-header');
                headerLine.style.cssText = `
                        display: flex; align-items: center; gap: 10px;
                `;

                // Radio indicator
                const radio = dom.$('.construct-stop-mode-radio');
                radio.style.cssText = `
                        width: 16px; height: 16px; border-radius: 50%;
                        border: 2px solid #4A5568; flex-shrink: 0;
                        display: flex; align-items: center; justify-content: center;
                        transition: border-color 0.15s;
                `;
                const radioInner = dom.$('.construct-stop-mode-radio-inner');
                radioInner.style.cssText = `
                        width: 8px; height: 8px; border-radius: 50%;
                        background: transparent; transition: background 0.15s;
                `;
                radio.appendChild(radioInner);

                // Label
                const label = dom.$('.construct-stop-mode-option-label');
                label.textContent = option.label;
                label.style.cssText = `
                        color: #E0E7FF; font-weight: 500;
                `;

                // Badge
                const badge = dom.$('.construct-stop-mode-option-badge');
                badge.textContent = option.badge;
                badge.style.cssText = `
                        margin-left: auto; font-size: 11px; font-weight: 600;
                        padding: 2px 8px; border-radius: 10px;
                        background: ${option.badgeColor}1A;
                        color: ${option.badgeColor};
                        flex-shrink: 0;
                `;

                headerLine.appendChild(radio);
                headerLine.appendChild(label);
                headerLine.appendChild(badge);
                row.appendChild(headerLine);

                // Description line
                const descLine = dom.$('.construct-stop-mode-option-desc');
                descLine.textContent = option.description;
                descLine.style.cssText = `
                        color: #8892A8; font-size: 12px;
                        padding-left: 26px; margin-top: 4px;
                `;
                row.appendChild(descLine);

                // Detail lines (for MAJOR_MILESTONE preview, populated dynamically)
                if (option.mode === ExecutionMode.MAJOR_MILESTONE) {
                        const detailContainer = dom.$('.construct-stop-mode-option-details');
                        detailContainer.style.cssText = `
                                padding-left: 26px; margin-top: 4px;
                                display: none;
                        `;
                        // Content will be populated dynamically by updateMajorMilestoneDetails()
                        row.appendChild(detailContainer);
                } else if (option.detailLines && option.detailLines.length > 0) {
                        const detailContainer = dom.$('.construct-stop-mode-option-details');
                        detailContainer.style.cssText = `
                                padding-left: 26px; margin-top: 4px;
                                display: none;
                        `;
                        for (const line of option.detailLines) {
                                const detailLine = dom.$('.construct-stop-mode-option-detail-line');
                                detailLine.textContent = `• ${line}`;
                                detailLine.style.cssText = `
                                        color: #6B7894; font-size: 11px; padding-left: 8px;
                                `;
                                detailContainer.appendChild(detailLine);
                        }
                        row.appendChild(detailContainer);
                }

                // SELECTIVE: checklist of milestones
                if (option.mode === ExecutionMode.SELECTIVE) {
                        this.selectiveChecklistElement = dom.$('.construct-stop-mode-selective-checklist');
                        this.selectiveChecklistElement.style.cssText = `
                                padding-left: 26px; margin-top: 8px;
                                display: none; flex-direction: column; gap: 4px;
                        `;
                        this.renderSelectiveChecklist(this.selectiveChecklistElement);
                        row.appendChild(this.selectiveChecklistElement);
                }

                // FULL_AUTO: warning banner
                if (option.mode === ExecutionMode.FULL_AUTO) {
                        this.fullAutoWarningElement = dom.$('.construct-stop-mode-fullauto-warning');
                        this.fullAutoWarningElement.style.cssText = `
                                padding-left: 26px; margin-top: 8px;
                                display: none;
                        `;
                        const warningBanner = dom.$('.construct-stop-mode-warning-banner');
                        warningBanner.style.cssText = `
                                background: #2D1414; border: 1px solid #5C1A1A;
                                border-radius: 4px; padding: 8px 12px;
                                display: flex; align-items: center; gap: 8px;
                                font-size: 12px;
                        `;
                        const warningIcon = dom.$('.construct-stop-mode-warning-icon');
                        warningIcon.textContent = '⚠';
                        warningIcon.style.cssText = `color: #FF4444; font-size: 14px; flex-shrink: 0;`;
                        const warningText = dom.$('.construct-stop-mode-warning-text');
                        warningText.textContent = Nls.CHANGES_WITHOUT_REVIEW;
                        warningText.style.cssText = `color: #FF6666;`;
                        warningBanner.appendChild(warningIcon);
                        warningBanner.appendChild(warningText);
                        this.fullAutoWarningElement.appendChild(warningBanner);
                        row.appendChild(this.fullAutoWarningElement);
                }

                // Click handler
                row.addEventListener('click', () => {
                        this.selectedMode = option.mode;
                        this.updateRadioStates();
                        this.updateContextualPanels();
                });

                // Hover effects
                row.addEventListener('mouseenter', () => {
                        if (this.selectedMode !== option.mode) {
                                row.style.background = '#0F1520';
                                row.style.borderColor = '#1A1F2E';
                        }
                });
                row.addEventListener('mouseleave', () => {
                        if (this.selectedMode !== option.mode) {
                                row.style.background = 'transparent';
                                row.style.borderColor = 'transparent';
                        }
                });

                parent.appendChild(row);
        }

        private renderSelectiveChecklist(container: HTMLElement): void {
                for (const milestone of this.milestones) {
                        const checkboxRow = dom.$('.construct-stop-mode-checkbox-row');
                        checkboxRow.style.cssText = `
                                display: flex; align-items: center; gap: 8px;
                                padding: 4px 8px; border-radius: 4px;
                                cursor: pointer; transition: background 0.1s;
                        `;

                        const isChecked = this.selectedMilestoneIds.has(milestone.id);

                        // Custom checkbox
                        const checkbox = dom.$('.construct-stop-mode-checkbox');
                        checkbox.style.cssText = `
                                width: 16px; height: 16px; border-radius: 3px;
                                border: 1.5px solid ${isChecked ? '#00E5FF' : '#4A5568'};
                                background: ${isChecked ? '#00E5FF1A' : 'transparent'};
                                display: flex; align-items: center; justify-content: center;
                                flex-shrink: 0; transition: border-color 0.15s, background 0.15s;
                        `;
                        const checkMark = dom.$('.construct-stop-mode-checkmark');
                        checkMark.textContent = '✓';
                        checkMark.style.cssText = `
                                font-size: 11px; font-weight: 700;
                                color: ${isChecked ? '#00E5FF' : 'transparent'};
                                transition: color 0.15s;
                        `;
                        checkbox.appendChild(checkMark);

                        // Label
                        const checkboxLabel = dom.$('.construct-stop-mode-checkbox-label');
                        checkboxLabel.textContent = milestone.label;
                        checkboxLabel.style.cssText = `
                                color: #C0C8D8; font-size: 12px;
                        `;

                        // Major indicator
                        if (milestone.isMajor) {
                                const majorTag = dom.$('.construct-stop-mode-major-tag');
                                majorTag.textContent = Nls.MAJOR_TAG;
                                majorTag.style.cssText = `
                                        margin-left: auto; font-size: 10px; color: #4A5568;
                                        padding: 1px 6px; border-radius: 3px;
                                        background: #1A1F2E;
                                `;
                                checkboxRow.appendChild(checkbox);
                                checkboxRow.appendChild(checkboxLabel);
                                checkboxRow.appendChild(majorTag);
                        } else {
                                checkboxRow.appendChild(checkbox);
                                checkboxRow.appendChild(checkboxLabel);
                        }

                        // Toggle handler
                        checkboxRow.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (this.selectedMilestoneIds.has(milestone.id)) {
                                        this.selectedMilestoneIds.delete(milestone.id);
                                } else {
                                        this.selectedMilestoneIds.add(milestone.id);
                                }
                                this.updateCheckboxState(checkbox, checkMark, this.selectedMilestoneIds.has(milestone.id));
                        });

                        // Hover
                        checkboxRow.addEventListener('mouseenter', () => {
                                checkboxRow.style.background = '#0F1520';
                        });
                        checkboxRow.addEventListener('mouseleave', () => {
                                checkboxRow.style.background = 'transparent';
                        });

                        container.appendChild(checkboxRow);
                }
        }

        private updateCheckboxState(checkbox: HTMLElement, checkmark: HTMLElement, checked: boolean): void {
                checkbox.style.borderColor = checked ? '#00E5FF' : '#4A5568';
                checkbox.style.background = checked ? '#00E5FF1A' : 'transparent';
                checkmark.style.color = checked ? '#00E5FF' : 'transparent';
        }

        private updateRadioStates(): void {
                const rows = this.rootElement.querySelectorAll<HTMLElement>('.construct-stop-mode-option');
                for (const row of rows) {
                        const mode = row.dataset.mode as ExecutionMode;
                        const isSelected = mode === this.selectedMode;
                        const radio = row.querySelector<HTMLElement>('.construct-stop-mode-radio');
                        const radioInner = row.querySelector<HTMLElement>('.construct-stop-mode-radio-inner');

                        // Update ARIA selected state
                        row.setAttribute('aria-selected', String(isSelected));

                        if (isSelected) {
                                row.style.background = '#0F1520';
                                row.style.borderColor = '#00E5FF33';
                                if (radio) {
                                        radio.style.borderColor = '#00E5FF';
                                }
                                if (radioInner) {
                                        radioInner.style.background = '#00E5FF';
                                }
                        } else {
                                row.style.background = 'transparent';
                                row.style.borderColor = 'transparent';
                                if (radio) {
                                        radio.style.borderColor = '#4A5568';
                                }
                                if (radioInner) {
                                        radioInner.style.background = 'transparent';
                                }
                        }
                }
        }

        private updateContextualPanels(): void {
                // SELECTIVE checklist
                if (this.selectiveChecklistElement) {
                        this.selectiveChecklistElement.style.display =
                                this.selectedMode === ExecutionMode.SELECTIVE ? 'flex' : 'none';
                }

                // FULL_AUTO warning
                if (this.fullAutoWarningElement) {
                        this.fullAutoWarningElement.style.display =
                                this.selectedMode === ExecutionMode.FULL_AUTO ? 'block' : 'none';
                }

                // MAJOR_MILESTONE detail lines — show major milestone labels as preview
                const majorDetailContainers = this.rootElement.querySelectorAll<HTMLElement>(
                        `.construct-stop-mode-option[data-mode="${ExecutionMode.MAJOR_MILESTONE}"] .construct-stop-mode-option-details`
                );
                for (const detailContainer of majorDetailContainers) {
                        detailContainer.style.display =
                                this.selectedMode === ExecutionMode.MAJOR_MILESTONE ? 'block' : 'none';
                }

                // Populate MAJOR_MILESTONE detail lines dynamically from milestones
                if (this.selectedMode === ExecutionMode.MAJOR_MILESTONE) {
                        this.updateMajorMilestoneDetails();
                }
        }

        private updateMajorMilestoneDetails(): void {
                const detailContainer = this.rootElement.querySelector<HTMLElement>(
                        `.construct-stop-mode-option[data-mode="${ExecutionMode.MAJOR_MILESTONE}"] .construct-stop-mode-option-details`
                );
                if (!detailContainer) {
                        return;
                }

                // Clear and repopulate with current major milestones
                detailContainer.textContent = '';
                const majorMilestones = this.milestones.filter(m => m.isMajor);
                if (majorMilestones.length === 0) {
                        const noMajors = dom.$('.construct-stop-mode-option-detail-line');
                        noMajors.textContent = `• ${Nls.NO_MAJOR_MILESTONES}`;
                        noMajors.style.cssText = `
                                color: #6B7894; font-size: 11px; padding-left: 8px;
                                font-style: italic;
                        `;
                        detailContainer.appendChild(noMajors);
                } else {
                        for (const m of majorMilestones) {
                                const detailLine = dom.$('.construct-stop-mode-option-detail-line');
                                detailLine.textContent = `• ${m.label}`;
                                detailLine.style.cssText = `
                                        color: #6B7894; font-size: 11px; padding-left: 8px;
                                `;
                                detailContainer.appendChild(detailLine);
                        }
                }
        }

        private handleExecute(): void {
                const config: IExecutionModeConfig = {
                        mode: this.selectedMode,
                };

                if (this.selectedMode === ExecutionMode.SELECTIVE) {
                        config.selectedMilestoneIds = Array.from(this.selectedMilestoneIds);
                }

                this.onExecute(config);
        }

        override dispose(): void {
                if (this.rootElement) {
                        this.rootElement.remove();
                }
                super.dispose();
        }
}

/**
 * Promise-based convenience wrapper around {@link ConstructStopModePicker}.
 *
 * Renders the stop mode picker inside `container` and returns a promise that
 * resolves with the chosen {@link IExecutionModeConfig} (which includes both
 * the {@link ExecutionMode} and, for `SELECTIVE` mode, the selected milestone IDs),
 * or `undefined` if the user clicks "Back to Plan".
 *
 * @param container - DOM element to render the picker into
 * @param milestones - The milestones extracted from the approved plan
 * @returns The selected execution mode configuration, or undefined if dismissed
 */
export function showStopModePicker(
        container: HTMLElement,
        milestones: IMilestone[],
): Promise<IExecutionModeConfig | undefined> {
        return new Promise<IExecutionModeConfig | undefined>((resolve) => {
                const picker = new ConstructStopModePicker(
                        milestones,
                        (modeConfig: IExecutionModeConfig) => {
                                picker.dispose();
                                resolve(modeConfig);
                        },
                        () => {
                                picker.dispose();
                                resolve(undefined);
                        },
                );
                picker.render(container);
        });
}
