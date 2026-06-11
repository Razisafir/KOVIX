// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { IAgentLoop, IPlanResult } from '../../../../platform/construct/common/agent/agentLoop.js';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IDiffApplier } from '../../../../platform/construct/common/editor/diffApplier.js';
import { IPendingChangesService } from '../../../../platform/construct/common/diff/pendingChanges.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands';
import { IFileService } from '../../../../platform/files/common/files';
import { URI } from '../../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../workbench/common/views';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ConstructProgressPanel } from './constructProgressPanel.js';
import { LoadingState, FileChangeEntry, TaskMetrics } from '../../../../platform/construct/common/agent/loadingState.js';
import { IRefinedIdea, IRefinementQuestion, IRefinementAnswer } from '../../../../platform/construct/common/agent/ideaRefinementTypes.js';
import { IIdeaRefinementService } from '../../../../platform/construct/common/agent/ideaRefinementService.js';
import { IConstructSessionService } from '../../../../platform/construct/common/session/constructSessionService.js';
import { ISelectablePlanStep, IApprovedPlan, IMilestone } from '../../../../platform/construct/common/agent/milestoneStateMachine.js';
import { showStopModePicker } from './constructStopModePicker.js';
import { ExecutionMode } from '../../../../platform/construct/common/agent/executionMode.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';

type ExecutionState = 'idle' | 'planning' | 'refining' | 'awaiting_approval' | 'executing' | 'paused_at_milestone' | 'complete' | 'error' | 'stopped';

type ContextScope = 'currentFile' | 'workspace' | 'selectedText';

interface PendingDiff {
        id: string;
        filePath: string;
        content: string;
        originalContent: string | null; // Original file content before the diff, for reject/revert
        changeType: 'write' | 'edit';
        element: HTMLElement;
        accepted: boolean;
}

interface ToolLogEntry {
        toolName: string;
        target: string;
        durationMs: number;
        success: boolean;
}

export class ConstructAgentViewPane extends ViewPane {

        private messageContainer!: HTMLElement;
        private inputBox!: HTMLTextAreaElement;
        private clearBtn!: HTMLButtonElement;
        private sendBtn!: HTMLButtonElement;
        private stopBtn!: HTMLButtonElement;
        private statusIndicator!: HTMLElement;
        private planContainer: HTMLElement | null = null;
        private progressPanel!: ConstructProgressPanel;
        private messageCount = 0;
        private currentTaskId: string | null = null;
        private executionState: ExecutionState = 'idle';
        private currentCancellationToken: CancellationTokenSource | null = null;
        private _abortController: AbortController | null = null;

        // Performance metrics tracking
        private taskStartTime = 0;
        private planningStartTime = 0;
        private planningEndTime = 0;
        private stepMetrics: Array<{
                stepNumber: number;
                label: string;
                startTime: number;
                endTime?: number;
                subSteps: Array<{ label: string; startTime: number; endTime?: number }>;
        }> = [];
        private currentStepStart = 0;
        private llmCallCount = 0;

        // Phase 2: Model picker
        private modelPickerBtn!: HTMLButtonElement;
        private currentModelInfo: { name: string; providerType: AIProviderType | undefined; isLocal: boolean } = {
                name: 'No Model', providerType: undefined, isLocal: true,
        };

        // Phase 2: Context selector
        private contextScope: ContextScope = 'workspace';

        // Phase 2: Tool activity log
        private toolLogEntries: ToolLogEntry[] = [];
        private toolLogContainer: HTMLElement | null = null;
        private toolLogCollapsed = true;

        // Phase 2: Pending diffs
        private pendingDiffs: PendingDiff[] = [];
        private diffCounter = 0;

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
                @IMemoryOrchestrator _memoryOrchestrator: IMemoryOrchestrator,
                @IConstructMemoryService private readonly constructMemory: IConstructMemoryService,
                @IAgentLoop private readonly agentLoop: IAgentLoop,
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IDiffApplier private readonly diffApplier: IDiffApplier,
                @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
                @ILogService private readonly logService: ILogService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @INotificationService private readonly notificationService: INotificationService,
                @ICommandService private readonly commandService: ICommandService,
                @IFileService private readonly fileService: IFileService,
                @IPendingChangesService private readonly pendingChangesService: IPendingChangesService,
                @IIdeaRefinementService private readonly ideaRefinementService: IIdeaRefinementService,
                @IConstructSessionService private readonly sessionService: IConstructSessionService,
                @IQuickInputService private readonly quickInputService: IQuickInputService,
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';

                // --- Phase 2: Model Picker Header ---
                const modelPickerBar = dom.$('.construct-model-picker-bar');
                modelPickerBar.style.cssText = `
                        display: flex; align-items: center; justify-content: space-between;
                        padding: 6px 10px; border-bottom: 1px solid #1A1F2E;
                        background: #0D1117;
                `;

                this.modelPickerBtn = dom.$('button.construct-model-picker') as HTMLButtonElement;
                this.modelPickerBtn.style.cssText = `
                        background: #141B2D; border: 1px solid #1A1F2E; border-radius: 4px;
                        color: #E0E7FF; font-size: 11px; padding: 4px 10px; cursor: pointer;
                        display: flex; align-items: center; gap: 6px;
                `;
                this.updateModelPickerLabel();
                this.modelPickerBtn.onclick = () => {
                        this.commandService.executeCommand('construct.selectModel');
                };

                const providerLabel = dom.$('.construct-provider-label');
                providerLabel.style.cssText = `font-size: 10px; color: #4A5568;`;
                providerLabel.textContent = this.currentModelInfo.isLocal ? 'local' : 'cloud';

                // --- Phase 4: Settings gear icon ---
                const settingsBtn = dom.$('button.construct-settings-btn') as HTMLButtonElement;
                settingsBtn.textContent = '\u2699'; // ⚙
                settingsBtn.style.cssText = `
                        background: transparent; border: none; color: #4A5568;
                        cursor: pointer; font-size: 14px; padding: 2px 4px;
                        border-radius: 3px;
                `;
                settingsBtn.title = 'API Settings';
                settingsBtn.onclick = () => {
                        this.commandService.executeCommand('construct.openApiSettings');
                };

                modelPickerBar.appendChild(this.modelPickerBtn);

                // Session history button
                const sessionHistoryBtn = dom.$('button.construct-session-history-btn') as HTMLButtonElement;
                sessionHistoryBtn.textContent = '\uD83D\uDCDC'; // 📜
                sessionHistoryBtn.style.cssText = `
                        background: transparent; border: none; color: #4A5568;
                        cursor: pointer; font-size: 13px; padding: 2px 4px;
                        border-radius: 3px;
                `;
                sessionHistoryBtn.title = 'Session History';
                sessionHistoryBtn.onclick = () => { this.showSessionHistory(); };
                modelPickerBar.appendChild(sessionHistoryBtn);

                modelPickerBar.appendChild(settingsBtn);
                modelPickerBar.appendChild(providerLabel);
                container.appendChild(modelPickerBar);

                // Messages area
                this.messageContainer = dom.$('.construct-messages');
                this.messageContainer.style.cssText = `
                        flex: 1; overflow-y: auto; padding: 10px;
                `;

                // Welcome message
                const welcome = dom.$('.construct-welcome');
                welcome.style.cssText = `padding: 16px; text-align: center;`;

                const logo = dom.$('.construct-logo');
                logo.style.cssText = `font-size: 32px; margin-bottom: 8px; color: #00E5FF;`;
                logo.textContent = '\u2B21'; // Hexagon

                const title = dom.$('.construct-title');
                title.style.cssText = `font-size: 14px; font-weight: 600; color: #E0E7FF; margin-bottom: 4px;`;
                title.textContent = 'Kovix Agent';

                const subtitle = dom.$('.construct-subtitle');
                subtitle.style.cssText = `font-size: 12px; color: #4A5568; margin-bottom: 12px;`;
                subtitle.textContent = 'AI-powered coding assistant';

