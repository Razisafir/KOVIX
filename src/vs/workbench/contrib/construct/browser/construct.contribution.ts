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

// Phase 1: Register LLM Provider singletons
registerSingleton(ILLMProviderService, LLMProviderService, InstantiationType.Delayed);
registerSingleton(IModelRegistryService, ModelRegistryService, InstantiationType.Delayed);
registerSingleton(ICredentialStoreService, CredentialStoreService, InstantiationType.Delayed);
registerSingleton(ILLMStreamingService, LLMStreamingService, InstantiationType.Delayed);
registerSingleton(IProviderHealthService, ProviderHealthService, InstantiationType.Delayed);
registerSingleton(ICostGovernorService, CostGovernorService, InstantiationType.Delayed);

// Phase 2: Register AI Execution + Execution Graph singletons
registerSingleton(IAIExecutionService, AIExecutionService, InstantiationType.Delayed);
registerSingleton(IExecutionGraphService, ExecutionGraphService, InstantiationType.Delayed);

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

	private readonly agentStatusEntry: IStatusbarEntryAccessor;
	private readonly modelEntry: IStatusbarEntryAccessor;
	private readonly changesEntry: IStatusbarEntryAccessor;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();

		// Agent status (left side)
		this.agentStatusEntry = this._register(this.statusbarService.addEntry({
			name: localize('constructAgentStatus', "Construct Agent Status"),
			text: '$(robot) Ready',
			ariaLabel: localize('constructAgentStatusAria', "Construct Agent: Ready"),
			tooltip: localize('constructAgentStatusTooltip', "Construct Agent: Idle — click to open panel"),
			command: 'construct.focusPanel',
		}, 'construct.agentStatus', StatusbarAlignment.LEFT, 50));

		// Model info (left side)
		this.modelEntry = this._register(this.statusbarService.addEntry({
			name: localize('constructModel', "Construct Model"),
			text: '$(sparkle) Claude Sonnet',
			ariaLabel: localize('constructModelAria', "Active LLM: Claude 3.5 Sonnet"),
			tooltip: localize('constructModelTooltip', "Active LLM: Claude 3.5 Sonnet"),
		}, 'construct.model', StatusbarAlignment.LEFT, 51));

		// Pending changes (right side)
		this.changesEntry = this._register(this.statusbarService.addEntry({
			name: localize('constructChanges', "Construct Changes"),
			text: '$(diff-added) 0 pending',
			ariaLabel: localize('constructChangesAria', "No changes awaiting approval"),
			tooltip: localize('constructChangesTooltip', "No changes awaiting approval"),
		}, 'construct.changes', StatusbarAlignment.RIGHT, 50));
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
		// The inline agent widget is activated through the editor contribution
		// which is registered separately. This command is a placeholder that
		// opens the agent panel as a fallback.
		accessor.get(IViewsService).openView('construct.agentPanel', true);
	}
});
