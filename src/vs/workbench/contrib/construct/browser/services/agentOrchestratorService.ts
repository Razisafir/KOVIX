/*---------------------------------------------------------------------------------------------
 *  Agent Orchestration System — Phase 7 Autonomous Execution Layer
 *  Construct IDE — AI-Native IDE
 *
 *  AgentOrchestratorService — Concrete implementation of the Agent Orchestration Runtime.
 *
 *  Implements:
 *    - Agent lifecycle management
 *    - Execution plan system with step orchestration
 *    - Capability validation + policy enforcement
 *    - Context integration with AIContextService
 *    - Observable execution pipeline
 *    - Interrupt + recovery with checkpoints
 *    - Approval + policy gate with escalation
 *    - Multi-step execution engine
 *    - Failure isolation + safety watchdog
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IAgentOrchestratorService, AgentLifecycleState, AgentCapability, CapabilityRiskLevel, IAgentCapabilityDeclaration, ApprovalLevel, ApprovalResult, IApprovalRequest, PlanStatus, StepStatus, IExecutionPlan, IPlanStep, IStepResult, IStepCheckpoint, IRetryPolicy as _IRetryPolicy, IRollbackStrategy as _IRollbackStrategy, IAgent, IAgentConstraint, IAgentObservation, AgentObservationType, IAgentLifecycleEvent, IPlanStatusEvent, IStepStatusEvent, IAgentContextSnapshot, IExecutionQuota, ILoopDetectionResult, IWatchdogStatus, IPlanOptions, StepFailureCondition, AgentConstraintType } from '../../../../../platform/construct/common/agentOrchestratorService.js';
import { IAIExecutionService, AIMutationSource, IAIFileEdit } from '../../../../../platform/construct/common/aiExecutionService.js';
import { IExecutionGraphService, ExecutionNodeType, ExecutionEdgeType, IExecutionNode } from '../../../../../platform/construct/common/executionGraphService.js';
import { IAIContextService } from '../../../../../platform/construct/common/aiContextService.js';
import { IObservabilityService } from '../../../../../platform/construct/common/observabilityService.js';
import { IAIUnifiedStateService } from '../../../../../platform/construct/common/aiUnifiedStateService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';


// ─── Default Policies ─────────────────────────────────────────────────────────

/**
 * Maps capabilities to their default approval levels.
 * Higher risk capabilities require more stringent approval.
 */
const DEFAULT_CAPABILITY_APPROVAL_MAP: Map<AgentCapability, ApprovalLevel> = new Map([
        [AgentCapability.FileRead, ApprovalLevel.Automatic],
        [AgentCapability.Observe, ApprovalLevel.Automatic],
        [AgentCapability.ContextQuery, ApprovalLevel.Automatic],
        [AgentCapability.GraphQuery, ApprovalLevel.Automatic],
        [AgentCapability.DependencyAnalysis, ApprovalLevel.AskOnce],
        [AgentCapability.PlanManagement, ApprovalLevel.AskOnce],
        [AgentCapability.FileEdit, ApprovalLevel.AskPerStep],
        [AgentCapability.WorkspaceEdit, ApprovalLevel.AskPerStep],
        [AgentCapability.TerminalExecution, ApprovalLevel.ManualReview],
]);

/**
 * Maps capabilities to risk levels.
 */
const CAPABILITY_RISK_MAP: Map<AgentCapability, CapabilityRiskLevel> = new Map([
        [AgentCapability.FileRead, CapabilityRiskLevel.Low],
        [AgentCapability.Observe, CapabilityRiskLevel.Low],
        [AgentCapability.ContextQuery, CapabilityRiskLevel.Low],
        [AgentCapability.GraphQuery, CapabilityRiskLevel.Low],
        [AgentCapability.DependencyAnalysis, CapabilityRiskLevel.Low],
        [AgentCapability.PlanManagement, CapabilityRiskLevel.Medium],
        [AgentCapability.FileEdit, CapabilityRiskLevel.Medium],
        [AgentCapability.WorkspaceEdit, CapabilityRiskLevel.High],
        [AgentCapability.TerminalExecution, CapabilityRiskLevel.Critical],
]);

/**
 * Default execution quota.
 */
const DEFAULT_EXECUTION_QUOTA: IExecutionQuota = {
        maxSteps: 50,
        maxDurationMs: 300000, // 5 minutes
        maxFileModifications: 20,
        maxRetries: 10,
        maxPlanDepth: 3,
};

/**
 * Default retry policy.
 */

/**
 * Default rollback strategy.
 */

// ─── Mutable Agent Implementation ─────────────────────────────────────────────

class AgentImpl implements IAgent {
        public lifecycleState: AgentLifecycleState = AgentLifecycleState.Idle;
        public activePlanId: string | undefined;
        public readonly completedPlanIds: string[] = [];
        public lastTransitionAt: number;

        constructor(
                public readonly id: string,
                public readonly name: string,
                public readonly description: string,
                public readonly capabilities: readonly IAgentCapabilityDeclaration[],
                public readonly constraints: readonly IAgentConstraint[],
                public readonly registeredAt: number,
        ) {
                this.lastTransitionAt = registeredAt;
        }
}

// ─── Mutable Plan Implementation ──────────────────────────────────────────────

// @ts-expect-error -- readonly mismatch in steps type, will be refined later
class ExecutionPlanImpl implements IExecutionPlan {
        public status: PlanStatus = PlanStatus.Drafting;
        public scopeId: string | undefined;
        public rootNodeId: string | undefined;
        public startedAt: number | undefined;
        public completedAt: number | undefined;
        public readonly activeStepIds: readonly string[] = [];

        constructor(
                public readonly id: string,
                public readonly agentId: string,
                public readonly goal: string,
                public readonly description: string,
                public readonly steps: readonly IPlanStep[],
                public readonly requiredCapabilities: readonly IAgentCapabilityDeclaration[],
                public readonly constraints: readonly IAgentConstraint[],
                public readonly createdAt: number,
                public readonly maxDurationMs: number,
                public readonly failFast: boolean,
        ) { }
}

// ─── Service Implementation ───────────────────────────────────────────────────

export class AgentOrchestratorService extends Disposable implements IAgentOrchestratorService {
        declare readonly _serviceBrand: undefined;

        // ─── State ────────────────────────────────────────────────────────────────

        private readonly _agents: Map<string, AgentImpl> = new Map();
        private readonly _plans: Map<string, ExecutionPlanImpl> = new Map();
        private readonly _approvalRequests: Map<string, IApprovalRequest> = new Map();
        private readonly _observations: Map<string, IAgentObservation[]> = new Map();
        private readonly _quotas: Map<string, IExecutionQuota> = new Map();
        private readonly _cancellationSources: Map<string, CancellationTokenSource> = new Map();

