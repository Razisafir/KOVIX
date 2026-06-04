/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { IAgentLoop, IPlanResult } from '../../../../platform/construct/common/agent/agentLoop.js';
import { IAnthropicProvider } from '../../../../platform/construct/common/llm/anthropicProvider.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands';
import { IFileService } from '../../../../platform/files/common/files';
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

type ExecutionState = 'idle' | 'planning' | 'awaiting_approval' | 'executing' | 'complete' | 'error' | 'stopped';

export class ConstructAgentViewPane extends ViewPane {

        private messageContainer!: HTMLElement;
        private inputBox!: HTMLInputElement;
        private sendBtn!: HTMLButtonElement;
        private stopBtn!: HTMLButtonElement;
        private statusIndicator!: HTMLElement;
        private planContainer: HTMLElement | null = null;
        private messageCount = 0;
        private currentTaskId: string | null = null;
        private executionState: ExecutionState = 'idle';
        private currentCancellationToken: CancellationTokenSource | null = null;

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
                @IAnthropicProvider private readonly anthropicProvider: IAnthropicProvider,
                @ILogService private readonly logService: ILogService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @INotificationService private readonly notificationService: INotificationService,
                @ICommandService private readonly commandService: ICommandService,
                @IFileService private readonly fileService: IFileService,
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';

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
                title.textContent = 'Construct Agent';

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

                this.inputBox = dom.$('input.construct-chat-input') as HTMLInputElement;
                this.inputBox.type = 'text';
                this.inputBox.placeholder = 'Ask Construct anything...';
                this.inputBox.style.cssText = `
                        flex: 1; background: #0A0E1A; border: 1px solid #1A1F2E;
                        border-radius: 4px; padding: 8px 10px; color: #E0E7FF;
                        font-size: 13px; outline: none;
                `;

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

                        // Auto-learn from user message
                        if (this.constructMemory.config.enabled && this.constructMemory.config.autoLearn) {
                                this.constructMemory.addMemory(`User asked: ${text}`, {
                                        type: 'user_message',
                                        taskId: this.currentTaskId,
                                        messageNumber: this.messageCount
                                }).catch(() => { /* non-critical */ });
                        }

                        // Check for API key
                        const apiKey = this.configurationService.getValue<string>('construct.anthropic.apiKey');
                        if (!apiKey) {
                                this.addAgentMessage(
                                        '[WARN] Anthropic API key required. [Open Settings](command:construct.openApiSettings)',
                                        'error'
                                );
                                this.notificationService.warn('Anthropic API key required. Configure it in Settings.');
                                return;
                        }

                        // Sync API config to provider
                        this.anthropicProvider.updateConfig({
                                apiKey,
                                model: this.configurationService.getValue<string>('construct.anthropic.model') || 'claude-sonnet-4-20250514',
                                maxTokens: this.configurationService.getValue<number>('construct.anthropic.maxTokens') || 8192,
                        });

