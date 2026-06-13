// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';

export const IFileWatcherService = createDecorator<IFileWatcherService>('construct.fileWatcher');

/**
 * The type of file system change detected.
 */
export type FileChangeType = 'created' | 'modified' | 'deleted';

/**
 * A file system change event from the watcher.
 */
export interface IFileChangeEvent {
	/** The URI of the changed file. */
	uri: URI;
	/** The type of change. */
	type: FileChangeType;
	/** Timestamp of the change detection. */
	timestamp: number;
}

/**
 * A batch of file changes, debounced and aggregated.
 */
export interface IFileChangeBatch {
	/** The changes in this batch. */
	changes: IFileChangeEvent[];
	/** Timestamp of the batch (time of the last change in the batch). */
	timestamp: number;
	/** Number of individual events that were coalesced into this batch. */
	coalescedCount: number;
}

/**
 * Configuration for the file watcher.
 */
export interface IFileWatcherConfig {
	/** Debounce interval in ms. Multiple changes within this window are batched. Default: 100. */
	debounceMs: number;
	/** Whether to animate file appearance in the tree. Default: true. */
	animateAppearance: boolean;
	/** Animation duration in ms. Default: 200. */
	animationDurationMs: number;
	/** File patterns to ignore (glob patterns). */
	ignorePatterns: string[];
}

/**
 * Service for watching file system changes in the workspace and
 * triggering real-time UI updates in the file explorer.
 *
 * Features:
 * - chokidar-based watching on workspace root
 * - Debounced tree refresh (default 100ms) to handle batch changes
 * - Animated file appearance (slide-in from left, 200ms)
 * - Cross-platform: Windows (NTFS), macOS (FSEvents), Linux (inotify)
 *
 * When the agent writes files, this watcher detects the changes and
 * triggers a refresh of the file explorer panel within 200ms.
 */
export interface IFileWatcherService {
	readonly _serviceBrand: undefined;

	/**
	 * Start watching a workspace folder for file changes.
	 *
	 * @param workspaceRoot The URI of the workspace root to watch.
	 */
	startWatching(workspaceRoot: URI): void;

	/**
	 * Stop watching and clean up all watchers.
	 */
	stopWatching(): void;

	/**
	 * Whether the watcher is currently active.
	 */
	readonly isWatching: boolean;

	/**
	 * Event fired when a batch of file changes is detected.
	 * Changes are debounced and coalesced for efficient processing.
	 *
	 * For example, if the agent creates 10 files, only one batch
	 * event is fired after the debounce window, containing all 10 changes.
	 */
	readonly onDidChangeFiles: Event<IFileChangeBatch>;

	/**
	 * Manually notify the watcher that a file was created by the agent.
	 * This is used for optimistic updates -- the file tree can show the
	 * file immediately before the filesystem watcher detects it.
	 *
	 * @param uri The URI of the file that was created.
	 */
	notifyAgentFileCreated(uri: URI): void;

	/**
	 * Manually notify the watcher that a file was modified by the agent.
	 *
	 * @param uri The URI of the file that was modified.
	 */
	notifyAgentFileModified(uri: URI): void;

	/**
	 * Manually notify the watcher that a file was deleted by the agent.
	 *
	 * @param uri The URI of the file that was deleted.
	 */
	notifyAgentFileDeleted(uri: URI): void;

	/**
	 * Get the current watcher configuration.
	 */
	readonly config: IFileWatcherConfig;

	/**
	 * Update the watcher configuration.
	 * Changes take effect on the next startWatching() call.
	 */
	updateConfig(config: Partial<IFileWatcherConfig>): void;
}
