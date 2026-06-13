// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { LoadingState, LoadingPhase, FileChangeEntry, TaskMetrics, LOADING_PHASE_LABELS } from '../../../../platform/construct/common/agent/loadingState.js';

/**
 * Reusable spinner that cycles through braille characters.
 * Creates a simple text-based animation without requiring CSS keyframes.
 */
export class SpinnerIndicator extends Disposable {
        private frame = 0;
        private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        private timerId: number | undefined;
        readonly element: HTMLElement;

        constructor(parent: HTMLElement) {
                super();
                this.element = dom.$('.construct-spinner-char');
                this.element.style.cssText = `
                        display: inline-block; width: 1.2em; text-align: center;
                        color: #00E5FF; font-size: 13px;
                `;
                parent.appendChild(this.element);
        }

        start(): void {
                this.stop();
                this.frame = 0;
                this.element.textContent = this.frames[0];
                this.timerId = window.setInterval(() => {
                        this.frame = (this.frame + 1) % this.frames.length;
                        this.element.textContent = this.frames[this.frame];
                }, 80);
        }

        stop(): void {
                if (this.timerId !== undefined) {
                        clearInterval(this.timerId);
                        this.timerId = undefined;
                }
        }

        override dispose(): void {
                this.stop();
                super.dispose();
        }
}

/**
 * Renders a Unicode progress bar like [████████░░░░] 45%.
 * Used for terminal commands and other operations with known progress.
 */
export class ProgressBar {
        private readonly element: HTMLElement;
        private readonly barElement: HTMLElement;
        private readonly labelElement: HTMLElement;

        constructor(parent: HTMLElement) {
                this.element = dom.$('.construct-progress-bar');
                this.element.style.cssText = `
                        display: flex; align-items: center; gap: 6px;
                        margin: 2px 0 2px 20px; font-size: 11px;
                        font-family: monospace;
                `;

                this.barElement = dom.$('.construct-progress-bar-fill');
                this.barElement.style.cssText = `
                        color: #00E5FF; white-space: pre;
                `;

                this.labelElement = dom.$('.construct-progress-bar-label');
                this.labelElement.style.cssText = `
                        color: #4A5568;
                `;

                this.element.appendChild(this.barElement);
                this.element.appendChild(this.labelElement);
                parent.appendChild(this.element);
        }

