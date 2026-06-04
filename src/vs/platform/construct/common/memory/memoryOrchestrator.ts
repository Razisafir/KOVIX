/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IMemoryQuery, IMemorySearchResult, IMemoryStats } from './memoryTypes';

export const IMemoryOrchestrator = createDecorator<IMemoryOrchestrator>('construct.memoryOrchestrator');

export interface IMemoryOrchestrator extends IDisposable {
	readonly _serviceBrand: undefined;

	query(query: IMemoryQuery): Promise<IMemorySearchResult>;
	consolidate(projectId: string): Promise<void>;
	forget(projectId: string): Promise<void>;
	getMemoryStats(projectId: string): IMemoryStats;
	injectContextIntoPrompt(prompt: string, projectId: string, maxTokens?: number): Promise<string>;
	getRelevantContext(projectId: string, query: string, maxResults?: number): Promise<string>;

	readonly onDidConsolidate: Event<{ projectId: string; stats: IMemoryStats }>;
	readonly onDidForget: Event<{ projectId: string }>;
}
