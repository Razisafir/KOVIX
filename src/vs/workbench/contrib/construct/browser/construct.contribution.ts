/*---------------------------------------------------------------------------------------------
 *  Construct IDE — MVP Contribution
 *  5 engine services + 4 utility services + 2 supporting services = 11 singletons
 *
 *  MVP: Anthropic LLM, MCP filesystem, agent loop, terminal, diff apply.
 *  No GOD mode, no multi-agent, no pricing, no telemetry, no collaboration.
 *  BYOK only. Single coder agent. Zero data collection.
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
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';

// MVP Engine Services (5)
import { IAnthropicProviderService } from '../../../../platform/construct/common/anthropicProvider.js';
import { AnthropicProviderService } from './services/AnthropicProvider.js';
import { IMCPProcessService } from '../../../../platform/construct/common/mcpProcess.js';
import { MCPProcessService } from './services/MCPProcess.js';
import { IAgentLoopService } from '../../../../platform/construct/common/agentLoop.js';
import { AgentLoopService } from './services/AgentLoop.js';
import { ITerminalExecutorService } from '../../../../platform/construct/common/terminalExecutor.js';
import { TerminalExecutorService } from './services/TerminalExecutor.js';
import { IDiffApplierService } from '../../../../platform/construct/common/diffApplier.js';
import { DiffApplierService } from './services/DiffApplier.js';

// Utility Services (4)
import { ITokenEstimationService } from '../../../../platform/construct/common/tokenEstimation.js';
import { TokenEstimationService } from './services/tokenEstimationService.js';
import { IStreamingOutputService } from '../../../../platform/construct/common/streamingOutput.js';
import { StreamingOutputService } from './services/streamingOutputService.js';
import { ICommandSafetyService } from '../../../../platform/construct/common/commandSafety.js';
import { CommandSafetyService } from './services/commandSafetyService.js';
import { IProjectMemoryService } from '../../../../platform/construct/common/projectMemory.js';
import { ProjectMemoryService } from './services/projectMemoryService.js';

// Supporting Services (2)
import { IGitWorkflowService } from '../../../../platform/construct/common/gitWorkflow.js';
import { GitWorkflowService } from './services/gitWorkflowService.js';
import { IRepositoryIntelligenceService } from '../../../../platform/construct/common/repositoryIntelligence.js';
import { RepositoryIntelligenceService } from './services/repositoryIntelligenceService.js';

// ═══════════════════════════════════════════════════════════════
// Singleton Registrations — 11 services (down from 45)
// ═══════════════════════════════════════════════════════════════

// MVP Engine (5)
registerSingleton(IAnthropicProviderService, AnthropicProviderService, InstantiationType.Delayed);
registerSingleton(IMCPProcessService, MCPProcessService, InstantiationType.Delayed);
registerSingleton(IAgentLoopService, AgentLoopService, InstantiationType.Delayed);
registerSingleton(ITerminalExecutorService, TerminalExecutorService, InstantiationType.Delayed);
registerSingleton(IDiffApplierService, DiffApplierService, InstantiationType.Delayed);

// Utilities (4)
registerSingleton(ITokenEstimationService, TokenEstimationService, InstantiationType.Delayed);
registerSingleton(IStreamingOutputService, StreamingOutputService, InstantiationType.Delayed);
registerSingleton(ICommandSafetyService, CommandSafetyService, InstantiationType.Delayed);
registerSingleton(IProjectMemoryService, ProjectMemoryService, InstantiationType.Delayed);

// Supporting (2)
registerSingleton(IGitWorkflowService, GitWorkflowService, InstantiationType.Delayed);
registerSingleton(IRepositoryIntelligenceService, RepositoryIntelligenceService, InstantiationType.Delayed);

// ═══════════════════════════════════════════════════════════════
// Configuration — API Key & Model Settings
// ═══════════════════════════════════════════════════════════════

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'construct',
	order: 100,
	title: localize('constructConfigurationTitle', "Construct IDE"),
	type: 'object',
	properties: {
		'construct.anthropic.model': {
			type: 'string',
			default: 'claude-sonnet-4-20250514',
			enum: [
				'claude-sonnet-4-20250514',
				'claude-3-5-sonnet-20241022',
				'claude-3-5-haiku-20241022',
				'claude-opus-4-20250514',
			],
			description: localize('construct.anthropic.model', "The Anthropic model to use for the Construct agent"),
			scope: ConfigurationScope.APPLICATION,
		},
		'construct.anthropic.maxTokens': {
			type: 'number',
			default: 8192,
			minimum: 1,
			maximum: 128000,
			description: localize('construct.anthropic.maxTokens', "Maximum tokens for Construct agent responses"),
			scope: ConfigurationScope.APPLICATION,
		},
		'construct.terminal.timeout': {
			type: 'number',
			default: 60000,
			minimum: 5000,
			maximum: 600000,
			description: localize('construct.terminal.timeout', "Timeout in milliseconds for terminal commands executed by the agent"),
			scope: ConfigurationScope.APPLICATION,
		},
		'construct.agent.maxIterations': {
			type: 'number',
			default: 10,
			minimum: 1,
			maximum: 50,
			description: localize('construct.agent.maxIterations', "Maximum number of tool-use iterations per agent request"),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});

// ═══════════════════════════════════════════════════════════════
// View Container + Agent Panel
// ═══════════════════════════════════════════════════════════════

const constructViewIcon = registerIcon('construct-view-icon', Codicon.robot, localize('constructViewIcon', 'View icon of the Construct Agent view.'));

const constructViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'construct',
	title: localize2('construct', "Construct Agent"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['construct', { mergeViewWithContainerWhenSingleView: true }]),
	icon: constructViewIcon,
	order: 100,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: 'construct.agentPanel',
	name: localize2('agentPanel', "Agent"),
	containerIcon: constructViewIcon,
	ctorDescriptor: new SyncDescriptor(ConstructAgentViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	order: 1,
}], constructViewContainer);

// ═══════════════════════════════════════════════════════════════
// Status Bar — Idle/Thinking/Done
// ═══════════════════════════════════════════════════════════════

class ConstructStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.constructStatusBar';

	private _agentStatusEntry: IStatusbarEntryAccessor | undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IAgentLoopService private readonly agentLoopService: IAgentLoopService,
	) {
		super();

		this._agentStatusEntry = this._register(this.statusbarService.addEntry({
			name: localize('constructAgentStatus', "Construct Agent Status"),
			text: '$(robot) Construct',
			ariaLabel: localize('constructAgentStatusAria', "Construct Agent: Idle"),
			tooltip: localize('constructAgentStatusTooltip', "Construct Agent: Idle — click to open panel"),
			command: 'construct.focusPanel',
		}, 'construct.agentStatus', StatusbarAlignment.LEFT, 50));

		// Update status bar based on agent state
		this._register(this.agentLoopService.onStateChange(state => {
			switch (state) {
				case 'idle':
					this._updateStatus('$(robot) Construct', 'Construct Agent: Idle');
					break;
				case 'thinking':
					this._updateStatus('$(sync~spin) Thinking...', 'Construct Agent: Processing your request');
					break;
				case 'executing_tool':
					this._updateStatus('$(tools) Executing...', 'Construct Agent: Running tools');
					break;
				case 'cancelled':
					this._updateStatus('$(circle-slash) Cancelled', 'Construct Agent: Last request cancelled');
					break;
				case 'error':
					this._updateStatus('$(error) Error', 'Construct Agent: Last request had an error');
					break;
			}
		}));
	}

	private _updateStatus(text: string, tooltip: string): void {
		this._agentStatusEntry?.update({
			name: localize('constructAgentStatus2', "Construct Agent Status"),
			text,
			ariaLabel: tooltip,
			tooltip,
			command: 'construct.focusPanel',
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ConstructStatusBarContribution, LifecyclePhase.Restored);

// ═══════════════════════════════════════════════════════════════
// Commands
// ═══════════════════════════════════════════════════════════════

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

registerAction2(class TestLLMConnectionAction extends Action2 {
	constructor() {
		super({
			id: 'construct.testLLM',
			title: localize2('testLLM', "Construct: Test LLM Connection"),
			f1: true,
			category: localize2('constructCategory4', "Construct"),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const anthropicProvider = accessor.get(IAnthropicProviderService);
		const status = anthropicProvider.getApiKeyStatus();
		if (!status.configured) {
			const outputChannel = accessor.get(IViewsService);
			outputChannel.openView('construct.agentPanel', true);
			return;
		}
		// Send a test message
		try {
			const response = await anthropicProvider.sendMessage(
				[{ role: 'user', content: 'Say "Hello, I am Claude" and nothing else.' }],
				{ maxTokens: 50 },
			);
			const text = response.content.find(b => b.type === 'text')?.text ?? 'No response';
			// Open panel to show result
			accessor.get(IViewsService).openView('construct.agentPanel', true);
			console.log('[Construct] LLM Test:', text);
		} catch (error) {
			console.error('[Construct] LLM Test Failed:', (error as Error).message);
		}
	}
});
