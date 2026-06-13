// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IEpisodicMemoryEntry } from './memoryTypes';

export const IEpisodicMemoryService = createDecorator<IEpisodicMemoryService>('construct.episodicMemory');

export interface IEpisodicMemoryService extends IDisposable {
	readonly _serviceBrand: undefined;

	recordEvent(entry: Omit<IEpisodicMemoryEntry, 'id' | 'layer' | 'timestamp'>): void;
	getRecentEvents(projectId: string, limit: number): IEpisodicMemoryEntry[];
	getEventsByTimeRange(projectId: string, start: number, end: number): IEpisodicMemoryEntry[];
	searchEvents(projectId: string, query: string): IEpisodicMemoryEntry[];
	getEventsByActionType(projectId: string, actionType: string): IEpisodicMemoryEntry[];
	summarizeSession(projectId: string, sessionId: string): string;
	getSessionIds(projectId: string): string[];

	readonly onDidRecordEvent: Event<IEpisodicMemoryEntry>;
}
