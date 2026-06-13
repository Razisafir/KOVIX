/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

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
import { ICommandService } from '../../../../platform/commands/common/commands';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructToolRegistry } from '../../../../platform/construct/common/tools/constructToolRegistry.js';
import { IMCPProcess } from '../../../../platform/construct/common/mcp/mcpProcess.js';
import { ITerminalExecutor } from '../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IDiffApplier } from '../../../../platform/construct/common/editor/diffApplier.js';
import { IAgentLoop } from '../../../../platform/construct/common/agent/agentLoop.js';
import { ConstructAIService } from './services/llm/constructAIService.js';
import { ConstructToolRegistryService } from './services/tools/constructToolRegistryService.js';
import { MCPProcessService } from './services/mcp/mcpProcess.js';
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
import { IPendingChangesService } from '../../../../platform/construct/common/diff/pendingChanges.js';
import { PendingChangesService } from './services/diff/pendingChangesService.js';
import { IConstructNotificationService } from '../../../../platform/construct/common/notification/constructNotificationService.js';
import { ConstructNotificationBrowserService } from './services/notification/constructNotificationService.js';
import { IConstructProjectService } from '../../../../platform/construct/common/project/constructProjectService.js';
import { ConstructProjectService } from './services/project/constructProjectServiceImpl.js';
import { IIdeaRefinementService } from '../../../../platform/construct/common/agent/ideaRefinementService.js';
import { IdeaRefinementService } from './services/agent/ideaRefinementServiceImpl.js';
import { IUniversalMemoryService } from '../../../../platform/construct/common/memory/universalMemoryService.js';
import { UniversalMemoryService } from './services/memory/universalMemoryService.js';
import { IConstructSessionService } from '../../../../platform/construct/common/session/constructSessionService.js';
import { ConstructSessionServiceImpl } from './services/session/constructSessionServiceImpl.js';
import { ConstructProjectWizard } from './constructProjectWizard.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ConstructOnboardingWizard } from './constructOnboarding.js';
import { IObsidianMemoryService } from '../../../../platform/construct/common/memory/obsidianMemoryService.js';
import { IConstructTelemetryService } from '../../../../platform/construct/common/telemetry/constructTelemetryService.js';
import { ObsidianMemoryServiceImpl } from './services/memory/obsidianMemoryServiceImpl.js';
import { ConstructTelemetryService } from './services/telemetry/constructTelemetryService.js';
import { IKovixLicenseService } from '../../../../platform/construct/common/license/kovixLicenseService.js';
import { KovixLicenseServiceImpl } from './services/license/kovixLicenseServiceImpl.js';
import { IDistributionDetector } from '../../../../platform/construct/common/terminal/distributionDetector.js';
import { IKaliToolBridge } from '../../../../platform/construct/common/terminal/kaliToolBridge.js';
import { DistributionDetectorService } from './services/kali/distributionDetectorService.js';
import { KaliToolBridgeService } from './services/kali/kaliToolBridgeService.js';
import { ObsidianMemoryTreePanel } from './constructMemoryExplorer.js';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from '../../../../platform/construct/common/memory/obsidianMemoryTypes.js';
import './constructMemoryConfig';
import './constructApiConfig';
import './constructApiSettings';

// P3: Feature completion imports
import { ITestGenerationTool } from '../../../../platform/construct/common/tools/testGenerationTool.js';
import { ICodeReviewTool } from '../../../../platform/construct/common/tools/codeReviewTool.js';
import { ICodebaseIndex } from '../../../../platform/construct/common/indexing/codebaseIndex.js';
// IBrowserAutomationTool interface is defined in platform/construct/common/browser/browserAutomationTool.ts
// but not registered as a singleton here since IBrowserAutomationService already covers Phase 18.
// The tool registry dispatches browser_open/screenshot/click/read directly.
import { ISkillService } from '../../../../platform/construct/common/skills/skillService.js';
import { IHookService } from '../../../../platform/construct/common/hooks/hookService.js';
import { TestGenerationToolService } from './services/tools/testGenerationToolService.js';
import { CodeReviewToolService } from './services/tools/codeReviewToolService.js';
import { CodebaseIndexService } from './services/indexing/codebaseIndexService.js';
import { SkillServiceImpl } from './services/skills/skillServiceImpl.js';
import { HookServiceImpl } from './services/hooks/hookServiceImpl.js';

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Kovix Agent view.'));
const constructMemoryIcon = registerIcon('construct-memory-icon', Codicon.symbolEvent, localize('constructMemoryIcon', 'View icon of the Kovix Memory view.'));
const constructObsidianIcon = registerIcon('construct-obsidian-icon', Codicon.bookmark, localize('constructObsidianIcon', 'View icon of the Kovix Obsidian Memory Explorer view.'));

