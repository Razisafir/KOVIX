// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ISemanticMemoryEntry, IMemorySearchResult } from './memoryTypes';

export const ISemanticMemoryService = createDecorator<ISemanticMemoryService>('construct.semanticMemory');

export interface ISemanticMemoryService extends IDisposable {
	readonly _serviceBrand: undefined;

	storeKnowledge(entry: Omit<ISemanticMemoryEntry, 'id' | 'layer' | 'timestamp'>): Promise<void>;
	searchKnowledge(projectId: string, query: string, topK?: number): Promise<IMemorySearchResult>;
	searchByEmbedding(projectId: string, embedding: number[], topK?: number): Promise<IMemorySearchResult>;
	getKnowledgeByTag(projectId: string, tag: string): ISemanticMemoryEntry[];
	deleteKnowledge(projectId: string, id: string): void;
	getAllKnowledge(projectId: string): ISemanticMemoryEntry[];

	readonly onDidStoreKnowledge: Event<ISemanticMemoryEntry>;
	readonly onDidDeleteKnowledge: Event<{ projectId: string; id: string }>;
}
