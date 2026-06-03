/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Main Contribution
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation } from '../../../../workbench/common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { ConstructAgentViewPane } from './constructAgentView.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { IWorkbenchContribution, Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../../workbench/common/contributions.js';
import { LifecyclePhase } from '../../../../workbench/services/lifecycle/common/lifecycle.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

// Phase 1: LLM Provider Service registrations
import { ILLMProviderService, IModelRegistryService, ICredentialStoreService, ILLMStreamingService, IProviderHealthService } from '../../../../platform/construct/common/llmProvider.js';
import { LLMProviderService, ModelRegistryService, CredentialStoreService, LLMStreamingService, ProviderHealthService } from './services/llmProviderService.js';
import { ICostGovernorService } from '../../../../platform/construct/common/costGovernor.js';
import { CostGovernorService } from './services/costGovernorService.js';

// Phase 2: AI Execution Service + Execution Graph registrations
import { IAIExecutionService } from '../../../../platform/construct/common/aiExecutionService.js';
import { AIExecutionService } from './services/aiExecutionService.js';
import { IExecutionGraphService } from '../../../../platform/construct/common/executionGraphService.js';
import { ExecutionGraphService } from './services/executionGraphService.js';

// Phase 3: Streaming Output + Token Estimation registrations
import { IStreamingOutputService } from '../../../../platform/construct/common/streamingOutput.js';
import { StreamingOutputService } from './services/streamingOutputService.js';
import { ITokenEstimationService } from '../../../../platform/construct/common/tokenEstimation.js';
import { TokenEstimationService } from './services/tokenEstimationService.js';

// Phase 4: Autonomous Execution + Approval System
import { IAutonomousExecutionService, IExecutionQueueService } from '../../../../platform/construct/common/autonomousExecution.js';
import { AutonomousExecutionService, ExecutionQueueService } from './services/autonomousExecutionService.js';
import { IAutonomousExecutionLoopService } from '../../../../platform/construct/common/autonomousExecutionLoop.js';
import { AutonomousExecutionLoopService } from './services/autonomousExecutionLoopService.js';

// Phase 5: Code Editing + Transactional Edits
import { ICodeEditingService } from '../../../../platform/construct/common/codeEditing.js';
import { CodeEditingService } from './services/codeEditingService.js';
import { ITransactionalEditService } from '../../../../platform/construct/common/transactionalEdit.js';
import { TransactionalEditService } from './services/transactionalEditService.js';

// Phase 6: Terminal Execution + Command Safety
import { ITerminalExecutionBridgeService } from '../../../../platform/construct/common/terminalExecutionBridge.js';
import { TerminalExecutionBridgeService } from './services/terminalExecutionBridgeService.js';
import { ICommandSafetyService } from '../../../../platform/construct/common/commandSafety.js';
import { CommandSafetyService } from './services/commandSafetyService.js';
import { ITerminalSessionManagerService } from '../../../../platform/construct/common/terminalSessionManager.js';
import { TerminalSessionManagerService } from './services/terminalSessionManagerService.js';

// Phase 7: Observability + Audit Logging
import { IObservabilityService } from '../../../../platform/construct/common/observabilityService.js';
import { ObservabilityService } from './services/observabilityService.js';

// Phase 8: AI Unified State + Execution Sandbox
import { IAIUnifiedStateService } from '../../../../platform/construct/common/aiUnifiedStateService.js';
import { AIUnifiedStateService } from './services/aiUnifiedStateService.js';
import { IExecutionSandboxService } from '../../../../platform/construct/common/executionSandbox.js';
import { ExecutionSandboxService } from './services/executionSandboxService.js';

// Phase 9: Project Memory + Repository Intelligence
import { IProjectMemoryService } from '../../../../platform/construct/common/projectMemory.js';
import { ProjectMemoryService } from './services/projectMemoryService.js';
import { IRepositoryIntelligenceService } from '../../../../platform/construct/common/repositoryIntelligence.js';
import { RepositoryIntelligenceService } from './services/repositoryIntelligenceService.js';
import { ILongHorizonMemoryService } from '../../../../platform/construct/common/longHorizonMemory.js';
import { LongHorizonMemoryService } from './services/longHorizonMemoryService.js';

// Phase 10: Execution Verification + Git Workflow
import { IExecutionVerificationService } from '../../../../platform/construct/common/executionVerification.js';
import { ExecutionVerificationService } from './services/executionVerificationService.js';
import { IGitWorkflowService } from '../../../../platform/construct/common/gitWorkflow.js';
import { GitWorkflowService } from './services/gitWorkflowService.js';

// Phase 11: Execution Lock + Sanity Checks
import { IExecutionLockService } from '../../../../platform/construct/common/executionLock.js';
import { ExecutionLockService } from './services/executionLockService.js';
import { IExecutionSanityService } from '../../../../platform/construct/common/executionSanity.js';
import { ExecutionSanityService } from './services/executionSanityService.js';
import { IContextWindowOptimizationService } from '../../../../platform/construct/common/contextWindowOptimization.js';
import { ContextWindowOptimizationService } from './services/contextWindowOptimizationService.js';

// Phase 12: Crash Recovery + Watchdog
import { ICrashRecoveryService, IWatchdogService, ISessionRecoveryService } from '../../../../platform/construct/common/crashRecovery.js';
import { CrashRecoveryService, WatchdogService, SessionRecoveryService } from './services/crashRecoveryService.js';

// Phase 13: Agent Orchestration + AI Context
import { IAgentOrchestratorService } from '../../../../platform/construct/common/agentOrchestratorService.js';
import { AgentOrchestratorService } from './services/agentOrchestratorService.js';
import { IAIContextService } from '../../../../platform/construct/common/aiContextService.js';
import { AIContextService } from './services/aiContextService.js';

// Phase 14: MCP Server Support
import { IMCPServerService } from '../../../../platform/construct/common/mcpServerService.js';
import { MCPServerService } from './services/mcpServerService.js';

// Phase 15: Plugin Sandbox + Safe Mode
import { IPluginSandboxService, ISafeModeService } from '../../../../platform/construct/common/pluginSandbox.js';
import { PluginSandboxService, SafeModeService } from './services/pluginSandboxService.js';

// Additional services
import { IRepairIntelligenceService } from '../../../../platform/construct/common/repairIntelligence.js';
import { RepairIntelligenceService } from './services/repairIntelligenceService.js';
import { IRealUIIntegrationService } from '../../../../platform/construct/common/realUIIntegration.js';
import { RealUIIntegrationService } from './services/realUIIntegrationService.js';
import { IAutonomousRepairService } from '../../../../platform/construct/common/autonomousRepair.js';
import { AutonomousRepairService } from './services/autonomousRepairService.js';
import { IMultiAgentExecutionService } from '../../../../platform/construct/common/multiAgentExecution.js';
import { MultiAgentExecutionService } from './services/multiAgentExecutionService.js';

// Phase 27 & 28: DELETED — Pricing/Stripe, GOD Mode, Launch Checklist, Telemetry
// These were fake/stub implementations. BYOK model for MVP.

// ─────────────────────────────────────────────────────────────
// Singleton Registrations — 45 services total (43 pre-Phase-28 + 2 Phase 28)
// ─────────────────────────────────────────────────────────────

// Phase 1 (6): LLM Provider + Credential Store + Cost Governor
registerSingleton(ILLMProviderService, LLMProviderService, InstantiationType.Delayed);
registerSingleton(IModelRegistryService, ModelRegistryService, InstantiationType.Delayed);
registerSingleton(ICredentialStoreService, CredentialStoreService, InstantiationType.Delayed);
registerSingleton(ILLMStreamingService, LLMStreamingService, InstantiationType.Delayed);
registerSingleton(IProviderHealthService, ProviderHealthService, InstantiationType.Delayed);
registerSingleton(ICostGovernorService, CostGovernorService, InstantiationType.Delayed);

// Phase 2 (2): AI Execution + Execution Graph
registerSingleton(IAIExecutionService, AIExecutionService, InstantiationType.Delayed);
registerSingleton(IExecutionGraphService, ExecutionGraphService, InstantiationType.Delayed);

// Phase 3 (2): Streaming Output + Token Estimation
registerSingleton(IStreamingOutputService, StreamingOutputService, InstantiationType.Delayed);
registerSingleton(ITokenEstimationService, TokenEstimationService, InstantiationType.Delayed);

// Phase 4 (3): Autonomous Execution + Loop + Queue
registerSingleton(IAutonomousExecutionService, AutonomousExecutionService, InstantiationType.Delayed);
registerSingleton(IExecutionQueueService, ExecutionQueueService, InstantiationType.Delayed);
registerSingleton(IAutonomousExecutionLoopService, AutonomousExecutionLoopService, InstantiationType.Delayed);

// Phase 5 (2): Code Editing + Transactional Edits
registerSingleton(ICodeEditingService, CodeEditingService, InstantiationType.Delayed);
registerSingleton(ITransactionalEditService, TransactionalEditService, InstantiationType.Delayed);

// Phase 6 (3): Terminal Execution + Command Safety + Session Manager
registerSingleton(ITerminalExecutionBridgeService, TerminalExecutionBridgeService, InstantiationType.Delayed);
registerSingleton(ICommandSafetyService, CommandSafetyService, InstantiationType.Delayed);
registerSingleton(ITerminalSessionManagerService, TerminalSessionManagerService, InstantiationType.Delayed);

// Phase 7 (1): Observability
registerSingleton(IObservabilityService, ObservabilityService, InstantiationType.Delayed);

// Phase 8 (2): AI Unified State + Execution Sandbox
registerSingleton(IAIUnifiedStateService, AIUnifiedStateService, InstantiationType.Delayed);
registerSingleton(IExecutionSandboxService, ExecutionSandboxService, InstantiationType.Delayed);

// Phase 9 (3): Project Memory + Repository Intelligence + Long Horizon Memory
registerSingleton(IProjectMemoryService, ProjectMemoryService, InstantiationType.Delayed);
registerSingleton(IRepositoryIntelligenceService, RepositoryIntelligenceService, InstantiationType.Delayed);
registerSingleton(ILongHorizonMemoryService, LongHorizonMemoryService, InstantiationType.Delayed);

// Phase 10 (2): Execution Verification + Git Workflow
registerSingleton(IExecutionVerificationService, ExecutionVerificationService, InstantiationType.Delayed);
registerSingleton(IGitWorkflowService, GitWorkflowService, InstantiationType.Delayed);

// Phase 11 (3): Execution Lock + Sanity + Context Window Optimization
registerSingleton(IExecutionLockService, ExecutionLockService, InstantiationType.Delayed);
registerSingleton(IExecutionSanityService, ExecutionSanityService, InstantiationType.Delayed);
registerSingleton(IContextWindowOptimizationService, ContextWindowOptimizationService, InstantiationType.Delayed);

// Phase 12 (3): Crash Recovery + Watchdog + Session Recovery
registerSingleton(ICrashRecoveryService, CrashRecoveryService, InstantiationType.Delayed);
registerSingleton(IWatchdogService, WatchdogService, InstantiationType.Delayed);
registerSingleton(ISessionRecoveryService, SessionRecoveryService, InstantiationType.Delayed);

// Phase 13 (2): Agent Orchestration + AI Context
registerSingleton(IAgentOrchestratorService, AgentOrchestratorService, InstantiationType.Delayed);
registerSingleton(IAIContextService, AIContextService, InstantiationType.Delayed);

// Phase 14 (1): MCP Server
registerSingleton(IMCPServerService, MCPServerService, InstantiationType.Delayed);

// Phase 15 (2): Plugin Sandbox + Safe Mode
registerSingleton(IPluginSandboxService, PluginSandboxService, InstantiationType.Delayed);
registerSingleton(ISafeModeService, SafeModeService, InstantiationType.Delayed);

// Additional (4): Repair Intelligence + UI Integration + Autonomous Repair + Multi-Agent
registerSingleton(IRepairIntelligenceService, RepairIntelligenceService, InstantiationType.Delayed);
registerSingleton(IRealUIIntegrationService, RealUIIntegrationService, InstantiationType.Delayed);
registerSingleton(IAutonomousRepairService, AutonomousRepairService, InstantiationType.Delayed);
registerSingleton(IMultiAgentExecutionService, MultiAgentExecutionService, InstantiationType.Delayed);

// Phase 27 & 28: DELETED — no credit system, no GOD mode for MVP

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Construct Agent view.'));

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
}], constructViewContainer);

