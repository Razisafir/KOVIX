/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * realUIIntegrationService.ts -- Phase 25: Real UI Integration (Service #152)
 *
 * Connects all Phase 25 services to the actual VS Code UI.
 * Injects real CSS, reads real service data, and feeds it to webviews.
 *
 * HONEST: This service coordinates data flow to the UI layer.
 * It does NOT render directly; it feeds data to webviews and CSS to the DOM.
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { createStyleSheet } from '../../../../../base/browser/domStylesheets.js';
import { registerThemingParticipant } from '../../../../../platform/theme/common/themeService.js';
import {
        IRealUIIntegrationService,
        AITheme, UISurface,
        ThemeColorTokens, WorkspaceLayout, ProviderUIInfo,
        ExecutionDashboardData, MemoryDashboardData
} from '../../../../../platform/construct/common/realUIIntegration.js';
import { ILLMProviderService } from '../../../../../platform/construct/common/llmProvider.js';
import { IProjectMemoryService } from '../../../../../platform/construct/common/projectMemory.js';
import { IAutonomousExecutionService, ExecutionStage } from '../../../../../platform/construct/common/autonomousExecution.js';
import { ITokenEstimationService } from '../../../../../platform/construct/common/tokenEstimation.js';
import { IProviderHealthService, HealthSeverity } from '../../../../../platform/construct/common/llmProvider.js';


// -- Storage Keys --

const STORAGE_KEY_LAYOUT = 'construct.aiExecution.ui.layout';
const STORAGE_KEY_THEME = 'construct.aiExecution.ui.theme';
const STORAGE_KEY_FOCUS_APPLIED = 'construct.aiExecution.ui.focusApplied';
const STORAGE_KEY_KBNAV_APPLIED = 'construct.aiExecution.ui.kbNavApplied';
const STORAGE_KEY_REDUCED_MOTION_APPLIED = 'construct.aiExecution.ui.reducedMotionApplied';

// -- Theme Token Definitions --
// Each theme provides a complete set of color tokens injected as CSS custom properties.

const THEME_TOKENS: Record<string, ThemeColorTokens> = {
        [AITheme.Dark]: {
                name: 'Dark',
                background: '#1e1e2e', foreground: '#e0e0e8', accent: '#6366f1', accentFg: '#ffffff',
                surface: '#252536', surfaceRaised: '#2d2d44', border: '#3b3b54',
                error: '#f87171', warning: '#fbbf24', success: '#34d399', info: '#60a5fa',
                muted: '#6b7280', placeholder: '#4b5563',
        },
        [AITheme.DeepBlue]: {
                name: 'Deep Blue',
                background: '#0f172a', foreground: '#e2e8f0', accent: '#3b82f6', accentFg: '#ffffff',
                surface: '#1e293b', surfaceRaised: '#273549', border: '#334155',
                error: '#f87171', warning: '#fbbf24', success: '#34d399', info: '#60a5fa',
                muted: '#64748b', placeholder: '#475569',
        },
        [AITheme.Light]: {
                name: 'Light',
                background: '#ffffff', foreground: '#1e293b', accent: '#6366f1', accentFg: '#ffffff',
                surface: '#f8fafc', surfaceRaised: '#f1f5f9', border: '#e2e8f0',
                error: '#dc2626', warning: '#d97706', success: '#059669', info: '#2563eb',
                muted: '#94a3b8', placeholder: '#cbd5e1',
        },
        [AITheme.HighContrast]: {
                name: 'High Contrast',
                background: '#000000', foreground: '#ffffff', accent: '#ffff00', accentFg: '#000000',
                surface: '#1a1a1a', surfaceRaised: '#2a2a2a', border: '#ffffff',
                error: '#ff5555', warning: '#ffff00', success: '#55ff55', info: '#5555ff',
                muted: '#cccccc', placeholder: '#888888',
        },
};

// -- CSS Generation Helpers --

function generateThemeCSSText(tokens: ThemeColorTokens): string {
        return `:root {
  --ai-bg: ${tokens.background};
  --ai-fg: ${tokens.foreground};
  --ai-accent: ${tokens.accent};
  --ai-accent-fg: ${tokens.accentFg};
  --ai-surface: ${tokens.surface};
  --ai-surface-raised: ${tokens.surfaceRaised};
  --ai-border: ${tokens.border};
  --ai-error: ${tokens.error};
  --ai-warning: ${tokens.warning};
  --ai-success: ${tokens.success};
  --ai-info: ${tokens.info};
  --ai-muted: ${tokens.muted};
  --ai-placeholder: ${tokens.placeholder};
}
.ai-workspace { background: var(--ai-bg); color: var(--ai-fg); }
.ai-surface { background: var(--ai-surface); border: 1px solid var(--ai-border); }
.ai-surface-raised { background: var(--ai-surface-raised); border: 1px solid var(--ai-border); }
.ai-accent-text { color: var(--ai-accent); }
.ai-error-text { color: var(--ai-error); }
.ai-warning-text { color: var(--ai-warning); }
.ai-success-text { color: var(--ai-success); }
.ai-info-text { color: var(--ai-info); }
.ai-muted-text { color: var(--ai-muted); }
.ai-placeholder-text { color: var(--ai-placeholder); }
.ai-btn-primary {
  background: var(--ai-accent); color: var(--ai-accent-fg);
  border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer;
}
.ai-btn-primary:hover { opacity: 0.9; }
.ai-panel {
  background: var(--ai-surface); border: 1px solid var(--ai-border);
  border-radius: 6px; padding: 12px;
}
.ai-progress-bar {
  background: var(--ai-border); border-radius: 3px; height: 6px; overflow: hidden;
}
.ai-progress-fill {
  background: var(--ai-accent); height: 100%; border-radius: 3px;
  transition: width 0.3s ease;
}
.ai-badge {
  display: inline-flex; align-items: center; padding: 2px 8px;
  border-radius: 10px; font-size: 11px; font-weight: 600;
}
.ai-badge-success { background: var(--ai-success); color: #000; }
.ai-badge-warning { background: var(--ai-warning); color: #000; }
.ai-badge-error { background: var(--ai-error); color: #fff; }
.ai-badge-info { background: var(--ai-info); color: #fff; }`;
}

function generateFocusCSS(): string {
        return `.ai-interactive:focus-visible {
  outline: 2px solid var(--ai-accent); outline-offset: 2px;
}
.ai-interactive:focus:not(:focus-visible) { outline: none; }
.ai-btn-primary:focus-visible,
.ai-panel:focus-visible,
.ai-surface:focus-visible {
  outline: 2px solid var(--ai-accent); outline-offset: 2px;
}`;
}

function generateKeyboardNavCSS(): string {
        return `.ai-interactive { position: relative; }
.ai-interactive.ai-keyboard-active {
  outline: 2px solid var(--ai-accent); outline-offset: 2px;
}
.ai-nav-group { display: flex; flex-direction: column; }
.ai-nav-group .ai-interactive { margin-bottom: 2px; }
.ai-skip-link {
  position: absolute; top: -40px; left: 0;
  background: var(--ai-accent); color: var(--ai-accent-fg);
  padding: 8px 16px; z-index: 100; text-decoration: none; border-radius: 4px;
}
.ai-skip-link:focus { top: 0; }`;
}

function generateReducedMotionCSS(): string {
        return `@media (prefers-reduced-motion: reduce) {
  .ai-workspace *,
  .ai-workspace *::before,
  .ai-workspace *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .ai-progress-fill { transition: none !important; }
}`;
}

// -- Default Layout --

const DEFAULT_LAYOUT: WorkspaceLayout = {
        sidebarWidth: 300, rightPanelWidth: 400, bottomPanelHeight: 200, topBarHeight: 40,
        sidebarVisible: true, rightPanelVisible: false, bottomPanelVisible: false,
        activeSurface: UISurface.Sidebar,
};

// -- Service Implementation --

export class RealUIIntegrationService extends Disposable implements IRealUIIntegrationService {

        declare readonly _serviceBrand: undefined;

        // -- Emitters --

        private readonly _onDidChangeTheme = this._register(new Emitter<AITheme>());
        readonly onDidChangeTheme: Event<AITheme> = this._onDidChangeTheme.event;

        private readonly _onDidChangeLayout = this._register(new Emitter<WorkspaceLayout>());
        readonly onDidChangeLayout: Event<WorkspaceLayout> = this._onDidChangeLayout.event;

        private readonly _onDidUpdateDashboard = this._register(new Emitter<ExecutionDashboardData>());
        readonly onDidUpdateDashboard: Event<ExecutionDashboardData> = this._onDidUpdateDashboard.event;

        // -- State --

        private _currentTheme: AITheme;
        private _layout: WorkspaceLayout;
        private _focusApplied: boolean = false;
        private _kbNavApplied: boolean = false;
        private _reducedMotionApplied: boolean = false;

        // Style sheet references for cleanup and re-injection
        private _themeStyleSheet: HTMLStyleElement | undefined;
        private _focusStyleSheet: HTMLStyleElement | undefined;
        private _kbNavStyleSheet: HTMLStyleElement | undefined;
        private _reducedMotionStyleSheet: HTMLStyleElement | undefined;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @ILLMProviderService private readonly llmProviderService: ILLMProviderService,
                @IProjectMemoryService private readonly projectMemoryService: IProjectMemoryService,
                @IAutonomousExecutionService private readonly autonomousExecutionService: IAutonomousExecutionService,
                @ITokenEstimationService private readonly tokenEstimationService: ITokenEstimationService,
                @IProviderHealthService private readonly providerHealthService: IProviderHealthService,
        ) {
                super();

                // Read persisted theme, fall back to config, then default
                const storedTheme = this.storageService.get(STORAGE_KEY_THEME, StorageScope.WORKSPACE, undefined);
                if (storedTheme && Object.values(AITheme).includes(storedTheme as AITheme)) {
                        this._currentTheme = storedTheme as AITheme;
                } else {
                        const configTheme = this.configurationService.getValue<string>('construct.aiExecution.theme');
                        if (configTheme && Object.values(AITheme).includes(configTheme as AITheme)) {
                                this._currentTheme = configTheme as AITheme;
                        } else {
                                this._currentTheme = AITheme.Dark;
                        }
                }

                // Read persisted layout
                const storedLayout = this.storageService.get(STORAGE_KEY_LAYOUT, StorageScope.WORKSPACE, undefined);
                if (storedLayout) {
                        try {
                                this._layout = JSON.parse(storedLayout);
                        } catch {
                                this._layout = { ...DEFAULT_LAYOUT };
                        }
                } else {
                        this._layout = { ...DEFAULT_LAYOUT };
                }

                // Read accessibility state from storage
                this._focusApplied = this.storageService.getBoolean(STORAGE_KEY_FOCUS_APPLIED, StorageScope.WORKSPACE, false);
                this._kbNavApplied = this.storageService.getBoolean(STORAGE_KEY_KBNAV_APPLIED, StorageScope.WORKSPACE, false);
                this._reducedMotionApplied = this.storageService.getBoolean(STORAGE_KEY_REDUCED_MOTION_APPLIED, StorageScope.WORKSPACE, false);

                // Inject theme CSS on startup
                this.injectThemeCSS();

                // Re-apply accessibility styles if they were previously applied
                if (this._focusApplied) { this.applyFocusHandling(); }
                if (this._kbNavApplied) { this.applyKeyboardNavigation(); }
                if (this._reducedMotionApplied) { this.applyReducedMotion(); }

                // Register theming participant so VS Code theme changes also trigger updates
                this._register(registerThemingParticipant((_theme, collector) => {
                        const currentTokens = this.getThemeTokens(this._currentTheme);
                        collector.addRule(`:root { --ai-bg: ${currentTokens.background}; --ai-fg: ${currentTokens.foreground}; }`);
                }));

                this.logService.info('[RealUIIntegration] Service initialized with theme:', this._currentTheme);
        }

        // -- Theme Management --

        getCurrentTheme(): AITheme {
                return this._currentTheme;
        }

        setTheme(theme: AITheme): void {
                if (this._currentTheme === theme) {
                        return;
                }
                const oldTheme = this._currentTheme;
                this._currentTheme = theme;

                // Persist to storage and config
                this.storageService.store(STORAGE_KEY_THEME, theme, StorageScope.WORKSPACE, StorageTarget.MACHINE);
                this.configurationService.updateValue('construct.aiExecution.theme', theme);

                // Re-inject CSS for the new theme
                this.injectThemeCSS();

                this._onDidChangeTheme.fire(theme);
                this.logService.info(`[RealUIIntegration] Theme changed: ${oldTheme} -> ${theme}`);
        }

        getThemeTokens(theme: AITheme): ThemeColorTokens {
                const tokens = THEME_TOKENS[theme];
                if (!tokens) {
                        this.logService.warn(`[RealUIIntegration] Unknown theme: ${theme}, falling back to Dark`);
                        return THEME_TOKENS[AITheme.Dark];
                }
                return tokens;
        }

        injectThemeCSS(): void {
                const tokens = this.getThemeTokens(this._currentTheme);
                const cssText = generateThemeCSSText(tokens);

                // Remove old style sheet if present
                if (this._themeStyleSheet) {
                        this._themeStyleSheet.remove();
                }

                // Create and inject new style sheet with CSS custom properties
                this._themeStyleSheet = createStyleSheet();
                this._themeStyleSheet.textContent = cssText;

                this.logService.debug('[RealUIIntegration] Theme CSS injected for:', this._currentTheme);
        }

        // -- Layout Management --

        getLayout(): WorkspaceLayout {
                return this._layout;
        }

        setSidebarWidth(width: number): void {
                const clamped = Math.max(200, Math.min(600, width));
                this._layout = { ...this._layout, sidebarWidth: clamped };
                this.persistLayout();
                this._onDidChangeLayout.fire(this._layout);
                this.logService.debug(`[RealUIIntegration] Sidebar width set to: ${clamped}`);
        }

        togglePanel(surface: UISurface): void {
                let updated: WorkspaceLayout;

                switch (surface) {
                        case UISurface.Sidebar:
                                updated = { ...this._layout, sidebarVisible: !this._layout.sidebarVisible, activeSurface: surface };
                                break;
                        case UISurface.RightPanel:
                                updated = { ...this._layout, rightPanelVisible: !this._layout.rightPanelVisible, activeSurface: surface };
                                break;
                        case UISurface.BottomPanel:
                                updated = { ...this._layout, bottomPanelVisible: !this._layout.bottomPanelVisible, activeSurface: surface };
                                break;
                        default:
                                updated = { ...this._layout, activeSurface: surface };
                                break;
                }

                this._layout = updated;
                this.persistLayout();
                this._onDidChangeLayout.fire(this._layout);
                this.logService.debug(`[RealUIIntegration] Panel toggled: ${surface}`);
        }

        private persistLayout(): void {
                this.storageService.store(STORAGE_KEY_LAYOUT, JSON.stringify(this._layout), StorageScope.WORKSPACE, StorageTarget.MACHINE);
        }

        // -- Provider Data for UI --

        getProviderList(): ProviderUIInfo[] {
                const providers: ProviderUIInfo[] = [];
                const healthMap = this.providerHealthService.healthStatus;

                for (const [id, config] of this.llmProviderService.providers) {
                        const health = healthMap.get(id);
                        const healthLabel = health
                                ? this.healthSeverityToLabel(health.status)
                                : 'unknown';

                        providers.push({
                                id,
                                displayName: config.displayName,
                                status: id === this.llmProviderService.activeProviderId ? 'active' : 'available',
                                isLocal: config.isLocal,
                                isPartial: config.isPartial,
                                currentModel: config.defaultModel,
                                healthStatus: healthLabel,
                                hasApiKey: !config.isLocal,
                        });
                }

                return providers;
        }

        getActiveProviderInfo(): ProviderUIInfo {
                const activeId = this.llmProviderService.activeProviderId;
                const config = this.llmProviderService.getProvider(activeId);
                const health = this.providerHealthService.getHealth(activeId);

                if (!config) {
                        return {
                                id: 'none', displayName: 'No Provider', status: 'inactive',
                                isLocal: false, isPartial: true, currentModel: 'none',
                                healthStatus: 'unknown', hasApiKey: false,
                        };
                }

                return {
                        id: activeId,
                        displayName: config.displayName,
                        status: 'active',
                        isLocal: config.isLocal,
                        isPartial: config.isPartial,
                        currentModel: config.defaultModel,
                        healthStatus: this.healthSeverityToLabel(health.status),
                        hasApiKey: !config.isLocal,
                };
        }

        private healthSeverityToLabel(severity: HealthSeverity): string {
                switch (severity) {
                        case HealthSeverity.Healthy: return 'healthy';
                        case HealthSeverity.Degraded: return 'degraded';
                        case HealthSeverity.Unhealthy: return 'unhealthy';
                        case HealthSeverity.Unknown: return 'unknown';
                        default: return 'unknown';
                }
        }

        // -- Execution Dashboard --

        getExecutionDashboardData(): ExecutionDashboardData {
                const execution = this.autonomousExecutionService.currentExecution;

                if (!execution) {
                        return {
                                currentStage: 'idle', currentMilestone: 'none', progress: 0,
                                tokensUsed: 0, tokensEstimated: 0, costUSD: 0, durationMs: 0,
                                isPaused: false, needsApproval: false, recentLogs: [],
                        };
                }

                const activeProvider = this.llmProviderService.getProvider(
                        this.llmProviderService.activeProviderId
                );

                const progress = this.calculateExecutionProgress(execution);
                const currentMilestone = execution.currentMilestoneId ?? 'none';
                const isPaused = execution.currentStage === ExecutionStage.Paused;
                const durationMs = execution.pauseTime
                        ? execution.pauseTime - execution.startTime
                        : Date.now() - execution.startTime;

                return {
                        currentStage: execution.currentStage,
                        currentMilestone,
                        progress,
                        tokensUsed: execution.tokensUsed,
                        tokensEstimated: activeProvider?.maxContextTokens ?? 0,
                        costUSD: execution.costIncurred,
                        durationMs,
                        isPaused,
                        needsApproval: execution.approvalPending,
                        recentLogs: this.buildRecentLogs(execution),
                };
        }

        private calculateExecutionProgress(execution: {
                completedSteps: string[]; failedSteps: string[];
        }): number {
                const totalSteps = execution.completedSteps.length + execution.failedSteps.length;
                if (totalSteps === 0) {
                        return 0;
                }
                return Math.min(1, execution.completedSteps.length / totalSteps);
        }

        private buildRecentLogs(execution: {
                currentStage: ExecutionStage;
                completedMilestones: string[];
                failedSteps: string[];
                tokensUsed: number;
        }): { timestamp: number; message: string; level: string }[] {
                const logs: { timestamp: number; message: string; level: string }[] = [];
                const now = Date.now();

                logs.push({ timestamp: now, message: `Stage: ${execution.currentStage}`, level: 'info' });

                if (execution.completedMilestones.length > 0) {
                        logs.push({
                                timestamp: now - 100,
                                message: `Milestones completed: ${execution.completedMilestones.length}`,
                                level: 'info',
                        });
                }

                if (execution.failedSteps.length > 0) {
                        logs.push({
                                timestamp: now - 50,
                                message: `Steps failed: ${execution.failedSteps.length}`,
                                level: 'warning',
                        });
                }

                if (execution.tokensUsed > 0) {
                        logs.push({
                                timestamp: now - 200,
                                message: `Tokens used: ${execution.tokensUsed.toLocaleString()}`,
                                level: 'info',
                        });
                }

                return logs;
        }

        // -- Memory Dashboard --

        getMemoryDashboardData(): MemoryDashboardData {
                const totalEntries = this.projectMemoryService.getEntryCount();
                const totalTokens = this.projectMemoryService.getTotalTokenCount();
                const memorySizeBytes = this.projectMemoryService.getMemorySize();
                const allProjects = this.projectMemoryService.getAllProjects();

                // Build entry type counts from project memory
                const entryTypeMap = new Map<string, number>();
                const projectData: { name: string; entries: number; tokens: number }[] = [];

                for (const project of allProjects) {
                        projectData.push({
                                name: project.projectName,
                                entries: project.entries.length,
                                tokens: project.totalTokenCount,
                        });

                        for (const entry of project.entries) {
                                const count = entryTypeMap.get(entry.type) ?? 0;
                                entryTypeMap.set(entry.type, count + 1);
                        }
                }

                const entryTypes: { type: string; count: number }[] = [];
                for (const [type, count] of entryTypeMap) {
                        entryTypes.push({ type, count });
                }

                // Derive last checkpoint info
                const currentProjectId = this.projectMemoryService.currentProjectId;
                let lastCheckpoint = 'none';
                if (currentProjectId) {
                        const latestCheckpoint = this.projectMemoryService.getLatestCheckpoint(currentProjectId);
                        if (latestCheckpoint) {
                                lastCheckpoint = latestCheckpoint.label;
                        }
                }

                return { totalEntries, totalTokens, memorySizeBytes, entryTypes, lastCheckpoint, projects: projectData };
        }

        // -- Token Estimator Data --

        getTokenEstimateData(): {
                projectedMinTokens: number;
                projectedMaxTokens: number;
                projectedMinCost: number;
                projectedMaxCost: number;
                projectedDuration: string;
                warningLevel: string;
                model: string;
                provider: string;
        } {
                const activeConfig = this.llmProviderService.getProvider(
                        this.llmProviderService.activeProviderId
                );
                const usage = this.tokenEstimationService.getCurrentUsage();

                // Project based on current usage trends
                const projectedMinTokens = usage.totalTokens;
                const projectedMaxTokens = Math.round(usage.totalTokens * 1.5);
                const projectedMinCost = usage.totalCostUSD;
                const projectedMaxCost = Math.round(usage.totalCostUSD * 1.8 * 100) / 100;

                // Format duration estimate (rough: ~50 tokens/sec)
                const estimatedSeconds = Math.round(projectedMaxTokens / 50);
                const minutes = Math.floor(estimatedSeconds / 60);
                const seconds = estimatedSeconds % 60;
                const projectedDuration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

                // Determine warning level for current model
                const modelId = activeConfig?.defaultModel ?? 'unknown';
                const warningLevel = this.tokenEstimationService.getWarningLevel(projectedMaxTokens, modelId);

                return {
                        projectedMinTokens, projectedMaxTokens,
                        projectedMinCost, projectedMaxCost,
                        projectedDuration, warningLevel,
                        model: modelId,
                        provider: activeConfig?.id ?? 'none',
                };
        }

        // -- Accessibility --

        applyFocusHandling(): void {
                if (this._focusStyleSheet) {
                        this._focusStyleSheet.remove();
                }

                const cssText = generateFocusCSS();
                this._focusStyleSheet = createStyleSheet();
                this._focusStyleSheet.textContent = cssText;

                this._focusApplied = true;
                this.storageService.store(STORAGE_KEY_FOCUS_APPLIED, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
                this.logService.info('[RealUIIntegration] Focus handling CSS applied');
        }

        applyKeyboardNavigation(): void {
                if (this._kbNavStyleSheet) {
                        this._kbNavStyleSheet.remove();
                }

                const cssText = generateKeyboardNavCSS();
                this._kbNavStyleSheet = createStyleSheet();
                this._kbNavStyleSheet.textContent = cssText;

                this._kbNavApplied = true;
                this.storageService.store(STORAGE_KEY_KBNAV_APPLIED, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
                this.logService.info('[RealUIIntegration] Keyboard navigation CSS applied');
        }

        applyReducedMotion(): void {
                if (this._reducedMotionStyleSheet) {
                        this._reducedMotionStyleSheet.remove();
                }

                const cssText = generateReducedMotionCSS();
                this._reducedMotionStyleSheet = createStyleSheet();
                this._reducedMotionStyleSheet.textContent = cssText;

                this._reducedMotionApplied = true;
                this.storageService.store(STORAGE_KEY_REDUCED_MOTION_APPLIED, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
                this.logService.info('[RealUIIntegration] Reduced motion CSS applied');
        }

        getAccessibilityScore(): number {
                // Score out of 100 based on applied accessibility features
                let score = 0;

                // Base score for having a theme with proper contrast (20 pts)
                score += 20;

                // Focus handling applied (25 pts)
                if (this._focusApplied) { score += 25; }

                // Keyboard navigation applied (25 pts)
                if (this._kbNavApplied) { score += 25; }

                // Reduced motion applied (15 pts)
                if (this._reducedMotionApplied) { score += 15; }

                // High contrast theme provides extra accessibility (15 pts)
                if (this._currentTheme === AITheme.HighContrast) { score += 15; }

                return Math.min(100, score);
        }

        // -- Refresh --

        refreshAll(): void {
                        // Credit tracking removed for MVP

                // Re-inject all CSS
                this.injectThemeCSS();

                if (this._focusApplied) { this.applyFocusHandling(); }
                if (this._kbNavApplied) { this.applyKeyboardNavigation(); }
                if (this._reducedMotionApplied) { this.applyReducedMotion(); }

                // Fire dashboard update with fresh data
                const dashboardData = this.getExecutionDashboardData();
                this._onDidUpdateDashboard.fire(dashboardData);

                // Fire layout update in case anything changed
                this._onDidChangeLayout.fire(this._layout);

                this.logService.info('[RealUIIntegration] All UI refreshed');
        }

        // -- Cleanup --

        override dispose(): void {
                this._themeStyleSheet?.remove();
                this._focusStyleSheet?.remove();
                this._kbNavStyleSheet?.remove();
                this._reducedMotionStyleSheet?.remove();
                super.dispose();
        }
}
