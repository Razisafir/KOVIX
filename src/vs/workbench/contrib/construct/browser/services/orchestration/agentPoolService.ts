/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { IBrowserAutomationService } from '../../../../../../platform/construct/common/mcp/browserAutomation.js';
import {
        IAgentInstance,
        AgentType,
        AgentStatus,
        IAgentPoolStats,
        IAgentExecutionPlan,
        ExecutionMode,
        IMilestone
} from '../../../../../../platform/construct/common/orchestration/agentTypes.js';
import { IEnhancedAgentOrchestrator } from '../../../../../../platform/construct/common/orchestration/agentOrchestrator.js';
import { IParallelDispatcher } from '../../../../../../platform/construct/common/orchestration/parallelDispatcher.js';
import { AgentFactory } from './agentFactory.js';

const MAX_CONCURRENT_AGENTS = 8;
const AGENT_RETRY_MAX = 3;
const AGENT_TIME_LIMIT_MS = 300000; // 5 minutes

interface IRunningAgent {
        instance: IAgentInstance;
        abortController: AbortController;
        startTime: number;
        memoryUsageMB: number;
        retryCount: number;
}

interface ITaskDecomposition {
        type: AgentType;
        description: string;
        dependencies: string[];
}

export class AgentPoolService extends Disposable implements IEnhancedAgentOrchestrator {
        readonly _serviceBrand: undefined;

        private agents = new Map<string, IRunningAgent>();
        private plans = new Map<string, IAgentExecutionPlan>();
        private factory: AgentFactory;
        private pausedPlans = new Set<string>();

        private readonly _onAgentStatusChange = this._register(new Emitter<IAgentInstance>());
        readonly onAgentStatusChange = this._onAgentStatusChange.event;

        private readonly _onMilestoneReached = this._register(new Emitter<{ planId: string; milestone: IMilestone }>());
        readonly onMilestoneReached = this._onMilestoneReached.event;

        private readonly _onExecutionComplete = this._register(new Emitter<{ planId: string; success: boolean; summary: string }>());
        readonly onExecutionComplete = this._onExecutionComplete.event;

        private readonly _onExecutionPaused = this._register(new Emitter<{ planId: string; reason: string; milestoneId?: string }>());
        readonly onExecutionPaused = this._onExecutionPaused.event;

