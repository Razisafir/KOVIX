/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Telemetry Hooks
 *  Lightweight event-based integration that connects existing service events
 *  to the telemetry pipeline WITHOUT modifying existing service interfaces.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITelemetryService } from '../../../../platform/construct/common/telemetry/telemetryService.js';
import { IEnhancedAgentOrchestrator } from '../../../../platform/construct/common/orchestration/agentOrchestrator.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMemoryOrchestrator } from '../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { ILogService } from '../../../../platform/log/common/log.js';

/**
 * Registers telemetry hooks by subscribing to existing events from
 * various services. These are fire-and-forget telemetry calls that
 * do not affect the behavior of the original services.
 *
 * This approach avoids modifying existing service interfaces or
 * constructors — we simply listen to their existing events.
 */
export class TelemetryHooks extends Disposable {

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnhancedAgentOrchestrator private readonly agentOrchestrator: IEnhancedAgentOrchestrator,
		@IMCPServerManager private readonly mcpServerManager: IMCPServerManager,
		@IMemoryOrchestrator private readonly memoryOrchestrator: IMemoryOrchestrator,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._registerAgentHooks();
		this._registerMCPHooks();
		this._registerMemoryHooks();

		this.logService.info('[TelemetryHooks] All telemetry hooks registered');
	}

	// ─── Agent Pool Hooks (Phase 20) ────────────────────────────────────

	private _registerAgentHooks(): void {
		// Record feature usage when multi-agent plans execute
		this._register(this.agentOrchestrator.onExecutionComplete(({ planId, success }) => {
			this.telemetryService.recordFeatureUsage('multi_agent');
			this.telemetryService.recordEvent(6, { // TelemetryEventType.FeatureUsage
				featureName: 'multi_agent_execution',
				success,
				planIdHash: this.hashString(planId)
			});
		}));

		// Record when milestones are reached
		this._register(this.agentOrchestrator.onMilestoneReached(({ planId, milestone }) => {
			this.telemetryService.recordFeatureUsage('milestone_reached');
			this.telemetryService.recordEvent(6, {
				featureName: 'milestone',
				milestoneId: milestone.id ? this.hashString(milestone.id) : undefined
			});
		}));
	}

	// ─── MCP Server Manager Hooks (Phase 17) ────────────────────────────

	private _registerMCPHooks(): void {
		// Record tool call telemetry when MCP tools are executed
		this._register(this.mcpServerManager.onDidChangeConnection((event) => {
			this.telemetryService.recordEvent(2, { // TelemetryEventType.ToolCall
				toolUsage: {
					toolName: `mcp_${event.type}`,
					success: event.type === 'connected',
					durationMs: 0
				}
			});
		}));

		// Record tool discovery events
		this._register(this.mcpServerManager.onDidDiscoverTools((tools) => {
			this.telemetryService.recordFeatureUsage('mcp_tool_discovery');
			this.telemetryService.recordEvent(6, {
				featureName: 'mcp_tools_discovered',
				toolCount: tools.length
			});
		}));
	}

	// ─── Memory Orchestrator Hooks (Phase 19) ───────────────────────────

	private _registerMemoryHooks(): void {
		// Record memory query feature usage when consolidation happens
		this._register(this.memoryOrchestrator.onDidConsolidate(({ projectId }) => {
			this.telemetryService.recordFeatureUsage('memory_consolidation');
			this.telemetryService.recordEvent(6, {
				featureName: 'memory_query',
				projectIdHash: this.hashString(projectId)
			});
		}));

		// Record when memory is forgotten (cleanup)
		this._register(this.memoryOrchestrator.onDidForget(({ projectId }) => {
			this.telemetryService.recordFeatureUsage('memory_forget');
		}));
	}

	// ─── Helpers ────────────────────────────────────────────────────────

	private hashString(input: string): string {
		let hash = 0;
		for (let i = 0; i < input.length; i++) {
			const char = input.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return Math.abs(hash).toString(36);
	}
}
