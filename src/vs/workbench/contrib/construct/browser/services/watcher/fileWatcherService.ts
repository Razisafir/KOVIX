/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IFileWatcherService, IFileChangeEvent, IFileChangeBatch, IFileWatcherConfig } from '../../../../../../platform/construct/common/watcher/fileWatcherService.js';
import { IFileService, IFileSystemWatcher } from '../../../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import * as glob from '../../../../../../base/common/glob.js';

/**
 * Default configuration for the file watcher.
 */
const DEFAULT_CONFIG: IFileWatcherConfig = {
        debounceMs: 100,
        animateAppearance: true,
        animationDurationMs: 200,
        ignorePatterns: []
};

/**
 * Command ID for refreshing the file explorer.
 */
const REFRESH_EXPLORER_COMMAND = 'workbench.files.action.refreshFilesExplorer';

/**
 * Service for watching file system changes in the workspace and
 * triggering real-time UI updates in the file explorer.
 *
 * Since this runs in VS Code's browser extension host, we CANNOT use
 * chokidar directly. Instead, we use VS Code's built-in IFileService
 * watcher API which provides cross-platform file watching (NTFS,
 * FSEvents, inotify under the hood).
 *
 * Features:
 * - VS Code IFileService-based watching on workspace root
 * - Debounced tree refresh (default 100ms) to handle batch changes
 * - Animated file appearance (controlled by config, rendered in view layer)
 * - Optimistic agent notifications for sub-200ms feedback
 * - Cross-platform: Windows (NTFS), macOS (FSEvents), Linux (inotify)
 */
export class FileWatcherService extends Disposable implements IFileWatcherService {
        declare readonly _serviceBrand: undefined;

        // --- State -------------------------------------------------------------------

        private _isWatching: boolean = false;
        private watcher: IFileSystemWatcher | IDisposable | null = null;
        private watcherEventListener: IDisposable | null = null;
        private workspaceRoot: URI | null = null;

        // --- Debounce & batching -----------------------------------------------------

        private pendingChanges: IFileChangeEvent[] = [];
        private debounceTimer: ReturnType<typeof setTimeout> | null = null;
        private rawEventCount: number = 0;

        // --- Config ------------------------------------------------------------------

        private _config: IFileWatcherConfig;

        // --- Parsed ignore patterns --------------------------------------------------

        private parsedIgnorePatterns: glob.ParsedPattern[] = [];

        // --- Events ------------------------------------------------------------------

        private readonly _onDidChangeFiles = this._register(new Emitter<IFileChangeBatch>());
        readonly onDidChangeFiles: Event<IFileChangeBatch> = this._onDidChangeFiles.event;

        // ---------------------------------------------------------------------------

        constructor(
                @IFileService private readonly fileService: IFileService,
                @ICommandService private readonly commandService: ICommandService,
                @ILogService private readonly logService: ILogService
        ) {
                super();
                this._config = { ...DEFAULT_CONFIG };
                this.recompileIgnorePatterns();
        }

        // --- Public API -------------------------------------------------------------

        get isWatching(): boolean {
                return this._isWatching;
        }

        get config(): IFileWatcherConfig {
                return { ...this._config };
        }

        /**
         * Start watching a workspace folder for file changes.
         * Uses VS Code's IFileService.createWatcher() which internally
         * uses chokidar on desktop and provides cross-platform watching
         * (Windows NTFS, macOS FSEvents, Linux inotify).
         */
        startWatching(workspaceRoot: URI): void {
                if (this._isWatching) {
                        this.logService.warn('[FileWatcher] Already watching, stopping previous watcher before restarting.');
                        this.stopWatching();
                }

                this.workspaceRoot = workspaceRoot;
                this.logService.info(`[FileWatcher] Starting watch on: ${workspaceRoot.toString()}`);

                try {
                        // Use createWatcher for correlated events — events are delivered
                        // on the returned IFileSystemWatcher.onDidChange, keeping them
                        // isolated from the global onDidFilesChange channel.
                        this.watcher = this.fileService.createWatcher(workspaceRoot, {
                                recursive: true,
                                excludes: this._config.ignorePatterns
                        });

                        // Subscribe to the watcher's change events.
                        if (this.watcher && 'onDidChange' in this.watcher) {
                                this.watcherEventListener = (this.watcher as IFileSystemWatcher).onDidChange((event) => {
                                        this.handleVSCodeFileChanges(event);
                                });
                        }

                        this._isWatching = true;
                        this.logService.info('[FileWatcher] Watcher started successfully.');
                } catch (error) {
                        this.logService.error('[FileWatcher] Failed to start watcher:', error);
                        this.cleanupWatcher();
                }
        }