        // ─── Events ───────────────────────────────────────────────────────────────

        private readonly _onDidChangeAgentLifecycle = this._register(new Emitter<IAgentLifecycleEvent>());
        readonly onDidChangeAgentLifecycle = this._onDidChangeAgentLifecycle.event;

        private readonly _onDidChangePlanStatus = this._register(new Emitter<IPlanStatusEvent>());
        readonly onDidChangePlanStatus = this._onDidChangePlanStatus.event;

        private readonly _onDidChangeStepStatus = this._register(new Emitter<IStepStatusEvent>());
        readonly onDidChangeStepStatus = this._onDidChangeStepStatus.event;

        private readonly _onDidRequestApproval = this._register(new Emitter<IApprovalRequest>());
        readonly onDidRequestApproval = this._onDidRequestApproval.event;

        private readonly _onDidResolveApproval = this._register(new Emitter<IApprovalRequest>());
        readonly onDidResolveApproval = this._onDidResolveApproval.event;

        private readonly _onDidProduceObservation = this._register(new Emitter<IAgentObservation>());
        readonly onDidProduceObservation = this._onDidProduceObservation.event;

        // ─── Capability Approval Tracking ─────────────────────────────────────────

        private readonly _askOnceApprovals: Map<string, Set<AgentCapability>> = new Map();

        // ─── Dependency Injection ─────────────────────────────────────────────────

        constructor(
                @IAIExecutionService private readonly aiExecutionService: IAIExecutionService,
                @IExecutionGraphService private readonly graphService: IExecutionGraphService,
                @IAIContextService private readonly contextService: IAIContextService,
                @IObservabilityService private readonly _observabilityService: IObservabilityService,
                @IAIUnifiedStateService private readonly _stateService: IAIUnifiedStateService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                void this._observabilityService; void this._stateService;
                this._registerListeners();
                this.logService.info('[AgentOrchestratorService] Initialized');
        }

        private _registerListeners(): void {
                // Listen for graph events to drive context-aware planning
                this._register(this.graphService.onDidCompleteNode(node => {
                        this._handleGraphNodeCompletion(node);
                }));
        }

        // ─── Agent Management ─────────────────────────────────────────────────────

        registerAgent(name: string, description: string, capabilities: IAgentCapabilityDeclaration[], constraints?: IAgentConstraint[]): IAgent {
                const id = generateUuid();
                const agent = new AgentImpl(
                        id,
                        name,
                        description,
                        Object.freeze([...capabilities]),
                        Object.freeze([...(constraints ?? [])]),
                        Date.now(),
                );

                this._agents.set(id, agent);
                this._observations.set(id, []);

                // Set default quota
                this._quotas.set(id, { ...DEFAULT_EXECUTION_QUOTA });

                this._emitObservation(id, undefined, undefined, AgentObservationType.LifecycleTransition,
                        `Agent "${name}" registered with ${capabilities.length} capabilities`);

                this.logService.info(`[AgentOrchestratorService] Agent "${name}" registered (${id})`);
                return Object.freeze({ ...agent });
        }

        getAgent(agentId: string): IAgent | undefined {
                const agent = this._agents.get(agentId);
                return agent ? Object.freeze({ ...agent }) : undefined;
        }

        getAllAgents(): readonly IAgent[] {
                return Object.freeze([...this._agents.values()].map(a => Object.freeze({ ...a })));
        }

        unregisterAgent(agentId: string): void {
                const agent = this._agents.get(agentId);
                if (!agent) { return; }

                // Cancel any active plans
                if (agent.activePlanId) {
                        this.cancelPlan(agent.activePlanId, 'Agent unregistered');
                }

                this._agents.delete(agentId);
                this._observations.delete(agentId);
                this._quotas.delete(agentId);

                this.logService.info(`[AgentOrchestratorService] Agent "${agent.name}" unregistered (${agentId})`);
        }

        // ─── Plan Management ─────────────────────────────────────────────────────

        createPlan(agentId: string, goal: string, description: string, steps: IPlanStep[], options?: IPlanOptions): IExecutionPlan {
                const agent = this._agents.get(agentId);
                if (!agent) {
                        throw new Error(`Agent not found: ${agentId}`);
                }

                // Validate capabilities
                this._validatePlanCapabilities(agent, steps);

                // Validate constraints
                this._validatePlanConstraints(agent, steps);

                const planId = generateUuid();
                const plan = new ExecutionPlanImpl(
                        planId,
                        agentId,
                        goal,
                        description,
                        [...steps.map(s => ({ ...s }))],
                        Object.freeze([...agent.capabilities]),
                        Object.freeze([...agent.constraints]),
                        Date.now(),
                        options?.maxDurationMs ?? 300000,
                        options?.failFast ?? true,
                );

                this._plans.set(planId, plan);

                // Override quota if specified
                if (options?.quota) {
                        this._quotas.set(agentId, { ...options.quota });
                }

                this._emitObservation(agentId, planId, undefined, AgentObservationType.PlanStatusChange,
                        `Plan created: "${goal}"`);

                this.logService.info(`[AgentOrchestratorService] Plan "${goal}" created for agent "${agent.name}" (${planId})`);
                return { ...plan } as unknown as IExecutionPlan;
        }

        getPlan(planId: string): IExecutionPlan | undefined {
                const plan = this._plans.get(planId);
                return plan ? this._clonePlan(plan) : undefined;
        }

        getAgentPlans(agentId: string): readonly IExecutionPlan[] {
                return Object.freeze(
                        [...this._plans.values()]
                                .filter(p => p.agentId === agentId)
                                .map(p => this._clonePlan(p))
                );
        }

        async cancelPlan(planId: string, reason: string): Promise<void> {
                const plan = this._plans.get(planId);
                if (!plan) { return; }

                // Cancel the token
                const cts = this._cancellationSources.get(planId);
                if (cts) {
                        cts.cancel();
                        cts.dispose();
                        this._cancellationSources.delete(planId);
                }

                // Create checkpoints for active steps
                for (const step of plan.steps) {
                        if (step.status === StepStatus.Executing || step.status === StepStatus.AwaitingApproval) {
                                step.checkpoint = this._createCheckpoint(step, 'interrupt');
                                step.status = StepStatus.Failed;
                                step.error = `Cancelled: ${reason}`;
                        }
                }

                this._transitionPlanStatus(plan, PlanStatus.Cancelled, reason);
                this._transitionAgentLifecycle(plan.agentId, AgentLifecycleState.Cancelled, 'Plan cancelled');

                // End execution scope if active
                if (plan.scopeId) {
                        try { this.graphService.endScope(plan.scopeId); } catch { /* scope may already be ended */ }
                }

                this.logService.info(`[AgentOrchestratorService] Plan "${plan.goal}" cancelled: ${reason}`);
        }