                // Status indicator
                this.statusIndicator = dom.$('.construct-status');
                this.updateStatusIndicator();

                // Memory status indicator
                const memoryStatus = dom.$('.construct-memory-status');
                memoryStatus.style.cssText = `font-size: 10px; color: ${this.constructMemory.isInitialized ? '#00E5FF' : '#4A5568'}; margin-bottom: 8px;`;
                memoryStatus.textContent = this.constructMemory.isInitialized
                        ? '[MEMORY] Connected'
                        : '[MEMORY] Local only';

                const hint = dom.$('.construct-hint');
                hint.style.cssText = `font-size: 11px; color: #4A5568; font-family: monospace; background: #0A0E1A; border-radius: 4px; padding: 6px 10px; display: inline-block;`;
                hint.textContent = 'Ctrl+Shift+I  Inline edit  |  Ctrl+Shift+C  Focus panel';

                welcome.appendChild(logo);
                welcome.appendChild(title);
                welcome.appendChild(subtitle);
                welcome.appendChild(this.statusIndicator);
                welcome.appendChild(memoryStatus);
                welcome.appendChild(hint);
                this.messageContainer.appendChild(welcome);

                container.appendChild(this.messageContainer);

                // Input area
                const inputArea = dom.$('.construct-input-area');
                inputArea.style.cssText = `padding: 8px; border-top: 1px solid #1A1F2E; display: flex; gap: 6px; align-items: center;`;

                this.inputBox = document.createElement('textarea');
                this.inputBox.className = 'construct-chat-input';
                this.inputBox.rows = 1;
                this.inputBox.placeholder = 'Ask Kovix anything...';
                this.inputBox.style.cssText = `
                        flex: 1; background: #0A0E1A; border: 1px solid #1A1F2E;
                        border-radius: 4px; padding: 8px 10px; color: #E0E7FF;
                        font-size: 13px; outline: none; resize: none;
                        min-height: 36px; max-height: 200px;
                        font-family: inherit; line-height: 1.4;
                `;
                this.inputBox.addEventListener('input', () => {
                        this.inputBox.style.height = 'auto';
                        this.inputBox.style.height = Math.min(this.inputBox.scrollHeight, 200) + 'px';
                });

                this.sendBtn = dom.$('button.construct-send-btn') as HTMLButtonElement;
                this.sendBtn.textContent = '\u2192'; // Right arrow
                this.sendBtn.style.cssText = `
                        background: #00E5FF; color: #0A0E1A; border: none;
                        border-radius: 4px; padding: 6px 12px; cursor: pointer;
                        font-size: 14px; font-weight: bold;
                `;

                this.stopBtn = dom.$('button.construct-stop-btn') as HTMLButtonElement;
                this.stopBtn.textContent = '\u25A0'; // Stop square
                this.stopBtn.style.cssText = `
                        background: #FF4444; color: white; border: none;
                        border-radius: 4px; padding: 6px 10px; cursor: pointer;
                        font-size: 12px; display: none;
                `;

                // Handle send
                const sendMessage = async () => {
                        const text = this.inputBox.value.trim();
                        if (!text || this.executionState !== 'idle') { return; }

                        this.currentTaskId = `task-${Date.now()}`;
                        this.messageCount++;

                        // Add user message bubble
                        this.addUserMessage(text);
                        this.inputBox.value = '';
                        this.inputBox.style.height = '36px';
                        this.updateClearBtnVisibility();

                        // Auto-learn from user message
                        if (this.constructMemory.config.enabled && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(`User asked: ${text}`, {
                                        type: 'user_message',
                                        taskId: this.currentTaskId,
                                        messageNumber: this.messageCount
                                }).catch(() => { /* non-critical */ });
                        }

                        // Phase 2: Check IConstructAIService availability first, then fallback to Anthropic
                        const hasAIProvider = !!this.aiService.activeProvider;
                        const apiKey = this.configurationService.getValue<string>('construct.anthropic.apiKey');

                        // Check if idea refinement is enabled
                        const refinementEnabled = this.configurationService.getValue<boolean>('construct.ideaRefinement.enabled');
                        if (refinementEnabled !== false && hasAIProvider) {
                                // Run idea refinement flow before planning
                                await this.runRefinementFlow(text);
                                return;
                        }

                        if (!hasAIProvider && !apiKey) {
                                this.addAgentMessage(
                                        '[SETUP] No AI provider available. Install [Ollama](https://ollama.ai) for local inference, or configure a cloud provider in [Settings](command:construct.openApiSettings).',
                                        'error'
                                );
                                this.notificationService.warn('No AI provider available. Install Ollama or configure cloud settings.');
                                return;
                        }

                        // Cloud provider config is managed by IConstructAIService.
                        // The unified service handles provider-specific configuration internally.

                        // Gather context based on scope selector
                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${text}\n\n[Context (${this.contextScope})]:\n${contextText}` : text;

                        // Reset tool log for new session
                        this.toolLogEntries = [];

                        // Start Plan/Act flow
                        await this.runPlanActFlow(taskWithContext);
                };

                // --- Phase 4: Clear button ---
                this.clearBtn = dom.$('button.construct-clear-btn') as HTMLButtonElement;
                this.clearBtn.textContent = '\uD83D\uDDB1'; // 🗑
                this.clearBtn.style.cssText = `
                        background: transparent; color: #4A5568; border: none;
                        cursor: pointer; font-size: 14px; padding: 4px 6px;
                        display: none; border-radius: 3px;
                `;
                this.clearBtn.title = 'Clear chat';
                this.clearBtn.onclick = () => { this.clearMessages(); };

                this.sendBtn.onclick = sendMessage;
                this.inputBox.onkeydown = (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                        }
                };

                this.stopBtn.onclick = () => {
                        if (this.currentCancellationToken) {
                                this.currentCancellationToken.cancel();
                                this.currentCancellationToken = null;
                        }
                        // BUG 2 FIX: Abort via real AbortController, not CancellationToken cast
                        const controller = this._abortController;
                        if (controller) {
                                controller.abort();
                                this._abortController = null;
                        }
                };

                inputArea.appendChild(this.inputBox);
                inputArea.appendChild(this.clearBtn);
                inputArea.appendChild(this.stopBtn);
                inputArea.appendChild(this.sendBtn);
                container.appendChild(inputArea);

                // --- Phase 2: Context Selector Bar ---
                const contextBar = dom.$('.construct-context-bar');
                contextBar.style.cssText = `
                        padding: 4px 8px 6px; border-top: 1px solid #1A1F2E;
                        display: flex; align-items: center; gap: 4px;
                `;

                const contextLabel = dom.$('.construct-context-label');
                contextLabel.style.cssText = `font-size: 10px; color: #4A5568; margin-right: 2px;`;
                contextLabel.textContent = 'Context:';

                const scopeOptions: Array<{ scope: ContextScope; label: string; icon: string }> = [
                        { scope: 'currentFile', label: 'File', icon: '\uD83D\uDCC4' },
                        { scope: 'workspace', label: 'Workspace', icon: '\uD83D\uDCC2' },
                        { scope: 'selectedText', label: 'Selection', icon: '\u270F\uFE0F' },
                ];

                contextBar.appendChild(contextLabel);

                for (const opt of scopeOptions) {
                        const btn = dom.$('button.construct-context-scope-btn') as HTMLButtonElement;
                        btn.style.cssText = `
                                background: ${this.contextScope === opt.scope ? '#1A2744' : '#0A0E1A'};
                                border: 1px solid ${this.contextScope === opt.scope ? '#00E5FF' : '#1A1F2E'};
                                border-radius: 3px; color: ${this.contextScope === opt.scope ? '#00E5FF' : '#4A5568'};
                                font-size: 10px; padding: 2px 8px; cursor: pointer;
                        `;
                        btn.textContent = `${opt.icon} ${opt.label}`;
                        btn.onclick = () => {
                                this.contextScope = opt.scope;
                                // Re-render button states
                                const buttons = contextBar.querySelectorAll('button.construct-context-scope-btn');
                                buttons.forEach((b, i) => {
                                        const isActive = scopeOptions[i].scope === this.contextScope;
                                        (b as HTMLButtonElement).style.background = isActive ? '#1A2744' : '#0A0E1A';
                                        (b as HTMLButtonElement).style.borderColor = isActive ? '#00E5FF' : '#1A1F2E';
                                        (b as HTMLButtonElement).style.color = isActive ? '#00E5FF' : '#4A5568';
                                });
                        };
                        contextBar.appendChild(btn);
                }

                container.appendChild(contextBar);

                // Listen for memory initialization changes
                this._register(this.constructMemory.onDidChangeInitialization((initialized) => {
                        memoryStatus.style.color = initialized ? '#00E5FF' : '#4A5568';
                        memoryStatus.textContent = initialized
                                ? '[MEMORY] Connected'
                                : '[MEMORY] Local only';
                }));

                // Listen for provider errors via IConstructAIService
                // When no provider is available, the service already shows a notification.
                // The agent loop handles individual API errors and yields error events.

                // Subscribe to agent loop loading state events
                this._register(this.agentLoop.onLoadingStateChange((state: LoadingState) => {
                        this.handleLoadingStateChange(state);
                }));

                // Subscribe to agent loop file change events
                this._register(this.agentLoop.onFileChange((change: FileChangeEntry) => {
                        this.handleFileChange(change);
                }));

                // --- Phase 2: Listen for AI service provider/model changes ---
                this._register(this.aiService.onDidChangeActiveProvider(() => {
                        this.refreshModelPickerInfo();
                }));
                this._register(this.aiService.onDidChangeActiveModel(() => {
                        this.refreshModelPickerInfo();
                }));

                // Initial model info load
                this.refreshModelPickerInfo();

                // --- Phase 4: Wire construct.newChat to clear ---
                this._register(this.commandService.onWillExecuteCommand(e => {
                        if (e.commandId === 'construct.newChat') {
                                this.clearMessages();
                                // H2: Clear conversation history on new chat
                                this.agentLoop.clearConversationHistory();
                        }
                }));
        }

