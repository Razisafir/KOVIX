// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const ISnapshotManager = createDecorator<ISnapshotManager>('construct.snapshotManager');

/**
 * The strategy used for creating the snapshot.
 */
export type SnapshotStrategy = 'git' | 'file';

/**
 * Status of a snapshot.
 */
export type SnapshotStatus = 'active' | 'restored' | 'expired';

/**
 * A snapshot of the workspace state before an agent task runs.
 * Used for task-level undo: one click reverts all changes made during a task.
 */
export interface ITaskSnapshot {
	/** Unique identifier for this snapshot. */
	id: string;
	/** The strategy used to create this snapshot. */
	strategy: SnapshotStrategy;
	/** Timestamp when the snapshot was created. */
	createdAt: number;
	/** The task description that triggered this snapshot. */
	taskDescription: string;
	/** Status of the snapshot. */
	status: SnapshotStatus;
	/** The workspace path that was snapshotted. */
	workspacePath: string;
	/** For git strategy: the stash reference. */
	gitStashRef?: string;
	/** For file strategy: list of files that existed before the task. */
	existingFiles?: string[];
	/** List of files created by the agent (to be deleted on undo). */
	createdFiles: string[];
	/** List of files modified by the agent (to be restored on undo). */
	modifiedFiles: string[];
	/** List of files deleted by the agent (to be restored on undo). */
	deletedFiles: string[];
}

/**
 * Result of a snapshot restore operation.
 */
export interface IRestoreResult {
	/** Whether the restore was successful. */
	success: boolean;
	/** Number of files restored (modified files written back). */
	restoredCount: number;
	/** Number of files deleted (agent-created files removed). */
	deletedCount: number;
	/** Time taken for the restore in milliseconds. */
	durationMs: number;
	/** Error message if the restore failed. */
	error?: string;
}

/**
 * Configuration for the snapshot manager.
 */
export interface ISnapshotConfig {
	/** Maximum number of snapshots to keep. Older snapshots are pruned. Default: 50. */
	maxSnapshots: number;
	/** Whether to automatically create a snapshot before each agent task. Default: true. */
	autoSnapshot: boolean;
	/** Time in seconds after which expired snapshots are cleaned up. Default: 86400 (24h). */
	expirySeconds: number;
}

/**
 * Service for creating and restoring workspace snapshots for task-level undo.
 *
 * Two strategies:
 * 1. **Git strategy**: For git repos, uses `git stash push` to create a snapshot.
 *    On undo, restores the stash. This is fast and handles all file types.
 *
 * 2. **File strategy**: For non-git workspaces, creates a manifest of file contents.
 *    On undo, restores modified files, deletes created files, recreates deleted files.
 *
 * Target: Full revert of a 20-file agent task completes in < 2 seconds.
 */
export interface ISnapshotManager {
	readonly _serviceBrand: undefined;

	/**
	 * Create a snapshot of the current workspace state before an agent task.
	 *
	 * Automatically selects the best strategy:
	 * - If workspace is a git repo → git strategy (stash)
	 * - Otherwise → file strategy (manifest of file contents)
	 *
	 * @param workspacePath The workspace root path.
	 * @param taskDescription Description of the task about to run.
	 * @returns The created snapshot.
	 */
	createSnapshot(workspacePath: string, taskDescription: string): Promise<ITaskSnapshot>;

	/**
	 * Restore a snapshot, reverting all changes made since the snapshot was created.
	 *
	 * This:
	 * - Restores all modified files to their pre-task state
	 * - Deletes all files created by the agent
	 * - Recreates all files deleted by the agent
	 * - Refreshes the file explorer
	 *
	 * @param snapshotId The ID of the snapshot to restore.
	 * @returns Result of the restore operation.
	 */
	restoreSnapshot(snapshotId: string): Promise<IRestoreResult>;

	/**
	 * Get a snapshot by ID.
	 *
	 * @param snapshotId The snapshot ID.
	 */
	getSnapshot(snapshotId: string): ITaskSnapshot | undefined;

	/**
	 * Get all snapshots, ordered by creation time (newest first).
	 */
	getAllSnapshots(): ITaskSnapshot[];

	/**
	 * Delete a snapshot (does NOT restore it, just removes the record).
	 *
	 * @param snapshotId The snapshot ID to delete.
	 */
	deleteSnapshot(snapshotId: string): Promise<void>;

	/**
	 * Track that a file was created by the agent during a task.
	 * Called by the agent loop when write_file creates a new file.
	 *
	 * @param snapshotId The active snapshot ID.
	 * @param filePath The file that was created.
	 */
	trackFileCreated(snapshotId: string, filePath: string): void;

	/**
	 * Track that a file was modified by the agent during a task.
	 *
	 * @param snapshotId The active snapshot ID.
	 * @param filePath The file that was modified.
	 */
	trackFileModified(snapshotId: string, filePath: string): void;

	/**
	 * Track that a file was deleted by the agent during a task.
	 *
	 * @param snapshotId The active snapshot ID.
	 * @param filePath The file that was deleted.
	 */
	trackFileDeleted(snapshotId: string, filePath: string): void;

	/**
	 * Get the current snapshot configuration.
	 */
	readonly config: ISnapshotConfig;

	/**
	 * Update the snapshot configuration.
	 */
	updateConfig(config: Partial<ISnapshotConfig>): void;

	/**
	 * Event fired when a snapshot is created.
	 */
	readonly onDidCreateSnapshot: Event<ITaskSnapshot>;

	/**
	 * Event fired when a snapshot is restored.
	 */
	readonly onDidRestoreSnapshot: Event<IRestoreResult>;

	/**
	 * Event fired when a snapshot is deleted.
	 */
	readonly onDidDeleteSnapshot: Event<string>;
}
