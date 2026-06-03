/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * projectMemory.ts -- Phase 4: Persistent Project Memory System
 * Construct IDE -- AI-Native IDE
 *
 * REAL project memory that survives crashes and restarts.
 * No infinite memory claims. No AGI-like understanding claims.
 * This is structured, disk-persisted, crash-safe project context.
 *
 * Service #145: IProjectMemoryService
 * Service #146: IMemoryCompactionService
 * Service #147: IExecutionTimelineService
 */

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

// -- Service Identifiers --

export const IProjectMemoryService = createDecorator<IProjectMemoryService>('construct.projectMemoryService');
export const IMemoryCompactionService = createDecorator<IMemoryCompactionService>('construct.memoryCompactionService');
export const IExecutionTimelineService = createDecorator<IExecutionTimelineService>('construct.executionTimelineService');

// -- Enumerations --

/**
 * Types of memory entries. Each type serves a specific purpose.
 */
export enum MemoryType {
	ProjectSummary = 'project-summary',
	ArchitectureDecision = 'architecture-decision',
	MilestoneHistory = 'milestone-history',
	ExecutionHistory = 'execution-history',
	FileChangeHistory = 'file-change-history',
	UserPreference = 'user-preference',
	CorrectionMemory = 'correction-memory',
	PlanningMemory = 'planning-memory',
	RepositoryUnderstanding = 'repository-understanding',
	FailureHistory = 'failure-history',
	RetryHistory = 'retry-history',
	Checkpoint = 'checkpoint',
}

/**
 * Priority levels for memory retrieval ranking.
 */
export enum MemoryPriority {
	Critical = 100,   // Must always be loaded (project summary, architecture)
	High = 75,        // Important context (recent decisions, milestones)
	Medium = 50,      // Useful context (execution history, preferences)
	Low = 25,         // Background context (old file changes, retries)
	Archive = 10,     // Compressed historical data
}

/**
 * Compaction strategy for managing memory size.
 */
export enum CompactionStrategy {
	Summarize = 'summarize',           // Replace many entries with a summary
	Merge = 'merge',                   // Merge related entries into one
	Archive = 'archive',               // Move to archive (low priority)
	Delete = 'delete',                 // Remove expired entries
}

/**
 * Checkpoint types for crash recovery.
 */
export enum CheckpointType {
	PreExecution = 'pre-execution',
	PostMilestone = 'post-milestone',
	PreRiskyOperation = 'pre-risky',
	ManualSave = 'manual-save',
	AutoSave = 'auto-save',
	PreRollback = 'pre-rollback',
}

// -- Data Types --

/**
 * A single memory entry with metadata for retrieval ranking.
 */
export interface MemoryEntry {
	readonly id: string;
	readonly type: MemoryType;
	readonly projectId: string;
	readonly key: string;
	readonly value: string;              // JSON string of the actual data
	readonly priority: MemoryPriority;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly accessedAt: number;
	readonly accessCount: number;
	readonly tags: string[];
	readonly expiresAt?: number;         // Optional TTL
	readonly sourceProviderId?: string;  // Which LLM provider generated this
	readonly tokenCount: number;         // Estimated tokens this entry consumes
}

/**
 * Complete project memory state.
 */
export interface ProjectMemoryState {
	readonly projectId: string;
	readonly projectName: string;
	readonly projectPath: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly entries: MemoryEntry[];
	readonly totalTokenCount: number;
	readonly lastCheckpointId: string;
	readonly version: number;
}

/**
 * A checkpoint for crash recovery.
 */
export interface MemoryCheckpoint {
	readonly id: string;
	readonly projectId: string;
	readonly type: CheckpointType;
	readonly timestamp: number;
	readonly state: ProjectMemoryState;
	readonly label: string;
	readonly description: string;
}

/**
 * Result of a memory query.
 */
export interface MemoryQueryResult {
	readonly entries: MemoryEntry[];
	readonly totalMatches: number;
	readonly queryTokens: number;
	readonly retrievalLatencyMs: number;
}

/**
 * Compaction result showing what was done.
 */
export interface CompactionResult {
	readonly entriesBefore: number;
	readonly entriesAfter: number;
	readonly tokensBefore: number;
	readonly tokensAfter: number;
	readonly strategies: CompactionAction[];
}

/**
 * A single compaction action taken.
 */
export interface CompactionAction {
	readonly strategy: CompactionStrategy;
	readonly entryIds: string[];
	readonly resultEntryId?: string;
	readonly tokensSaved: number;
}