        /**
         * Handle loading state changes from the agent loop.
         * Updates the progress panel with granular, function-level feedback.
         */
        private handleLoadingStateChange(state: LoadingState): void {
                if (!this.progressPanel) { return; }
                this.progressPanel.updateState(state);

                // Track metrics based on phase transitions
                switch (state.phase) {
                        case 'planning':
                                this.planningStartTime = state.startTime;
                                break;
                        case 'planning-complete':
                                this.planningEndTime = Date.now();
                                break;
                        case 'reading-file':
                        case 'writing-file':
                        case 'creating-directory':
                        case 'applying-diff':
                        case 'running-command':
                                break;
                        case 'error':
                                // Show error in progress panel with recovery context
                                this.progressPanel.showError(
                                        state.detail ?? state.message,
                                        state.stepNumber,
                                        state.totalSteps
                                );
                                break;
                        case 'complete': {
                                // Build and show performance metrics
                                const metrics: TaskMetrics = {
                                        totalStartTime: this.taskStartTime,
                                        totalEndTime: Date.now(),
                                        planningStartTime: this.planningStartTime,
                                        planningEndTime: this.planningEndTime,
                                        steps: this.stepMetrics,
                                        llmCallCount: this.llmCallCount,
                                };
                                this.progressPanel.showMetrics(metrics);
                                break;
                        }
                }

                this.scrollToBottom();
        }

        /**
         * Handle file change events from the agent loop.
         * Updates the file tree diff in the progress panel.
         * Phase 2: Also shows inline diff viewer for write/edit operations.
         */
        private handleFileChange(change: FileChangeEntry): void {
                if (!this.progressPanel) { return; }
                this.progressPanel.addFileChange(change);

                // Phase 2: Show diff viewer for write/edit operations
                if (change.status === 'created' || change.status === 'modified') {
                        this.showPendingDiff(change.path, change.status === 'created' ? 'write' : 'edit');
                }

                this.scrollToBottom();
        }

        /**
         * Run the Plan/Act approval flow.
         */
        private async runPlanActFlow(task: string): Promise<void> {
                this.setExecutionState('planning');
                this.currentCancellationToken = new CancellationTokenSource();
                // BUG 2 FIX: Create a real AbortController and bridge cancellation
                this._abortController = new AbortController();
                const abortController = this._abortController;
                this.currentCancellationToken.token.onCancellationRequested(() => abortController.abort());
                this.taskStartTime = Date.now();
                this.planningStartTime = Date.now();
                this.planningEndTime = 0;
                this.stepMetrics = [];
                this.llmCallCount = 0;

                // Create a progress panel for this task
                this.progressPanel = new ConstructProgressPanel(this.messageContainer);

                // Add planning indicator
                const planningMsg = this.addAgentMessage('', 'info');

                try {
                        // Phase 1: Planning — pass real AbortSignal, NOT CancellationToken cast
                        const plan = await this.agentLoop.runPlanningPhase(task, abortController.signal);

                        if (abortController.signal.aborted) {
                                this.setExecutionState('stopped');
                                this.updateMessageContent(planningMsg, '[STOP] Stopped by user');
                                // Transition back to idle after showing stopped state
                                setTimeout(() => { this.setExecutionState('idle'); }, 1500);
                                return;
                        }

                        // Phase 2: Show plan and await approval
                        this.planningEndTime = Date.now();
                        this.setExecutionState('awaiting_approval');
                        this.updateMessageContent(planningMsg, '');
                        this.renderPlan(plan, task);

                } catch (error) {
                        this.setExecutionState('error');
                        const msg = error instanceof Error ? error.message : String(error);
                        this.updateMessageContent(planningMsg, `[FAIL] Planning failed: ${msg}`);
                        this.logService.error('[AgentView] Planning error:', msg);

                        // Transition back to idle after showing error
                        setTimeout(() => { this.setExecutionState('idle'); }, 2000);
                } finally {
                        // BUG 6 FIX: Clean up cancellation state to prevent stale references
                        this.currentCancellationToken?.dispose();
                        this.currentCancellationToken = null;
                        this._abortController = null;
                }
        }

        /**
         * Render the plan with Approve/Cancel buttons.
         */
        private selectableSteps: ISelectablePlanStep[] = [];
        private currentPlanTask: string = '';

