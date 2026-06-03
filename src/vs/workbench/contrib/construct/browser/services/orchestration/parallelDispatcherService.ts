/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IParallelDispatcher } from '../../../../../../platform/construct/common/orchestration/parallelDispatcher.js';
import { IAgentInstance } from '../../../../../../platform/construct/common/orchestration/agentTypes.js';

interface IExecutionContext {
        planId: string;
        groups: string[][];
        agentMap: Map<string, IAgentInstance>;
        executeAgent: (agent: IAgentInstance) => Promise<void>;
        maxConcurrency: number;
        currentGroup: number;
        activePromises: Map<string, Promise<void>>;
        completedAgents: Set<string>;
        failedAgents: Set<string>;
}

export class ParallelDispatcherService extends Disposable implements IParallelDispatcher {
        readonly _serviceBrand: undefined;

        private readonly _onGroupStarted = this._register(new Emitter<{ planId: string; groupIndex: number; agentIds: string[] }>());
        readonly onGroupStarted = this._onGroupStarted.event;

        private readonly _onGroupCompleted = this._register(new Emitter<{ planId: string; groupIndex: number; results: Array<{ agentId: string; success: boolean }> }>());
        readonly onGroupCompleted = this._onGroupCompleted.event;

        constructor(
                @ILogService private readonly logService: ILogService
        ) {
                super();
        }

        analyzeDependencies(agents: IAgentInstance[]): Map<string, string[]> {
                const graph = new Map<string, string[]>();

                // Build dependency graph
                for (const agent of agents) {
                        graph.set(agent.id, [...agent.dependencies]);
                }

                // Build reverse dependencies (dependents)
                for (const agent of agents) {
                        for (const depId of agent.dependencies) {
                                const dep = agents.find(a => a.id === depId);
                                if (dep) {
                                        dep.dependents.push(agent.id);
                                }
                        }
                }

                return graph;
        }

        computeParallelGroups(graph: Map<string, string[]>): string[][] {
                const visited = new Set<string>();
                const inProgress = new Set<string>();

                const visit = (node: string): void => {
                        if (inProgress.has(node)) {
                                // Cycle detected -- break it by removing the cyclic dependency
                                this.logService.warn(`[ParallelDispatcher] Cycle detected involving ${node}`);
                                return;
                        }
                        if (visited.has(node)) { return; }

                        inProgress.add(node);

                        const deps = graph.get(node) ?? [];
                        for (const dep of deps) {
                                visit(dep);
                        }

                        inProgress.delete(node);
                        visited.add(node);
                };

                // Topological sort with grouping
                const remaining = new Set(graph.keys());
                const groups: string[][] = [];

                while (remaining.size > 0) {
                        const group: string[] = [];

                        for (const node of remaining) {
                                const deps = graph.get(node) ?? [];
                                const allDepsResolved = deps.every(d => !remaining.has(d));

                                if (allDepsResolved) {
                                        group.push(node);
                                }
                        }

                        if (group.length === 0) {
                                // Deadlock -- force break by taking remaining nodes
                                this.logService.error('[ParallelDispatcher] Deadlock detected, forcing resolution');
                                group.push(...remaining);
                                remaining.clear();
                        } else {
                                for (const node of group) {
                                        remaining.delete(node);
                                }
                        }

                        groups.push(group);
                }

                return groups;
        }

        detectCycles(graph: Map<string, string[]>): string[][] {
                const cycles: string[][] = [];
                const visited = new Set<string>();
                const recStack = new Set<string>();

                const dfs = (node: string, path: string[]): void => {
                        visited.add(node);
                        recStack.add(node);
                        path.push(node);

                        const neighbors = graph.get(node) ?? [];
                        for (const neighbor of neighbors) {
                                if (!visited.has(neighbor)) {
                                        dfs(neighbor, [...path]);
                                } else if (recStack.has(neighbor)) {
                                        // Cycle found
                                        const cycleStart = path.indexOf(neighbor);
                                        cycles.push(path.slice(cycleStart));
                                }
                        }

                        recStack.delete(node);
                };

                for (const node of graph.keys()) {
                        if (!visited.has(node)) {
                                dfs(node, []);
                        }
                }

                return cycles;
        }