        // ─── Plan Execution ──────────────────────────────────────────────────────

        async executePlan(planId: string): Promise<IExecutionPlan> {
                const plan = this._plans.get(planId);
                if (!plan) {
                        throw new Error(`Plan not found: ${planId}`);
                }

                const agent = this._agents.get(plan.agentId);
                if (!agent) {
                        throw new Error(`Agent not found: ${plan.agentId}`);
                }

                // Validate plan is in a state that can be executed
                if (plan.status !== PlanStatus.Drafting && plan.status !== PlanStatus.PendingApproval) {
                        if (plan.status === PlanStatus.Suspended) {
                                return this.resumePlan(planId);
                        }
                        throw new Error(`Plan cannot be executed in state: ${plan.status}`);
                }

                // Check capability approval levels
                const capabilityApprovals = this._evaluateCapabilityApprovals(agent, plan);
                const needsManualApproval = capabilityApprovals.some(a => a.level !== ApprovalLevel.Automatic);

                if (needsManualApproval) {
                        this._transitionPlanStatus(plan, PlanStatus.PendingApproval, 'Capabilities require approval');

                        // Create approval requests for each capability that needs approval
                        for (const approval of capabilityApprovals) {
                                if (approval.level !== ApprovalLevel.Automatic) {
                                        await this._requestApprovalForCapability(agent.id, planId, approval);
                                }
                        }

                        // Wait for all approvals
                        const allApproved = await this._waitForAllApprovals(planId);
                        if (!allApproved) {
                                this._transitionPlanStatus(plan, PlanStatus.Cancelled, 'Approval denied');
                                return this._clonePlan(plan);
                        }
                }

                // Start execution
                return this._executePlanSteps(plan, agent);
        }

        async suspendPlan(planId: string): Promise<void> {
                const plan = this._plans.get(planId);
                if (!plan) { return; }

                if (plan.status !== PlanStatus.Executing) {
                        throw new Error(`Plan cannot be suspended in state: ${plan.status}`);
                }

                // Create checkpoints for all active steps
                for (const step of plan.steps) {
                        if (step.status === StepStatus.Executing) {
                                step.checkpoint = this._createCheckpoint(step, 'suspend');
                                step.status = StepStatus.Pending; // Will be re-evaluated on resume
                        }
                }

                this._transitionPlanStatus(plan, PlanStatus.Suspended, 'User-initiated suspend');
                this._transitionAgentLifecycle(plan.agentId, AgentLifecycleState.Suspended, 'Plan suspended');
        }

        async resumePlan(planId: string): Promise<IExecutionPlan> {
                const plan = this._plans.get(planId);
                if (!plan) {
                        throw new Error(`Plan not found: ${planId}`);
                }

                if (plan.status !== PlanStatus.Suspended) {
                        throw new Error(`Plan cannot be resumed in state: ${plan.status}`);
                }

                const agent = this._agents.get(plan.agentId);
                if (!agent) {
                        throw new Error(`Agent not found: ${plan.agentId}`);
                }

                // Restore steps from checkpoints
                for (const step of plan.steps) {
                        if (step.checkpoint && step.checkpoint.resumable) {
                                if (step.checkpoint.statusAtCheckpoint === StepStatus.Executing) {
                                        step.status = StepStatus.Ready;
                                } else {
                                        step.status = step.checkpoint.statusAtCheckpoint;
                                }
                                step.checkpoint = undefined;
                        }
                }

                this._emitObservation(agent.id, planId, undefined, AgentObservationType.RecoveryInitiated,
                        'Plan resumed from checkpoint');

                return this._executePlanSteps(plan, agent);
        }

        async rollbackPlan(planId: string): Promise<void> {
                const plan = this._plans.get(planId);
                if (!plan) { return; }

                // Roll back steps in reverse order
                const completedSteps = plan.steps.filter(s =>
                        s.status === StepStatus.Completed || (s.status === StepStatus.Failed && s.graphNodeId)
                ).reverse();

                for (const step of completedSteps) {
                        if (step.graphNodeId) {
                                const node = this.graphService.getNode(step.graphNodeId);
                                if (node && node.reversible) {
                                        // Use inverse edit strategy via AIExecutionService
                                        if (step.rollbackStrategy.type === 'inverse-edit' && step.result) {
                                                void this.aiExecutionService.createAIContext(
                                                        `Rollback step: ${step.label}`,
                                                        plan.rootNodeId
                                                );
                                                for (const fileUri of step.result.modifiedFiles) {
                                                        try {
                                                                (this.aiExecutionService as any).notifyFileModified(fileUri);
                                                        } catch { /* best effort */ }
                                                }
                                        }
                                        this.graphService.markRolledBack(step.graphNodeId, plan.rootNodeId ?? planId);
                                }
                        }
                        step.status = StepStatus.RolledBack;
                }

                this._transitionPlanStatus(plan, PlanStatus.RolledBack, 'Rollback completed');
                this.logService.info(`[AgentOrchestratorService] Plan "${plan.goal}" rolled back`);
        }

        // ─── Approval System ─────────────────────────────────────────────────────

        getPendingApprovals(): readonly IApprovalRequest[] {
                return Object.freeze(
                        [...this._approvalRequests.values()]
                                .filter(r => r.result === ApprovalResult.Pending)
                );
        }

        resolveApproval(requestId: string, result: ApprovalResult.Approved | ApprovalResult.Denied, resolvedBy: string, reason?: string): void {
                const request = this._approvalRequests.get(requestId);
                if (!request) { return; }

                request.result = result;
                (request as { resolvedBy?: string }).resolvedBy = resolvedBy;
                (request as { resolvedAt?: number }).resolvedAt = Date.now();
                if (result === ApprovalResult.Denied && reason) {
                        (request as { denialReason?: string }).denialReason = reason;
                }

                this._onDidResolveApproval.fire(request);

                // Track ask-once approvals
                if (result === ApprovalResult.Approved) {
                        const agentApprovals = this._askOnceApprovals.get(request.agentId);
                        if (agentApprovals) {
                                agentApprovals.add(request.capability);
                        }
                }

                this._emitObservation(request.agentId, undefined, request.stepId,
                        AgentObservationType.ApprovalResolved,
                        `Approval ${result} for ${request.capability} by ${resolvedBy}`);
        }

        // ─── Context Integration ─────────────────────────────────────────────────