        private renderPlan(plan: IPlanResult, task: string): void {
                // Remove any existing plan container
                this.planContainer?.remove();
                this.currentPlanTask = task;

                // Create selectable steps from the plan
                this.selectableSteps = plan.steps.map((step, idx) => ({
                        index: idx,
                        action: step.action,
                        target: step.target,
                        description: step.description,
                        selected: true,
                }));

                this.planContainer = dom.$('.construct-plan');
                this.planContainer.style.cssText = `
                        background: #141B2D; border: 1px solid #1A1F2E;
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;

                // Plan header
                const header = dom.$('.construct-plan-header');
                header.style.cssText = `font-weight: 600; color: #E0E7FF; margin-bottom: 8px; font-size: 13px;`;
                header.textContent = `\uD83D\uDCA1 Plan ready \u2014 ${plan.steps.length} steps`;
                this.planContainer.appendChild(header);

                // Select All / Deselect All controls
                if (this.selectableSteps.length > 0) {
                        const controlBar = dom.$('.construct-plan-controls');
                        controlBar.style.cssText = `display: flex; gap: 8px; margin-bottom: 8px;`;

                        const selectAllBtn = dom.$('button') as HTMLButtonElement;
                        selectAllBtn.textContent = 'Select All';
                        selectAllBtn.style.cssText = `
                                background: #1A2744; border: 1px solid #2D3A5C; border-radius: 3px;
                                color: #E0E7FF; font-size: 11px; padding: 3px 8px; cursor: pointer;
                        `;
                        selectAllBtn.onclick = () => {
                                this.selectableSteps.forEach(s => s.selected = true);
                                this.planContainer?.querySelectorAll<HTMLInputElement>('.construct-step-checkbox').forEach(cb => { cb.checked = true; });
                                this.planContainer?.querySelectorAll('.construct-step-text').forEach(el => { (el as HTMLElement).style.textDecoration = 'none'; });
                        };

                        const deselectAllBtn = dom.$('button') as HTMLButtonElement;
                        deselectAllBtn.textContent = 'Deselect All';
                        deselectAllBtn.style.cssText = `
                                background: #1A2744; border: 1px solid #2D3A5C; border-radius: 3px;
                                color: #E0E7FF; font-size: 11px; padding: 3px 8px; cursor: pointer;
                        `;
                        deselectAllBtn.onclick = () => {
                                this.selectableSteps.forEach(s => s.selected = false);
                                this.planContainer?.querySelectorAll<HTMLInputElement>('.construct-step-checkbox').forEach(cb => { cb.checked = false; });
                                this.planContainer?.querySelectorAll('.construct-step-text').forEach(el => { (el as HTMLElement).style.textDecoration = 'line-through'; });
                        };

                        controlBar.appendChild(selectAllBtn);
                        controlBar.appendChild(deselectAllBtn);
                        this.planContainer.appendChild(controlBar);
                }

                // Plan steps with checkboxes
                if (this.selectableSteps.length > 0) {
                        for (const step of this.selectableSteps) {
                                const stepRow = dom.$('.construct-plan-step');
                                stepRow.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 12px;`;

                                const checkbox = document.createElement('input');
                                checkbox.type = 'checkbox';
                                checkbox.checked = step.selected;
                                checkbox.className = 'construct-step-checkbox';
                                checkbox.style.cssText = `accent-color: #00E5FF; cursor: pointer;`;
                                checkbox.onchange = () => {
                                        step.selected = checkbox.checked;
                                        const textEl = stepRow.querySelector('.construct-step-text') as HTMLElement;
                                        if (textEl) {
                                                textEl.style.textDecoration = checkbox.checked ? 'none' : 'line-through';
                                                textEl.style.color = checkbox.checked ? '#C0C0C0' : '#666';
                                        }
                                };

                                const icon = this.getActionIcon(step.action);
                                const stepText = dom.$('.construct-step-text');
                                stepText.style.cssText = `color: #C0C0C0;`;
                                stepText.textContent = `${icon} ${step.action}: ${step.target}`;

                                stepRow.appendChild(checkbox);
                                stepRow.appendChild(stepText);
                                this.planContainer.appendChild(stepRow);
                        }
                } else {
                        // No structured steps -- show the raw summary
                        const summaryEl = dom.$('.construct-plan-summary');
                        summaryEl.style.cssText = `font-size: 12px; color: #C0C0C0; white-space: pre-wrap; max-height: 150px; overflow-y: auto;`;
                        summaryEl.textContent = plan.summary.substring(0, 500);
                        this.planContainer.appendChild(summaryEl);
                }

                // Buttons
                const btnContainer = dom.$('.construct-plan-buttons');
                btnContainer.style.cssText = `display: flex; gap: 8px; margin-top: 10px;`;

                const approveBtn = dom.$('button') as HTMLButtonElement;
                approveBtn.textContent = '\u2705 Approve';
                approveBtn.style.cssText = `
                        background: #00C853; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;

                const cancelBtn = dom.$('button') as HTMLButtonElement;
                cancelBtn.textContent = '\u274C Cancel';
                cancelBtn.style.cssText = `
                        background: #FF4444; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;

                approveBtn.onclick = async () => {
                        // Show stop mode picker
                        const milestones = this.agentLoop.extractMilestonesFromPlan(plan.steps);
                        const selectedMode = await showStopModePicker(this.quickInputService, milestones);
                        if (!selectedMode) { return; } // cancelled

                        const approvedPlan: IApprovedPlan = {
                                task,
                                steps: this.selectableSteps,
                                executionMode: selectedMode,
                                milestones,
                                approved: true,
                                approvedAt: Date.now(),
                        };

                        this.planContainer?.remove();
                        this.planContainer = null;
                        this.runExecution(task, approvedPlan);
                };

                cancelBtn.onclick = () => {
                        this.planContainer?.remove();
                        this.planContainer = null;
                        this.addAgentMessage('[CANCEL] Task cancelled', 'info');
                        this.setExecutionState('idle');
                        this.progressPanel?.clear();
                };

                btnContainer.appendChild(approveBtn);
                btnContainer.appendChild(cancelBtn);
                this.planContainer.appendChild(btnContainer);

                this.messageContainer.appendChild(this.planContainer);
                this.scrollToBottom();
        }

