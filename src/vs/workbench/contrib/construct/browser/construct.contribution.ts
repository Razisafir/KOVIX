// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation } from '../../../../workbench/common/views';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors';
import { Codicon } from '../../../../base/common/codicons';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { ConstructAgentViewPane } from './constructAgentView.js';
import { ConstructMemoryViewPane } from './constructMemoryView.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { IWorkbenchContribution, Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../../workbench/common/contributions';
import { LifecyclePhase } from '../../../../workbench/services/lifecycle/common/lifecycle.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { IBrowserAutomationService } from '../../../../platform/construct/common/mcp/browserAutomation.js';
import { MCPServerManagerService } from './services/mcp/mcpServerManagerService.js';
import { MCPMarketplaceService } from './services/mcp/mcpMarketplaceService.js';
import { BrowserAutomationService } from './services/mcp/browserAutomationService.js';
import { IWorkingMemoryService } from '../../../../platform/construct/common/memory/workingMemory.js';
import { IEpisodicMemoryService } from '../../../../platform/construct/common/memory/episodicMemory.js';
import { ISemanticMemoryService } from '../../../../platform/construct/common/memory/semanticMemory.js';
import { IProceduralMemoryService } from '../../../../platform/construct/common/memory/proceduralMemory.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IEmbeddingService } from '../../../../platform/construct/common/memory/embeddingService.js';
import { IConstructMemoryService } from '../../../../platform/construct/common/memory/constructMemory.js';
import { WorkingMemoryService } from './services/memory/workingMemoryService.js';
import { EpisodicMemoryService } from './services/memory/episodicMemoryService.js';
import { SemanticMemoryService } from './services/memory/semanticMemoryService.js';
import { ProceduralMemoryService } from './services/memory/proceduralMemoryService.js';
import { MemoryOrchestratorService } from './services/memory/memoryOrchestratorService.js';
import { EmbeddingService } from './services/memory/embeddingService.js';
import { ConstructMemoryService } from './services/memory/constructMemoryService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructToolRegistry } from '../../../../platform/construct/common/tools/constructToolRegistry.js';
import { IMCPProcess } from '../../../../platform/construct/common/mcp/mcpProcess';
import { ITerminalExecutor } from '../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IDiffApplier } from '../../../../platform/construct/common/editor/diffApplier.js';
import { IAgentLoop } from '../../../../platform/construct/common/agent/agentLoop.js';
import { ConstructAIService } from './services/llm/constructAIService.js';
import { ConstructToolRegistryService } from './services/tools/constructToolRegistryService.js';
import { MCPProcessService } from './services/mcp/mcpProcess';
import { TerminalExecutorService } from './services/terminal/terminalExecutor.js';
import { DiffApplierService } from './services/editor/diffApplier.js';
import { AgentLoopService } from './services/agent/agentLoop.js';
import { ISecureKeyManager } from '../../../../platform/construct/common/security/secureKeyManager.js';
import { SecureKeyManagerService } from './services/security/secureKeyManager.js';
import { IAgentErrorRecovery } from '../../../../platform/construct/common/recovery/agentErrorRecovery.js';
import { AgentErrorRecoveryService } from './services/recovery/agentErrorRecovery.js';
import { IFileWatcherService } from '../../../../platform/construct/common/watcher/fileWatcherService.js';
import { FileWatcherService } from './services/watcher/fileWatcherService.js';
import { ISnapshotManager } from '../../../../platform/construct/common/snapshot/snapshotManager.js';
import { SnapshotManagerService } from './services/snapshot/snapshotManager.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ConstructOnboardingWizard } from './constructOnboarding.js';
import './constructMemoryConfig';
import './constructApiConfig';
import './constructApiSettings';

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Construct Agent view.'));
const constructMemoryIcon = registerIcon('construct-memory-icon', Codicon.symbolEvent, localize('constructMemoryIcon', 'View icon of the Construct Memory view.'));

// Register the Construct view container in the sidebar
const constructViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
                id: 'construct',
                title: localize2('construct', "Construct Agent"),
                ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['construct', { mergeViewWithContainerWhenSingleView: true }]),
                icon: constructViewIcon,
                order: 100,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

// Register the agent panel view inside the container
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
                id: 'construct.agentPanel',
                name: localize2('agentPanel', "Agent"),
                containerIcon: constructViewIcon,
                ctorDescriptor: new SyncDescriptor(ConstructAgentViewPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 1,
}, {
                id: 'construct.memoryPanel',
                name: localize2('memoryPanel', "Memory"),
                containerIcon: constructMemoryIcon,
                ctorDescriptor: new SyncDescriptor(ConstructMemoryViewPane),
                canToggleVisibility: true,
                canMoveView: true,
                order: 2,
}], constructViewContainer);