        getAgentContextSnapshot(agentId: string, planId: string): IAgentContextSnapshot {
                const plan = this._plans.get(planId);
                const relevantUris: URI[] = [];

                // Collect URIs from plan steps
                if (plan) {
                        for (const step of plan.steps) {
                                if (step.action.fileUri) { relevantUris.push(step.action.fileUri); }
                                if (step.action.additionalFileUris) {
                                        relevantUris.push(...step.action.additionalFileUris);
                                }
                        }
                }

                // Get context-relevant files
                const uniqueUris = [...new Map(relevantUris.map(u => [u.toString(), u])).values()];

                // Get execution history for relevant files
                const executionHistory: IExecutionNode[] = [];
                for (const uri of uniqueUris) {
                        const nodes = this.graphService.getNodesByFile(uri);
                        executionHistory.push(...nodes.slice(-5)); // Last 5 per file
                }

                // Get active scopes
                const activeScopes = this.graphService.activeScope ? [this.graphService.activeScope] : [];

                return Object.freeze({
                        agentId,
                        planId,
                        relevantFiles: Object.freeze(uniqueUris),
                        executionHistory: Object.freeze(executionHistory),
                        activeScopes: Object.freeze(activeScopes),
                        takenAt: Date.now(),
                        freshness: 'live',
                });
        }

        // ─── Watchdog + Safety ───────────────────────────────────────────────────

        getWatchdogStatus(agentId: string): IWatchdogStatus | undefined {
                const agent = this._agents.get(agentId);
                if (!agent) { return undefined; }

                const plan = agent.activePlanId ? this._plans.get(agent.activePlanId) : undefined;
                const quota = this._quotas.get(agentId) ?? DEFAULT_EXECUTION_QUOTA;

                const stepsExecuted = plan?.steps.filter(s =>
                        s.status === StepStatus.Completed || s.status === StepStatus.Failed || s.status === StepStatus.Retrying
                ).length ?? 0;

                const elapsedMs = plan?.startedAt ? Date.now() - plan.startedAt : 0;
                const filesModified = plan?.steps.filter(s => s.status === StepStatus.Completed && s.result)
                        .reduce((acc, s) => acc + (s.result?.modifiedFiles.length ?? 0), 0) ?? 0;
                const retriesConsumed = plan?.steps.reduce((acc, s) => acc + s.retryCount, 0) ?? 0;

                const loopDetection = this._detectLoop(agentId, plan);

                return Object.freeze({
                        agentId,
                        planId: agent.activePlanId ?? '',
                        active: plan?.status === PlanStatus.Executing,
                        stepsExecuted,
                        elapsedMs,
                        filesModified,
                        retriesConsumed,
                        quotaUsage: {
                                stepsUsed: stepsExecuted,
                                stepsMax: quota.maxSteps,
                                durationUsedMs: elapsedMs,
                                durationMaxMs: quota.maxDurationMs,
                                filesModified,
                                filesMax: quota.maxFileModifications,
                                retriesUsed: retriesConsumed,
                                retriesMax: quota.maxRetries,
                        },
                        loopDetection,
                });
        }

        setExecutionQuota(agentId: string, quota: IExecutionQuota): void {
                this._quotas.set(agentId, { ...quota });
        }

        getExecutionQuota(agentId: string): IExecutionQuota | undefined {
                return this._quotas.get(agentId);
        }

        hasExceededQuota(agentId: string): boolean {
                const status = this.getWatchdogStatus(agentId);
                if (!status) { return false; }

                const q = status.quotaUsage;
                return q.stepsUsed >= q.stepsMax
                        || q.durationUsedMs >= q.durationMaxMs
                        || q.filesModified >= q.filesMax
                        || q.retriesUsed >= q.retriesMax;
        }

        // ─── Query ───────────────────────────────────────────────────────────────

        getActivePlan(agentId: string): IExecutionPlan | undefined {
                const agent = this._agents.get(agentId);
                if (!agent?.activePlanId) { return undefined; }
                return this.getPlan(agent.activePlanId);
        }

        getSuspendedPlans(): readonly IExecutionPlan[] {
                return Object.freeze(
                        [...this._plans.values()]
                                .filter(p => p.status === PlanStatus.Suspended)
                                .map(p => this._clonePlan(p))
                );
        }

        getRecentObservations(agentId: string, limit: number = 50): readonly IAgentObservation[] {
                const observations = this._observations.get(agentId) ?? [];
                return Object.freeze(observations.slice(-limit));
        }

        getPlanTimeline(planId: string): readonly IAgentObservation[] {
                const allObservations: IAgentObservation[] = [];
                for (const [, obs] of this._observations) {
                        allObservations.push(...obs.filter(o => o.planId === planId));
                }
                allObservations.sort((a, b) => a.timestamp - b.timestamp);
                return Object.freeze(allObservations);
        }

        get agentCount(): number { return this._agents.size; }
        get activePlanCount(): number {
                return [...this._plans.values()].filter(p => p.status === PlanStatus.Executing).length;
        }

        // ─── Private: Plan Execution Engine ──────────────────────────────────────