        render(percent: number, width: number = 20): void {
                const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
                const empty = width - filled;
                this.barElement.textContent = `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
                this.labelElement.textContent = `${Math.round(percent)}%`;
        }

        setVisible(visible: boolean): void {
                this.element.style.display = visible ? 'flex' : 'none';
        }

        remove(): void {
                this.element.remove();
        }
}

/**
 * Shows elapsed time like "12.3s elapsed".
 * Updates in real-time while running.
 */
export class ElapsedTimer extends Disposable {
        private readonly startTime: number;
        private readonly element: HTMLElement;
        private timerId: number | undefined;

        constructor(parent: HTMLElement, startTime: number) {
                super();
                this.startTime = startTime;
                this.element = dom.$('.construct-elapsed-timer');
                this.element.style.cssText = `
                        display: inline-block; font-size: 11px;
                        color: #4A5568; font-family: monospace;
                        margin-left: 6px;
                `;
                this.update();
                this.timerId = window.setInterval(() => this.update(), 100);
                parent.appendChild(this.element);
        }

        private update(): void {
                const elapsed = (Date.now() - this.startTime) / 1000;
                this.element.textContent = `${elapsed.toFixed(1)}s`;
        }

        stop(): string {
                if (this.timerId !== undefined) {
                        clearInterval(this.timerId);
                        this.timerId = undefined;
                }
                const elapsed = (Date.now() - this.startTime) / 1000;
                this.element.textContent = `${elapsed.toFixed(1)}s`;
                return `${elapsed.toFixed(1)}s`;
        }

        override dispose(): void {
                this.stop();
                super.dispose();
        }
}

/**
 * Tracks and renders file changes as a real-time tree view.
 * Shows created/modified/deleted files with icons and timestamps.
 */
export class FileTreeDiff extends Disposable {
        private readonly files = new Map<string, FileChangeEntry>();
        private readonly element: HTMLElement;
        private readonly headerElement: HTMLElement;
        private readonly treeElement: HTMLElement;

        constructor(parent: HTMLElement) {
                super();
                this.element = dom.$('.construct-file-tree-diff');
                this.element.style.cssText = `
                        margin: 8px 0; padding: 6px 8px;
                        background: #0A0E1A; border: 1px solid #1A1F2E;
                        border-radius: 4px; font-size: 11px;
                        font-family: monospace; display: none;
                `;

                this.headerElement = dom.$('.construct-file-tree-header');
                this.headerElement.style.cssText = `
                        font-weight: 600; color: #E0E7FF; margin-bottom: 4px;
                `;
                this.headerElement.textContent = 'Files changed:';

                this.treeElement = dom.$('.construct-file-tree-body');
                this.treeElement.style.cssText = `
                        white-space: pre-wrap; color: #C0C0C0;
                `;

                this.element.appendChild(this.headerElement);
                this.element.appendChild(this.treeElement);
                parent.appendChild(this.element);
        }

        addFile(path: string, status: FileChangeEntry['status']): void {
                this.files.set(path, { path, status, timestamp: Date.now() });
                this.render();
                this.element.style.display = 'block';
        }

        private render(): void {
                this.treeElement.textContent = '';
                const lines: string[] = [];

                // Group files by directory
                const sorted = Array.from(this.files.values()).sort((a, b) => a.path.localeCompare(b.path));
                const dirs = new Map<string, Array<{ path: string; status: FileChangeEntry['status'] }>>();

                for (const entry of sorted) {
                        const parts = entry.path.split('/');
                        const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                        if (!dirs.has(dir)) {
                                dirs.set(dir, []);
                        }
                        dirs.get(dir)!.push({ path: entry.path, status: entry.status });
                }

                for (const [dir, files] of Array.from(dirs.entries())) {
                        if (dir) {
                                lines.push(`📁 ${dir}/`);
                                for (const file of files) {
                                        const fileName = file.path.split('/').pop() ?? file.path;
                                        const icon = this.getStatusIcon(file.status);
                                        const label = this.getStatusLabel(file.status);
                                        lines.push(`   ${icon} ${fileName}  [${label}]`);
                                }
                        } else {
                                for (const file of files) {
                                        const icon = this.getStatusIcon(file.status);
                                        const label = this.getStatusLabel(file.status);
                                        lines.push(`${icon} ${file.path}  [${label}]`);
                                }
                        }
                }

                this.headerElement.textContent = `Files changed: (${this.files.size})`;
                this.treeElement.textContent = lines.join('\n');
        }

        private getStatusIcon(status: FileChangeEntry['status']): string {
                switch (status) {
                        case 'created': return '📄';
                        case 'modified': return '✏️';
                        case 'deleted': return '🗑️';
                        case 'reading': return '📖';
                        case 'writing': return '✏️';
                        default: return '•';
                }
        }

        private getStatusLabel(status: FileChangeEntry['status']): string {
                switch (status) {
                        case 'created': return 'created';
                        case 'modified': return 'modified';
                        case 'deleted': return 'deleted';
                        case 'reading': return 'reading...';
                        case 'writing': return 'writing...';
                        default: return status;
                }
        }

        clear(): void {
                this.files.clear();
                this.element.style.display = 'none';
                this.treeElement.textContent = '';
        }

        override dispose(): void {
                this.element.remove();
                super.dispose();
        }
}

/**
 * Main progress panel that orchestrates all loading state UI.
 * Renders phase indicators, step progress, tool details, progress bars,
 * file tree diffs, error recovery, and performance metrics.
 */
export class ConstructProgressPanel extends Disposable {
        private readonly container: HTMLElement;

        // Sub-components
        private readonly spinner: SpinnerIndicator;
        private readonly phaseLabel: HTMLElement;
        private readonly stepLine: HTMLElement;
        private readonly toolDetail: HTMLElement;
        private readonly progressBar: ProgressBar;
        private readonly fileTree: FileTreeDiff;
        private readonly errorPanel: HTMLElement;
        private readonly metricsPanel: HTMLElement;

        // State
        private currentTimer: ElapsedTimer | undefined;
        private currentStep = 0;
        private totalSteps = 0;

        constructor(parent: HTMLElement) {
                super();

                this.container = dom.$('.construct-progress-panel');
                this.container.style.cssText = `
                        background: #141B2D; border: 1px solid #1A1F2E;
                        border-radius: 6px; padding: 10px 12px; margin: 6px 0;
                        font-size: 12px; display: none;
                `;

                // Phase line: [spinner] [phase label] [timer]
                const phaseLine = dom.$('.construct-phase-line');
                phaseLine.style.cssText = `display: flex; align-items: center; gap: 6px; margin-bottom: 4px;`;

                this.spinner = this._register(new SpinnerIndicator(phaseLine));

                this.phaseLabel = dom.$('.construct-phase-label');
                this.phaseLabel.style.cssText = `color: #E0E7FF; font-weight: 500; flex: 1;`;

                const timerContainer = dom.$('.construct-phase-timer');
                timerContainer.style.cssText = `display: inline-block;`;

                phaseLine.appendChild(this.phaseLabel);
                phaseLine.appendChild(timerContainer);
                this.container.appendChild(phaseLine);

                // Step line: "Step 2 of 4: Creating components"
                this.stepLine = dom.$('.construct-step-line');
                this.stepLine.style.cssText = `
                        color: #C0C0C0; padding-left: 22px; margin-bottom: 2px;
                        font-size: 11px;
                `;
                this.container.appendChild(this.stepLine);

                // Tool detail: "📖 Reading: src/App.tsx"
                this.toolDetail = dom.$('.construct-tool-detail');
                this.toolDetail.style.cssText = `
                        color: #8892A8; padding-left: 22px; font-size: 11px;
                        font-family: monospace; margin-bottom: 2px;
                `;
                this.container.appendChild(this.toolDetail);

                // Progress bar
                this.progressBar = new ProgressBar(this.container);

                // File tree diff
                this.fileTree = this._register(new FileTreeDiff(this.container));

                // Error panel
                this.errorPanel = dom.$('.construct-error-panel');
                this.errorPanel.style.cssText = `
                        margin-top: 6px; padding: 6px 8px;
                        background: #2D1414; border: 1px solid #5C1A1A;
                        border-radius: 4px; color: #FF6666;
                        font-size: 11px; display: none;
                `;
                this.container.appendChild(this.errorPanel);

                // Metrics panel
                this.metricsPanel = dom.$('.construct-metrics-panel');
                this.metricsPanel.style.cssText = `
                        margin-top: 6px; padding: 6px 8px;
                        background: #0D1F0D; border: 1px solid #1A3D1A;
                        border-radius: 4px; color: #66FF66;
                        font-size: 11px; font-family: monospace;
                        white-space: pre-wrap; display: none;
                `;
                this.container.appendChild(this.metricsPanel);

                parent.appendChild(this.container);
        }