// Status Bar Integration
class ConstructStatusBarContribution extends Disposable implements IWorkbenchContribution {
                static readonly ID = 'workbench.contrib.constructStatusBar';

                private modelEntryAccessor: IStatusbarEntryAccessor | undefined;

                constructor(
                                @IStatusbarService private readonly statusbarService: IStatusbarService,
                                @IConstructAIService private readonly aiService: IConstructAIService,
                ) {
                                super();

                                // Agent status (left side)
                                this._register(this.statusbarService.addEntry({
                                                name: localize('constructAgentStatus', "Construct Agent Status"),
                                                text: '$(robot) Ready',
                                                ariaLabel: localize('constructAgentStatusAria', "Construct Agent: Ready"),
                                                tooltip: localize('constructAgentStatusTooltip', "Construct Agent: Idle -- click to open panel"),
                                                command: 'construct.focusPanel',
                                }, 'construct.agentStatus', StatusbarAlignment.LEFT, 50));

                                // Model info (left side) — dynamically updated from AI service
                                this.modelEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructModel', "Construct Model"),
                                                text: '$(zap) No Model local',
                                                ariaLabel: localize('constructModelAria', "Active LLM: No model selected"),
                                                tooltip: localize('constructModelTooltip', "Click to select a model"),
                                                command: 'construct.selectModel',
                                }, 'construct.model', StatusbarAlignment.LEFT, 51));

                                // Listen for provider and model changes
                                this._register(this.aiService.onDidChangeActiveModel(() => {
                                                this.updateModelStatus();
                                }));
                                this._register(this.aiService.onDidChangeActiveProvider(() => {
                                                this.updateModelStatus();
                                }));

                                // Pending changes (right side)
                                this._register(this.statusbarService.addEntry({
                                                name: localize('constructChanges', "Construct Changes"),
                                                text: '$(diff-added) 0 pending',
                                                ariaLabel: localize('constructChangesAria', "No changes awaiting approval"),
                                                tooltip: localize('constructChangesTooltip', "No changes awaiting approval"),
                                }, 'construct.changes', StatusbarAlignment.RIGHT, 50));
                }

                private updateModelStatus(): void {
                                if (!this.modelEntryAccessor) { return; }

                                const isLocal = this.aiService.isOffline();
                                const icon = isLocal ? '$(zap)' : '$(globe)';
                                const suffix = isLocal ? 'local' : 'cloud';
                                const model = this.aiService.getActiveModel();
                                const modelName = model?.displayName ?? 'No Model';

                                this.modelEntryAccessor.update({
                                                name: localize('constructModel', "Construct Model"),
                                                text: `${icon} ${modelName} ${suffix}`,
                                                ariaLabel: localize('constructModelAria', `Active LLM: ${modelName} (${suffix})`),
                                                tooltip: localize('constructModelTooltip', `Active LLM: ${modelName} (${suffix}) — click to change`),
                                                command: 'construct.selectModel',
                                });
                }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructStatusBarContribution, LifecyclePhase.Restored);

// --- Construct Commands --------------------------------------------------------

registerAction2(class FocusConstructPanelAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.focusPanel',
                                                title: localize2('focusConstructPanel', "Show Construct Agent"),
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
                                                f1: true,
                                                category: localize2('constructCategory', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.agentPanel', true);
                }
});

registerAction2(class NewConstructChatAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.newChat',
                                                title: localize2('newConstructChat', "New Construct Chat"),
                                                f1: true,
                                                category: localize2('constructCategory2', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.agentPanel', true);
                }
});

registerAction2(class ShowInlineAgentAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.showInlineAgent',
                                                title: localize2('showInlineAgent', "Show Inline Agent"),
                                                keybinding: {
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI,
                                                                weight: KeybindingWeight.WorkbenchContrib,
                                                },
                                                f1: true,
                                                category: localize2('constructCategory3', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.agentPanel', true);
                }
});

// --- Memory Commands (Phase 19+Supermemory) ------------------------------------

registerAction2(class OpenMemoryPanelAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.openMemoryPanel',
                                                title: localize2('openMemoryPanel', "Open Memory Panel"),
                                                f1: true,
                                                category: localize2('constructCategory4', "Construct"),
                                });
                }
                run(accessor: ServicesAccessor): void {
                                accessor.get(IViewsService).openView('construct.memoryPanel', true);
                }
});