        async scheduleExecution(
                planId: string,
                groups: string[][],
                agentMap: Map<string, IAgentInstance>,
                executeAgent: (agent: IAgentInstance) => Promise<void>,
                maxConcurrency: number = 4
        ): Promise<void> {
                const ctx: IExecutionContext = {
                        planId,
                        groups,
                        agentMap,
                        executeAgent,
                        maxConcurrency,
                        currentGroup: 0,
                        activePromises: new Map(),
                        completedAgents: new Set(),
                        failedAgents: new Set()
                };

                for (let i = 0; i < groups.length; i++) {
                        ctx.currentGroup = i;
                        await this.executeGroup(ctx, i);
                }
        }

        private async executeGroup(ctx: IExecutionContext, groupIndex: number): Promise<void> {
                const agentIds = ctx.groups[groupIndex];
                const agents = agentIds.map(id => ctx.agentMap.get(id)).filter((a): a is IAgentInstance => !!a);

                this.logService.info(`[ParallelDispatcher] Starting group ${groupIndex} with ${agents.length} agents`);
                this._onGroupStarted.fire({ planId: ctx.planId, groupIndex, agentIds });

                const results: Array<{ agentId: string; success: boolean }> = [];

                // Execute agents with concurrency limit
                const executing: Promise<void>[] = [];
                const queue = [...agents];

                const processNext = async (): Promise<void> => {
                        while (queue.length > 0 && executing.length < ctx.maxConcurrency) {
                                const agent = queue.shift()!;

                                const promise = this.runAgentWithTimeout(agent, ctx.executeAgent, 300000) // 5 min timeout
                                        .then(() => {
                                                ctx.completedAgents.add(agent.id);
                                                results.push({ agentId: agent.id, success: true });
                                                ctx.activePromises.delete(agent.id);
                                        })
                                        .catch(error => {
                                                ctx.failedAgents.add(agent.id);
                                                results.push({ agentId: agent.id, success: false });
                                                ctx.activePromises.delete(agent.id);
                                                this.logService.error(`[ParallelDispatcher] Agent ${agent.id} failed:`, error);
                                        })
                                        .finally(() => {
                                                const idx = executing.indexOf(promise);
                                                if (idx > -1) { executing.splice(idx, 1); }
                                        });

                                ctx.activePromises.set(agent.id, promise);
                                executing.push(promise);
                        }
                };

                // Start initial batch
                await processNext();

                // Wait for completion and start new agents as slots free up
                while (executing.length > 0 || queue.length > 0) {
                        if (executing.length > 0) {
                                await Promise.race(executing);
                        }
                        await processNext();
                }

                this.logService.info(`[ParallelDispatcher] Group ${groupIndex} complete: ${results.filter(r => r.success).length}/${results.length} succeeded`);
                this._onGroupCompleted.fire({ planId: ctx.planId, groupIndex, results });
        }

        private async runAgentWithTimeout(
                agent: IAgentInstance,
                execute: (agent: IAgentInstance) => Promise<void>,
                timeoutMs: number
        ): Promise<void> {
                return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {
                                reject(new Error(`Agent ${agent.id} timed out after ${timeoutMs}ms`));
                        }, timeoutMs);

                        execute(agent)
                                .then(() => {
                                        clearTimeout(timer);
                                        resolve();
                                })
                                .catch(error => {
                                        clearTimeout(timer);
                                        reject(error);
                                });
                });
        }

        getOptimalConcurrency(): number {
                // Use CPU cores as baseline, cap at 8
                const cpus = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4;
                return Math.min(Math.max(cpus - 1, 2), 8);
        }

        getExecutionOrder(agents: IAgentInstance[]): string[] {
                const graph = this.analyzeDependencies(agents);
                const groups = this.computeParallelGroups(graph);
                return groups.flat();
        }

        override dispose(): void {
                super.dispose();
        }
}