        /**
         * Update the panel based on a new loading state.
         */
        updateState(state: LoadingState): void {
                this.container.style.display = 'block';

                // Phase label
                this.phaseLabel.textContent = state.message || LOADING_PHASE_LABELS[state.phase];

                // Spinner
                if (this.isAnimatedPhase(state.phase)) {
                        this.spinner.start();
                } else {
                        this.spinner.stop();
                        if (state.phase === 'complete') {
                                this.spinner.element.textContent = '✅';
                        } else if (state.phase === 'error') {
                                this.spinner.element.textContent = '❌';
                        } else if (state.phase === 'idle') {
                                this.spinner.element.textContent = '●';
                        } else {
                                this.spinner.element.textContent = '●';
                        }
                }

                // Step line
                if (state.stepNumber !== undefined && state.totalSteps !== undefined) {
                        this.stepLine.textContent = `Step ${state.stepNumber} of ${state.totalSteps}`;
                        this.stepLine.style.display = 'block';
                        this.currentStep = state.stepNumber;
                        this.totalSteps = state.totalSteps;
                } else if (state.stepNumber !== undefined) {
                        this.stepLine.textContent = `Step ${state.stepNumber}`;
                        this.stepLine.style.display = 'block';
                } else {
                        this.stepLine.style.display = 'none';
                }

                // Tool detail
                if (state.detail) {
                        const icon = this.getToolIcon(state.phase, state.toolName);
                        this.toolDetail.textContent = `${icon} ${state.detail}`;
                        this.toolDetail.style.display = 'block';
                } else if (state.filePath) {
                        const icon = this.getToolIcon(state.phase, state.toolName);
                        this.toolDetail.textContent = `${icon} ${state.filePath}`;
                        this.toolDetail.style.display = 'block';
                } else {
                        this.toolDetail.style.display = 'none';
                }

                // Progress bar
                if (state.progress !== undefined && state.progress >= 0) {
                        this.progressBar.render(state.progress);
                        this.progressBar.setVisible(true);
                } else if (state.phase === 'running-command') {
                        // Indeterminate command progress - show bar but no fill
                        this.progressBar.render(0);
                        this.progressBar.setVisible(true);
                } else {
                        this.progressBar.setVisible(false);
                }

                // Timer
                if (this.currentTimer) {
                        this.currentTimer.dispose();
                        this.currentTimer = undefined;
                }
                // Always show a timer for active phases
                if (this.isAnimatedPhase(state.phase)) {
                        const timerContainer = this.container.querySelector('.construct-phase-timer') as HTMLElement;
                        if (timerContainer) {
                                this.currentTimer = new ElapsedTimer(timerContainer, state.startTime);
                        }
                }

                // Hide error/metrics during active phases
                if (state.phase !== 'error') {
                        this.errorPanel.style.display = 'none';
                }
                if (state.phase !== 'complete') {
                        this.metricsPanel.style.display = 'none';
                }
        }

        /**
         * Add a file change to the file tree diff.
         */
        addFileChange(entry: FileChangeEntry): void {
                this.fileTree.addFile(entry.path, entry.status);
        }