        private readonly _onCreditsConsumed = this._register(new Emitter<{ planId: string; agentId: string; amount: number }>());
        readonly onCreditsConsumed = this._onCreditsConsumed.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IMCPServerManager private readonly mcpManager: IMCPServerManager,
                @IMemoryOrchestrator private readonly memory: IMemoryOrchestrator,
                @IParallelDispatcher private readonly dispatcher: IParallelDispatcher,
                @IBrowserAutomationService private readonly _browserService: IBrowserAutomationService
        ) {
                super();
                this.factory = new AgentFactory(logService, mcpManager, memory);
        }

        // --- IEnhancedAgentOrchestrator Implementation ---

        async createExecutionPlan(goal: string, mode: ExecutionMode = ExecutionMode.Milestone): Promise<IAgentExecutionPlan> {
                this.logService.info(`[AgentPool] Creating plan for: ${goal.substring(0, 100)}...`);

                const planId = `plan-${Date.now()}`;
                const tasks = this.decomposeGoal(goal);

                // Create specialized agents based on decomposition
                const agents: IAgentInstance[] = [];
                const agentMap = new Map<string, IAgentInstance>();

                for (const task of tasks) {
                        const agent = this.factory.createAgent(task.type, task.description, planId, task.dependencies);
                        agents.push(agent);
                        agentMap.set(agent.id, agent);
                }

                // Build dependency graph
                const graph = this.dispatcher.analyzeDependencies(agents);
                const parallelGroups = this.dispatcher.computeParallelGroups(graph);
                const cycles = this.dispatcher.detectCycles(graph);

                if (cycles.length > 0) {
                        this.logService.warn(`[AgentPool] Detected ${cycles.length} cycles in dependency graph, breaking them`);
                        // Break cycles by removing last dependency in each
                        for (const cycle of cycles) {
                                const lastAgent = agentMap.get(cycle[cycle.length - 1]);
                                if (lastAgent && lastAgent.dependencies.length > 0) {
                                        lastAgent.dependencies.pop();
                                }
                        }
                        // Recompute
                        const newGraph = this.dispatcher.analyzeDependencies(agents);
                        const newGroups = this.dispatcher.computeParallelGroups(newGraph);
                        parallelGroups.length = 0;
                        parallelGroups.push(...newGroups);
                }

                // Create milestones
                const milestones = this.createMilestones(tasks, agents);

                // Estimate credits
                const estimatedCredits = agents.reduce((sum, a) =>
                        sum + this.factory.estimateCredits(a.type, 10), 0
                );

                const plan: IAgentExecutionPlan = {
                        id: planId,
                        goal,
                        agents,
                        dependencyGraph: graph,
                        parallelGroups,
                        milestones,
                        executionMode: mode,
                        createdAt: Date.now(),
                        estimatedCredits
                };

                this.plans.set(planId, plan);
                this.logService.info(`[AgentPool] Plan ${planId} created: ${agents.length} agents, ${parallelGroups.length} parallel groups, ${milestones.length} milestones`);

                return plan;
        }

        async refinePlan(planId: string, modifications: Partial<IAgentExecutionPlan>): Promise<IAgentExecutionPlan> {
                const existing = this.plans.get(planId);
                if (!existing) {
                        throw new Error(`Plan ${planId} not found`);
                }

                // Apply modifications by creating a new plan object
                const refined: IAgentExecutionPlan = {
                        ...existing,
                        ...modifications,
                        id: existing.id, // Preserve ID
                        createdAt: existing.createdAt
                };

                this.plans.set(planId, refined);
                this.logService.info(`[AgentPool] Plan ${planId} refined`);
                return refined;
        }

        async executePlan(plan: IAgentExecutionPlan): Promise<void> {
                if (this.pausedPlans.has(plan.id)) {
                        this.logService.info(`[AgentPool] Plan ${plan.id} is paused, resuming...`);
                        this.pausedPlans.delete(plan.id);
                }

                this.logService.info(`[AgentPool] Executing plan ${plan.id} in ${plan.executionMode} mode`);

                const agentMap = new Map(plan.agents.map(a => [a.id, a]));

                // Pre-execution: save checkpoint for GOD mode
                if (plan.executionMode === ExecutionMode.GOD) {
                        this.logService.info('[AgentPool] GOD mode: auto-save checkpoint before execution');
                        // Trigger git checkpoint via MCP
                        try {
                                await this.mcpManager.executeTool('filesystem', 'execute_command', {
                                        command: 'git stash push -m "construct-god-mode-checkpoint"'
                                });
                        } catch {
                                this.logService.warn('[AgentPool] Failed to create git checkpoint, continuing anyway');
                        }
                }

                // Execute by parallel groups
                await this.dispatcher.scheduleExecution(
                        plan.id,
                        plan.parallelGroups,
                        agentMap,
                        async (agent) => this.executeSingleAgent(agent, plan),
                        Math.min(MAX_CONCURRENT_AGENTS, this.dispatcher.getOptimalConcurrency())
                );

                // Check completion
                const success = plan.agents.every(a => a.status === AgentStatus.Completed);
                const summary = this.generateSummary(plan);

                this._onExecutionComplete.fire({ planId: plan.id, success, summary });
                this.logService.info(`[AgentPool] Plan ${plan.id} complete: ${success ? 'SUCCESS' : 'PARTIAL_FAILURE'}`);
        }

        pauseExecution(planId: string): void {
                this.pausedPlans.add(planId);

                // Abort running agents for this plan
                for (const [agentId, running] of this.agents.entries()) {
                        if (agentId.startsWith(planId)) {
                                running.abortController.abort();
                                running.instance.status = AgentStatus.Paused;
                                this._onAgentStatusChange.fire(running.instance);
                        }
                }

                this._onExecutionPaused.fire({ planId, reason: 'User requested pause' });
                this.logService.info(`[AgentPool] Paused plan ${planId}`);
        }

        resumeExecution(planId: string): void {
                const plan = this.plans.get(planId);
                if (!plan) { return; }

                this.pausedPlans.delete(planId);
                this.executePlan(plan).catch(error => {
                        this.logService.error(`[AgentPool] Failed to resume plan ${planId}:`, error);
                });
        }

        cancelExecution(planId: string): void {
                for (const [agentId, running] of this.agents.entries()) {
                        if (agentId.startsWith(planId)) {
                                running.abortController.abort();
                                running.instance.status = AgentStatus.Failed;
                                running.instance.error = 'Execution cancelled by user';
                                this._onAgentStatusChange.fire(running.instance);
                                this.agents.delete(agentId);
                        }
                }

                this.logService.info(`[AgentPool] Cancelled plan ${planId}`);
        }

        cancelAgent(agentId: string): void {
                const running = this.agents.get(agentId);
                if (running) {
                        running.abortController.abort();
                        running.instance.status = AgentStatus.Failed;
                        running.instance.error = 'Agent cancelled by user';
                        this._onAgentStatusChange.fire(running.instance);
                        this.agents.delete(agentId);
                }
        }

        getExecutionStatus(planId: string): IAgentExecutionPlan | undefined {
                return this.plans.get(planId);
        }

        getAllActivePlans(): IAgentExecutionPlan[] {
                return Array.from(this.plans.values()).filter(p =>
                        p.agents.some(a => a.status === AgentStatus.Executing || a.status === AgentStatus.Waiting)
                );
        }

        getAgentOutput(agentId: string): string {
                const running = this.agents.get(agentId);
                return running?.instance.output ?? '';
        }

        getMilestoneStatus(planId: string, milestoneId: string): IMilestone | undefined {
                const plan = this.plans.get(planId);
                if (!plan) { return undefined; }
                return plan.milestones.find(m => m.id === milestoneId);
        }

        approveMilestone(planId: string, milestoneId: string): void {
                const plan = this.plans.get(planId);
                if (!plan) { return; }
                const milestone = plan.milestones.find(m => m.id === milestoneId);
                if (milestone) {
                        milestone.status = 'completed';
                        this.logService.info(`[AgentPool] Milestone ${milestoneId} approved`);
                        // Resume execution if plan was paused for this milestone
                        if (this.pausedPlans.has(planId)) {
                                this.resumeExecution(planId);
                        }
                }
        }

        rejectMilestone(planId: string, milestoneId: string, reason: string): void {
                const plan = this.plans.get(planId);
                if (!plan) { return; }
                const milestone = plan.milestones.find(m => m.id === milestoneId);
                if (milestone) {
                        milestone.status = 'blocked';
                        this.logService.info(`[AgentPool] Milestone ${milestoneId} rejected: ${reason}`);
                        this._onExecutionPaused.fire({ planId, reason: `Milestone rejected: ${reason}`, milestoneId });
                }
        }

        skipMilestone(planId: string, milestoneId: string): void {
                const plan = this.plans.get(planId);
                if (!plan) { return; }
                const milestone = plan.milestones.find(m => m.id === milestoneId);
                if (milestone) {
                        milestone.status = 'completed';
                        this.logService.info(`[AgentPool] Milestone ${milestoneId} skipped`);
                        if (this.pausedPlans.has(planId)) {
                                this.resumeExecution(planId);
                        }
                }
        }

        // --- Pool Statistics ---

        getPoolStats(): IAgentPoolStats {
                const allAgents = Array.from(this.agents.values());
                const active = allAgents.filter(a => a.instance.status === AgentStatus.Executing).length;
                const completed = allAgents.filter(a => a.instance.status === AgentStatus.Completed).length;
                const failed = allAgents.filter(a => a.instance.status === AgentStatus.Failed).length;
                const waiting = allAgents.filter(a => a.instance.status === AgentStatus.Waiting).length;

                const totalCredits = allAgents.reduce((sum, a) => sum + a.instance.creditsConsumed, 0);
                const estimatedTotal = Array.from(this.plans.values()).reduce((sum, p) => sum + p.estimatedCredits, 0);

                const totalAgents = allAgents.length;
                const progressPercent = totalAgents > 0 ? ((completed + failed) / totalAgents) * 100 : 0;

                return {
                        totalAgents,
                        activeAgents: active,
                        completedAgents: completed,
                        failedAgents: failed,
                        waitingAgents: waiting,
                        currentParallelism: active,
                        maxParallelism: MAX_CONCURRENT_AGENTS,
                        creditsConsumed: totalCredits,
                        estimatedTotalCredits: estimatedTotal,
                        progressPercent
                };
        }

        // --- Private execution ---

        private async executeSingleAgent(agent: IAgentInstance, plan: IAgentExecutionPlan): Promise<void> {
                const abortController = new AbortController();
                const startTime = Date.now();

                this.agents.set(agent.id, {
                        instance: agent,
                        abortController,
                        startTime,
                        memoryUsageMB: 0,
                        retryCount: 0
                });

                agent.status = AgentStatus.Executing;
                agent.startTime = startTime;
                this._onAgentStatusChange.fire(agent);

                try {
                        // Check dependencies
                        const depsCompleted = agent.dependencies.every(depId => {
                                const dep = plan.agents.find(a => a.id === depId);
                                return dep?.status === AgentStatus.Completed;
                        });

                        if (!depsCompleted) {
                                agent.status = AgentStatus.Waiting;
                                this._onAgentStatusChange.fire(agent);

                                // Wait for dependencies (with timeout)
                                await this.waitForDependencies(agent, plan, AGENT_TIME_LIMIT_MS);
                        }

                        if (abortController.signal.aborted) {
                                throw new Error('Agent execution aborted');
                        }

                        agent.status = AgentStatus.Executing;
                        this._onAgentStatusChange.fire(agent);

                        // Inject memory context
                        const enrichedTask = await this.memory.injectContextIntoPrompt(agent.task, plan.id);

                        // Execute based on agent type
                        const result = await this.runAgentLogic(agent, enrichedTask, abortController.signal);

                        agent.output = result;
                        agent.status = AgentStatus.Completed;
                        agent.endTime = Date.now();

                        // Consume credits
                        const credits = this.factory.estimateCredits(agent.type, 1);
                        agent.creditsConsumed = credits;
                        this._onCreditsConsumed.fire({ planId: plan.id, agentId: agent.id, amount: credits });

                } catch (error) {
                        const running = this.agents.get(agent.id);

                        if (running && running.retryCount < AGENT_RETRY_MAX) {
                                running.retryCount++;
                                this.logService.warn(`[AgentPool] Retrying agent ${agent.id} (attempt ${running.retryCount}/${AGENT_RETRY_MAX})`);

                                // Exponential backoff
                                await this.delay(1000 * Math.pow(2, running.retryCount - 1));

                                // Reset and retry
                                agent.status = AgentStatus.Idle;
                                agent.error = undefined;
                                return this.executeSingleAgent(agent, plan);
                        }

                        agent.status = AgentStatus.Failed;
                        agent.error = error instanceof Error ? error.message : String(error);
                        agent.endTime = Date.now();

                        this.logService.error(`[AgentPool] Agent ${agent.id} failed after ${running?.retryCount ?? 0} retries:`, error);
                }

                this._onAgentStatusChange.fire(agent);
                this.agents.delete(agent.id);

                // Check milestones
                this.checkMilestones(plan);
        }

        private async runAgentLogic(agent: IAgentInstance, task: string, signal: AbortSignal): Promise<string> {
                // In production, this calls the LLM with the agent's system prompt + tools
                // For now, simulate based on agent type
                const config = this.factory.getConfig(agent.type);

                this.logService.info(`[AgentPool] ${agent.type} agent ${agent.id} executing with ${config.model}`);

                // Simulate work duration based on complexity
                const workDuration = 2000 + Math.random() * 3000;
                await this.delay(workDuration);

                if (signal.aborted) {
                        throw new Error('Execution aborted');
                }

                // Simulate output based on agent type
                const outputs: Record<string, string> = {
                        [AgentType.Planner]: `Plan created: ${task.substring(0, 50)}...`,
                        [AgentType.Coder]: `Code written for: ${task.substring(0, 50)}...`,
                        [AgentType.Tester]: `Tests written: 5 unit, 2 integration. Coverage: 82%`,
                        [AgentType.Reviewer]: `Review complete: 2 minor issues found, 0 critical`,
                        [AgentType.Browser]: `Screenshot captured. Visual validation: PASS`,
                        [AgentType.DevOps]: `Deployment triggered. Health check: PASS`,
                        [AgentType.Researcher]: `Found 3 relevant solutions. Recommended approach: A`,
                        [AgentType.DocWriter]: `Documentation updated: README, API docs, changelog`
                };

                return outputs[agent.type] ?? `Task completed: ${task.substring(0, 50)}...`;
        }

        private async waitForDependencies(agent: IAgentInstance, plan: IAgentExecutionPlan, timeoutMs: number): Promise<void> {
                const start = Date.now();

                while (Date.now() - start < timeoutMs) {
                        const allDone = agent.dependencies.every(depId => {
                                const dep = plan.agents.find(a => a.id === depId);
                                return dep?.status === AgentStatus.Completed || dep?.status === AgentStatus.Failed;
                        });

                        if (allDone) {
                                // Check if any dependency failed
                                const anyFailed = agent.dependencies.some(depId => {
                                        const dep = plan.agents.find(a => a.id === depId);
                                        return dep?.status === AgentStatus.Failed;
                                });

                                if (anyFailed) {
                                        throw new Error(`Dependencies failed for agent ${agent.id}`);
                                }

                                return;
                        }

                        await this.delay(500);
                }

                throw new Error(`Timeout waiting for dependencies of agent ${agent.id}`);
        }

        private checkMilestones(plan: IAgentExecutionPlan): void {
                for (const milestone of plan.milestones) {
                        if (milestone.status === 'completed' || milestone.status === 'blocked') { continue; }

                        const requiredDone = milestone.requiredAgents.every(agentId => {
                                const agent = plan.agents.find(a => a.id === agentId);
                                return agent?.status === AgentStatus.Completed;
                        });

                        if (requiredDone) {
                                milestone.status = 'completed';
                                this._onMilestoneReached.fire({ planId: plan.id, milestone });

                                // Pause if milestone mode and not auto-approved
                                if (plan.executionMode === ExecutionMode.Milestone && !milestone.autoApprove) {
                                        this.pauseExecution(plan.id);
                                        this._onExecutionPaused.fire({
                                                planId: plan.id,
                                                reason: `Milestone reached: ${milestone.name}`,
                                                milestoneId: milestone.id
                                        });
                                }
                        }
                }
        }

        private decomposeGoal(goal: string): ITaskDecomposition[] {
                // In production, this uses the Planner agent + LLM
                // Simplified heuristic decomposition for demonstration
                const tasks: ITaskDecomposition[] = [];
                const lowerGoal = goal.toLowerCase();

                // Always start with planning
                const plannerId = `planner-${Date.now()}`;
                tasks.push({
                        type: AgentType.Planner,
                        description: `Decompose goal: ${goal}`,
                        dependencies: []
                });

                // Detect project type and create relevant agents
                if (lowerGoal.includes('frontend') || lowerGoal.includes('ui') || lowerGoal.includes('react') || lowerGoal.includes('web')) {
                        tasks.push({
                                type: AgentType.Coder,
                                description: `Implement frontend: ${goal}`,
                                dependencies: [plannerId]
                        });
                        tasks.push({
                                type: AgentType.Browser,
                                description: `Validate frontend visually`,
                                dependencies: []
                        });
                }

                if (lowerGoal.includes('backend') || lowerGoal.includes('api') || lowerGoal.includes('server') || lowerGoal.includes('database')) {
                        tasks.push({
                                type: AgentType.Coder,
                                description: `Implement backend: ${goal}`,
                                dependencies: [plannerId]
                        });
                }

                if (lowerGoal.includes('test') || lowerGoal.includes('spec')) {
                        tasks.push({
                                type: AgentType.Tester,
                                description: `Write comprehensive tests`,
                                dependencies: []
                        });
                }

                if (lowerGoal.includes('deploy') || lowerGoal.includes('ci/cd') || lowerGoal.includes('docker')) {
                        tasks.push({
                                type: AgentType.DevOps,
                                description: `Setup deployment pipeline`,
                                dependencies: []
                        });
                }

                if (lowerGoal.includes('doc') || lowerGoal.includes('readme')) {
                        tasks.push({
                                type: AgentType.DocWriter,
                                description: `Update documentation`,
                                dependencies: []
                        });
                }

                // Always add reviewer
                tasks.push({
                        type: AgentType.Reviewer,
                        description: `Review all changes for security and quality`,
                        dependencies: []
                });

                // Fix dependencies: reviewer depends on all coders
                const coderIds = tasks.filter(t => t.type === AgentType.Coder).map((_, i) => `coder-${i}`);
                const reviewerTask = tasks.find(t => t.type === AgentType.Reviewer);
                if (reviewerTask) {
                        reviewerTask.dependencies = coderIds;
                }

                // Tester depends on all coders
                const testerTask = tasks.find(t => t.type === AgentType.Tester);
                if (testerTask) {
                        testerTask.dependencies = coderIds;
                }

                // Browser depends on frontend coder
                const browserTask = tasks.find(t => t.type === AgentType.Browser);
                const frontendCoder = tasks.find(t => t.type === AgentType.Coder && t.description.includes('frontend'));
                if (browserTask && frontendCoder) {
                        browserTask.dependencies = [frontendCoder.description]; // Simplified
                }

                return tasks;
        }

        private createMilestones(
                tasks: ITaskDecomposition[],
                agents: IAgentInstance[]
        ): IMilestone[] {
                const milestones: IMilestone[] = [];

                // Milestone 1: Planning complete
                const planner = agents.find(a => a.type === AgentType.Planner);
                if (planner) {
                        milestones.push({
                                id: `ms-plan-${Date.now()}`,
                                name: 'Architecture Defined',
                                description: 'High-level design and task decomposition complete',
                                requiredAgents: [planner.id],
                                completionCriteria: 'Planner agent has created execution plan',
                                autoApprove: true,
                                status: 'pending',
                                order: 1
                        });
                }

                // Milestone 2: Core implementation
                const coders = agents.filter(a => a.type === AgentType.Coder);
                if (coders.length > 0) {
                        milestones.push({
                                id: `ms-code-${Date.now()}`,
                                name: 'Implementation Complete',
                                description: 'All code files written and compiling',
                                requiredAgents: coders.map(a => a.id),
                                completionCriteria: 'All coder agents completed without errors',
                                autoApprove: false,
                                status: 'pending',
                                order: 2
                        });
                }

                // Milestone 3: Tests passing
                const testers = agents.filter(a => a.type === AgentType.Tester);
                if (testers.length > 0) {
                        milestones.push({
                                id: `ms-test-${Date.now()}`,
                                name: 'Tests Passing',
                                description: 'All tests green with >80% coverage',
                                requiredAgents: testers.map(a => a.id),
                                completionCriteria: 'Test suite passes with acceptable coverage',
                                autoApprove: true,
                                status: 'pending',
                                order: 3
                        });
                }

                // Milestone 4: Review approved
                const reviewers = agents.filter(a => a.type === AgentType.Reviewer);
                if (reviewers.length > 0) {
                        milestones.push({
                                id: `ms-review-${Date.now()}`,
                                name: 'Code Review Approved',
                                description: 'Security and quality review passed',
                                requiredAgents: reviewers.map(a => a.id),
                                completionCriteria: 'No critical issues, all style violations resolved',
                                autoApprove: false,
                                status: 'pending',
                                order: 4
                        });
                }

                // Milestone 5: Deployed (if DevOps)
                const devops = agents.filter(a => a.type === AgentType.DevOps);
                if (devops.length > 0) {
                        milestones.push({
                                id: `ms-deploy-${Date.now()}`,
                                name: 'Deployed',
                                description: 'Live in production with health checks passing',
                                requiredAgents: devops.map(a => a.id),
                                completionCriteria: 'Deployment successful, health checks green',
                                autoApprove: true,
                                status: 'pending',
                                order: 5
                        });
                }

                return milestones.sort((a, b) => a.order - b.order);
        }

        private generateSummary(plan: IAgentExecutionPlan): string {
                const completed = plan.agents.filter(a => a.status === AgentStatus.Completed).length;
                const failed = plan.agents.filter(a => a.status === AgentStatus.Failed).length;
                const total = plan.agents.length;
                const duration = Math.max(...plan.agents.map(a => (a.endTime ?? Date.now()) - (a.startTime ?? Date.now())));
                const credits = plan.agents.reduce((sum, a) => sum + a.creditsConsumed, 0);

                return [
                        `Plan: ${plan.goal.substring(0, 50)}...`,
                        `Agents: ${completed}/${total} completed, ${failed} failed`,
                        `Duration: ${(duration / 1000).toFixed(1)}s`,
                        `Credits consumed: ${credits}/${plan.estimatedCredits}`,
                        `Milestones: ${plan.milestones.filter(m => m.status === 'completed').length}/${plan.milestones.length} reached`
                ].join('\n');
        }

        private delay(ms: number): Promise<void> {
                return new Promise(resolve => setTimeout(resolve, ms));
        }

        override dispose(): void {
                // Cancel all active agents
                for (const [, running] of this.agents.entries()) {
                        running.abortController.abort();
                }
                this.agents.clear();
                this.plans.clear();
                super.dispose();
        }
}
