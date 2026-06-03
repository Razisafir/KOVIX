/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkingMemoryService } from '../../../../platform/construct/common/memory/workingMemory.js';
import { IWorkingMemoryEntry, MemoryLayer } from '../../../../platform/construct/common/memory/memoryTypes.js';

const WORKING_MEMORY_PREFIX = 'construct.memory.working.';
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_TOKEN_BUDGET = 8000;

interface ISerializedWorkingMemory {
	id: string;
	projectId: string;
	content: string;
	timestamp: number;
	contextWindow: string[];
	activeFiles: string[];
	cursorPositions: Array<{ file: string; line: number; column: number }>;
	conversationHistory: string[];
	tokenBudget: number;
	tokensUsed: number;
}

export class WorkingMemoryService extends Disposable implements IWorkingMemoryService {
	readonly _serviceBrand: undefined;

	private contexts = new Map<string, IWorkingMemoryEntry>();
	private lastAccess = new Map<string, number>();

	private readonly _onDidChangeContext = this._register(new Emitter<{ projectId: string; entry: IWorkingMemoryEntry }>());
	readonly onDidChangeContext = this._onDidChangeContext.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.loadPersistedContexts();
		this.startCleanupTimer();
	}

	getCurrentContext(projectId: string): IWorkingMemoryEntry | undefined {
		this.lastAccess.set(projectId, Date.now());
		return this.contexts.get(projectId);
	}

	updateContext(projectId: string, update: Partial<Omit<IWorkingMemoryEntry, 'id' | 'layer' | 'timestamp'>>): void {
		const existing = this.contexts.get(projectId);
		const now = Date.now();

		const entry: IWorkingMemoryEntry = {
			id: existing?.id ?? `working-${projectId}-${now}`,
			layer: MemoryLayer.Working,
			content: update.content ?? existing?.content ?? '',
			timestamp: now,
			projectId,
			contextWindow: update.contextWindow ?? existing?.contextWindow ?? [],
			activeFiles: update.activeFiles ?? existing?.activeFiles ?? [],
			cursorPositions: update.cursorPositions ?? existing?.cursorPositions ?? [],
			conversationHistory: update.conversationHistory ?? existing?.conversationHistory ?? [],
			tokenBudget: update.tokenBudget ?? existing?.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
			tokensUsed: update.tokensUsed ?? existing?.tokensUsed ?? 0,
			relevanceScore: 1.0,
			metadata: update.metadata ?? existing?.metadata
		};

		this.contexts.set(projectId, entry);
		this.lastAccess.set(projectId, now);
		this.persistContext(projectId, entry);
		this._onDidChangeContext.fire({ projectId, entry });
	}

	clearContext(projectId: string): void {
		this.contexts.delete(projectId);
		this.lastAccess.delete(projectId);
		this.storageService.remove(`${WORKING_MEMORY_PREFIX}${projectId}`, StorageScope.WORKSPACE);
		this.logService.info(`[WorkingMemory] Cleared context for ${projectId}`);
	}

	getContextWindowSize(projectId: string): number {
		const ctx = this.contexts.get(projectId);
		if (!ctx) { return 0; }
		return ctx.conversationHistory.reduce((sum, msg) => sum + this.estimateTokens(msg), 0);
	}

	getTokenBudget(projectId: string): number {
		return this.contexts.get(projectId)?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
	}

	pruneContext(projectId: string, targetTokens: number): void {
		const ctx = this.contexts.get(projectId);
		if (!ctx) { return; }

		let currentTokens = this.getContextWindowSize(projectId);
		const prunedHistory = [...ctx.conversationHistory];

		while (currentTokens > targetTokens && prunedHistory.length > 1) {
			const removed = prunedHistory.shift()!;
			currentTokens -= this.estimateTokens(removed);
		}

		this.updateContext(projectId, {
			conversationHistory: prunedHistory,
			tokensUsed: currentTokens
		});

		this.logService.info(`[WorkingMemory] Pruned ${projectId} to ${currentTokens} tokens`);
	}

	// --- Private Helpers -------------------------------------------------------

	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	private loadPersistedContexts(): void {
		try {
			const keys = this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.USER);
			const workingKeys = keys.filter(k => k.startsWith(WORKING_MEMORY_PREFIX));

			for (const key of workingKeys) {
				const projectId = key.replace(WORKING_MEMORY_PREFIX, '');
				const serialized = this.storageService.getObject<ISerializedWorkingMemory>(key, StorageScope.WORKSPACE);

				if (serialized && (Date.now() - serialized.timestamp) < DEFAULT_TTL_MS) {
					const entry: IWorkingMemoryEntry = {
						...serialized,
						layer: MemoryLayer.Working,
						relevanceScore: 1.0
					};
					this.contexts.set(projectId, entry);
					this.lastAccess.set(projectId, Date.now());
				}
			}

			this.logService.info(`[WorkingMemory] Loaded ${this.contexts.size} persisted contexts`);
		} catch (error) {
			this.logService.error('[WorkingMemory] Failed to load persisted contexts:', error);
		}
	}

	private persistContext(projectId: string, entry: IWorkingMemoryEntry): void {
		const serialized: ISerializedWorkingMemory = {
			id: entry.id,
			projectId: entry.projectId,
			content: entry.content,
			timestamp: entry.timestamp,
			contextWindow: entry.contextWindow,
			activeFiles: entry.activeFiles,
			cursorPositions: entry.cursorPositions,
			conversationHistory: entry.conversationHistory,
			tokenBudget: entry.tokenBudget,
			tokensUsed: entry.tokensUsed
		};

		this.storageService.store(`${WORKING_MEMORY_PREFIX}${projectId}`, serialized, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private startCleanupTimer(): void {
		const timer = setInterval(() => {
			const now = Date.now();
			for (const [projectId, lastAccessTime] of this.lastAccess.entries()) {
				if ((now - lastAccessTime) > DEFAULT_TTL_MS) {
					this.clearContext(projectId);
				}
			}
		}, 60000);

		this._register({
			dispose: () => clearInterval(timer)
		});
	}

	override dispose(): void {
		for (const [projectId, entry] of this.contexts.entries()) {
			this.persistContext(projectId, entry);
		}
		super.dispose();
	}
}