        /**
         * Show an error with recovery options.
         */
        showError(errorText: string, stepNumber?: number, totalSteps?: number): void {
                this.spinner.stop();
                this.spinner.element.textContent = '❌';

                let content = '';
                if (stepNumber !== undefined && totalSteps !== undefined) {
                        content += `Step ${stepNumber} of ${totalSteps} failed\n`;
                }
                content += `${errorText}`;
                this.errorPanel.textContent = content;
                this.errorPanel.style.display = 'block';
        }

        /**
         * Show performance metrics at task completion.
         */
        showMetrics(metrics: TaskMetrics): void {
                this.spinner.stop();
                this.spinner.element.textContent = '✅';

                const totalElapsed = metrics.totalEndTime
                        ? ((metrics.totalEndTime - metrics.totalStartTime) / 1000).toFixed(1)
                        : '?';

                const planningElapsed = metrics.planningStartTime && metrics.planningEndTime
                        ? ((metrics.planningEndTime - metrics.planningStartTime) / 1000).toFixed(1)
                        : '?';

                const lines: string[] = [];
                lines.push(`Task complete! (${totalElapsed}s total)`);
                lines.push(`  Planning: ${planningElapsed}s`);

                for (const step of metrics.steps) {
                        const stepElapsed = step.endTime
                                ? ((step.endTime - step.startTime) / 1000).toFixed(1)
                                : '?';
                        lines.push(`  Step ${step.stepNumber} (${step.label}): ${stepElapsed}s`);
                        for (const sub of step.subSteps) {
                                const subElapsed = sub.endTime
                                        ? ((sub.endTime - sub.startTime) / 1000).toFixed(1)
                                        : '?';
                                lines.push(`    └─ ${sub.label}: ${subElapsed}s`);
                        }
                }
                lines.push(`  LLM calls: ${metrics.llmCallCount}`);

                this.metricsPanel.textContent = lines.join('\n');
                this.metricsPanel.style.display = 'block';
        }

        /**
         * Clear the panel and reset all state.
         */
        clear(): void {
                this.container.style.display = 'none';
                this.spinner.stop();
                this.phaseLabel.textContent = '';
                this.stepLine.textContent = '';
                this.stepLine.style.display = 'none';
                this.toolDetail.textContent = '';
                this.toolDetail.style.display = 'none';
                this.progressBar.setVisible(false);
                this.fileTree.clear();
                this.errorPanel.style.display = 'none';
                this.metricsPanel.style.display = 'none';
                this.currentStep = 0;
                this.totalSteps = 0;
                if (this.currentTimer) {
                        this.currentTimer.dispose();
                        this.currentTimer = undefined;
                }
        }

        /**
         * Get the current step number.
         */
        getCurrentStep(): number {
                return this.currentStep;
        }

        /**
         * Get the total steps.
         */
        getTotalSteps(): number {
                return this.totalSteps;
        }

        private isAnimatedPhase(phase: LoadingPhase): boolean {
                return phase !== 'idle' && phase !== 'complete' && phase !== 'error' && phase !== 'planning-complete';
        }

        private getToolIcon(phase: LoadingPhase, toolName?: string): string {
                if (toolName) {
                        switch (toolName) {
                                case 'read_file': return '📖';
                                case 'write_file': return '✏️';
                                case 'list_directory': return '📂';
                                case 'create_directory': return '📁';
                                case 'run_command': return '🖥️';
                                case 'edit_file': return '🔀';
                                default: return '🔧';
                        }
                }
                switch (phase) {
                        case 'reading-file': return '📖';
                        case 'writing-file': return '✏️';
                        case 'creating-directory': return '📁';
                        case 'running-command': return '🖥️';
                        case 'applying-diff': return '🔀';
                        case 'verifying': return '🔍';
                        case 'planning-reading': return '📖';
                        case 'planning-listing': return '📂';
                        default: return '🔧';
                }
        }

        override dispose(): void {
                if (this.currentTimer) {
                        this.currentTimer.dispose();
                        this.currentTimer = undefined;
                }
                this.container.remove();
                super.dispose();
        }
}

/**
 * Parse terminal output for progress indicators.
 * Detects npm/yarn percentage output and common progress patterns.
 */
export function parseTerminalProgress(output: string): number | undefined {
        // Match patterns like:
        // [##################] 45%
        // 45% complete
        // progress: 45%
        // npm: ... 45%
        const percentMatch = output.match(/(\d+)%/);
        if (percentMatch) {
                const pct = parseInt(percentMatch[1], 10);
                // Sanity check: only return reasonable percentages
                if (pct >= 0 && pct <= 100) {
                        return pct;
                }
        }
        return undefined;
}