registerAction2(class SearchMemoriesAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.searchMemories',
                                                title: localize2('searchMemories', "Search Memories"),
                                                f1: true,
                                                category: localize2('constructCategory5', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const quickInput = accessor.get(IQuickInputService);
                                const memoryService = accessor.get(IConstructMemoryService);
                                const logService = accessor.get(ILogService);

                                const query = await new Promise<string | undefined>((resolve) => {
                                                const input = quickInput.createInputBox();
                                                input.placeholder = 'Search memories...';
                                                input.onDidAccept(() => {
                                                                resolve(input.value);
                                                                input.dispose();
                                                });
                                                input.onDidHide(() => {
                                                                resolve(undefined);
                                                                input.dispose();
                                                });
                                                input.show();
                                });

                                if (!query) { return; }

                                try {
                                                const results = await memoryService.searchMemories(query, 'hybrid', 10);
                                                if (results.length === 0) {
                                                                quickInput.pick([{ label: 'No memories found', alwaysShow: true }]);
                                                                return;
                                                }

                                                const picks = results.map(r => ({
                                                                label: r.content.length > 100 ? r.content.substring(0, 100) + '...' : r.content,
                                                                detail: r.metadata?.type ? String(r.metadata.type) : undefined,
                                                                description: r.score ? `${(r.score * 100).toFixed(0)}% match` : undefined,
                                                }));

                                                await quickInput.pick(picks, { placeHolder: `${results.length} memories found` });
                                } catch (error) {
                                                logService.error('[Construct] Search failed:', error);
                                }
                }
});