// Register the Kovix view container in the sidebar
const constructViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
                id: 'construct',
                title: localize2('construct', "Kovix Agent"),
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
}, {
                id: 'construct.memoryExplorer',
                name: localize2('memoryExplorer', "Memory Explorer"),
                containerIcon: constructObsidianIcon,
                ctorDescriptor: new SyncDescriptor(ObsidianMemoryTreePanel),
                canToggleVisibility: true,
                canMoveView: true,
                order: 3,
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
                                                name: localize('constructAgentStatus', "Kovix Agent Status"),
                                                text: '$(robot) Ready',
                                                ariaLabel: localize('constructAgentStatusAria', "Kovix Agent: Ready"),
                                                tooltip: localize('constructAgentStatusTooltip', "Kovix Agent: Idle -- click to open panel"),
                                                command: 'construct.focusPanel',
                                }, 'construct.agentStatus', StatusbarAlignment.LEFT, 50));

                                // Model info (left side) — dynamically updated from AI service
                                this.modelEntryAccessor = this._register(this.statusbarService.addEntry({
                                                name: localize('constructModel', "Kovix Model"),
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
                                                name: localize('constructChanges', "Kovix Changes"),
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
                                                name: localize('constructModel', "Kovix Model"),
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
                                                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
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

registerAction2(class SetApiKeyAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.setApiKey',
                                                title: localize2('setApiKey', "Set API Key"),
                                                f1: true,
                                                category: localize2('constructCategoryApiKey', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const keyManager = accessor.get(ISecureKeyManager);
                                const notificationService = accessor.get(INotificationService);
                                const quickInputService = accessor.get(IQuickInputService);
                                const key = await quickInputService.input({
                                                prompt: 'Enter your Anthropic API key',
                                                password: true,
                                                placeHolder: 'sk-ant-...',
                                                validateInput: async (value: string) => {
                                                                if (!value) { return 'Key cannot be empty'; }
                                                                if (!value.startsWith('sk-ant-')) { return 'Key must start with sk-ant-'; }
                                                                return undefined as unknown as string;
                                                }
                                });
                                if (key) {
                                                await keyManager.setKey('anthropic', key);
                                                notificationService.info('CONSTRUCT: Anthropic API key saved.');
                                }
                }
});

registerAction2(class ClearApiKeyAction extends Action2 {
                constructor() {
                                super({
                                                id: 'construct.clearApiKey',
                                                title: localize2('clearApiKey', "Clear API Key"),
                                                f1: true,
                                                category: localize2('constructCategoryApiKey2', "Construct"),
                                });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                                const keyManager = accessor.get(ISecureKeyManager);
                                const notificationService = accessor.get(INotificationService);
                                await keyManager.deleteKey('anthropic');
                                notificationService.info('CONSTRUCT: Anthropic API key removed.');
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
registerSingleton(IWorkingMemoryService, WorkingMemoryService, InstantiationType.Delayed);
registerSingleton(IEpisodicMemoryService, EpisodicMemoryService, InstantiationType.Delayed);
registerSingleton(IEmbeddingService, EmbeddingService, InstantiationType.Delayed);
registerSingleton(ISemanticMemoryService, SemanticMemoryService, InstantiationType.Delayed);
registerSingleton(IProceduralMemoryService, ProceduralMemoryService, InstantiationType.Delayed);
registerSingleton(IMemoryOrchestrator, MemoryOrchestratorService, InstantiationType.Delayed);

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
registerSingleton(IPendingChangesService, PendingChangesService, InstantiationType.Delayed);
registerSingleton(IConstructNotificationService, ConstructNotificationBrowserService, InstantiationType.Delayed);

// --- Feature Build: Project, Idea Refinement, Universal Memory, Session -----------
registerSingleton(IConstructProjectService, ConstructProjectService, InstantiationType.Delayed);
registerSingleton(IIdeaRefinementService, IdeaRefinementService, InstantiationType.Delayed);
registerSingleton(IUniversalMemoryService, UniversalMemoryService, InstantiationType.Delayed);
registerSingleton(IConstructSessionService, ConstructSessionServiceImpl, InstantiationType.Delayed);

// --- Obsidian Memory Service Singleton ---------------------------------------------
registerSingleton(IObsidianMemoryService, ObsidianMemoryServiceImpl, InstantiationType.Delayed);

// --- Telemetry Service Singleton ---------------------------------------------------
registerSingleton(IConstructTelemetryService, ConstructTelemetryService, InstantiationType.Delayed);

// --- License Service Singleton ---------------------------------------------------
registerSingleton(IKovixLicenseService, KovixLicenseServiceImpl, InstantiationType.Delayed);

// --- P4: Kali Linux Integration Singletons --------------------------------------
registerSingleton(IDistributionDetector, DistributionDetectorService, InstantiationType.Delayed);
registerSingleton(IKaliToolBridge, KaliToolBridgeService, InstantiationType.Delayed);

// --- P3: Feature Completion Singletons -------------------------------------------
registerSingleton(ITestGenerationTool, TestGenerationToolService, InstantiationType.Delayed);
registerSingleton(ICodeReviewTool, CodeReviewToolService, InstantiationType.Delayed);
registerSingleton(ICodebaseIndex, CodebaseIndexService, InstantiationType.Delayed);
// IBrowserAutomationTool is already covered by IBrowserAutomationService (Phase 18).
// We keep IBrowserAutomationTool registered with a placeholder; the tool registry
// dispatches browser_open/screenshot/click/read directly.
registerSingleton(ISkillService, SkillServiceImpl, InstantiationType.Delayed);
registerSingleton(IHookService, HookServiceImpl, InstantiationType.Delayed);

// --- License Nag Banner -----------------------------------------------------------
class KovixLicenseBannerContribution extends Disposable implements IWorkbenchContribution {
        static readonly ID = 'workbench.contrib.kovixLicenseBanner';

        constructor(
                @IKovixLicenseService licenseService: IKovixLicenseService,
                @INotificationService notificationService: INotificationService,
        ) {
                super();

                if (!licenseService.isValid()) {
                        notificationService.info(
                                localize('kovixLicenseNag', "KOVIX requires a license key. Visit kovix.dev to purchase.")
                        );
                }
        }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KovixLicenseBannerContribution, LifecyclePhase.Restored);

// --- Feature Build: Project Commands -----------------------------------------
registerAction2(class NewProjectAction extends Action2 {
                constructor() {
                        super({
                                id: 'construct.newProject',
                                title: localize2('newConstructProject', "New Kovix Project"),
                                f1: true,
                                category: localize2('constructCategoryProject', "Construct"),
                        });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                        const instantiationService = accessor.get(IInstantiationService);
                        const wizard = instantiationService.createInstance(ConstructProjectWizard);
                        wizard.show();
                }
});

registerAction2(class OpenProjectWizardAction extends Action2 {
                constructor() {
                        super({
                                id: 'construct.openProjectWizard',
                                title: localize2('openProjectWizard', "Open Project Wizard"),
                                f1: true,
                                category: localize2('constructCategoryWizard', "Construct"),
                        });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                        const instantiationService = accessor.get(IInstantiationService);
                        const wizard = instantiationService.createInstance(ConstructProjectWizard);
                        wizard.show();
                }
});

registerAction2(class LoadProjectAction extends Action2 {
                constructor() {
                        super({
                                id: 'construct.loadProject',
                                title: localize2('loadProject', "Load Kovix Project"),
                                f1: true,
                                category: localize2('constructCategoryLoadProject', "Construct"),
                        });
                }
                async run(accessor: ServicesAccessor): Promise<void> {
                        const projectService = accessor.get(IConstructProjectService);
                        const quickInput = accessor.get(IQuickInputService);
                        const notificationService = accessor.get(INotificationService);

                        const projects = await projectService.listAllProjects();
                        if (projects.length === 0) {
                                notificationService.info('No projects found. Create one with "New Kovix Project".');
                                return;
                        }

                        const picks = projects.map((p: { id: string; name: string; template?: string; status: string }) => ({
                                label: p.name,
                                description: p.template,
                                detail: `Status: ${p.status}`,
                                projectId: p.id,
                        }));

                        const pick = await quickInput.pick(picks, { placeHolder: 'Select a project to load' });
                        if (pick) {
                                await projectService.loadProject((pick as any).projectId);
                                notificationService.info(`Project loaded: ${pick.label}`);
                        }
                }
});

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

// --- Phase 1 (Kovix): Project Commands ------------------------------------------

registerAction2(class NewKovixProjectAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.newProject',
                        title: localize2('newKovixProject', "New KOVIX Project"),
                        f1: true,
                        category: localize2('kovixCategory', "KOVIX"),
                });
        }
        run(accessor: ServicesAccessor): void {
                const viewsService = accessor.get(IViewsService);
                viewsService.openView('construct.agentPanel', true);
                // The agent view will detect no active project and show the wizard
                accessor.get(ICommandService).executeCommand('kovix.openProjectWizard');
        }
});

registerAction2(class OpenProjectWizardAction extends Action2 {
        constructor() {
                super({
                        id: 'kovix.openProjectWizard',
                        title: localize2('openProjectWizard', "Open Project Wizard"),
                        f1: true,
                        category: localize2('kovixCategory2', "KOVIX"),
                });
        }
        run(accessor: ServicesAccessor): void {
                const viewsService = accessor.get(IViewsService);
                viewsService.openView('construct.agentPanel', true);
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

// --- Phase 8: Semantic Memory -- Index Workspace Command ---

registerAction2(class IndexWorkspaceAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.indexWorkspace',
                        title: localize2('indexWorkspace', "Index Workspace for Semantic Search"),
                        f1: true,
                        category: localize2('constructCategoryMemory', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const memoryService = accessor.get(IConstructMemoryService);
                const notificationService = accessor.get(INotificationService);
                notificationService.info('CONSTRUCT: Indexing workspace for semantic search...');
                try {
                        await memoryService.addMemory('Workspace indexing initiated', { type: 'index-trigger', source: 'workspace-index' });
                        notificationService.info('CONSTRUCT: Workspace indexing complete.');
                } catch (err) {
                        notificationService.error('CONSTRUCT: Workspace indexing failed: ' + (err instanceof Error ? err.message : String(err)));
                }
        }
});

// --- MCP Server Management Commands (Phase 17) ---------------------------------

registerAction2(class StartMCPServerAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.mcp.startServer',
                        title: localize2('startMCPServer', "Start MCP Server"),
                        f1: true,
                        category: localize2('constructCategoryMCP', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const mcpManager = accessor.get(IMCPServerManager);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        const servers = mcpManager.listInstalledServers();
                        const stoppedServers = servers.filter(s => mcpManager.getServerStatus(s.name) !== 'running');

                        if (stoppedServers.length === 0) {
                                notificationService.info('All MCP servers are already running.');
                                return;
                        }

                        const picks = stoppedServers.map(s => ({
                                label: '$(circle-outline) ' + s.name,
                                description: s.command,
                                detail: mcpManager.getServerStatus(s.name),
                                serverName: s.name,
                        }));

                        const pick = await quickInput.pick(picks, { placeHolder: 'Select an MCP server to start' });

                        if (pick) {
                                await mcpManager.startServer(pick.serverName);
                                notificationService.info('MCP server started: ' + pick.serverName);
                        }
                } catch (error) {
                        logService.error('[Construct] Failed to start MCP server:', error);
                        notificationService.error('Failed to start MCP server: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

registerAction2(class StopMCPServerAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.mcp.stopServer',
                        title: localize2('stopMCPServer', "Stop MCP Server"),
                        f1: true,
                        category: localize2('constructCategoryMCP2', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const mcpManager = accessor.get(IMCPServerManager);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        const servers = mcpManager.listInstalledServers();
                        const runningServers = servers.filter(s => mcpManager.getServerStatus(s.name) === 'running');

                        if (runningServers.length === 0) {
                                notificationService.info('No MCP servers are currently running.');
                                return;
                        }

                        const picks = runningServers.map(s => ({
                                label: '$(circle-filled) ' + s.name,
                                description: s.command,
                                detail: mcpManager.getServerStatus(s.name),
                                serverName: s.name,
                        }));

                        const pick = await quickInput.pick(picks, { placeHolder: 'Select an MCP server to stop' });

                        if (pick) {
                                await mcpManager.stopServer(pick.serverName);
                                notificationService.info('MCP server stopped: ' + pick.serverName);
                        }
                } catch (error) {
                        logService.error('[Construct] Failed to stop MCP server:', error);
                        notificationService.error('Failed to stop MCP server: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- Provider Status Command ---

registerAction2(class ProviderStatusAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.providerStatus',
                        title: localize2('providerStatus', "Show AI Provider Status"),
                        f1: true,
                        category: localize2('constructCategoryProvider', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const aiService = accessor.get(IConstructAIService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                try {
                        const activeType = aiService.activeProviderType;
                        const activeModel = aiService.getActiveModel();
                        const isOffline = aiService.isOffline();
                        const models = await aiService.listModels();

                        const statusLines: string[] = [
                                'Provider: ' + activeType + (isOffline ? ' (offline)' : ' (cloud)'),
                                'Model: ' + (activeModel?.displayName ?? 'None selected'),
                                'Available models: ' + models.length,
                        ];

                        // Check Ollama availability
                        try {
                                const ollamaProvider = aiService.getProvider('ollama');
                                if (ollamaProvider) {
                                        statusLines.push('Ollama: Available');
                                } else {
                                        statusLines.push('Ollama: Not detected');
                                }
                        } catch {
                                statusLines.push('Ollama: Not detected');
                        }

                        // Check cloud availability
                        try {
                                const cloudProvider = aiService.getProvider('cloud');
                                if (cloudProvider) {
                                        statusLines.push('Cloud: Configured');
                                } else {
                                        statusLines.push('Cloud: Not configured');
                                }
                        } catch {
                                statusLines.push('Cloud: Not configured');
                        }

                        notificationService.info('CONSTRUCT Status: ' + statusLines.join(' | '));
                        logService.info('[Construct] Provider status: ' + statusLines.join(', '));
                } catch (error) {
                        logService.error('[Construct] Failed to get provider status:', error);
                        notificationService.error('Failed to get provider status: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- Obsidian Memory Commands --------------------------------------------------

registerAction2(class OpenMemoryExplorerAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.memory.openExplorer',
                        title: localize2('openMemoryExplorer', "Open Memory Explorer"),
                        f1: true,
                        category: localize2('constructCategoryObsidian1', "Construct"),
                });
        }
        run(accessor: ServicesAccessor): void {
                accessor.get(IViewsService).openView('construct.memoryExplorer', true);
        }
});

registerAction2(class AddObsidianMemoryAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.memory.add',
                        title: localize2('addObsidianMemory', "Add Obsidian Memory"),
                        f1: true,
                        category: localize2('constructCategoryObsidian2', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const obsidianMemory = accessor.get(IObsidianMemoryService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const title = await quickInput.input({
                        prompt: 'Memory title',
                        placeHolder: 'e.g., "John - Project Manager"',
                });
                if (!title) { return; }

                const categoryPick = await quickInput.pick(
                        MEMORY_CATEGORIES.map(cat => ({
                                label: MEMORY_CATEGORY_LABELS[cat],
                                description: cat,
                        })),
                        { placeHolder: 'Select category' },
                );
                if (!categoryPick) { return; }

                const content = await quickInput.input({
                        prompt: 'Memory content',
                        placeHolder: 'Enter the memory content...',
                });
                if (!content) { return; }

                try {
                        await obsidianMemory.addMemory(
                                title,
                                content,
                                categoryPick.description as any,
                                [],
                                'user-created',
                        );
                        notificationService.info(`Memory added: "${title}"`);
                } catch (error) {
                        notificationService.error(`Failed to add memory: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class SearchObsidianMemoryAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.memory.search',
                        title: localize2('searchObsidianMemory', "Search Obsidian Memories"),
                        f1: true,
                        category: localize2('constructCategoryObsidian3', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const obsidianMemory = accessor.get(IObsidianMemoryService);
                const quickInput = accessor.get(IQuickInputService);

                const query = await quickInput.input({
                        prompt: 'Search memories',
                        placeHolder: 'Enter search terms...',
                });
                if (!query) { return; }

                const results = obsidianMemory.searchMemories({ text: query, limit: 10 });
                if (results.length === 0) {
                        await quickInput.pick([{ label: 'No memories found', alwaysShow: true }]);
                        return;
                }

                const picks = results.map(r => ({
                        label: r.title,
                        description: MEMORY_CATEGORY_LABELS[r.category],
                        detail: r.content.length > 100 ? r.content.substring(0, 100) + '...' : r.content,
                }));

                await quickInput.pick(picks, { placeHolder: `${results.length} memories found` });
        }
});

registerAction2(class ImportObsidianMemoryAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.memory.import',
                        title: localize2('importObsidianMemory', "Import Memories"),
                        f1: true,
                        category: localize2('constructCategoryObsidian4', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const obsidianMemory = accessor.get(IObsidianMemoryService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const formatPick = await quickInput.pick(
                        [
                                { label: 'JSON', description: 'Import from JSON format' },
                                { label: 'Markdown', description: 'Import from Markdown with YAML frontmatter' },
                        ],
                        { placeHolder: 'Select import format' },
                );
                if (!formatPick) { return; }

                const content = await quickInput.input({
                        prompt: `Paste ${formatPick.label} content to import`,
                        placeHolder: 'Paste your content here...',
                });
                if (!content) { return; }

                try {
                        let count: number;
                        if (formatPick.label === 'JSON') {
                                count = await obsidianMemory.importFromJson(content);
                        } else {
                                count = await obsidianMemory.importFromMarkdown(content);
                        }
                        notificationService.info(`Imported ${count} memories`);
                } catch (error) {
                        notificationService.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class ExportObsidianMemoryAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.memory.export',
                        title: localize2('exportObsidianMemory', "Export Memories"),
                        f1: true,
                        category: localize2('constructCategoryObsidian5', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const obsidianMemory = accessor.get(IObsidianMemoryService);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);

                const formatPick = await quickInput.pick(
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
                                output = await obsidianMemory.exportToJson();
                        } else {
                                output = await obsidianMemory.exportToMarkdown();
                        }

                        await navigator.clipboard.writeText(output);
                        const stats = obsidianMemory.getStats();
                        notificationService.info(`Exported ${stats.totalEntries} memories to clipboard (${formatPick.label})`);
                } catch (error) {
                        notificationService.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
                }
        }
});

registerAction2(class EditObsidianMemoryAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.memory.edit',
                        title: localize2('editObsidianMemory', "Edit Memory"),
                        f1: true,
                        category: localize2('constructCategoryObsidian6', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const obsidianMemory = accessor.get(IObsidianMemoryService);
                const quickInput = accessor.get(IQuickInputService);

                const allMemories = obsidianMemory.getAllMemories();
                if (allMemories.length === 0) {
                        await quickInput.pick([{ label: 'No memories to edit', alwaysShow: true }]);
                        return;
                }

                const picks = allMemories.map(m => ({
                        label: m.title,
                        description: MEMORY_CATEGORY_LABELS[m.category],
                        detail: m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content,
                        memoryId: m.id,
                }));

                const pick = await quickInput.pick(picks, { placeHolder: 'Select a memory to edit' });
                if (pick) {
                        // Open the Memory Explorer and select the entry
                        accessor.get(IViewsService).openView('construct.memoryExplorer', true);
                }
        }
});

// --- P3: Code Review Command --------------------------------------------------

registerAction2(class ReviewCodeAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.reviewCode',
                        title: localize2('reviewCode', "Review Code"),
                        f1: true,
                        category: localize2('constructCategoryReview', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const codeReviewTool = accessor.get(ICodeReviewTool);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                const target = await quickInput.input({
                        prompt: 'File URI or diff to review',
                        placeHolder: 'e.g., file:///path/to/file.ts',
                });
                if (!target) { return; }

                try {
                        const result = await codeReviewTool.reviewCode(target, {
                                severity: 'all',
                                includeSuggestions: true,
                        });

                        if (result.findings.length === 0) {
                                notificationService.info('No issues found in the reviewed code.');
                                return;
                        }

                        // Display findings as a summary
                        const summary = result.findings.map(f => {
                                const loc = f.line ? `:${f.line}` : '';
                                const sev = f.severity.toUpperCase();
                                const sug = f.suggestion ? `\n  Suggestion: ${f.suggestion}` : '';
                                return `[${sev}] ${f.message} (${f.file}${loc})${sug}`;
                        }).join('\n\n');

                        notificationService.info(`Code Review: ${result.findings.length} finding(s)\n\n${summary.substring(0, 1000)}`);
                        logService.info('[Construct] Code review completed:', result.findings.length, 'findings');
                } catch (error) {
                        logService.error('[Construct] Code review failed:', error);
                        notificationService.error('Code review failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- P3: Generate Tests Command ------------------------------------------------

registerAction2(class GenerateTestsAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.generateTests',
                        title: localize2('generateTests', "Generate Tests"),
                        f1: true,
                        category: localize2('constructCategoryTestGen', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const testGenTool = accessor.get(ITestGenerationTool);
                const quickInput = accessor.get(IQuickInputService);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                const fileUri = await quickInput.input({
                        prompt: 'File URI to generate tests for',
                        placeHolder: 'e.g., file:///path/to/file.ts',
                });
                if (!fileUri) { return; }

                try {
                        const result = await testGenTool.generateTests(fileUri);
                        notificationService.info(`Tests generated for ${fileUri} using ${result.framework}. Suggested path: ${result.suggestedFilePath}`);
                        logService.info('[Construct] Tests generated:', result.framework, result.suggestedFilePath);
                } catch (error) {
                        logService.error('[Construct] Test generation failed:', error);
                        notificationService.error('Test generation failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- P3: Index Workspace Command (Codebase Search) ----------------------------

registerAction2(class IndexWorkspaceP3Action extends Action2 {
        constructor() {
                super({
                        id: 'construct.indexCodebase',
                        title: localize2('indexCodebase', "Index Codebase for Semantic Search"),
                        f1: true,
                        category: localize2('constructCategoryIndex', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const codebaseIndex = accessor.get(ICodebaseIndex);
                const notificationService = accessor.get(INotificationService);
                const logService = accessor.get(ILogService);

                notificationService.info('Indexing codebase...');
                try {
                        await codebaseIndex.indexWorkspace();
                        notificationService.info(`Codebase indexing complete. ${codebaseIndex.indexedFileCount} files indexed.`);
                } catch (error) {
                        logService.error('[Construct] Codebase indexing failed:', error);
                        notificationService.error('Codebase indexing failed: ' + (error instanceof Error ? error.message : String(error)));
                }
        }
});

// --- P3: Show Skills Picker Command --------------------------------------------

registerAction2(class ShowSkillsAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.showSkills',
                        title: localize2('showSkills', "Show Agent Skills"),
                        f1: true,
                        category: localize2('constructCategorySkills', "Construct"),
                });
        }
        async run(accessor: ServicesAccessor): Promise<void> {
                const skillService = accessor.get(ISkillService);
                const quickInput = accessor.get(IQuickInputService);

                const skills = skillService.listSkills();
                if (skills.length === 0) {
                        await quickInput.pick([{ label: 'No skills available', alwaysShow: true }]);
                        return;
                }

                const picks = skills.map(s => ({
                        label: `/${s.name}`,
                        description: s.description,
                        detail: `Tools: ${s.allowedTools.join(', ') || 'all'}`,
                        skillName: s.name,
                }));

                const pick = await quickInput.pick(picks, { placeHolder: 'Select a skill to execute' });
                if (pick) {
                        // Execute the skill
                        await skillService.executeSkill((pick as any).skillName, {
                                userInput: `/${(pick as any).skillName}`,
                                skillName: (pick as any).skillName,
                                args: [],
                        });
                }
        }
});

// --- P3: Inline Suggestions Registration ---------------------------------------
// The ConstructInlineSuggestionProvider is registered in the workbench contribution below.

class ConstructInlineSuggestionsContribution extends Disposable implements IWorkbenchContribution {
        static readonly ID = 'workbench.contrib.constructInlineSuggestions';

        constructor(
                @IConstructAIService aiService: IConstructAIService,
                @ILogService logService: ILogService,
                @IInstantiationService instantiationService: IInstantiationService,
        ) {
                super();

                // Register the inline completion provider
                try {
                        const { ConstructInlineSuggestionProvider } = require('./constructInlineSuggestion.js') as typeof import('./constructInlineSuggestion.js');
                        instantiationService.createInstance(ConstructInlineSuggestionProvider);
                        logService.info('[Construct] Inline suggestions provider created');
                } catch (error) {
                        logService.debug('[Construct] Inline suggestions not available:', error);
                }
        }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructInlineSuggestionsContribution, LifecyclePhase.Restored);

