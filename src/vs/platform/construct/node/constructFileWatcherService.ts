// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileWatcherService, IFileChangeEvent, IFileChangeBatch, IFileWatcherConfig, FileChangeType } from '../common/watcher/fileWatcherService.js';
import { ILogService } from '../../log/common/log.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';

/**
 * Default file watcher configuration.
 */
const DEFAULT_CONFIG: IFileWatcherConfig = {
        debounceMs: 100,
        animateAppearance: true,
        animationDurationMs: 200,
        ignorePatterns: ['**/node_modules/**', '**/.git/**', '**/.construct/**'],
};

/**
 * Node-layer file watcher service using fs.watch.
 * Provides reliable filesystem event streaming with debounce.
 * P2: This is a future-facing implementation. Browser-side FileWatcherService
 * currently uses VS Code's built-in file watcher.
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
                // Full implementation would use fs.watch with debouncing
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
