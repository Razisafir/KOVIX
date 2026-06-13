// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

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
