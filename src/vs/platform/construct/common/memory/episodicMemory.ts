/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IEpisodicMemoryEntry } from './memoryTypes.js';

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