        /**
         * Run the execution phase with full tool access.
         * Now shows granular, function-level progress indicators.
         */
        private async runExecution(task: string, approvedPlan?: IApprovedPlan): Promise<void> {
                this.setExecutionState('executing');
                this.currentCancellationToken = new CancellationTokenSource();
                // BUG 2 FIX: Create a real AbortController and bridge cancellation
                this._abortController = new AbortController();
                const abortController = this._abortController;
                this.currentCancellationToken.token.onCancellationRequested(() => abortController.abort());

                // Clear and re-initialize progress panel for execution phase
                if (this.progressPanel) {
                        this.progressPanel.clear();
                }

                // Add execution message container with structured layout
                const execContainer = dom.$('.construct-exec-container');
                execContainer.style.cssText = `
                        margin: 6px 0;
                `;

                // Streaming output area
                const execMsg = this.addAgentMessage('', 'streaming');

                let fullText = '';
                let stepCount = 0;
                let currentToolName = '';
                let currentToolDetail = '';

                try {
                        // Use approved plan with milestone support if available, otherwise standard execution
                        const stream = approvedPlan
                                ? this.agentLoop.runWithApprovedPlan(approvedPlan, abortController.signal)
                                : this.agentLoop.run(task, abortController.signal);

                        for await (const event of stream) {
                                switch (event.type) {
                                        case 'thinking':
                                                fullText += `[THINK] ${event.text}`;
                                                break;

                                        case 'token':
                                                fullText += event.text;
                                                break;

                                        case 'tool_start':
                                                stepCount++;
                                                currentToolName = event.toolName;
                                                // Track step metric start
                                                this.currentStepStart = Date.now();
                                                fullText += `\n\n[TOOL] ${event.toolName}`;
                                                if (event.toolInput && typeof event.toolInput === 'object') {
                                                        const input = event.toolInput as Record<string, string>;
                                                        if (input.path) {
                                                                fullText += `: ${input.path}`;
                                                                currentToolDetail = input.path;
                                                        }
                                                        else if (input.command) {
                                                                fullText += `: ${input.command.substring(0, 60)}`;
                                                                currentToolDetail = input.command.substring(0, 60);
                                                        }
                                                }
                                                break;

                                        case 'tool_executing':
                                                // The progress panel is already updated via onLoadingStateChange.
                                                // We no longer treat this as a no-op -- the progress panel handles it.
                                                break;

                                        case 'tool_result': {
                                                // Record step metric
                                                const stepEnd = Date.now();
                                                this.stepMetrics.push({
                                                        stepNumber: stepCount,
                                                        label: currentToolName + (currentToolDetail ? `: ${currentToolDetail}` : ''),
                                                        startTime: this.currentStepStart,
                                                        endTime: stepEnd,
                                                        subSteps: [],
                                                });

                                                // Phase 2: Track tool activity log
                                                this.toolLogEntries.push({
                                                        toolName: currentToolName,
                                                        target: currentToolDetail,
                                                        durationMs: stepEnd - this.currentStepStart,
                                                        success: event.success,
                                                });

                                                if (event.success) {
                                                        fullText += `\n[OK] ${event.toolName} completed`;
                                                } else {
                                                        fullText += `\n[FAIL] ${event.toolName} failed: ${event.result.substring(0, 200)}`;
                                                }
                                                break;
                                        }

                                        case 'file_written':
                                                // Refresh file explorer after writes
                                                this.refreshFileExplorer();
                                                break;

                                        case 'milestone_reached':
                                                fullText += `\n\n\uD83D\uDEA9 Milestone reached: ${event.milestone.name}`;
                                                break;

                                        case 'milestone_paused':
                                                this.setExecutionState('paused_at_milestone');
                                                fullText += `\n\n\u23F8 Paused at milestone: ${event.milestone.name}`;
                                                this.renderMilestonePauseControls(event.milestone);
                                                break;

                                        case 'milestone_resumed':
                                                this.setExecutionState('executing');
                                                fullText += `\n\n\u25B6 Resumed from milestone: ${event.milestone.name}`;
                                                break;

                                        case 'milestone_completed':
                                                fullText += `\n\n\u2705 Milestone completed: ${event.milestone.name}`;
                                                break;

                                        case 'complete':
                                                fullText += `\n\n[OK] Task complete`;
                                                break;

                                        case 'error':
                                                if (event.text.includes('Rate limited')) {
                                                        fullText += `\n\n[WAIT] ${event.text}`;
                                                } else if (event.text.includes('API key')) {
                                                        fullText += `\n\n[KEY] ${event.text} [Open Settings](command:construct.openApiSettings)`;
                                                } else if (event.text.includes('Connection')) {
                                                        fullText += `\n\n[NET] ${event.text} [Retry](command:construct.focusPanel)`;
                                                } else if (event.text.includes('[STOP]')) {
                                                        fullText += `\n\n[STOP] Stopped by user`;
                                                } else {
                                                        fullText += `\n\n[FAIL] ${event.text}`;
                                                }
                                                break;
                                }

                                this.updateMessageContent(execMsg, fullText);
                                this.scrollToBottom();
                        }

                        this.setExecutionState(abortController.signal.aborted ? 'stopped' : 'complete');

                        // Transition back to idle after a brief delay so the user can
                        // see the final state indicator, then send another message.
                        setTimeout(() => { this.setExecutionState('idle'); }, 1500);

                        // Auto-learn the task completion
                        if (this.constructMemory.config.enabled && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(`Agent completed task: ${task}`, {
                                        type: 'task_completion',
                                        taskId: this.currentTaskId ?? 'unknown',
                                }).catch(() => { /* non-critical */ });
                        }

                        // Phase 2: Show tool activity log after execution
                        this.renderToolActivityLog();

                } catch (error) {
                        this.setExecutionState('error');
                        const msg = error instanceof Error ? error.message : String(error);
                        this.updateMessageContent(execMsg, `[FAIL] Error: ${msg}`);
                        this.logService.error('[AgentView] Execution error:', msg);

                        // Transition back to idle after showing error
                        setTimeout(() => { this.setExecutionState('idle'); }, 2000);
                } finally {
                        // BUG 6 FIX: Clean up cancellation state to prevent stale references
                        this.currentCancellationToken?.dispose();
                        this.currentCancellationToken = null;
                        this._abortController = null;
                }
        }

        // --- UI Helpers ---

        private addUserMessage(text: string): void {
                const msg = dom.$('.construct-user-msg');
                msg.style.cssText = `
                        background: #00E5FF20; border-left: 2px solid #00E5FF;
                        padding: 8px 10px; margin: 8px 0; border-radius: 0 4px 4px 0;
                        font-size: 13px; color: #E0E7FF; white-space: pre-wrap;
                `;
                msg.textContent = text;
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
        }

        private addAgentMessage(text: string, type: 'info' | 'error' | 'streaming' = 'info'): HTMLElement {
                const msg = dom.$('.construct-agent-msg');

                const borderColors: Record<string, string> = {
                        info: '#4A5568',
                        error: '#FF4444',
                        streaming: '#00E5FF',
                };

                msg.style.cssText = `
                        background: #141B2D; border-left: 2px solid ${borderColors[type] ?? '#4A5568'};
                        padding: 8px 10px; margin: 8px 0; border-radius: 0 4px 4px 0;
                        font-size: 13px; color: ${type === 'error' ? '#FF6666' : '#E0E7FF'};
                        white-space: pre-wrap; font-family: inherit;
                `;
                msg.textContent = text;
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
                return msg;
        }

        private updateMessageContent(element: HTMLElement, text: string): void {
                element.textContent = text;
        }

        private setExecutionState(state: ExecutionState): void {
                this.executionState = state;
                this.updateStatusIndicator();

                const isRunning = state === 'planning' || state === 'executing';
                this.sendBtn.style.display = isRunning ? 'none' : 'inline-block';
                this.stopBtn.style.display = isRunning ? 'inline-block' : 'none';
                this.inputBox.disabled = isRunning;

                if (state === 'idle') {
                        this.inputBox.placeholder = 'Ask Kovix anything...';
                        // Clean up progress panel
                        if (this.progressPanel) {
                                this.progressPanel.dispose();
                                this.progressPanel = undefined as any;
                        }
                } else if (state === 'planning') {
                        this.inputBox.placeholder = 'Planning...';
                } else if (state === 'executing') {
                        this.inputBox.placeholder = 'Executing...';
                } else if (state === 'awaiting_approval') {
                        this.inputBox.placeholder = 'Awaiting approval...';
                }
        }

        private updateStatusIndicator(): void {
                const stateConfig: Record<ExecutionState, { text: string; color: string }> = {
                        idle: { text: '\u25CF Ready', color: '#00C853' },
                        planning: { text: '\u25CF Planning...', color: '#FFB300' },
                        awaiting_approval: { text: '\u25CF Awaiting Approval', color: '#FFB300' },
                        executing: { text: '\u25CF Executing...', color: '#00E5FF' },
                        complete: { text: '\u25CF Complete', color: '#00C853' },
                        error: { text: '\u25CF Error', color: '#FF4444' },
                        stopped: { text: '\u25CF Stopped', color: '#FF9800' },
                };
                const config = stateConfig[this.executionState] ?? stateConfig.idle;
                this.statusIndicator.style.cssText = `font-size: 11px; color: ${config.color}; margin-bottom: 6px;`;
                this.statusIndicator.textContent = config.text;
        }

        private getActionIcon(action: string): string {
                const icons: Record<string, string> = {
                        Read: '[READ]',
                        Create: '[CREATE]',
                        Edit: '[EDIT]',
                        Run: '[RUN]',
                };
                return icons[action] ?? '\u2022';
        }

        private scrollToBottom(): void {
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        }