        /**
         * Stop watching and clean up all watchers, timers, and state.
         */
        stopWatching(): void {
                if (!this._isWatching) {
                        return;
                }

                this.logService.info('[FileWatcher] Stopping watcher.');
                this.cleanupWatcher();
                this.flushPendingChanges();
                this._isWatching = false;
                this.workspaceRoot = null;
                this.logService.info('[FileWatcher] Watcher stopped.');
        }

        /**
         * Optimistic notification that the agent created a file.
         * Fires an event immediately so the UI can show the file
         * before the filesystem watcher detects it (sub-200ms feedback).
         */
        notifyAgentFileCreated(uri: URI): void {
                this.logService.trace(`[FileWatcher] Agent file created: ${uri.toString()}`);
                this.addChange({
                        uri,
                        type: 'created',
                        timestamp: Date.now()
                });
                this.scheduleDebounce();
        }

        /**
         * Optimistic notification that the agent modified a file.
         */
        notifyAgentFileModified(uri: URI): void {
                this.logService.trace(`[FileWatcher] Agent file modified: ${uri.toString()}`);
                this.addChange({
                        uri,
                        type: 'modified',
                        timestamp: Date.now()
                });
                this.scheduleDebounce();
        }

        /**
         * Optimistic notification that the agent deleted a file.
         */
        notifyAgentFileDeleted(uri: URI): void {
                this.logService.trace(`[FileWatcher] Agent file deleted: ${uri.toString()}`);
                this.addChange({
                        uri,
                        type: 'deleted',
                        timestamp: Date.now()
                });
                this.scheduleDebounce();
        }

        /**
         * Update the watcher configuration.
         * Changes to debounceMs, animateAppearance, and animationDurationMs
         * take effect immediately. Changes to ignorePatterns take effect on
         * the next startWatching() call (requires restarting the watcher).
         */
        updateConfig(partial: Partial<IFileWatcherConfig>): void {
                const needsRestart = partial.ignorePatterns !== undefined &&
                        JSON.stringify(partial.ignorePatterns) !== JSON.stringify(this._config.ignorePatterns);

                this._config = {
                        ...this._config,
                        ...partial
                };

                this.logService.info(`[FileWatcher] Config updated: ${JSON.stringify(partial)}`);

                if (needsRestart) {
                        this.recompileIgnorePatterns();
                        if (this._isWatching && this.workspaceRoot) {
                                this.logService.info('[FileWatcher] ignorePatterns changed, restarting watcher.');
                                this.startWatching(this.workspaceRoot);
                        }
                }
        }

        // --- VS Code File Change Handler -------------------------------------------

        /**
         * Handle file change events from VS Code's IFileService watcher.
         * Converts VS Code's FileChangeType enum to our FileChangeType string.
         */
        private handleVSCodeFileChanges(event: { rawAdded: readonly URI[]; rawUpdated: readonly URI[]; rawDeleted: readonly URI[] }): void {
                const now = Date.now();

                // Process added files
                for (const resource of event.rawAdded) {
                        if (this.shouldIgnore(resource)) {
                                continue;
                        }
                        this.addChange({
                                uri: resource,
                                type: 'created',
                                timestamp: now
                        });
                        this.rawEventCount++;
                }

                // Process updated files
                for (const resource of event.rawUpdated) {
                        if (this.shouldIgnore(resource)) {
                                continue;
                        }
                        this.addChange({
                                uri: resource,
                                type: 'modified',
                                timestamp: now
                        });
                        this.rawEventCount++;
                }

                // Process deleted files
                for (const resource of event.rawDeleted) {
                        if (this.shouldIgnore(resource)) {
                                continue;
                        }
                        this.addChange({
                                uri: resource,
                                type: 'deleted',
                                timestamp: now
                        });
                        this.rawEventCount++;
                }

                if (this.pendingChanges.length > 0) {
                        this.scheduleDebounce();
                }
        }