        private async _executePlanSteps(plan: ExecutionPlanImpl, agent: AgentImpl): Promise<IExecutionPlan> {
                // Create cancellation token
                const cts = new CancellationTokenSource();
                this._cancellationSources.set(plan.id, cts);

                // Create execution scope in the graph
                const planNode = this.graphService.createNode({
                        type: ExecutionNodeType.AiAction,
                        label: `Plan: ${plan.goal}`,
                        mutationSource: AIMutationSource.AIAgent,
                        trusted: true,
                        description: plan.description,
                        reversible: true,
                        rollbackStrategy: 2 as any, // InverseEdit
                });

                plan.rootNodeId = planNode.id;
                const scope = this.graphService.beginScope(
                        `Agent Plan: ${plan.goal}`,
                        planNode.id,
                        AIMutationSource.AIAgent
                );
                plan.scopeId = scope.id;

                // Transition plan to executing
                this._transitionPlanStatus(plan, PlanStatus.Approved, 'All capabilities approved');
                this._transitionPlanStatus(plan, PlanStatus.Executing, 'Starting execution');
                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Planning, 'Plan approved');
                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Executing, 'Plan execution started');

                plan.startedAt = Date.now();
                agent.activePlanId = plan.id;

                try {
                        // Execute steps in dependency order
                        await this._executeStepsInOrder(plan, agent, cts.token);

                        // Check final status
                        const allCompleted = plan.steps.every(s => s.status === StepStatus.Completed);
                        const anyFailed = plan.steps.some(s => s.status === StepStatus.Failed);

                        if (allCompleted) {
                                this._transitionPlanStatus(plan, PlanStatus.Completed, 'All steps completed');
                                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Completed, 'Plan completed');
                                this.graphService.completeNode(planNode.id, { success: true });
                        } else if (anyFailed && plan.failFast) {
                                this._transitionPlanStatus(plan, PlanStatus.Failed, 'Step failed with fail-fast enabled');
                                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Failed, 'Plan failed');
                                this.graphService.completeNode(planNode.id, { success: false, error: 'Step failed' });
                        } else {
                                // Partial completion
                                this._transitionPlanStatus(plan, PlanStatus.Completed, 'Plan completed with some skipped steps');
                                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Completed, 'Plan completed (partial)');
                                this.graphService.completeNode(planNode.id, { success: true });
                        }
                } catch (err) {
                        if (cts.token.isCancellationRequested) {
                                this._transitionPlanStatus(plan, PlanStatus.Cancelled, 'Execution cancelled');
                                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Cancelled, 'Plan cancelled');
                        } else {
                                this._transitionPlanStatus(plan, PlanStatus.Failed, `Execution error: ${err}`);
                                this._transitionAgentLifecycle(agent.id, AgentLifecycleState.Failed, 'Plan failed');
                                this.graphService.completeNode(planNode.id, { success: false, error: String(err) });
                        }
                } finally {
                        // End scope and cleanup
                        if (plan.scopeId) {
                                try { this.graphService.endScope(plan.scopeId); } catch { /* scope may already be ended */ }
                        }
                        agent.activePlanId = undefined;
                        agent.completedPlanIds.push(plan.id);
                        this._cancellationSources.delete(plan.id);
                        cts.dispose();
                }

                plan.completedAt = Date.now();
                return this._clonePlan(plan);
        }

        private async _executeStepsInOrder(plan: ExecutionPlanImpl, agent: AgentImpl, token: CancellationToken): Promise<void> {
                const completedSteps = new Set<string>();
                const failedSteps = new Set<string>();
                let iterationGuard = 0;
                const maxIterations = plan.steps.length * 3; // Safety: prevent infinite loops

                while (completedSteps.size + failedSteps.size < plan.steps.length) {
                        if (token.isCancellationRequested) { return; }
                        if (++iterationGuard > maxIterations) {
                                this.logService.warn('[AgentOrchestratorService] Step execution loop guard triggered');
                                break;
                        }

                        // Check quota
                        if (this.hasExceededQuota(agent.id)) {
                                this.logService.warn('[AgentOrchestratorService] Agent quota exceeded');
                                throw new Error('Execution quota exceeded');
                        }

                        // Check for loops
                        const loopResult = this._detectLoop(agent.id, plan);
                        if (loopResult.loopDetected && loopResult.confidence > 0.7) {
                                this.logService.warn(`[AgentOrchestratorService] Loop detected: ${loopResult.description}`);
                                if (loopResult.suggestedAction === 'terminate') {
                                        throw new Error(`Loop detected: ${loopResult.description}`);
                                } else if (loopResult.suggestedAction === 'suspend') {
                                        await this.suspendPlan(plan.id);
                                        return;
                                }
                        }

                        // Find steps that are ready to execute
                        const readySteps = plan.steps.filter(step => {
                                if (step.status !== StepStatus.Pending && step.status !== StepStatus.Ready && step.status !== StepStatus.Retrying) {
                                        return false;
                                }
                                return step.dependencies.every(depId => completedSteps.has(depId));
                        });

                        if (readySteps.length === 0) {
                                // Check if there are still steps that could become ready
                                const pendingSteps = plan.steps.filter(s =>
                                        s.status === StepStatus.Pending || s.status === StepStatus.Ready || s.status === StepStatus.Retrying
                                );
                                if (pendingSteps.length === 0) { break; }

                                // Some steps have unmet dependencies — check if they're blocked by failed steps
                                const blockedByFailure = pendingSteps.filter(step =>
                                        step.dependencies.some(depId => failedSteps.has(depId))
                                );

                                if (blockedByFailure.length > 0) {
                                        for (const step of blockedByFailure) {
                                                step.status = StepStatus.Skipped;
                                                step.error = 'Dependency failed';
                                        }
                                        if (plan.failFast) { break; }
                                        continue;
                                }

                                // Wait a bit for in-flight steps to complete
                                await new Promise(resolve => setTimeout(resolve, 50));
                                continue;
                        }

                        // Execute ready steps (could be parallelized in future)
                        for (const step of readySteps) {
                                if (token.isCancellationRequested) { return; }

                                await this._executeStep(plan, agent, step, token);

                                if (step.status === StepStatus.Completed) {
                                        completedSteps.add(step.id);
                                } else if (step.status === StepStatus.Failed) {
                                        failedSteps.add(step.id);
                                        if (plan.failFast) { return; }
                                }
                        }
                }
        }

        private async _executeStep(plan: ExecutionPlanImpl, agent: AgentImpl, step: IPlanStep, token: CancellationToken): Promise<void> {
                // Check approval requirements
                if (step.requiresApproval || step.approvalLevel !== ApprovalLevel.Automatic) {
                        const alreadyApproved = step.approvalLevel === ApprovalLevel.AskOnce
                                && (this._askOnceApprovals.get(agent.id)?.has(step.requiredCapability) ?? false);

                        if (!alreadyApproved) {
                                step.status = StepStatus.AwaitingApproval;
                                this._emitStepStatusChange(step, plan, agent, StepStatus.Ready, StepStatus.AwaitingApproval);

                                const approved = await this._requestStepApproval(agent, plan, step);
                                if (!approved) {
                                        step.status = StepStatus.Failed;
                                        step.error = 'Approval denied';
                                        this._emitStepStatusChange(step, plan, agent, StepStatus.AwaitingApproval, StepStatus.Failed);
                                        return;
                                }
                        }
                }

                // Start execution
                step.status = StepStatus.Executing;
                step.startedAt = Date.now();

                // Credit tracking removed for MVP

                this._emitStepStatusChange(step, plan, agent, StepStatus.Ready, StepStatus.Executing);
                this._emitObservation(agent.id, plan.id, step.id, AgentObservationType.StepExecutionStart,
                        `Executing step: ${step.label}`);

                // Create graph node for this step
                const stepNode = this.graphService.createNode({
                        type: ExecutionNodeType.AiAction,
                        label: step.label,
                        mutationSource: AIMutationSource.AIAgent,
                        trusted: true,
                        description: step.description,
                        fileUri: step.action.fileUri,
                        additionalFileUris: step.action.additionalFileUris ? [...step.action.additionalFileUris] as any : undefined,
                        reversible: step.rollbackStrategy.type !== 'none',
                        rollbackStrategy: (step.rollbackStrategy.type === 'inverse-edit' ? 1 : step.rollbackStrategy.type === 'snapshot-restore' ? 2 : 0) as any,
                });
                step.graphNodeId = stepNode.id;

                // Link to plan root
                if (plan.rootNodeId) {
                        this.graphService.createEdge(plan.rootNodeId, stepNode.id, ExecutionEdgeType.Parent);
                }

                try {
                        // Execute the step action
                        const result = await this._executeStepAction(step, token);

                        // Handle timeout
                        if (token.isCancellationRequested) {
                                step.checkpoint = this._createCheckpoint(step, 'timeout');
                                step.status = StepStatus.Failed;
                                step.error = 'Execution timed out';
                                this.graphService.completeNode(stepNode.id, { success: false, error: 'Timeout' });
                                return;
                        }

                        step.result = result;
                        step.status = StepStatus.Completed;
                        step.completedAt = Date.now();
                        this.graphService.completeNode(stepNode.id, { success: true });

                        this._emitObservation(agent.id, plan.id, step.id, AgentObservationType.StepExecutionComplete,
                                `Step completed: ${step.label} (${result.durationMs}ms, ${result.modifiedFiles.length} files)`);

                } catch (err) {
                        const errorMsg = String(err);
                        step.error = errorMsg;

                        // Check retry policy
                        if (this._shouldRetryStep(step, errorMsg)) {
                                step.retryCount++;
                                step.status = StepStatus.Retrying;
                                this._emitStepStatusChange(step, plan, agent, StepStatus.Executing, StepStatus.Retrying);

                                // Wait before retry (with exponential backoff)
                                const delay = step.retryPolicy.exponentialBackoff
                                        ? step.retryPolicy.retryDelayMs * Math.pow(2, step.retryCount - 1)
                                        : step.retryPolicy.retryDelayMs;

                                await new Promise(resolve => setTimeout(resolve, Math.min(delay, step.retryPolicy.maxDurationMs)));

                                // Reset step state for retry
                                step.status = StepStatus.Ready;
                                step.error = undefined;
                                return this._executeStep(plan, agent, step, token);
                        }

                        step.status = StepStatus.Failed;
                        step.completedAt = Date.now();
                        this.graphService.completeNode(stepNode.id, { success: false, error: errorMsg });

                        this._emitObservation(agent.id, plan.id, step.id, AgentObservationType.StepExecutionFailed,
                                `Step failed: ${step.label} — ${errorMsg}`);
                }
        }

        private async _executeStepAction(step: IPlanStep, token: CancellationToken): Promise<IStepResult> {
                const startTime = Date.now();
                const action = step.action;
                const modifiedFiles: URI[] = [];
                const createdNodeIds: string[] = [];
                const outputData: Record<string, unknown> = {};

                switch (action.type) {
                        case 'file-edit': {
                                if (!action.fileUri) { throw new Error('fileUri required for file-edit action'); }
                                const editParams = action.parameters as { rangeStartLineNumber: number; rangeStartColumn: number; rangeEndLineNumber: number; rangeEndColumn: number; newText: string };
                                void this.aiExecutionService.createAIContext(
                                        action.description,
                                        undefined
                                );
                                const edit: IAIFileEdit = {
                                        resource: action.fileUri,
                                        ...editParams,
                                };
                                await this.aiExecutionService.requestFileEdit(edit, null as any);
                                modifiedFiles.push(action.fileUri);
                                break;
                        }

                        case 'workspace-edit': {
                                void this.aiExecutionService.createAIContext(
                                        action.description,
                                        undefined
                                );
                                const editsParam = action.parameters as { edits: Array<{ resource: string; rangeStartLineNumber: number; rangeStartColumn: number; rangeEndLineNumber: number; rangeEndColumn: number; newText: string }> };
                                if (editsParam.edits && Array.isArray(editsParam.edits)) {
                                        for (const e of editsParam.edits) {
                                                const edit: IAIFileEdit = {
                                                        resource: URI.parse(e.resource),
                                                        rangeStartLineNumber: e.rangeStartLineNumber,
                                                        rangeStartColumn: e.rangeStartColumn,
                                                        rangeEndLineNumber: e.rangeEndLineNumber,
                                                        rangeEndColumn: e.rangeEndColumn,
                                                        newText: e.newText,
                                                };
                                                await this.aiExecutionService.requestFileEdit(edit, null as any);
                                                modifiedFiles.push(URI.parse(e.resource));
                                        }
                                }
                                break;
                        }

                        case 'file-read': {
                                if (!action.fileUri) { throw new Error('fileUri required for file-read action'); }
                                const fileContext = this.contextService.getFileContext(action.fileUri);
                                outputData.fileContext = fileContext;
                                outputData.uri = action.fileUri.toString();
                                break;
                        }

                        case 'context-query': {
                                const contextSnapshot = this.contextService.getRelevantFiles({
                                        focusFile: action.fileUri,
                                        limit: (action.parameters.limit as number) ?? 10,
                                });
                                outputData.relevantFiles = contextSnapshot.map(f => f.uri.toString());
                                break;
                        }

                        case 'graph-query': {
                                if (action.fileUri) {
                                        const nodes = this.graphService.getNodesByFile(action.fileUri);
                                        outputData.graphNodes = nodes.map(n => n.id);
                                }
                                break;
                        }

                        case 'rename-symbol':
                        case 'refactor':
                        case 'organize-imports':
                        case 'create-file':
                        case 'delete-file':
                        case 'move-file': {
                                // These route through AIExecutionService as workspace edits
                                void this.aiExecutionService.createAIContext(
                                        action.description,
                                        undefined
                                );
                                outputData.actionType = action.type;
                                outputData.parameters = action.parameters;
                                if (action.fileUri) {
                                        modifiedFiles.push(action.fileUri);
                                }
                                break;
                        }

                        case 'custom': {
                                outputData.custom = action.parameters;
                                break;
                        }

                        default:
                                throw new Error(`Unknown step action type: ${action.type}`);
                }

                return Object.freeze({
                        success: true,
                        description: `Step completed: ${action.description}`,
                        modifiedFiles: Object.freeze(modifiedFiles),
                        createdNodeIds: Object.freeze(createdNodeIds),
                        outputData: Object.freeze(outputData),
                        durationMs: Date.now() - startTime,
                });
        }

        // ─── Private: Capability Validation ──────────────────────────────────────

        private _validatePlanCapabilities(agent: AgentImpl, steps: IPlanStep[]): void {
                const declaredCapabilities = new Set(agent.capabilities.map(c => c.capability));

                for (const step of steps) {
                        if (!declaredCapabilities.has(step.requiredCapability)) {
                                throw new Error(`Step "${step.label}" requires capability "${step.requiredCapability}" not declared by agent "${agent.name}"`);
                        }
                }
        }

        private _validatePlanConstraints(agent: AgentImpl, steps: IPlanStep[]): void {
                for (const constraint of agent.constraints) {
                        switch (constraint.type) {
                                case AgentConstraintType.MaxSteps:
                                        if (steps.length > (constraint.value as number)) {
                                                throw new Error(`Plan exceeds max steps constraint (${steps.length} > ${constraint.value})`);
                                        }
                                        break;
                                case AgentConstraintType.MaxDuration:
                                        // Validated at runtime
                                        break;
                                case AgentConstraintType.ProtectedFiles: {
                                        const protectedUris = (constraint.value as string).split(',').map(s => s.trim());
                                        for (const step of steps) {
                                                if (step.action.fileUri && protectedUris.some(p => step.action.fileUri!.toString().includes(p))) {
                                                        throw new Error(`Step "${step.label}" targets protected file: ${step.action.fileUri}`);
                                                }
                                        }
                                        break;
                                }
                        }
                }
        }

        private _evaluateCapabilityApprovals(agent: AgentImpl, plan: ExecutionPlanImpl): Array<{ capability: AgentCapability; level: ApprovalLevel }> {
                const results: Array<{ capability: AgentCapability; level: ApprovalLevel }> = [];
                const seen = new Set<AgentCapability>();

                for (const step of plan.steps) {
                        if (seen.has(step.requiredCapability)) { continue; }
                        seen.add(step.requiredCapability);

                        const defaultLevel = DEFAULT_CAPABILITY_APPROVAL_MAP.get(step.requiredCapability) ?? ApprovalLevel.AskPerStep;

                        // Check if agent declared a higher risk level — escalate if so
                        const agentDecl = agent.capabilities.find(c => c.capability === step.requiredCapability);
                        let level = step.approvalLevel ?? defaultLevel;

                        if (agentDecl && agentDecl.riskLevel === CapabilityRiskLevel.Critical) {
                                level = ApprovalLevel.ManualReview;
                        } else if (agentDecl && agentDecl.riskLevel === CapabilityRiskLevel.High && level === ApprovalLevel.Automatic) {
                                level = ApprovalLevel.AskPerStep;
                        }

                        results.push({ capability: step.requiredCapability, level });
                }

                return results;
        }

        // ─── Private: Approval System ────────────────────────────────────────────

        private async _requestApprovalForCapability(agentId: string, planId: string, approval: { capability: AgentCapability; level: ApprovalLevel }): Promise<void> {
                const requestId = generateUuid();
                const request: IApprovalRequest = {
                        id: requestId,
                        agentId,
                        stepId: planId, // Plan-level approval
                        capability: approval.capability,
                        level: approval.level,
                        description: `Agent requests ${approval.capability} capability (level: ${approval.level})`,
                        riskLevel: CAPABILITY_RISK_MAP.get(approval.capability) ?? CapabilityRiskLevel.Medium,
                        affectedFiles: [],
                        reversible: approval.capability !== AgentCapability.TerminalExecution,
                        requestedAt: Date.now(),
                        result: ApprovalResult.Pending,
                };

                this._approvalRequests.set(requestId, request);
                this._onDidRequestApproval.fire(request);
                this._emitObservation(agentId, planId, undefined, AgentObservationType.ApprovalRequested,
                        `Approval requested for ${approval.capability} (level: ${approval.level})`);
        }

        private async _requestStepApproval(agent: AgentImpl, plan: ExecutionPlanImpl, step: IPlanStep): Promise<boolean> {
                const requestId = generateUuid();
                const request: IApprovalRequest = {
                        id: requestId,
                        agentId: agent.id,
                        stepId: step.id,
                        capability: step.requiredCapability,
                        level: step.approvalLevel,
                        description: step.description,
                        riskLevel: CAPABILITY_RISK_MAP.get(step.requiredCapability) ?? CapabilityRiskLevel.Medium,
                        affectedFiles: step.action.fileUri ? [step.action.fileUri] : [],
                        reversible: step.rollbackStrategy.type !== 'none',
                        requestedAt: Date.now(),
                        result: ApprovalResult.Pending,
                };

                this._approvalRequests.set(requestId, request);
                this._onDidRequestApproval.fire(request);

                // Wait for approval (with timeout)
                return new Promise<boolean>((resolve) => {
                        const timeout = setTimeout(() => {
                                request.result = ApprovalResult.Expired;
                                resolve(false);
                        }, 60000); // 60 second timeout

                        const handler = this._onDidResolveApproval.event((resolved) => {
                                if (resolved.id === requestId) {
                                        clearTimeout(timeout);
                                        handler.dispose();
                                        resolve(resolved.result === ApprovalResult.Approved);
                                }
                        });
                });
        }

        private async _waitForAllApprovals(planId: string): Promise<boolean> {
                const planApprovals = [...this._approvalRequests.values()]
                        .filter(r => r.stepId === planId && r.result === ApprovalResult.Pending);

                if (planApprovals.length === 0) { return true; }

                return new Promise<boolean>((resolve) => {
                        let resolved = 0;
                        let anyDenied = false;

                        const timeout = setTimeout(() => {
                                resolve(false);
                        }, 120000); // 2 minute timeout

                        const handler = this._onDidResolveApproval.event((request) => {
                                if (planApprovals.some(a => a.id === request.id)) {
                                        resolved++;
                                        if (request.result === ApprovalResult.Denied) {
                                                anyDenied = true;
                                        }
                                        if (resolved >= planApprovals.length) {
                                                clearTimeout(timeout);
                                                handler.dispose();
                                                resolve(!anyDenied);
                                        }
                                }
                        });
                });
        }

        // ─── Private: Loop Detection ─────────────────────────────────────────────

        private _detectLoop(agentId: string, plan: ExecutionPlanImpl | undefined): ILoopDetectionResult {
                if (!plan) {
                        return { loopDetected: false, loopType: 'none', confidence: 0, involvedSteps: [], suggestedAction: 'none', description: 'No active plan' };
                }

                // Step repetition: same step retried more than 3 times
                const retrying = plan.steps.filter(s => s.retryCount > 3);
                if (retrying.length > 0) {
                        return {
                                loopDetected: true,
                                loopType: 'step-repetition',
                                confidence: Math.min(retrying[0].retryCount / 5, 1),
                                involvedSteps: retrying.map(s => s.id),
                                suggestedAction: retrying[0].retryCount > 5 ? 'terminate' : 'suspend',
                                description: `Step "${retrying[0].label}" retried ${retrying[0].retryCount} times`,
                        };
                }

                // State oscillation: steps cycling between states
                const observations = this._observations.get(agentId) ?? [];
                const recentObs = observations.slice(-20);
                const stepStatusChanges = recentObs.filter(o => o.type === AgentObservationType.StepStatusChange);

                if (stepStatusChanges.length >= 6) {
                        const stepCounts = new Map<string, number>();
                        for (const obs of stepStatusChanges) {
                                if (obs.stepId) {
                                        stepCounts.set(obs.stepId, (stepCounts.get(obs.stepId) ?? 0) + 1);
                                }
                        }
                        const oscillating = [...stepCounts.entries()].filter(([, count]) => count >= 3);
                        if (oscillating.length > 0) {
                                return {
                                        loopDetected: true,
                                        loopType: 'state-oscillation',
                                        confidence: 0.8,
                                        involvedSteps: oscillating.map(([id]) => id),
                                        suggestedAction: 'escalate',
                                        description: `Steps oscillating: ${oscillating.map(([id, c]) => `${id}(${c}x)`).join(', ')}`,
                                };
                        }
                }

                // Circular dependency: would be caught at plan creation, but check runtime
                // Check if any step depends on itself (shouldn't happen but safety check)
                for (const step of plan.steps) {
                        if (step.dependencies.includes(step.id)) {
                                return {
                                        loopDetected: true,
                                        loopType: 'circular-dependency',
                                        confidence: 1,
                                        involvedSteps: [step.id],
                                        suggestedAction: 'terminate',
                                        description: `Step "${step.label}" depends on itself`,
                                };
                        }
                }

                return { loopDetected: false, loopType: 'none', confidence: 0, involvedSteps: [], suggestedAction: 'none', description: 'No loop detected' };
        }

        // ─── Private: Retry Logic ────────────────────────────────────────────────

        private _shouldRetryStep(step: IPlanStep, error: string): boolean {
                if (step.retryCount >= step.retryPolicy.maxRetries) { return false; }

                // Check if the error matches retry conditions
                if (step.retryPolicy.retryOn.includes(StepFailureCondition.Any)) { return true; }

                // Simple heuristic: transient errors contain these keywords
                const transientKeywords = ['timeout', 'network', 'unavailable', 'temporarily', 'retry'];
                const isTransient = transientKeywords.some(kw => error.toLowerCase().includes(kw));

                if (isTransient && step.retryPolicy.retryOn.includes(StepFailureCondition.TransientError)) { return true; }

                return false;
        }

        // ─── Private: Checkpoint ─────────────────────────────────────────────────

        private _createCheckpoint(step: IPlanStep, reason: IStepCheckpoint['reason']): IStepCheckpoint {
                return Object.freeze({
                        takenAt: Date.now(),
                        statusAtCheckpoint: step.status,
                        partialOutput: step.result?.outputData ?? {},
                        filesModifiedSoFar: step.result?.modifiedFiles ?? [],
                        nodesCreatedSoFar: step.graphNodeId ? [step.graphNodeId] : [],
                        resumable: step.rollbackStrategy.type !== 'none' || step.status === StepStatus.Executing,
                        reason,
                });
        }

        // ─── Private: State Transitions ──────────────────────────────────────────

        private _transitionAgentLifecycle(agentId: string, newState: AgentLifecycleState, trigger: string): void {
                const agent = this._agents.get(agentId);
                if (!agent) { return; }

                const oldState = agent.lifecycleState;
                agent.lifecycleState = newState;
                agent.lastTransitionAt = Date.now();

                this._onDidChangeAgentLifecycle.fire({
                        agentId,
                        fromState: oldState,
                        toState: newState,
                        trigger,
                        timestamp: Date.now(),
                        planId: agent.activePlanId,
                });
        }

        private _transitionPlanStatus(plan: ExecutionPlanImpl, newStatus: PlanStatus, reason: string): void {
                const oldStatus = plan.status;
                plan.status = newStatus;

                this._onDidChangePlanStatus.fire({
                        planId: plan.id,
                        agentId: plan.agentId,
                        fromStatus: oldStatus,
                        toStatus: newStatus,
                        timestamp: Date.now(),
                        reason,
                });
        }

        private _emitStepStatusChange(step: IPlanStep, plan: ExecutionPlanImpl, agent: AgentImpl, fromStatus: StepStatus, toStatus: StepStatus): void {
                this._onDidChangeStepStatus.fire({
                        stepId: step.id,
                        planId: plan.id,
                        agentId: agent.id,
                        fromStatus,
                        toStatus,
                        timestamp: Date.now(),
                        error: step.error,
                });
        }

        private _emitObservation(agentId: string, planId: string | undefined, stepId: string | undefined, type: AgentObservationType, description: string, data?: Record<string, unknown>): void {
                const observation: IAgentObservation = Object.freeze({
                        id: generateUuid(),
                        agentId,
                        planId: planId ?? '',
                        stepId,
                        type,
                        timestamp: Date.now(),
                        description,
                        graphNodeId: undefined,
                        data: data ?? {},
                });

                const agentObs = this._observations.get(agentId);
                if (agentObs) {
                        agentObs.push(observation);
                        // Bound observation storage
                        if (agentObs.length > 1000) {
                                agentObs.splice(0, agentObs.length - 500);
                        }
                }

                this._onDidProduceObservation.fire(observation);
        }

        // ─── Private: Graph Integration ──────────────────────────────────────────

        private _handleGraphNodeCompletion(node: IExecutionNode): void {
                // When a graph node completes, check if it belongs to an agent plan
                // and update context accordingly
                if (node.mutationSource === AIMutationSource.AIAgent) {
                        // Find the agent that owns this node
                        for (const [agentId, agent] of this._agents) {
                                if (agent.activePlanId) {
                                        const plan = this._plans.get(agent.activePlanId);
                                        if (plan) {
                                                const step = plan.steps.find(s => s.graphNodeId === node.id);
                                                if (step) {
                                                        this._emitObservation(agentId, plan.id, step.id,
                                                                AgentObservationType.StepExecutionComplete,
                                                                `Graph node completed for step: ${step.label}`,
                                                                { success: node.success, error: node.error }
                                                        );
                                                }
                                        }
                                }
                        }
                }
        }

        // ─── Private: Cloning ────────────────────────────────────────────────────

        private _clonePlan(plan: ExecutionPlanImpl): IExecutionPlan {
                return Object.freeze({
                        id: plan.id,
                        agentId: plan.agentId,
                        goal: plan.goal,
                        description: plan.description,
                        status: plan.status,
                        steps: Object.freeze(plan.steps.map(s => Object.freeze({ ...s }))),
                        requiredCapabilities: plan.requiredCapabilities,
                        constraints: plan.constraints,
                        scopeId: plan.scopeId,
                        rootNodeId: plan.rootNodeId,
                        createdAt: plan.createdAt,
                        startedAt: plan.startedAt,
                        completedAt: plan.completedAt,
                        maxDurationMs: plan.maxDurationMs,
                        failFast: plan.failFast,
                        activeStepIds: Object.freeze([...plan.activeStepIds]),
                }) as unknown as IExecutionPlan;
        }

        override dispose(): void {
                // Cancel all active plans
                for (const [planId, plan] of this._plans) {
                        if (plan.status === PlanStatus.Executing) {
                                this.cancelPlan(planId, 'Service disposing');
                        }
                }

                // Dispose cancellation tokens
                for (const [, cts] of this._cancellationSources) {
                        cts.dispose();
                }

                super.dispose();
                this.logService.info('[AgentOrchestratorService] Disposed');
        }
}