/**
 * An entry on the execution timeline.
 */
export interface TimelineEntry {
	readonly id: string;
	readonly projectId: string;
	readonly timestamp: number;
	readonly eventType: string;
	readonly description: string;
	readonly metadata: Record<string, unknown>;
	readonly success: boolean;
	readonly durationMs: number;
	readonly parentId?: string;  // For nesting
}

// -- Service Interfaces --

/**
 * IProjectMemoryService -- Persistent project memory with crash recovery.
 *
 * REAL responsibilities:
 *   - Store and retrieve project context entries
 *   - Persist to disk (VS Code storage) on every write
 *   - Restore full state on startup
 *   - Create checkpoints for crash recovery
 *   - Restore from checkpoint after crash
 *   - Query memory with priority ranking
 *   - Track access patterns for relevance scoring
 *
 * HONEST limitations:
 *   - Not infinite memory; entries are bounded by storage quotas
 *   - Not AGI understanding; this is structured key-value storage
 *   - Perfect recall is not guaranteed; compaction may summarize
 *   - Crash recovery depends on VS Code storage reliability
 */
export interface IProjectMemoryService {
	readonly _serviceBrand: undefined;

	// State
	readonly currentProjectId: string | undefined;
	readonly onDidChangeMemory: Event<string>;  // projectId
	readonly onDidRestore: Event<string>;       // projectId

	// Project lifecycle
	createProject(name: string, path: string): string;  // returns projectId
	loadProject(projectId: string): Promise<boolean>;
	getAllProjects(): ProjectMemoryState[];

	// Entry CRUD
	store(type: MemoryType, key: string, value: string, priority?: MemoryPriority, tags?: string[]): string;
	retrieve(type: MemoryType, key: string): MemoryEntry | undefined;
	query(predicate: (entry: MemoryEntry) => boolean): MemoryQueryResult;
	delete(entryId: string): boolean;
	update(entryId: string, value: string): boolean;

	// Checkpoints
	createCheckpoint(type: CheckpointType, label: string, description?: string): MemoryCheckpoint;
	restoreCheckpoint(checkpointId: string): Promise<boolean>;
	getCheckpoints(projectId: string): MemoryCheckpoint[];
	getLatestCheckpoint(projectId: string): MemoryCheckpoint | undefined;

	// Crash recovery
	didCrashRecover(): boolean;
	getRestoredProjectId(): string | undefined;

	// Auto-save
	readonly autoSaveIntervalMs: number;
	setAutoSaveInterval(ms: number): void;
	flush(): Promise<void>;  // Force immediate write to disk

	// Stats
	getTotalTokenCount(): number;
	getEntryCount(): number;
	getMemorySize(): number;  // bytes
}

/**
 * IMemoryCompactionService -- Keep memory bounded and relevant.
 *
 * REAL responsibilities:
 *   - Summarize old entries when token budget exceeded
 *   - Merge related entries
 *   - Archive low-priority entries
 *   - Delete expired entries
 *   - Report compaction results
 *
 * HONEST: This is rule-based compaction, not AGI summarization.
 * Summaries are generated by LLM when available, otherwise entries are merged mechanically.
 */
export interface IMemoryCompactionService {
	readonly _serviceBrand: undefined;

	readonly onDidCompact: Event<CompactionResult>;

	compact(projectId: string, targetTokenBudget: number): Promise<CompactionResult>;
	getCompactionRecommendation(projectId: string): { entriesToCompact: number; estimatedTokensSaved: number };
	isCompactionNeeded(projectId: string, tokenBudget: number): boolean;
}

/**
 * IExecutionTimelineService -- Ordered record of all execution events.
 *
 * REAL responsibilities:
 *   - Record every execution event with timestamp
 *   - Query timeline by time range, type, or project
 *   - Support timeline replay for debugging
 *   - Persist timeline to storage
 *
 * HONEST: This is a simple append-only log, not a time-travel debugger.
 */
export interface IExecutionTimelineService {
	readonly _serviceBrand: undefined;

	readonly onDidAddEntry: Event<TimelineEntry>;
	readonly onDidClear: Event<string>;  // projectId

	addEntry(entry: Omit<TimelineEntry, 'id' | 'timestamp'>): TimelineEntry;
	getEntries(projectId: string, from?: number, to?: number): TimelineEntry[];
	getRecentEntries(projectId: string, count: number): TimelineEntry[];
	clearEntries(projectId: string): void;
	getEntryCount(projectId: string): number;
}
