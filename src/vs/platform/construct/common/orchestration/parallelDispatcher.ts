/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAgentInstance } from './agentTypes.js';

export const IParallelDispatcher = createDecorator<IParallelDispatcher>('construct.parallelDispatcher');

export interface IParallelDispatcher extends IDisposable {
	readonly _serviceBrand: undefined;

	// Dependency Analysis
	analyzeDependencies(agents: IAgentInstance[]): Map<string, string[]>;
	computeParallelGroups(graph: Map<string, string[]>): string[][];
	detectCycles(graph: Map<string, string[]>): string[][];

	// Scheduling
	scheduleExecution(
		planId: string,
		groups: string[][],
		agentMap: Map<string, IAgentInstance>,
		executeAgent: (agent: IAgentInstance) => Promise<void>,
		maxConcurrency?: number
	): Promise<void>;

	// Optimization
	getOptimalConcurrency(): number;  // Based on CPU cores, memory, network
	getExecutionOrder(agents: IAgentInstance[]): string[];

	// Events
	readonly onGroupStarted: Event<{ planId: string; groupIndex: number; agentIds: string[] }>;
	readonly onGroupCompleted: Event<{ planId: string; groupIndex: number; results: Array<{ agentId: string; success: boolean }> }>;
}