registerAction2(class AddMemoryAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.addMemory',
                                                title: localize2('addMemory', "Add Memory"),
                                                f1: true,
                                                category: localize2('constructCategory6', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const quickInput = accessor.get(IQuickInputService);
                                const memoryService = accessor.get(IConstructMemoryService);
                                const notificationService = accessor.get(INotificationService);

                                const content = await new Promise<string | undefined>((resolve) => {
                                                const input = quickInput.createInputBox();
                                                input.placeholder = 'Enter a fact or memory to store...';
                                                input.onDidAccept(() => {
                                                                resolve(input.value);
                                                                input.dispose();
                                                });
                                                input.onDidHide(() => {
                                                                resolve(undefined);
                                                                input.dispose();
                                                });
                                                input.show();
                                });

                                if (!content) { return; }

                                try {
                                                await memoryService.addMemory(content, { type: 'manual', source: 'command' });
                                                notificationService.info(`Memory added: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
                                } catch (error) {
                                                notificationService.error(`Failed to add memory: ${error instanceof Error ? error.message : String(error)}`);
                                }
                }
});

registerAction2(class TestLLMConnectionAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.testMemoryConnection',
                                                title: localize2('testMemoryConnection', "Test Memory Connection"),
                                                f1: true,
                                                category: localize2('constructCategory7', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const memoryService = accessor.get(IConstructMemoryService);
                                const notificationService = accessor.get(INotificationService);

                                if (!memoryService.isInitialized) {
                                                notificationService.warn('Supermemory is not connected. Please configure your API key in settings.');
                                                return;
                                }

                                const healthy = await memoryService.testConnection();
                                if (healthy) {
                                                notificationService.info('[MEMORY] Supermemory connection: Healthy');
                                } else {
                                                notificationService.error('[MEMORY] Supermemory connection: Failed. Check your API key.');
                                }
                }
});

// --- LLM Integration Commands (Phase 4) ---------------------------------------

registerAction2(class OpenApiSettingsAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.openApiSettings',
                                                title: localize2('openApiSettings', "Open API Settings"),
                                                f1: true,
                                                category: localize2('constructCategoryApi', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                accessor.get(ICommandService).executeCommand('workbench.action.openSettings', 'construct.anthropic');
                }
});

registerAction2(class TestCloudConnectionAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.testCloudConnection',
                                                title: localize2('testCloudConnection', "Test Cloud AI Connection"),
                                                f1: true,
                                                category: localize2('constructCategoryCloud', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const aiService = accessor.get(IConstructAIService);
                                const _configurationService = accessor.get(IConfigurationService);
                                const notificationService = accessor.get(INotificationService);

                                // Ensure a cloud provider is configured
                                const provider = aiService.getProvider('cloud');
                                if (!provider) {
                                                notificationService.warn('Cloud provider not available. Configure it in Construct settings first.');
                                                return;
                                }

                                // Try a minimal API call to test the connection
                                try {
                                                const stream = aiService.chat(
                                                                [{ role: 'user', content: 'Reply with exactly: OK' }],
                                                                [],
                                                                { systemPrompt: 'You are a test assistant. Reply concisely.' },
                                                );
                                                let response = '';
                                                for await (const event of stream) {
                                                                if (event.type === 'token') { response += event.text; }
                                                                if (event.type === 'error') {
                                                                                notificationService.error(`Cloud AI connection failed: ${event.text}`);
                                                                                return;
                                                                }
                                                }
                                                const model = aiService.getActiveModel();
                                                notificationService.info(`Cloud AI connection: Working (model: ${model?.displayName ?? 'unknown'})`);
                                } catch (error) {
                                                notificationService.error(`Cloud AI connection failed: ${error instanceof Error ? error.message : String(error)}`);
                                }
                }
});

// --- MCP Service Singletons (Phase 17) -----------------------------------------
registerSingleton(IMCPServerManager, MCPServerManagerService, InstantiationType.Delayed);
registerSingleton(IMCPMarketplace, MCPMarketplaceService, InstantiationType.Delayed);

// --- Browser Automation Singleton (Phase 18) -----------------------------------
registerSingleton(IBrowserAutomationService, BrowserAutomationService, InstantiationType.Delayed);

// --- Memory Architecture Singletons (Phase 19) ---------------------------------
registerSingleton(IWorkingMemoryService, WorkingMemoryService, InstantiationType.Eager);
registerSingleton(IEpisodicMemoryService, EpisodicMemoryService, InstantiationType.Eager);
registerSingleton(IEmbeddingService, EmbeddingService, InstantiationType.Eager);
registerSingleton(ISemanticMemoryService, SemanticMemoryService, InstantiationType.Eager);
registerSingleton(IProceduralMemoryService, ProceduralMemoryService, InstantiationType.Eager);
registerSingleton(IMemoryOrchestrator, MemoryOrchestratorService, InstantiationType.Eager);

// --- Supermemory Integration Singleton (Phase 19+) ----------------------------
registerSingleton(IConstructMemoryService, ConstructMemoryService, InstantiationType.Delayed);

// --- LLM Integration Singletons (Phase 4) --------------------------------------
// NOTE: IAnthropicProvider removed — Anthropic API is now a backend within
// CloudProvider inside IConstructAIService, not a separate top-level service.
registerSingleton(IMCPProcess, MCPProcessService, InstantiationType.Delayed);
registerSingleton(ITerminalExecutor, TerminalExecutorService, InstantiationType.Delayed);
registerSingleton(IDiffApplier, DiffApplierService, InstantiationType.Delayed);
registerSingleton(IAgentLoop, AgentLoopService, InstantiationType.Delayed);

// --- Phase 1: AI Provider Layer -----------------------------------------------
// The unified AI service auto-selects the best provider: Ollama > Xenova > Cloud
registerSingleton(IConstructAIService, ConstructAIService, InstantiationType.Delayed);

// --- Phase 4: Tool/Skill Engine -----------------------------------------------
// Built-in tools (read_file, write_file, run_terminal, search_codebase, web_search)
// + Kali WSL2 integration + command safety blocklist
registerSingleton(IConstructToolRegistry, ConstructToolRegistryService, InstantiationType.Delayed);

// Command: Switch AI Provider
registerAction2(class SwitchAIProviderAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.switchProvider',
                        title: localize2('switchAIProvider', "Switch AI Provider"),
                        f1: true,
                        category: localize2('constructCategoryAI', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const providerTypes: AIProviderType[] = ['ollama', 'xenova', 'cloud'];
                const labels: Record<AIProviderType, string> = {
                        ollama: '$(server) Ollama (Local)',
                        xenova: '$(cpu) Xenova (In-Process)',
                        cloud: '$(globe) Cloud (OpenAI-Compatible)',
                };

                const currentType = aiService.activeProviderType;
                const picks = providerTypes.map(pt => ({
                        label: labels[pt],
                        description: pt === currentType ? '(active)' : '',
                        providerType: pt,
                }));

                const pick = await quickInput.pick(picks, {
                        placeHolder: 'Select AI provider',
                });

                if (pick) {
                        const selected = pick.providerType as AIProviderType;
                        const success = await aiService.switchProvider(selected);
                        if (success) {
                                const model = aiService.getActiveModel();
                                notificationService.info(
                                        `CONSTRUCT: Switched to ${selected} provider${model ? ' (model: ' + model.displayName + ')' : ''}`
                                );
                        }
                }
        }
});

// Command: Select Model
registerAction2(class SelectModelAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.selectModel',
                        title: localize2('selectModel', "Select AI Model"),
                        f1: true,
                        category: localize2('constructCategoryModel', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const models = await aiService.listModels();
                if (models.length === 0) {
                        notificationService.warn('No models available. Please check your AI provider settings.');
                        return;
                }

                const currentModel = aiService.getActiveModel();
                const picks = models.map(m => ({
                        label: m.displayName,
                        description: m.provider + (m.id === currentModel?.id ? ' (active)' : ''),
                        detail: `Context: ${m.contextWindowTokens.toLocaleString()} tokens` + (m.supportsTools ? ' | Tools: Yes' : ''),
                        modelId: m.id,
                }));

                const pick = await quickInput.pick(picks, {
                        placeHolder: 'Select a model',
                });

                if (pick) {
                        const success = await aiService.setActiveModel(pick.modelId);
                        if (success) {
                                notificationService.info(`CONSTRUCT: Model set to ${pick.label}`);
                        } else {
                                notificationService.error('Failed to switch model.');
                        }
                }
        }
});

// --- Phase 1: Core Maturity Singletons ----------------------------------------
registerSingleton(ISecureKeyManager, SecureKeyManagerService, InstantiationType.Delayed);
registerSingleton(IAgentErrorRecovery, AgentErrorRecoveryService, InstantiationType.Delayed);
registerSingleton(IFileWatcherService, FileWatcherService, InstantiationType.Delayed);
registerSingleton(ISnapshotManager, SnapshotManagerService, InstantiationType.Delayed);

// --- Phase 1: Task-Level Undo Command -----------------------------------------
registerAction2(class UndoTaskAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.undoTask',
                                                title: localize2('undoTask', "Undo Last Task"),
                                                f1: true,
                                                category: localize2('constructCategoryUndo', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const agentLoop = accessor.get(IAgentLoop);
                                const notificationService = accessor.get(INotificationService);
                                const logService = accessor.get(ILogService);

                                if (agentLoop.isRunning) {
                                                notificationService.warn('Cannot undo while an agent task is running.');
                                                return;
                                }

                                try {
                                                const result = await agentLoop.undoLastTask();
                                                if (!result) {
                                                                notificationService.info('No task to undo.');
                                                                return;
                                                }
                                                if (result.success) {
                                                                notificationService.info(`Task undone: ${result.restoredCount} files restored, ${result.deletedCount} files removed (${result.durationMs}ms)`);
                                                } else {
                                                                notificationService.error(`Undo failed: ${result.error}`);
                                                }
                                } catch (error) {
                                                logService.error('[Construct] Undo task failed:', error);
                                                notificationService.error(`Undo failed: ${error instanceof Error ? error.message : String(error)}`);
                                }
                }
});

// --- Phase 2: Diff Accept/Reject Commands -------------------------------------

registerAction2(class AcceptAllDiffsAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.acceptAllDiffs',
                        title: localize2('acceptAllDiffs', "Accept All Pending Diffs"),
                        f1: true,
                        category: localize2('constructCategoryDiff', "Construct"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const viewsService = accessor.get(IViewsService);
                const notificationService = accessor.get(INotificationService);
                const view = viewsService.getActiveViewWithId('construct.agentPanel') as any;
                if (view && typeof view.acceptAllPendingDiffs === 'function') {
                        await view.acceptAllPendingDiffs();
                        notificationService.info('All pending diffs accepted.');
                } else {
                        notificationService.warn('No agent panel with pending diffs found.');
                }
        }
});

registerAction2(class RejectAllDiffsAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.rejectAllDiffs',
                        title: localize2('rejectAllDiffs', "Reject All Pending Diffs"),
                        f1: true,
                        category: localize2('constructCategoryDiff2', "Construct"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Escape,
                                weight: KeybindingWeight.WorkbenchContrib,
                        },
                });
        }
        run(accessor: ServicesAccessor): void {
                const viewsService = accessor.get(IViewsService);
                const notificationService = accessor.get(INotificationService);
                const view = viewsService.getActiveViewWithId('construct.agentPanel') as any;
                if (view && typeof view.rejectAllPendingDiffs === 'function') {
                        view.rejectAllPendingDiffs();
                        notificationService.info('All pending diffs rejected.');
                } else {
                        notificationService.warn('No agent panel with pending diffs found.');
                }
        }
});

// --- Onboarding Wizard (First-Launch) ------------------------------------------

registerAction2(class OpenOnboardingWizardAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.openOnboarding',
                        title: localize2('openOnboarding', "Open Setup Wizard"),
                        f1: true,
                        category: localize2('constructCategoryOnboarding', "Construct"),
                });
        }
        run(accessor: ServicesAccessor): void {
                const instantiationService = accessor.get(IInstantiationService);
                const wizard = instantiationService.createInstance(ConstructOnboardingWizard);
                wizard.show();
        }
});