        /**
         * Phase 4: Clear all messages and reset to welcome state.
         */
        private clearMessages(): void {
                this.messageContainer.replaceChildren();
                this.messageCount = 0;
                this.currentTaskId = null;
                this.pendingDiffs = [];
                this.diffCounter = 0;
                this.toolLogEntries = [];
                this.toolLogContainer = null;

                // Clear conversation history so the agent doesn't remember previous turns
                this.agentLoop.clearConversationHistory();

                // Re-render welcome message
                const welcome = dom.$('.construct-welcome');
                welcome.style.cssText = `padding: 16px; text-align: center;`;

                const logo = dom.$('.construct-logo');
                logo.style.cssText = `font-size: 32px; margin-bottom: 8px; color: #00E5FF;`;
                logo.textContent = '\u2B21';

                const title = dom.$('.construct-title');
                title.style.cssText = `font-size: 14px; font-weight: 600; color: #E0E7FF; margin-bottom: 4px;`;
                title.textContent = 'Kovix Agent';

                const subtitle = dom.$('.construct-subtitle');
                subtitle.style.cssText = `font-size: 12px; color: #4A5568; margin-bottom: 12px;`;
                subtitle.textContent = 'AI-powered coding assistant';

                const statusEl = dom.$('.construct-status');
                const stateConfig: Record<ExecutionState, { text: string; color: string }> = {
                        idle: { text: '\u25CF Ready', color: '#00C853' },
                        planning: { text: '\u25CF Planning...', color: '#FFB300' },
                        awaiting_approval: { text: '\u25CF Awaiting Approval', color: '#FFB300' },
                        executing: { text: '\u25CF Executing...', color: '#00E5FF' },
                        complete: { text: '\u25CF Complete', color: '#00C853' },
                        error: { text: '\u25CF Error', color: '#FF4444' },
                        stopped: { text: '\u25CF Stopped', color: '#FF9800' },
                };
                const cfg = stateConfig.idle;
                statusEl.style.cssText = `font-size: 11px; color: ${cfg.color}; margin-bottom: 6px;`;
                statusEl.textContent = cfg.text;

                const memoryStatus = dom.$('.construct-memory-status');
                memoryStatus.style.cssText = `font-size: 10px; color: ${this.constructMemory.isInitialized ? '#00E5FF' : '#4A5568'}; margin-bottom: 8px;`;
                memoryStatus.textContent = this.constructMemory.isInitialized
                        ? '[MEMORY] Connected'
                        : '[MEMORY] Local only';

                const hint = dom.$('.construct-hint');
                hint.style.cssText = `font-size: 11px; color: #4A5568; font-family: monospace; background: #0A0E1A; border-radius: 4px; padding: 6px 10px; display: inline-block;`;
                hint.textContent = 'Ctrl+Shift+I  Inline edit  |  Ctrl+Shift+C  Focus panel';

                welcome.appendChild(logo);
                welcome.appendChild(title);
                welcome.appendChild(subtitle);
                welcome.appendChild(statusEl);
                welcome.appendChild(memoryStatus);
                welcome.appendChild(hint);
                this.messageContainer.appendChild(welcome);

                this.setExecutionState('idle');
                this.updateClearBtnVisibility();
        }

        /**
         * Phase 4: Show clear button only when messages exist beyond the welcome.
         */
        private updateClearBtnVisibility(): void {
                if (!this.clearBtn) { return; }
                const hasMessages = this.messageContainer.querySelectorAll('.construct-user-msg, .construct-agent-msg').length > 0;
                this.clearBtn.style.display = hasMessages ? 'inline-block' : 'none';
        }

        /**
         * Refresh the file explorer to show newly created/modified files.
         * Uses multiple fallback strategies for reliability.
         */
        private async refreshFileExplorer(): Promise<void> {
                try {
                        await this.commandService.executeCommand('workbench.files.action.refreshFilesExplorer');
                } catch {
                        // Fallback: stat the workspace root to trigger file watcher
                        try {
                                const rootUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (rootUri) {
                                        await this.fileService.stat(rootUri);
                                }
                        } catch {
                                // Non-critical -- file explorer will refresh eventually via watchers
                        }
                }
        }

        protected override layoutBody(height: number, width: number): void {
                // Layout handled by flexbox
        }

        // --- Phase 2: Model Picker Methods ---

        private refreshModelPickerInfo(): void {
                const model = this.aiService.getActiveModel();
                const providerType = this.aiService.activeProviderType;
                const isLocal = this.aiService.isOffline();

                this.currentModelInfo = {
                        name: model?.displayName ?? 'No Model',
                        providerType,
                        isLocal,
                };
                this.updateModelPickerLabel();
        }

        private updateModelPickerLabel(): void {
                if (!this.modelPickerBtn) { return; }
                const icon = this.currentModelInfo.isLocal ? '\u26A1' : '\uD83C\uDF10'; // ⚡ or 🌐
                const typeLabel = this.currentModelInfo.providerType ?? 'none';
                this.modelPickerBtn.textContent = `${icon} ${this.currentModelInfo.name} (${typeLabel})`;
        }

        // --- Phase 2: Context Gathering ---

        private gatherContext(): string {
                switch (this.contextScope) {
                        case 'currentFile': {
                                const editor = this.codeEditorService.getActiveCodeEditor();
                                if (!editor) { return ''; }
                                const model = editor.getModel();
                                if (!model) { return ''; }
                                const fileName = model.uri.path.split('/').pop() ?? 'unknown';
                                const content = model.getValue();
                                // Limit to first 3000 chars to avoid overwhelming context
                                const truncated = content.length > 3000
                                        ? content.substring(0, 3000) + '\n... (truncated)'
                                        : content;
                                return `[File: ${fileName}]\n${truncated}`;
                        }
                        case 'selectedText': {
                                const editor = this.codeEditorService.getActiveCodeEditor();
                                if (!editor) { return ''; }
                                const selection = editor.getSelection();
                                if (!selection || selection.isEmpty()) { return ''; }
                                return editor.getModel()?.getValueInRange(selection) ?? '';
                        }
                        case 'workspace':
                                // Workspace context is handled by the agent loop itself
                                return '';
                        default:
                                return '';
                }
        }

        // --- Phase 2: Tool Activity Log ---

        private renderToolActivityLog(): void {
                if (this.toolLogEntries.length === 0) { return; }

                // Remove previous log if any
                this.toolLogContainer?.remove();

                this.toolLogContainer = dom.$('.construct-tool-log');
                this.toolLogContainer.style.cssText = `
                        background: #141B2D; border: 1px solid #1A1F2E;
                        border-radius: 6px; margin: 8px 0; font-size: 11px;
                `;

                // Header with toggle
                const header = dom.$('.construct-tool-log-header');
                header.style.cssText = `
                        display: flex; align-items: center; justify-content: space-between;
                        padding: 6px 10px; cursor: pointer; color: #E0E7FF;
                        font-weight: 600;
                `;
                header.textContent = `\uD83D\uDD27 Tool Activity (${this.toolLogEntries.length} calls)`;

                const toggle = dom.$('.construct-tool-log-toggle');
                toggle.style.cssText = `color: #4A5568; font-size: 10px;`;
                toggle.textContent = this.toolLogCollapsed ? '[+]' : '[-]';

                header.appendChild(toggle);

                // Body
                const body = dom.$('.construct-tool-log-body');
                body.style.cssText = `
                        padding: 0 10px 8px; display: ${this.toolLogCollapsed ? 'none' : 'block'};
                `;

                for (const entry of this.toolLogEntries) {
                        const row = dom.$('.construct-tool-log-entry');
                        const statusIcon = entry.success ? '\u2705' : '\u274C'; // ✅ or ❌
                        const duration = entry.durationMs > 1000
                                ? `${(entry.durationMs / 1000).toFixed(1)}s`
                                : `${entry.durationMs}ms`;
                        row.style.cssText = `
                                padding: 3px 0; color: #C0C0C0; font-family: monospace;
                                border-bottom: 1px solid #1A1F2E;
                        `;
                        row.textContent = `${statusIcon} ${entry.toolName}${entry.target ? ': ' + entry.target : ''} (${duration})`;
                        body.appendChild(row);
                }

                header.onclick = () => {
                        this.toolLogCollapsed = !this.toolLogCollapsed;
                        body.style.display = this.toolLogCollapsed ? 'none' : 'block';
                        toggle.textContent = this.toolLogCollapsed ? '[+]' : '[-]';
                };

                this.toolLogContainer.appendChild(header);
                this.toolLogContainer.appendChild(body);
                this.messageContainer.appendChild(this.toolLogContainer);
                this.scrollToBottom();
        }

        // --- Phase 2: Diff Viewer ---

