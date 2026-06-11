// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../base/common/path.js';
import { IFileWatcherService, IFileChangeEvent, IFileChangeBatch, IFileWatcherConfig, FileChangeType } from '../common/watcher/fileWatcherService.js';
import { ILogService } from '../../log/common/log.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { watch } from 'fs';
import { join } from '../../../base/common/path.js';

/**
 * Default file watcher configuration.
 */
const DEFAULT_CONFIG: IFileWatcherConfig = {
	debounceMs: 300,
	animateAppearance: true,
	animationDurationMs: 200,
	ignorePatterns: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.construct/**'],
};

/**
 * Directories to exclude from recursive watching.
 */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.construct']);

/**
 * Check if a file path should be excluded from watching.
 */
function isExcluded(filePath: string): boolean {
	const segments = filePath.split(/[/\\]/);
	return segments.some(seg => EXCLUDED_DIRS.has(seg));
}

/**
 * Node-layer file watcher service using fs.watch.
 * Provides reliable filesystem event streaming with debounce.
 */
export class FileWatcherNodeService extends Disposable implements IFileWatcherService {
	declare readonly _serviceBrand: undefined;

	private _isWatching = false;
	private readonly _watchers = new Map<string, { close(): void }>();
	private _config: IFileWatcherConfig = { ...DEFAULT_CONFIG };

	// Debounce state
	private _pendingChanges: IFileChangeEvent[] = [];
	private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private _coalescedCount = 0;

	private readonly _onDidChangeFiles = this._register(new Emitter<IFileChangeBatch>());
	readonly onDidChangeFiles = this._onDidChangeFiles.event;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.logService.info('[FileWatcherNode] Service created');
	}

	get isWatching(): boolean { return this._isWatching; }

	get config(): IFileWatcherConfig { return this._config; }

	updateConfig(config: Partial<IFileWatcherConfig>): void {
		this._config = { ...this._config, ...config };
		this.logService.info(`[FileWatcherNode] Config updated: debounceMs=${this._config.debounceMs}`);
	}

	startWatching(workspaceRoot: URI): void {
		if (this._isWatching) { return; }
		this._isWatching = true;
		this.logService.info(`[FileWatcherNode] Started watching: ${workspaceRoot.fsPath}`);

		try {
			// Use fs.watch with recursive: true for efficient directory watching
			const watcher = fs.watch(
				workspaceRoot.fsPath,
				{ recursive: true },
				(eventType: string, filename: string | null) => {
					if (!filename) { return; }

					// Skip excluded directories
					if (isExcluded(filename)) { return; }

					// Build the full URI for the changed file
					const fullPath = path.join(workspaceRoot.fsPath, filename);
					const fileUri = URI.file(fullPath);

					// Map fs.watch event types to our FileChangeType
					// 'rename' covers both creation and deletion; 'change' is modification
					if (eventType === 'rename') {
						// Determine if file was created or deleted by checking existence
						fs.access(fullPath, fs.constants.F_OK, (err) => {
							if (err) {
								// File doesn't exist → deleted
								this.notifyAgentFileDeleted(fileUri);
							} else {
								// File exists → created (could also be a rename-to)
								this.notifyAgentFileCreated(fileUri);
							}
						});
					} else if (eventType === 'change') {
						this.notifyAgentFileModified(fileUri);
					}
				}
			);

			// Handle watcher errors
			watcher.on('error', (err) => {
				this.logService.error(`[FileWatcherNode] Watcher error: ${err instanceof Error ? err.message : String(err)}`);
			});

			// Store the watcher so it can be closed later
			this._watchers.set(workspaceRoot.fsPath, watcher);

			this.logService.info(`[FileWatcherNode] fs.watch recursive active on ${workspaceRoot.fsPath}`);
		} catch (err) {
			this.logService.error(`[FileWatcherNode] Failed to start fs.watch: ${err instanceof Error ? err.message : String(err)}`);
			this._isWatching = false;
		}
	}

	stopWatching(): void {
		for (const [, watcher] of this._watchers) {
			try { watcher.close(); } catch { /* ignore */ }
		}
		this._watchers.clear();
		this._isWatching = false;
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = null;
		}
		this._pendingChanges = [];
		this.logService.info('[FileWatcherNode] Stopped watching');
	}

	notifyAgentFileCreated(uri: URI): void {
		this._addChange(uri, 'created');
	}

	notifyAgentFileModified(uri: URI): void {
		this._addChange(uri, 'modified');
	}

	notifyAgentFileDeleted(uri: URI): void {
		this._addChange(uri, 'deleted');
	}

	private _addChange(uri: URI, type: FileChangeType): void {
		this._pendingChanges.push({ uri, type, timestamp: Date.now() });
		this._coalescedCount++;

		// Debounce: reset timer
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}
		this._debounceTimer = setTimeout(() => {
			this._flushChanges();
		}, this._config.debounceMs);
	}

	private _flushChanges(): void {
		if (this._pendingChanges.length === 0) { return; }

		const batch: IFileChangeBatch = {
			changes: [...this._pendingChanges],
			timestamp: Date.now(),
			coalescedCount: this._coalescedCount,
		};

		this._pendingChanges = [];
		this._coalescedCount = 0;
		this._debounceTimer = null;

		this._onDidChangeFiles.fire(batch);
	}

	override dispose(): void {
		this.stopWatching();
		super.dispose();
	}
}