// Status Bar Integration
class ConstructStatusBarContribution extends Disposable implements IWorkbenchContribution {
        static readonly ID = 'workbench.contrib.constructStatusBar';

        private _agentStatusEntry: IStatusbarEntryAccessor | undefined;
        private _modelEntry: IStatusbarEntryAccessor | undefined;
        private _changesEntry: IStatusbarEntryAccessor | undefined;

        constructor(
                @IStatusbarService private readonly statusbarService: IStatusbarService,
        ) {
                super();

                this._agentStatusEntry = this._register(this.statusbarService.addEntry({
                        name: localize('constructAgentStatus', "Construct Agent Status"),
                        text: '$(robot) Ready',
                        ariaLabel: localize('constructAgentStatusAria', "Construct Agent: Ready"),
                        tooltip: localize('constructAgentStatusTooltip', "Construct Agent: Idle — click to open panel"),
                        command: 'construct.focusPanel',
                }, 'construct.agentStatus', StatusbarAlignment.LEFT, 50));

                this._modelEntry = this._register(this.statusbarService.addEntry({
                        name: localize('constructModel', "Construct Model"),
                        text: '$(sparkle) Claude Sonnet',
                        ariaLabel: localize('constructModelAria', "Active LLM: Claude 3.5 Sonnet"),
                        tooltip: localize('constructModelTooltip', "Active LLM: Claude 3.5 Sonnet"),
                }, 'construct.model', StatusbarAlignment.LEFT, 51));

                this._changesEntry = this._register(this.statusbarService.addEntry({
                        name: localize('constructChanges', "Construct Changes"),
                        text: '$(diff-added) 0 pending',
                        ariaLabel: localize('constructChangesAria', "No changes awaiting approval"),
                        tooltip: localize('constructChangesTooltip', "No changes awaiting approval"),
                }, 'construct.changes', StatusbarAlignment.RIGHT, 50));
                // Status bar entries are stored for future updates
                void this._agentStatusEntry; void this._modelEntry; void this._changesEntry;
        }
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructStatusBarContribution, LifecyclePhase.Restored);

// Register Construct commands
registerAction2(class FocusConstructPanelAction extends Action2 {
        constructor() {
                super({
                        id: 'construct.focusPanel',
                        title: localize2('focusConstructPanel', "Show Construct Agent"),
                        keybinding: {
                                primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
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