        private showPendingDiff(filePath: string, changeType: 'write' | 'edit'): void {
                const diffId = `diff-${++this.diffCounter}`;

                const diffContainer = dom.$(`.construct-diff-${diffId}`);
                diffContainer.style.cssText = `
                        background: #141B2D; border: 1px solid #2D3A4D;
                        border-radius: 6px; margin: 8px 0; overflow: hidden;
                `;

                // File path header
                const pathHeader = dom.$('.construct-diff-path');
                pathHeader.style.cssText = `
                        padding: 6px 10px; background: #0D1117; color: #00E5FF;
                        font-size: 11px; font-family: monospace;
                        border-bottom: 1px solid #1A1F2E;
                        display: flex; align-items: center; justify-content: space-between;
                `;
                const changeLabel = changeType === 'write' ? '[NEW]' : '[EDIT]';
                pathHeader.textContent = `${changeLabel} ${filePath}`;

                // Content area (async loaded)
                const contentArea = dom.$('.construct-diff-content');
                contentArea.style.cssText = `
                        padding: 8px 10px; max-height: 200px; overflow-y: auto;
                        font-family: monospace; font-size: 11px; color: #C0C0C0;
                        white-space: pre-wrap; background: #0A0E1A;
                `;
                contentArea.textContent = 'Loading file content...';

                // Load file content via diffApplier
                this.diffApplier.readFile(filePath).then(content => {
                        const truncated = content.length > 2000
                                ? content.substring(0, 2000) + '\n... (truncated)'
                                : content;
                        contentArea.textContent = truncated;
                        // Store the content in the pending diff entry
                        const entry = this.pendingDiffs.find(d => d.id === diffId);
                        if (entry) { entry.content = content; }
                }).catch(() => {
                        contentArea.textContent = '(Unable to read file content)';
                });

                // Buttons
                const btnRow = dom.$('.construct-diff-buttons');
                btnRow.style.cssText = `
                        display: flex; gap: 6px; padding: 6px 10px;
                        border-top: 1px solid #1A1F2E; background: #0D1117;
                `;

                const acceptBtn = dom.$('button') as HTMLButtonElement;
                acceptBtn.textContent = '\u2705 Accept';
                acceptBtn.style.cssText = `
                        background: #00C853; color: white; border: none;
                        border-radius: 3px; padding: 4px 10px; cursor: pointer;
                        font-size: 11px; font-weight: 600;
                `;

                const rejectBtn = dom.$('button') as HTMLButtonElement;
                rejectBtn.textContent = '\u274C Reject';
                rejectBtn.style.cssText = `
                        background: #FF4444; color: white; border: none;
                        border-radius: 3px; padding: 4px 10px; cursor: pointer;
                        font-size: 11px; font-weight: 600;
                `;

                acceptBtn.onclick = () => {
                        const entry = this.pendingDiffs.find(d => d.id === diffId);
                        if (entry) { entry.accepted = true; }
                        diffContainer.style.borderLeft = '3px solid #00C853';
                        acceptBtn.disabled = true;
                        rejectBtn.disabled = true;
                        acceptBtn.style.opacity = '0.5';
                        rejectBtn.style.opacity = '0.5';
                        // P0-5 FIX: Accept the pending change (writes to disk)
                        const fileUri = URI.file(filePath);
                        this.pendingChangesService.accept(fileUri).then(() => {
                                this.notificationService.info(`Accepted change: ${filePath}`);
                        }).catch((err: unknown) => {
                                this.logService.error('[AgentView] Failed to accept change:', err);
                                this.notificationService.error(`Failed to accept change: ${err instanceof Error ? err.message : String(err)}`);
                        });
                };

                rejectBtn.onclick = () => {
                        const entry = this.pendingDiffs.find(d => d.id === diffId);
                        if (entry) { entry.accepted = false; }
                        diffContainer.style.borderLeft = '3px solid #FF4444';
                        acceptBtn.disabled = true;
                        rejectBtn.disabled = true;
                        acceptBtn.style.opacity = '0.5';
                        rejectBtn.style.opacity = '0.5';
                        // P0-5 FIX: Reject the pending change (discards in memory, no disk write)
                        const fileUri = URI.file(filePath);
                        this.pendingChangesService.reject(fileUri).then(() => {
                                this.notificationService.info(`Rejected change: ${filePath}`);
                        }).catch((err: unknown) => {
                                this.logService.error('[AgentView] Failed to reject change:', err);
                                this.notificationService.error(`Failed to reject change: ${err instanceof Error ? err.message : String(err)}`);
                        });
                };

                btnRow.appendChild(acceptBtn);
                btnRow.appendChild(rejectBtn);

                diffContainer.appendChild(pathHeader);
                diffContainer.appendChild(contentArea);
                diffContainer.appendChild(btnRow);

                this.messageContainer.appendChild(diffContainer);

                // Track pending diff
                this.pendingDiffs.push({
                        id: diffId,
                        filePath,
                        content: '',
                        originalContent: null, // Will be populated when diff content arrives
                        changeType,
                        element: diffContainer,
                        accepted: false,
                });

                this.scrollToBottom();
        }

        /**
         * Accept all pending diffs via PendingChangesService.
         * P0-5 FIX: Changes are now written to disk only upon explicit accept.
         */
        async acceptAllPendingDiffs(): Promise<void> {
                // Delegate to PendingChangesService which writes to disk
                await this.pendingChangesService.acceptAll();
                // Clean up UI elements
                for (const diff of this.pendingDiffs) {
                        diff.element.remove();
                }
                this.pendingDiffs = [];
        }

        /**
         * Reject all pending diffs via PendingChangesService.
         * P0-5 FIX: Rejecting discards in-memory changes; disk is never modified.
         */
        async rejectAllPendingDiffs(): Promise<void> {
                // Delegate to PendingChangesService which discards in-memory entries
                await this.pendingChangesService.rejectAll();
                // Clean up UI elements
                for (const diff of this.pendingDiffs) {
                        diff.element.remove();
                }
                this.pendingDiffs = [];
        }

        // --- Idea Refinement Flow ---

        private async runRefinementFlow(idea: string): Promise<void> {
                this.setExecutionState('refining');
                try {
                        const questions = await this.ideaRefinementService.startRefinement(idea);
                        if (questions.length === 0) {
                                // No questions - go straight to planning
                                this.setExecutionState('idle');
                                const contextText = this.gatherContext();
                                const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                                this.toolLogEntries = [];
                                await this.runPlanActFlow(taskWithContext);
                                return;
                        }
                        this.renderRefinementQuestions(questions, idea);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.addAgentMessage(`[Refinement Error] ${msg}. Proceeding to planning...`, 'error');
                        this.setExecutionState('idle');
                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                        this.toolLogEntries = [];
                        await this.runPlanActFlow(taskWithContext);
                }
        }

