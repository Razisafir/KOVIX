/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IProceduralMemoryEntry } from './memoryTypes';

export const IProceduralMemoryService = createDecorator<IProceduralMemoryService>('construct.proceduralMemory');

export interface IProceduralMemoryService extends IDisposable {
	readonly _serviceBrand: undefined;

	recordPattern(entry: Omit<IProceduralMemoryEntry, 'id' | 'layer' | 'timestamp' | 'successCount' | 'failureCount' | 'totalAttempts' | 'lastUsed' | 'createdAt'>): void;
	getPatternsForContext(projectId: string, context: string): IProceduralMemoryEntry[];
	getSuccessfulPatterns(projectId: string, taskType: string): IProceduralMemoryEntry[];
	updatePatternSuccess(projectId: string, id: string, success: boolean): void;
	getPatternLeaderboard(projectId: string): IProceduralMemoryEntry[];
	extractPatternsFromEpisodes(projectId: string, episodes: string[]): Promise<void>;

	readonly onDidRecordPattern: Event<IProceduralMemoryEntry>;
	readonly onDidUpdatePattern: Event<IProceduralMemoryEntry>;
}