        // --- Change Accumulation & Coalescing ---------------------------------------

        /**
         * Add a change event to the pending buffer, performing coalescing
         * to merge duplicate events for the same URI.
         *
         * Coalescing rules:
         * - created + modified → created  (file was just created, modifications are implicit)
         * - modified + modified → modified (collapse duplicate modifications)
         * - created + deleted → removed   (file came and went, drop it entirely)
         * - deleted + created → modified  (file was deleted then recreated = modified)
         * - deleted + modified → deleted  (if we saw delete first, modified is likely a race; keep deleted)
         * - modified + deleted → deleted  (file was modified then deleted; final state is deleted)
         * - modified + created → modified (shouldn't happen, but treat as modified)
         * - deleted + deleted → deleted   (collapse duplicate deletions)
         * - created + created → created   (collapse duplicate creations)
         */
        private addChange(change: IFileChangeEvent): void {
                const uriKey = change.uri.toString();
                const existingIndex = this.pendingChanges.findIndex(c => c.uri.toString() === uriKey);

                if (existingIndex === -1) {
                        // No existing entry for this URI — just append
                        this.pendingChanges.push(change);
                        return;
                }

                const existing = this.pendingChanges[existingIndex];
                const merged = this.coalesceChanges(existing, change);

                if (merged === null) {
                        // created + deleted — cancel out, remove the entry
                        this.pendingChanges.splice(existingIndex, 1);
                } else {
                        // Replace with the coalesced result
                        this.pendingChanges[existingIndex] = merged;
                }
        }

        /**
         * Coalesce two change events for the same URI.
         * Returns null if the changes cancel each other out (created + deleted).
         */
        private coalesceChanges(existing: IFileChangeEvent, incoming: IFileChangeEvent): IFileChangeEvent | null {
                const combined = `${existing.type}+${incoming.type}`;

                switch (combined) {
                        // created + modified → created (modification is implicit in creation)
                        case 'created+modified':
                                return { uri: existing.uri, type: 'created', timestamp: incoming.timestamp };

                        // created + deleted → cancel out (file came and went within debounce window)
                        case 'created+deleted':
                                return null;

                        // modified + modified → modified (collapse)
                        case 'modified+modified':
                                return { uri: existing.uri, type: 'modified', timestamp: incoming.timestamp };

                        // modified + deleted → deleted (file was modified then deleted)
                        case 'modified+deleted':
                                return { uri: existing.uri, type: 'deleted', timestamp: incoming.timestamp };

                        // deleted + created → modified (file was deleted then recreated)
                        case 'deleted+created':
                                return { uri: existing.uri, type: 'modified', timestamp: incoming.timestamp };

                        // deleted + modified → deleted (keep deleted; modification after delete is likely a race)
                        case 'deleted+modified':
                                return { uri: existing.uri, type: 'deleted', timestamp: incoming.timestamp };

                        // modified + created → modified (shouldn't normally happen)
                        case 'modified+created':
                                return { uri: existing.uri, type: 'modified', timestamp: incoming.timestamp };

                        // Same type combinations — collapse, keep later timestamp
                        case 'created+created':
                                return { uri: existing.uri, type: 'created', timestamp: incoming.timestamp };

                        case 'deleted+deleted':
                                return { uri: existing.uri, type: 'deleted', timestamp: incoming.timestamp };

                        default:
                                // Fallback: keep the incoming change
                                return incoming;
                }
        }

        // --- Debounce Logic ---------------------------------------------------------