        private renderRefinementQuestions(questions: IRefinementQuestion[], idea: string): void {
                const container = dom.$('.construct-refinement');
                container.style.cssText = `
                        background: #141B2D; border: 1px solid #1A1F2E;
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;

                const header = dom.$('.construct-refinement-header');
                header.style.cssText = `font-weight: 600; color: #E0E7FF; margin-bottom: 10px; font-size: 13px;`;
                header.textContent = `\uD83D\uDCA1 Idea Refinement \u2014 ${questions.length} questions`;
                container.appendChild(header);

                const answers: Map<string, string> = new Map();

                for (const q of questions) {
                        const qCard = dom.$('.construct-refinement-question');
                        qCard.style.cssText = `
                                background: #0D1117; border: 1px solid #1A1F2E;
                                border-radius: 4px; padding: 8px 10px; margin-bottom: 8px;
                        `;

                        const categoryBadge = dom.$('.construct-refinement-category');
                        categoryBadge.style.cssText = `
                                font-size: 10px; background: #1A2744; color: #00E5FF;
                                border-radius: 3px; padding: 1px 6px; display: inline-block; margin-bottom: 4px;
                        `;
                        categoryBadge.textContent = q.category;

                        const qText = dom.$('.construct-refinement-text');
                        qText.style.cssText = `font-size: 12px; color: #E0E7FF; margin-bottom: 6px;`;
                        qText.textContent = q.text;

                        const input = document.createElement('input');
                        input.type = 'text';
                        input.placeholder = q.suggestions?.[0] ?? 'Your answer...';
                        input.style.cssText = `
                                width: 100%; background: #0A0E1A; border: 1px solid #1A1F2E;
                                border-radius: 3px; padding: 6px 8px; color: #E0E7FF;
                                font-size: 12px; outline: none; box-sizing: border-box;
                        `;
                        input.oninput = () => { answers.set(q.id, input.value); };

                        qCard.appendChild(categoryBadge);
                        qCard.appendChild(qText);
                        qCard.appendChild(input);

                        // Suggestion chips
                        if (q.suggestions && q.suggestions.length > 0) {
                                const chipContainer = dom.$('.construct-refinement-chips');
                                chipContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;`;
                                for (const suggestion of q.suggestions.slice(0, 3)) {
                                        const chip = dom.$('button') as HTMLButtonElement;
                                        chip.textContent = suggestion;
                                        chip.style.cssText = `
                                                background: #1A2744; border: 1px solid #2D3A5C; border-radius: 12px;
                                                color: #E0E7FF; font-size: 10px; padding: 2px 8px; cursor: pointer;
                                        `;
                                        chip.onclick = () => {
                                                input.value = suggestion;
                                                answers.set(q.id, suggestion);
                                        };
                                        chipContainer.appendChild(chip);
                                }
                                qCard.appendChild(chipContainer);
                        }

                        container.appendChild(qCard);
                }

                // Action buttons
                const btnContainer = dom.$('.construct-refinement-buttons');
                btnContainer.style.cssText = `display: flex; gap: 8px; margin-top: 8px;`;

                const submitBtn = dom.$('button') as HTMLButtonElement;
                submitBtn.textContent = 'Submit Answers';
                submitBtn.style.cssText = `
                        background: #00E5FF; color: #0A0E1A; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;

                const skipBtn = dom.$('button') as HTMLButtonElement;
                skipBtn.textContent = 'Skip to Planning';
                skipBtn.style.cssText = `
                        background: #1A2744; border: 1px solid #2D3A5C; color: #E0E7FF;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px;
                `;

                submitBtn.onclick = async () => {
                        container.remove();
                        const refinementAnswers: IRefinementAnswer[] = questions.map(q => ({
                                questionId: q.id,
                                text: answers.get(q.id) ?? '',
                                skipped: !answers.has(q.id),
                        }));
                        await this.handleRefinementAnswers(refinementAnswers, idea);
                };

                skipBtn.onclick = async () => {
                        container.remove();
                        try {
                                const refinedIdea = await this.ideaRefinementService.skipToRefinedIdea();
                                this.proceedWithRefinedIdea(refinedIdea, idea);
                        } catch {
                                this.setExecutionState('idle');
                                const contextText = this.gatherContext();
                                const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                                this.toolLogEntries = [];
                                await this.runPlanActFlow(taskWithContext);
                        }
                };

                btnContainer.appendChild(submitBtn);
                btnContainer.appendChild(skipBtn);
                container.appendChild(btnContainer);

                this.messageContainer.appendChild(container);
                this.scrollToBottom();
        }

        private async handleRefinementAnswers(answers: IRefinementAnswer[], idea: string): Promise<void> {
                this.addAgentMessage('\u23F3 Processing your answers...', 'info');
                try {
                        const result = await this.ideaRefinementService.submitAnswers(answers);
                        if (result.type === 'questions') {
                                this.renderRefinementQuestions(result.questions, idea);
                        } else {
                                this.proceedWithRefinedIdea(result.refinedIdea, idea);
                        }
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.addAgentMessage(`[Refinement Error] ${msg}. Proceeding with original idea...`, 'error');
                        this.setExecutionState('idle');
                        const contextText = this.gatherContext();
                        const taskWithContext = contextText ? `${idea}\n\n[Context (${this.contextScope})]:\n${contextText}` : idea;
                        this.toolLogEntries = [];
                        await this.runPlanActFlow(taskWithContext);
                }
        }

        private async proceedWithRefinedIdea(refinedIdea: IRefinedIdea, originalIdea: string): Promise<void> {
                const summaryEl = dom.$('.construct-refined-summary');
                summaryEl.style.cssText = `
                        background: #141B2D; border: 1px solid #00E5FF;
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;
                summaryEl.innerHTML = `
                        <div style="font-weight:600;color:#E0E7FF;margin-bottom:6px;font-size:13px">\u2705 Refined Idea</div>
                        <div style="font-size:12px;color:#C0C0C0;margin-bottom:8px">${this.escapeHtml(refinedIdea.refinedDescription)}</div>
                        <div style="font-size:11px;color:#00E5FF">Confidence: ${Math.round(refinedIdea.confidence * 100)}%</div>
                `;
                this.messageContainer.appendChild(summaryEl);
                this.scrollToBottom();

                // Use refined idea for planning
                this.setExecutionState('idle');
                this.toolLogEntries = [];
                await this.runPlanActFlow(refinedIdea.refinedDescription);
        }

        // --- Milestone Pause Controls ---

        private renderMilestonePauseControls(milestone: IMilestone): void {
                const container = dom.$('.construct-milestone-pause');
                container.style.cssText = `
                        background: #1A2744; border: 1px solid #00E5FF;
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;

                const header = dom.$('.construct-milestone-header');
                header.style.cssText = `font-weight: 600; color: #00E5FF; margin-bottom: 6px; font-size: 13px;`;
                header.textContent = `\u23F8 Paused at: ${milestone.name}`;
                container.appendChild(header);

                const desc = dom.$('.construct-milestone-desc');
                desc.style.cssText = `font-size: 12px; color: #C0C0C0; margin-bottom: 10px;`;
                desc.textContent = milestone.description;
                container.appendChild(desc);

                const btnContainer = dom.$('.construct-milestone-buttons');
                btnContainer.style.cssText = `display: flex; gap: 8px;`;

                const continueBtn = dom.$('button') as HTMLButtonElement;
                continueBtn.textContent = '\u25B6 Continue';
                continueBtn.style.cssText = `
                        background: #00C853; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;
                continueBtn.onclick = () => {
                        container.remove();
                        this.agentLoop.resumeFromMilestone();
                        this.setExecutionState('executing');
                };

                const skipBtn = dom.$('button') as HTMLButtonElement;
                skipBtn.textContent = '\u23ED Skip';
                skipBtn.style.cssText = `
                        background: #FF9800; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;
                skipBtn.onclick = () => {
                        container.remove();
                        this.agentLoop.skipCurrentMilestone();
                        this.setExecutionState('executing');
                };

                const stopBtn = dom.$('button') as HTMLButtonElement;
                stopBtn.textContent = '\u25A0 Stop';
                stopBtn.style.cssText = `
                        background: #FF4444; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;
                stopBtn.onclick = () => {
                        container.remove();
                        if (this._abortController) {
                                this._abortController.abort();
                                this._abortController = null;
                        }
                        this.setExecutionState('idle');
                };

                btnContainer.appendChild(continueBtn);
                btnContainer.appendChild(skipBtn);
                btnContainer.appendChild(stopBtn);
                container.appendChild(btnContainer);

                this.messageContainer.appendChild(container);
                this.scrollToBottom();
        }

        // --- Session History ---

        private async showSessionHistory(): Promise<void> {
                const sessions = this.sessionService.sessions;
                if (sessions.length === 0) {
                        this.notificationService.info('No previous sessions found.');
                        return;
                }

                const picks = sessions.map(s => ({
                        label: s.title,
                        description: `${s.messageCount} messages`,
                        detail: `Last active: ${new Date(s.lastActiveAt).toLocaleString()}`,
                        sessionId: s.id,
                }));

                const pick = await this.quickInputService.pick(picks, {
                        placeHolder: 'Select a session to restore...',
                        title: 'Session History',
                });

                if (pick) {
                        await this.sessionService.switchToSession((pick as any).sessionId);
                        this.notificationService.info(`Session restored: ${pick.label}`);
                }
        }

        // --- Utility ---

        private escapeHtml(text: string): string {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
        }
}