                        // Start Plan/Act flow
                        await this.runPlanActFlow(text);
                };

                this.sendBtn.onclick = sendMessage;
                this.inputBox.onkeydown = (e) => {
                        if (e.key === 'Enter') { sendMessage(); }
                };

                this.stopBtn.onclick = () => {
                        if (this.currentCancellationToken) {
                                this.currentCancellationToken.cancel();
                                this.currentCancellationToken = null;
                        }
                };

                inputArea.appendChild(this.inputBox);
                inputArea.appendChild(this.stopBtn);
                inputArea.appendChild(this.sendBtn);
                container.appendChild(inputArea);

                // Listen for memory initialization changes
                this._register(this.constructMemory.onDidChangeInitialization((initialized) => {
                        memoryStatus.style.color = initialized ? '#00E5FF' : '#4A5568';
                        memoryStatus.textContent = initialized
                                ? '[MEMORY] Connected'
                                : '[MEMORY] Local only';
                }));

                // Listen for provider errors
                this._register(this.anthropicProvider.onKeyInvalid(() => {
                        this.addAgentMessage('[KEY] API key invalid. [Open Settings](command:construct.openApiSettings)', 'error');
                }));
                this._register(this.anthropicProvider.onConnectionError((error) => {
                        this.addAgentMessage(`[NET] Connection failed: ${error.message}. [Retry](command:construct.focusPanel)`, 'error');
                }));
        }

        /**
         * Run the Plan/Act approval flow.
         */
        private async runPlanActFlow(task: string): Promise<void> {
                this.setExecutionState('planning');
                this.currentCancellationToken = new CancellationTokenSource();

                // Add planning indicator
                const planningMsg = this.addAgentMessage('[PLAN] Planning...', 'info');

                try {
                        // Phase 1: Planning
                        const plan = await this.agentLoop.runPlanningPhase(task, this.currentCancellationToken.token as unknown as AbortSignal);

                        if (this.currentCancellationToken.token.isCancellationRequested) {
                                this.setExecutionState('stopped');
                                this.updateMessageContent(planningMsg, '[STOP] Stopped by user');
                                // Transition back to idle after showing stopped state
                                setTimeout(() => { this.setExecutionState('idle'); }, 1500);
                                return;
                        }

                        // Phase 2: Show plan and await approval
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
                }
        }

        /**
         * Render the plan with Approve/Cancel buttons.
         */
        private renderPlan(plan: IPlanResult, task: string): void {
                // Remove any existing plan container
                this.planContainer?.remove();

                this.planContainer = dom.$('.construct-plan');
                this.planContainer.style.cssText = `
                        background: #141B2D; border: 1px solid #1A1F2E;
                        border-radius: 6px; padding: 12px; margin: 8px 0;
                `;

                // Plan header
                const header = dom.$('.construct-plan-header');
                header.style.cssText = `font-weight: 600; color: #E0E7FF; margin-bottom: 8px; font-size: 13px;`;
                header.textContent = '[PLAN] Execution Plan';
                this.planContainer.appendChild(header);

                // Plan steps
                if (plan.steps.length > 0) {
                        for (const step of plan.steps) {
                                const stepEl = dom.$('.construct-plan-step');
                                const icon = this.getActionIcon(step.action);
                                stepEl.style.cssText = `padding: 4px 0; font-size: 12px; color: #C0C0C0;`;
                                stepEl.textContent = `${icon} ${step.action}: ${step.target}`;
                                this.planContainer.appendChild(stepEl);
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
                approveBtn.textContent = '[OK] Approve';
                approveBtn.style.cssText = `
                        background: #00C853; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;

                const cancelBtn = dom.$('button') as HTMLButtonElement;
                cancelBtn.textContent = '[X] Cancel';
                cancelBtn.style.cssText = `
                        background: #FF4444; color: white; border: none;
                        border-radius: 4px; padding: 6px 14px; cursor: pointer;
                        font-size: 12px; font-weight: 600;
                `;

                approveBtn.onclick = () => {
                        this.planContainer?.remove();
                        this.planContainer = null;
                        this.runExecution(task);
                };

                cancelBtn.onclick = () => {
                        this.planContainer?.remove();
                        this.planContainer = null;
                        this.addAgentMessage('[CANCEL] Task cancelled', 'info');
                        this.setExecutionState('idle');
                };

                btnContainer.appendChild(approveBtn);
                btnContainer.appendChild(cancelBtn);
                this.planContainer.appendChild(btnContainer);

                this.messageContainer.appendChild(this.planContainer);
                this.scrollToBottom();
        }

        /**
         * Run the execution phase with full tool access.
         */
        private async runExecution(task: string): Promise<void> {
                this.setExecutionState('executing');
                this.currentCancellationToken = new CancellationTokenSource();

                // Add execution indicator
                const execMsg = this.addAgentMessage('', 'streaming');

                let fullText = '';
                let stepCount = 0;

                try {
                        const stream = this.agentLoop.run(task, this.currentCancellationToken.token as unknown as AbortSignal);

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
                                                fullText += `\n\n[TOOL] ${event.toolName}`;
                                                if (event.toolInput && typeof event.toolInput === 'object') {
                                                        const input = event.toolInput as Record<string, string>;
                                                        if (input.path) { fullText += `: ${input.path}`; }
                                                        else if (input.command) { fullText += `: ${input.command.substring(0, 60)}`; }
                                                }
                                                break;

                                        case 'tool_executing':
                                                // Show progress indicator
                                                break;

                                        case 'tool_result':
                                                if (event.success) {
                                                        fullText += `\n[OK] ${event.toolName} completed`;
                                                } else {
                                                        fullText += `\n[FAIL] ${event.toolName} failed: ${event.result.substring(0, 200)}`;
                                                }
                                                fullText += `\n\nExecuting step ${stepCount}...`;
                                                break;

                                        case 'file_written':
                                                // Refresh file explorer after writes
                                                this.refreshFileExplorer();
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

                        this.setExecutionState(this.currentCancellationToken.token.isCancellationRequested ? 'stopped' : 'complete');

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

                } catch (error) {
                        this.setExecutionState('error');
                        const msg = error instanceof Error ? error.message : String(error);
                        this.updateMessageContent(execMsg, `[FAIL] Error: ${msg}`);
                        this.logService.error('[AgentView] Execution error:', msg);

                        // Transition back to idle after showing error
                        setTimeout(() => { this.setExecutionState('idle'); }, 2000);
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
                        this.inputBox.placeholder = 'Ask Construct anything...';
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
}