        /**
         * Schedule (or reschedule) the debounce timer.
         * After `debounceMs` of no new events, the pending changes
         * are flushed as a single IFileChangeBatch.
         */
        private scheduleDebounce(): void {
                if (this.debounceTimer !== null) {
                        clearTimeout(this.debounceTimer);
                }

                this.debounceTimer = setTimeout(() => {
                        this.debounceTimer = null;
                        this.flushPendingChanges();
                }, this._config.debounceMs);
        }

        /**
         * Flush all pending changes as a single IFileChangeBatch,
         * fire the onDidChangeFiles event, and trigger explorer refresh.
         */
        private flushPendingChanges(): void {
                if (this.pendingChanges.length === 0) {
                        return;
                }

                const changes = [...this.pendingChanges];
                const coalescedCount = this.rawEventCount || changes.length;

                const batch: IFileChangeBatch = {
                        changes,
                        timestamp: Date.now(),
                        coalescedCount
                };

                // Reset buffers
                this.pendingChanges = [];
                this.rawEventCount = 0;

                this.logService.trace(`[FileWatcher] Firing batch with ${changes.length} change(s), ${batch.coalescedCount} raw event(s) coalesced.`);

                // Fire the event
                this._onDidChangeFiles.fire(batch);

                // Trigger file explorer refresh
                this.triggerExplorerRefresh();
        }

        /**
         * Trigger VS Code's built-in file explorer refresh command.
         */
        private triggerExplorerRefresh(): void {
                try {
                        this.commandService.executeCommand(REFRESH_EXPLORER_COMMAND);
                } catch (error) {
                        // Command may not be available in all contexts (e.g., tests)
                        this.logService.warn('[FileWatcher] Failed to trigger explorer refresh:', error);
                }
        }

        // --- Ignore Pattern Filtering -----------------------------------------------

        /**
         * Check if a URI should be ignored based on the configured
         * ignore patterns.
         */
        private shouldIgnore(uri: URI): boolean {
                if (this.parsedIgnorePatterns.length === 0) {
                        return false;
                }

                // Get the path relative to the workspace root for pattern matching.
                // If no workspace root, use the full path.
                let pathToMatch: string;
                if (this.workspaceRoot) {
                        const rootPath = this.workspaceRoot.path;
                        if (uri.path.startsWith(rootPath)) {
                                pathToMatch = uri.path.substring(rootPath.length);
                                // Strip leading slash for relative matching
                                if (pathToMatch.startsWith('/')) {
                                        pathToMatch = pathToMatch.substring(1);
                                }
                        } else {
                                pathToMatch = uri.path;
                        }
                } else {
                        pathToMatch = uri.path;
                }

                for (const parsed of this.parsedIgnorePatterns) {
                        if (parsed(pathToMatch)) {
                                return true;
                        }
                }

                return false;
        }

        /**
         * Recompile ignore patterns from the config into parsed glob patterns.
         */
        private recompileIgnorePatterns(): void {
                this.parsedIgnorePatterns = this._config.ignorePatterns.map(pattern => {
                        try {
                                return glob.parse(pattern);
                        } catch (error) {
                                this.logService.warn(`[FileWatcher] Failed to parse ignore pattern "${pattern}":`, error);
                                // Return a pattern that never matches so the invalid pattern is effectively ignored
                                return (_path: string) => false;
                        }
                });
        }

        // --- Cleanup ----------------------------------------------------------------

        /**
         * Clean up the watcher and its event listener without changing
         * the isWatching state.
         */
        private cleanupWatcher(): void {
                // Dispose the event listener first
                if (this.watcherEventListener) {
                        this.watcherEventListener.dispose();
                        this.watcherEventListener = null;
                }

                // Dispose the watcher
                if (this.watcher) {
                        this.watcher.dispose();
                        this.watcher = null;
                }
        }

        override dispose(): void {
                this.stopWatching();

                // Clear any remaining debounce timer
                if (this.debounceTimer !== null) {
                        clearTimeout(this.debounceTimer);
                        this.debounceTimer = null;
                }

                // Flush any remaining changes before disposal
                if (this.pendingChanges.length > 0) {
                        this.flushPendingChanges();
                }

                super.dispose();
        }
}
