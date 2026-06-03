/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * projectMemoryService.ts -- Phase 9: Persistent Project Memory System
 *
 * Concrete implementations of IProjectMemoryService (#145),
 * IMemoryCompactionService (#146), and IExecutionTimelineService (#147).
 *
 * Uses VS Code's IStorageService for crash-safe persistence.
 * Every method produces real behavior: store, retrieve, persist, restore.
 * No simulated memory, no fake recall, no AGI claims.
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import {
	IProjectMemoryService, IMemoryCompactionService, IExecutionTimelineService,
	MemoryType, MemoryPriority, CompactionStrategy, CheckpointType,
	MemoryEntry, ProjectMemoryState, MemoryCheckpoint, MemoryQueryResult,
	CompactionResult, CompactionAction, TimelineEntry,
} from '../../../../../platform/construct/common/projectMemory.js';

// -- Storage Key Prefixes --

const STORAGE_PREFIX = 'construct.aiExecution.memory.';
const STORAGE_PROJECTS_INDEX = STORAGE_PREFIX + 'projectsIndex';
const STORAGE_PROJECT_PREFIX = STORAGE_PREFIX + 'project.';
const STORAGE_CHECKPOINTS_PREFIX = STORAGE_PREFIX + 'checkpoints.';
const STORAGE_TIMELINE_PREFIX = STORAGE_PREFIX + 'timeline.';
const STORAGE_CRASH_FLAG = STORAGE_PREFIX + 'crashFlag.';

// -- Constants --

const DEFAULT_AUTO_SAVE_INTERVAL_MS = 30_000;
const MAX_CHECKPOINTS_PER_PROJECT = 50;
const MAX_TIMELINE_ENTRIES_PER_PROJECT = 10_000;
const CJK_RANGES: [number, number][] = [
	[0x4E00, 0x9FFF], [0x3400, 0x4DBF], [0x3040, 0x309F],
	[0x30A0, 0x30FF], [0xAC00, 0xD7AF],
];

/** Heuristic token estimation: 4 chars/token for Latin, 1.5 for CJK. */
function estimateTokenCount(text: string): number {
	let cjkCount = 0;
	let latinCount = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		let isCjk = false;
		for (const [lo, hi] of CJK_RANGES) {
			if (code >= lo && code <= hi) { isCjk = true; break; }
		}
		if (isCjk) { cjkCount++; } else { latinCount++; }
	}
	return Math.ceil(latinCount / 4) + Math.ceil(cjkCount / 1.5);
}

function computeTotalTokens(entries: MemoryEntry[]): number {
	let total = 0;
	for (const entry of entries) { total += entry.tokenCount; }
	return total;
}

// ============================================================================
// ProjectMemoryService
// ============================================================================

export class ProjectMemoryService extends Disposable implements IProjectMemoryService {

	declare readonly _serviceBrand: undefined;

	private _currentProjectId: string | undefined;
	get currentProjectId(): string | undefined { return this._currentProjectId; }

	private _projectStates = new Map<string, ProjectMemoryState>();
	private _entries = new Map<string, MemoryEntry[]>();
	private _checkpoints = new Map<string, MemoryCheckpoint[]>();
	private _crashRecovered = false;
	private _restoredProjectId: string | undefined;

	private _autoSaveIntervalMs = DEFAULT_AUTO_SAVE_INTERVAL_MS;
	get autoSaveIntervalMs(): number { return this._autoSaveIntervalMs; }
	private _autoSaveTimer: ReturnType<typeof setInterval> | undefined;

	private readonly _onDidChangeMemory = this._register(new Emitter<string>());
	readonly onDidChangeMemory: Event<string> = this._onDidChangeMemory.event;
	private readonly _onDidRestore = this._register(new Emitter<string>());
	readonly onDidRestore: Event<string> = this._onDidRestore.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._restoreFromStorage();
		this._startAutoSave();
		this.logService.trace('[Construct ProjectMemoryService] Initialized');
	}

	// -- Project Lifecycle --

	createProject(name: string, path: string): string {
		const projectId = generateUuid();
		const now = Date.now();
		const state: ProjectMemoryState = {
			projectId, projectName: name, projectPath: path,
			createdAt: now, updatedAt: now, entries: [],
			totalTokenCount: 0, lastCheckpointId: '', version: 1,
		};
		this._projectStates.set(projectId, state);
		this._entries.set(projectId, []);
		this._checkpoints.set(projectId, []);
		this._currentProjectId = projectId;
		this._persistProjectIndex();
		this._persistProjectState(projectId);
		this.storageService.store(STORAGE_CRASH_FLAG + projectId, 'active', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this._onDidChangeMemory.fire(projectId);
		this.logService.info(`[Construct ProjectMemoryService] Created project: ${name} (${projectId})`);
		return projectId;
	}

	async loadProject(projectId: string): Promise<boolean> {
		if (!this._projectStates.has(projectId)) {
			if (!this._loadProjectFromStorage(projectId)) {
				this.logService.warn(`[Construct ProjectMemoryService] Project not found: ${projectId}`);
				return false;
			}
		}
		this._currentProjectId = projectId;
		this._onDidChangeMemory.fire(projectId);
		this.logService.info(`[Construct ProjectMemoryService] Loaded project: ${projectId}`);
		return true;
	}

	getAllProjects(): ProjectMemoryState[] {
		return Array.from(this._projectStates.values());
	}

	// -- Entry CRUD --

	store(type: MemoryType, key: string, value: string, priority: MemoryPriority = MemoryPriority.Medium, tags: string[] = []): string {
		const projectId = this._requireCurrentProject();
		const now = Date.now();
		const tokenCount = estimateTokenCount(value);
		const id = generateUuid();
		const entry: MemoryEntry = {
			id, type, projectId, key, value, priority,
			createdAt: now, updatedAt: now, accessedAt: now,
			accessCount: 0, tags, tokenCount,
		};
		const entries = this._entries.get(projectId) ?? [];
		entries.push(entry);
		this._entries.set(projectId, entries);
		this._updateProjectState(projectId);
		this._onDidChangeMemory.fire(projectId);
		this.logService.trace(`[Construct ProjectMemoryService] Stored entry: ${type}/${key} (${tokenCount} tokens)`);
		return id;
	}

	retrieve(type: MemoryType, key: string): MemoryEntry | undefined {
		const projectId = this._currentProjectId;
		if (!projectId) { return undefined; }
		const entries = this._entries.get(projectId) ?? [];
		const entry = entries.find(e => e.type === type && e.key === key);
		if (!entry) { return undefined; }
		// Update access metadata
		const now = Date.now();
		const updatedEntry: MemoryEntry = { ...entry, accessedAt: now, accessCount: entry.accessCount + 1 };
		const idx = entries.indexOf(entry);
		if (idx >= 0) { entries[idx] = updatedEntry; }
		return updatedEntry;
	}

	query(predicate: (entry: MemoryEntry) => boolean): MemoryQueryResult {
		const start = Date.now();
		const projectId = this._currentProjectId;
		const allEntries = projectId ? (this._entries.get(projectId) ?? []) : [];
		const matched = allEntries.filter(predicate);
		matched.sort((a, b) => {
			if (b.priority !== a.priority) { return b.priority - a.priority; }
			return b.accessedAt - a.accessedAt;
		});
		return {
			entries: matched,
			totalMatches: matched.length,
			queryTokens: computeTotalTokens(matched),
			retrievalLatencyMs: Date.now() - start,
		};
	}

	delete(entryId: string): boolean {
		const projectId = this._currentProjectId;
		if (!projectId) { return false; }
		const entries = this._entries.get(projectId) ?? [];
		const idx = entries.findIndex(e => e.id === entryId);
		if (idx < 0) { return false; }
		entries.splice(idx, 1);
		this._updateProjectState(projectId);
		this._onDidChangeMemory.fire(projectId);
		this.logService.trace(`[Construct ProjectMemoryService] Deleted entry: ${entryId}`);
		return true;
	}

	update(entryId: string, value: string): boolean {
		const projectId = this._currentProjectId;
		if (!projectId) { return false; }
		const entries = this._entries.get(projectId) ?? [];
		const idx = entries.findIndex(e => e.id === entryId);
		if (idx < 0) { return false; }
		const now = Date.now();
		entries[idx] = {
			...entries[idx],
			value,
			updatedAt: now,
			accessedAt: now,
			accessCount: entries[idx].accessCount + 1,
			tokenCount: estimateTokenCount(value),
		};
		this._updateProjectState(projectId);
		this._onDidChangeMemory.fire(projectId);
		return true;
	}

	// -- Checkpoints --

	createCheckpoint(type: CheckpointType, label: string, description: string = ''): MemoryCheckpoint {
		const projectId = this._requireCurrentProject();
		const state = this._projectStates.get(projectId);
		if (!state) { throw new Error('[Construct ProjectMemoryService] Project state missing.'); }
		const now = Date.now();
		const id = generateUuid();
		const snapshotEntries = (this._entries.get(projectId) ?? []).map(e => ({ ...e }));
		const checkpointState: ProjectMemoryState = {
			...state, entries: snapshotEntries,
			totalTokenCount: computeTotalTokens(snapshotEntries),
			lastCheckpointId: id, updatedAt: now,
		};
		const checkpoint: MemoryCheckpoint = {
			id, projectId, type, timestamp: now,
			state: checkpointState, label, description,
		};
		const checkpoints = this._checkpoints.get(projectId) ?? [];
		checkpoints.push(checkpoint);
		while (checkpoints.length > MAX_CHECKPOINTS_PER_PROJECT) { checkpoints.shift(); }
		this._checkpoints.set(projectId, checkpoints);
		this._projectStates.set(projectId, { ...state, lastCheckpointId: id, updatedAt: now });
		this._persistCheckpoints(projectId);
		this._persistProjectState(projectId);
		this.logService.info(`[Construct ProjectMemoryService] Checkpoint created: ${type} "${label}" (${id})`);
		return checkpoint;
	}

	async restoreCheckpoint(checkpointId: string): Promise<boolean> {
		for (const [projectId, checkpoints] of this._checkpoints) {
			const checkpoint = checkpoints.find(c => c.id === checkpointId);
			if (checkpoint) {
				this._projectStates.set(projectId, checkpoint.state);
				this._entries.set(projectId, checkpoint.state.entries.map((e: any) => ({ ...e })));
				this._currentProjectId = projectId;
				this._persistProjectState(projectId);
				this._onDidChangeMemory.fire(projectId);
				this.logService.info(`[Construct ProjectMemoryService] Restored checkpoint: ${checkpointId}`);
				return true;
			}
		}
		this.logService.warn(`[Construct ProjectMemoryService] Checkpoint not found: ${checkpointId}`);
		return false;
	}

	getCheckpoints(projectId: string): MemoryCheckpoint[] {
		return this._checkpoints.get(projectId) ?? [];
	}

	getLatestCheckpoint(projectId: string): MemoryCheckpoint | undefined {
		const cps = this._checkpoints.get(projectId) ?? [];
		return cps.length > 0 ? cps[cps.length - 1] : undefined;
	}

	// -- Crash Recovery --

	didCrashRecover(): boolean { return this._crashRecovered; }
	getRestoredProjectId(): string | undefined { return this._restoredProjectId; }

	// -- Auto-save --

	setAutoSaveInterval(ms: number): void {
		this._autoSaveIntervalMs = ms;
		this._stopAutoSave();
		this._startAutoSave();
		this.logService.trace(`[Construct ProjectMemoryService] Auto-save interval set to ${ms}ms`);
	}

	async flush(): Promise<void> {
		this._persistAll();
		this.logService.trace('[Construct ProjectMemoryService] Flushed all state to storage');
	}

	// -- Stats --

	getTotalTokenCount(): number {
		const pid = this._currentProjectId;
		return pid ? computeTotalTokens(this._entries.get(pid) ?? []) : 0;
	}

	getEntryCount(): number {
		const pid = this._currentProjectId;
		return pid ? (this._entries.get(pid) ?? []).length : 0;
	}

	getMemorySize(): number {
		let totalBytes = 0;
		for (const entries of this._entries.values()) {
			for (const entry of entries) {
				totalBytes += entry.value.length * 2 + 200; // UTF-16 + metadata overhead
			}
		}
		return totalBytes;
	}

	// -- Internal: Persistence --

	private _persistProjectIndex(): void {
		this.storageService.store(
			STORAGE_PROJECTS_INDEX,
			JSON.stringify(Array.from(this._projectStates.keys())),
			StorageScope.WORKSPACE, StorageTarget.MACHINE,
		);
	}

	private _persistProjectState(projectId: string): void {
		const state = this._projectStates.get(projectId);
		if (!state) { return; }
		const entries = this._entries.get(projectId) ?? [];
		this.storageService.store(
			STORAGE_PROJECT_PREFIX + projectId,
			JSON.stringify({ ...state, entries, totalTokenCount: computeTotalTokens(entries) }),
			StorageScope.WORKSPACE, StorageTarget.MACHINE,
		);
	}

	private _persistCheckpoints(projectId: string): void {
		this.storageService.store(
			STORAGE_CHECKPOINTS_PREFIX + projectId,
			JSON.stringify(this._checkpoints.get(projectId) ?? []),
			StorageScope.WORKSPACE, StorageTarget.MACHINE,
		);
	}

	private _persistAll(): void {
		this._persistProjectIndex();
		for (const projectId of this._projectStates.keys()) {
			this._persistProjectState(projectId);
			this._persistCheckpoints(projectId);
		}
	}

	// -- Internal: Restore from storage --

	private _restoreFromStorage(): void {
		const indexRaw = this.storageService.get(STORAGE_PROJECTS_INDEX, StorageScope.WORKSPACE, undefined);
		if (!indexRaw) { return; }
		let projectIds: string[];
		try {
			projectIds = JSON.parse(indexRaw);
			if (!Array.isArray(projectIds)) { return; }
		} catch {
			this.logService.warn('[Construct ProjectMemoryService] Corrupted project index, skipping restore.');
			return;
		}
		for (const projectId of projectIds) {
			const crashFlag = this.storageService.get(STORAGE_CRASH_FLAG + projectId, StorageScope.WORKSPACE, undefined);
			if (crashFlag === 'active') {
				this._crashRecovered = true;
				this._restoredProjectId = projectId;
				this.logService.info(`[Construct ProjectMemoryService] Crash recovery detected for project: ${projectId}`);
			}
			this._loadProjectFromStorage(projectId);
		}
		if (this._crashRecovered && this._restoredProjectId) {
			this._onDidRestore.fire(this._restoredProjectId);
		}
	}

	private _loadProjectFromStorage(projectId: string): boolean {
		const raw = this.storageService.get(STORAGE_PROJECT_PREFIX + projectId, StorageScope.WORKSPACE, undefined);
		if (!raw) { return false; }
		try {
			const data = JSON.parse(raw);
			const entries: MemoryEntry[] = Array.isArray(data.entries) ? data.entries : [];
			const state: ProjectMemoryState = {
				projectId: data.projectId, projectName: data.projectName,
				projectPath: data.projectPath, createdAt: data.createdAt,
				updatedAt: data.updatedAt, entries,
				totalTokenCount: computeTotalTokens(entries),
				lastCheckpointId: data.lastCheckpointId ?? '',
				version: data.version ?? 1,
			};
			this._projectStates.set(projectId, state);
			this._entries.set(projectId, entries);
			// Restore checkpoints
			const cpRaw = this.storageService.get(STORAGE_CHECKPOINTS_PREFIX + projectId, StorageScope.WORKSPACE, undefined);
			if (cpRaw) {
				try {
					const cps = JSON.parse(cpRaw);
					if (Array.isArray(cps)) { this._checkpoints.set(projectId, cps); }
				} catch {
					this.logService.warn(`[Construct ProjectMemoryService] Corrupted checkpoints for project: ${projectId}`);
					this._checkpoints.set(projectId, []);
				}
			} else {
				this._checkpoints.set(projectId, []);
			}
			return true;
		} catch {
			this.logService.warn(`[Construct ProjectMemoryService] Corrupted project data for: ${projectId}`);
			return false;
		}
	}

	// -- Internal helpers --

	private _requireCurrentProject(): string {
		if (!this._currentProjectId) {
			throw new Error('[Construct ProjectMemoryService] No active project. Call createProject or loadProject first.');
		}
		return this._currentProjectId;
	}

	private _updateProjectState(projectId: string): void {
		const state = this._projectStates.get(projectId);
		if (!state) { return; }
		const entries = this._entries.get(projectId) ?? [];
		this._projectStates.set(projectId, {
			...state, updatedAt: Date.now(), entries,
			totalTokenCount: computeTotalTokens(entries),
		});
	}

	private _startAutoSave(): void {
		if (this._autoSaveTimer) { return; }
		const id = setInterval(() => {
			this._persistAll();
			for (const pid of this._projectStates.keys()) {
				this.storageService.store(STORAGE_CRASH_FLAG + pid, 'saved', StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
		}, this._autoSaveIntervalMs);
		this._autoSaveTimer = id;
		this._register({ dispose: () => { clearInterval(id); } });
	}

	private _stopAutoSave(): void {
		if (this._autoSaveTimer !== undefined) {
			clearInterval(this._autoSaveTimer);
			this._autoSaveTimer = undefined;
		}
	}

	override dispose(): void {
		this._persistAll();
		for (const pid of this._projectStates.keys()) {
			this.storageService.store(STORAGE_CRASH_FLAG + pid, 'clean', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		this._stopAutoSave();
		this._projectStates.clear();
		this._entries.clear();
		this._checkpoints.clear();
		super.dispose();
	}
}

// ============================================================================
// MemoryCompactionService
// ============================================================================

export class MemoryCompactionService extends Disposable implements IMemoryCompactionService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidCompact = this._register(new Emitter<CompactionResult>());
	readonly onDidCompact: Event<CompactionResult> = this._onDidCompact.event;

	constructor(
		@IProjectMemoryService private readonly memoryService: IProjectMemoryService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.trace('[Construct MemoryCompactionService] Initialized');
	}

	async compact(projectId: string, targetTokenBudget: number): Promise<CompactionResult> {
		const start = Date.now();
		const project = this._findProject(projectId);
		if (!project) {
			this.logService.warn(`[Construct MemoryCompactionService] Project not found: ${projectId}`);
			return { entriesBefore: 0, entriesAfter: 0, tokensBefore: 0, tokensAfter: 0, strategies: [] };
		}
		const tokensBefore = project.totalTokenCount;
		const entriesBefore = project.entries.length;
		if (tokensBefore <= targetTokenBudget) {
			return { entriesBefore, entriesAfter: entriesBefore, tokensBefore, tokensAfter: tokensBefore, strategies: [] };
		}

		const strategies: CompactionAction[] = [];

		// Phase 1: Delete expired entries
		const expiredAction = this._deleteExpiredEntries(projectId);
		if (expiredAction) { strategies.push(expiredAction); }

		// Phase 2: Merge entries with same type + key
		strategies.push(...this._mergeDuplicateEntries(projectId));

		// Phase 3: Archive low-priority entries if still over budget
		if (this._getCurrentTokens(projectId) > targetTokenBudget) {
			const archiveAction = this._archiveLowPriorityEntries(projectId, targetTokenBudget);
			if (archiveAction) { strategies.push(archiveAction); }
		}

		// Phase 4: Summarize old medium-priority entries if still over budget
		if (this._getCurrentTokens(projectId) > targetTokenBudget) {
			const summarizeAction = this._summarizeOldEntries(projectId, targetTokenBudget);
			if (summarizeAction) { strategies.push(summarizeAction); }
		}

		const tokensAfter = this._getCurrentTokens(projectId);
		const entriesAfter = this._getCurrentEntryCount(projectId);
		const result: CompactionResult = { entriesBefore, entriesAfter, tokensBefore, tokensAfter, strategies };
		this._onDidCompact.fire(result);
		this.logService.info(
			`[Construct MemoryCompactionService] Compacted ${projectId}: ` +
			`${entriesBefore} -> ${entriesAfter} entries, ` +
			`${tokensBefore} -> ${tokensAfter} tokens (${Date.now() - start}ms)`
		);
		return result;
	}

	getCompactionRecommendation(projectId: string): { entriesToCompact: number; estimatedTokensSaved: number } {
		const project = this._findProject(projectId);
		if (!project) { return { entriesToCompact: 0, estimatedTokensSaved: 0 }; }
		const now = Date.now();
		let compactableCount = 0;
		let estimatedSavings = 0;
		for (const entry of project.entries) {
			if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
				compactableCount++;
				estimatedSavings += entry.tokenCount;
			} else if (entry.priority === MemoryPriority.Low || entry.priority === MemoryPriority.Archive) {
				compactableCount++;
				estimatedSavings += Math.floor(entry.tokenCount * 0.7);
			} else if (entry.priority === MemoryPriority.Medium && (now - entry.updatedAt) > 7 * 24 * 60 * 60 * 1000) {
				compactableCount++;
				estimatedSavings += Math.floor(entry.tokenCount * 0.5);
			}
		}
		return { entriesToCompact: compactableCount, estimatedTokensSaved: estimatedSavings };
	}

	isCompactionNeeded(projectId: string, tokenBudget: number): boolean {
		const project = this._findProject(projectId);
		return project ? project.totalTokenCount > tokenBudget : false;
	}

	// -- Compaction phases --

	private _deleteExpiredEntries(projectId: string): CompactionAction | undefined {
		const result = this.memoryService.query(
			(e: any) => e.projectId === projectId && e.expiresAt !== undefined && e.expiresAt! <= Date.now()
		);
		if (result.entries.length === 0) { return undefined; }
		const entryIds: string[] = [];
		let tokensSaved = 0;
		for (const entry of result.entries) {
			entryIds.push(entry.id);
			tokensSaved += entry.tokenCount;
			this.memoryService.delete(entry.id);
		}
		return { strategy: CompactionStrategy.Delete, entryIds, tokensSaved };
	}

	private _mergeDuplicateEntries(projectId: string): CompactionAction[] {
		const result = this.memoryService.query((e: any) => e.projectId === projectId);
		const actions: CompactionAction[] = [];
		// Group by type + key
		const groups = new Map<string, MemoryEntry[]>();
		for (const entry of result.entries) {
			const groupKey = `${entry.type}::${entry.key}`;
			const group = groups.get(groupKey) ?? [];
			group.push(entry);
			groups.set(groupKey, group);
		}
		for (const [, group] of groups) {
			if (group.length < 2) { continue; }
			group.sort((a, b) => b.updatedAt - a.updatedAt);
			const newest = group[0];
			const mergedIds: string[] = [];
			let tokensSaved = 0;
			const history: string[] = [];
			for (let i = 1; i < group.length; i++) {
				const older = group[i];
				history.push(older.value);
				mergedIds.push(older.id);
				tokensSaved += older.tokenCount;
				this.memoryService.delete(older.id);
			}
			const mergedValue = JSON.stringify({ merged: true, latest: newest.value, history });
			this.memoryService.update(newest.id, mergedValue);
			actions.push({
				strategy: CompactionStrategy.Merge, entryIds: mergedIds,
				resultEntryId: newest.id, tokensSaved,
			});
		}
		return actions;
	}

	private _archiveLowPriorityEntries(projectId: string, targetBudget: number): CompactionAction | undefined {
		const result = this.memoryService.query(
			e => e.projectId === projectId && (e.priority === MemoryPriority.Low || e.priority === MemoryPriority.Archive)
		);
		if (result.entries.length === 0) { return undefined; }
		const entryIds: string[] = [];
		let tokensSaved = 0;
		for (const entry of result.entries) {
			entryIds.push(entry.id);
			tokensSaved += entry.tokenCount;
			this.memoryService.delete(entry.id);
			if (this._getCurrentTokens(projectId) <= targetBudget) { break; }
		}
		if (entryIds.length === 0) { return undefined; }
		const archiveId = this.memoryService.store(
			MemoryType.Checkpoint, 'compaction-archive',
			JSON.stringify({ archivedEntryCount: entryIds.length, archivedAt: Date.now() }),
			MemoryPriority.Archive, ['compaction', 'archive'],
		);
		return { strategy: CompactionStrategy.Archive, entryIds, resultEntryId: archiveId, tokensSaved };
	}

	private _summarizeOldEntries(projectId: string, targetBudget: number): CompactionAction | undefined {
		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		const result = this.memoryService.query(
			e => e.projectId === projectId && e.priority === MemoryPriority.Medium && e.updatedAt < sevenDaysAgo
		);
		if (result.entries.length === 0) { return undefined; }
		const entryIds: string[] = [];
		let tokensSaved = 0;
		const summaries: { type: string; key: string; snippet: string }[] = [];
		for (const entry of result.entries) {
			entryIds.push(entry.id);
			tokensSaved += entry.tokenCount;
			summaries.push({
				type: entry.type, key: entry.key,
				snippet: entry.value.length > 100 ? entry.value.substring(0, 100) + '...' : entry.value,
			});
			this.memoryService.delete(entry.id);
			if (this._getCurrentTokens(projectId) <= targetBudget) { break; }
		}
		if (entryIds.length === 0) { return undefined; }
		const summaryId = this.memoryService.store(
			MemoryType.Checkpoint, 'compaction-summary',
			JSON.stringify({ summaryCount: summaries.length, summaries, summarizedAt: Date.now() }),
			MemoryPriority.Low, ['compaction', 'summary'],
		);
		return { strategy: CompactionStrategy.Summarize, entryIds, resultEntryId: summaryId, tokensSaved };
	}

	// -- Helpers --

	private _findProject(projectId: string): ProjectMemoryState | undefined {
		return this.memoryService.getAllProjects().find((p: any) => p.projectId === projectId);
	}

	private _getCurrentTokens(projectId: string): number {
		return this._findProject(projectId)?.totalTokenCount ?? 0;
	}

	private _getCurrentEntryCount(projectId: string): number {
		return this._findProject(projectId)?.entries.length ?? 0;
	}
}

// ============================================================================
// ExecutionTimelineService
// ============================================================================

export class ExecutionTimelineService extends Disposable implements IExecutionTimelineService {

	declare readonly _serviceBrand: undefined;

	private _timelines = new Map<string, TimelineEntry[]>();

	private readonly _onDidAddEntry = this._register(new Emitter<TimelineEntry>());
	readonly onDidAddEntry: Event<TimelineEntry> = this._onDidAddEntry.event;
	private readonly _onDidClear = this._register(new Emitter<string>());
	readonly onDidClear: Event<string> = this._onDidClear.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._restoreTimelines();
		this.logService.trace('[Construct ExecutionTimelineService] Initialized');
	}

	addEntry(entry: Omit<TimelineEntry, 'id' | 'timestamp'>): TimelineEntry {
		const now = Date.now();
		const id = generateUuid();
		const fullEntry: TimelineEntry = { ...entry, id, timestamp: now };
		const projectId = entry.projectId;
		const timeline = this._timelines.get(projectId) ?? [];
		timeline.push(fullEntry);
		while (timeline.length > MAX_TIMELINE_ENTRIES_PER_PROJECT) { timeline.shift(); }
		this._timelines.set(projectId, timeline);
		this._persistTimeline(projectId);
		this._onDidAddEntry.fire(fullEntry);
		this.logService.trace(`[Construct ExecutionTimelineService] Added entry: ${entry.eventType} for ${projectId}`);
		return fullEntry;
	}

	getEntries(projectId: string, from?: number, to?: number): TimelineEntry[] {
		let entries = (this._timelines.get(projectId) ?? []).slice();
		if (from !== undefined) { entries = entries.filter(e => e.timestamp >= from); }
		if (to !== undefined) { entries = entries.filter(e => e.timestamp <= to); }
		return entries.sort((a, b) => a.timestamp - b.timestamp);
	}

	getRecentEntries(projectId: string, count: number): TimelineEntry[] {
		const timeline = this._timelines.get(projectId) ?? [];
		return timeline.slice(Math.max(0, timeline.length - count));
	}

	clearEntries(projectId: string): void {
		this._timelines.set(projectId, []);
		this.storageService.remove(STORAGE_TIMELINE_PREFIX + projectId, StorageScope.WORKSPACE);
		this._onDidClear.fire(projectId);
		this.logService.info(`[Construct ExecutionTimelineService] Cleared timeline for project: ${projectId}`);
	}

	getEntryCount(projectId: string): number {
		return (this._timelines.get(projectId) ?? []).length;
	}

	// -- Internal --

	private _persistTimeline(projectId: string): void {
		this.storageService.store(
			STORAGE_TIMELINE_PREFIX + projectId,
			JSON.stringify(this._timelines.get(projectId) ?? []),
			StorageScope.WORKSPACE, StorageTarget.MACHINE,
		);
	}

	private _restoreTimelines(): void {
		const indexRaw = this.storageService.get(STORAGE_PROJECTS_INDEX, StorageScope.WORKSPACE, undefined);
		if (!indexRaw) { return; }
		let projectIds: string[];
		try {
			projectIds = JSON.parse(indexRaw);
			if (!Array.isArray(projectIds)) { return; }
		} catch { return; }
		for (const projectId of projectIds) {
			const raw = this.storageService.get(STORAGE_TIMELINE_PREFIX + projectId, StorageScope.WORKSPACE, undefined);
			if (!raw) { continue; }
			try {
				const entries = JSON.parse(raw);
				if (Array.isArray(entries)) { this._timelines.set(projectId, entries); }
			} catch {
				this.logService.warn(`[Construct ExecutionTimelineService] Corrupted timeline for project: ${projectId}`);
			}
		}
	}

	override dispose(): void {
		for (const projectId of this._timelines.keys()) { this._persistTimeline(projectId); }
		this._timelines.clear();
		super.dispose();
	}
}
