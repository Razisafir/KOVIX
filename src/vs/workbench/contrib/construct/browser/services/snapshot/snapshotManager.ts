// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ISnapshotManager, ITaskSnapshot, IRestoreResult, SnapshotStrategy, SnapshotStatus, ISnapshotConfig } from '../../../../../../platform/construct/common/snapshot/snapshotManager.js';
import { ITerminalExecutor } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

// --- Constants ----------------------------------------------------------------

const SNAPSHOT_STORAGE_PREFIX = 'construct.snapshot.';
const BACKUP_DIR_NAME = '.construct';
const SNAPSHOT_SUBDIR = 'snapshots';
const CONSTRUCT_GIT_STASH_PREFIX = 'construct-snapshot-';

const DEFAULT_CONFIG: ISnapshotConfig = {
        maxSnapshots: 50,
        autoSnapshot: true,
        expirySeconds: 86400, // 24 hours
};

// --- Internal Types -----------------------------------------------------------

interface ISerializedSnapshot {
        id: string;
        strategy: SnapshotStrategy;
        createdAt: number;
        taskDescription: string;
        status: SnapshotStatus;
        workspacePath: string;
        gitStashRef?: string;
        existingFiles?: string[];
        createdFiles: string[];
        modifiedFiles: string[];
        deletedFiles: string[];
}

// --- SnapshotManagerService ---------------------------------------------------

export class SnapshotManagerService extends Disposable implements ISnapshotManager {
        readonly _serviceBrand: undefined;

        private snapshots = new Map<string, ITaskSnapshot>();
        private _config: ISnapshotConfig = { ...DEFAULT_CONFIG };

        private readonly _onDidCreateSnapshot = this._register(new Emitter<ITaskSnapshot>());
        readonly onDidCreateSnapshot = this._onDidCreateSnapshot.event;

        private readonly _onDidRestoreSnapshot = this._register(new Emitter<IRestoreResult>());
        readonly onDidRestoreSnapshot = this._onDidRestoreSnapshot.event;

        private readonly _onDidDeleteSnapshot = this._register(new Emitter<string>());
        readonly onDidDeleteSnapshot = this._onDidDeleteSnapshot.event;

        constructor(
                @ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ILogService private readonly logService: ILogService,
                @ICommandService private readonly commandService: ICommandService,
                @IStorageService private readonly storageService: IStorageService,
        ) {
                super();
                this.loadPersistedSnapshots();
                this.logService.info('[SnapshotManager] Service created');
        }

        get config(): ISnapshotConfig {
                return this._config;
        }

        // --- Public API ------------------------------------------------------------

        async createSnapshot(workspacePath: string, taskDescription: string): Promise<ITaskSnapshot> {
                // Prune expired and excess snapshots before creating a new one
                this.pruneExpiredSnapshots();
                this.enforceMaxSnapshots();

                const id = generateUuid();
                const now = Date.now();

                // Determine strategy: git if inside a work tree, otherwise file
                const isGitRepo = await this.isGitRepository(workspacePath);
                const strategy: SnapshotStrategy = isGitRepo ? 'git' : 'file';

                const snapshot: ITaskSnapshot = {
                        id,
                        strategy,
                        createdAt: now,
                        taskDescription,
                        status: 'active',
                        workspacePath,
                        createdFiles: [],
                        modifiedFiles: [],
                        deletedFiles: [],
                };

                if (strategy === 'git') {
                        await this.createGitSnapshot(snapshot);
                } else {
                        await this.createFileSnapshot(snapshot);
                }

                this.snapshots.set(id, snapshot);
                this.persistSnapshot(snapshot);
                this._onDidCreateSnapshot.fire(snapshot);

                this.logService.info(`[SnapshotManager] Created ${strategy} snapshot ${id} for: ${taskDescription}`);
                return snapshot;
        }

        async restoreSnapshot(snapshotId: string): Promise<IRestoreResult> {
                const startTime = performance.now();
                const snapshot = this.snapshots.get(snapshotId);

                if (!snapshot) {
                        const result: IRestoreResult = {
                                success: false,
                                restoredCount: 0,
                                deletedCount: 0,
                                durationMs: performance.now() - startTime,
                                error: `Snapshot not found: ${snapshotId}`,
                        };
                        this._onDidRestoreSnapshot.fire(result);
                        return result;
                }

                if (snapshot.status === 'restored') {
                        const result: IRestoreResult = {
                                success: false,
                                restoredCount: 0,
                                deletedCount: 0,
                                durationMs: performance.now() - startTime,
                                error: `Snapshot already restored: ${snapshotId}`,
                        };
                        this._onDidRestoreSnapshot.fire(result);
                        return result;
                }

                try {
                        let restoredCount = 0;
                        let deletedCount = 0;

                        if (snapshot.strategy === 'git') {
                                const gitResult = await this.restoreGitSnapshot(snapshot);
                                restoredCount = gitResult.restoredCount;
                                deletedCount = gitResult.deletedCount;
                        } else {
                                const fileResult = await this.restoreFileSnapshot(snapshot);
                                restoredCount = fileResult.restoredCount;
                                deletedCount = fileResult.deletedCount;
                        }

                        // Update snapshot status
                        snapshot.status = 'restored';
                        this.persistSnapshot(snapshot);

                        const durationMs = performance.now() - startTime;

                        const result: IRestoreResult = {
                                success: true,
                                restoredCount,
                                deletedCount,
                                durationMs,
                        };

                        this._onDidRestoreSnapshot.fire(result);
                        this.refreshExplorer();

                        this.logService.info(`[SnapshotManager] Restored snapshot ${snapshotId} in ${durationMs.toFixed(0)}ms (${restoredCount} restored, ${deletedCount} deleted)`);
                        return result;
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[SnapshotManager] Restore failed for ${snapshotId}: ${msg}`);

                        const result: IRestoreResult = {
                                success: false,
                                restoredCount: 0,
                                deletedCount: 0,
                                durationMs: performance.now() - startTime,
                                error: msg,
                        };

                        this._onDidRestoreSnapshot.fire(result);
                        return result;
                }
        }

        getSnapshot(snapshotId: string): ITaskSnapshot | undefined {
                return this.snapshots.get(snapshotId);
        }

        getAllSnapshots(): ITaskSnapshot[] {
                return Array.from(this.snapshots.values())
                        .sort((a, b) => b.createdAt - a.createdAt);
        }

        async deleteSnapshot(snapshotId: string): Promise<void> {
                const snapshot = this.snapshots.get(snapshotId);
                if (!snapshot) {
                        this.logService.warn(`[SnapshotManager] Cannot delete unknown snapshot: ${snapshotId}`);
                        return;
                }

                // Clean up backup directory for file strategy
                if (snapshot.strategy === 'file') {
                        await this.cleanupBackupDirectory(snapshot);
                }

                // Note: for git strategy, we intentionally do NOT drop the stash.
                // The stash may still be useful for the user. Only the tracking
                // record is removed.

                this.snapshots.delete(snapshotId);
                this.storageService.remove(`${SNAPSHOT_STORAGE_PREFIX}${snapshotId}`, StorageScope.WORKSPACE);
                this._onDidDeleteSnapshot.fire(snapshotId);

                this.logService.info(`[SnapshotManager] Deleted snapshot ${snapshotId}`);
        }

        trackFileCreated(snapshotId: string, filePath: string): void {
                const snapshot = this.snapshots.get(snapshotId);
                if (!snapshot || snapshot.status !== 'active') {
                        return;
                }

                // Only track if not already in any list
                if (
                        !snapshot.createdFiles.includes(filePath) &&
                        !snapshot.modifiedFiles.includes(filePath) &&
                        !snapshot.deletedFiles.includes(filePath)
                ) {
                        snapshot.createdFiles.push(filePath);
                        this.persistSnapshot(snapshot);
                        this.logService.trace(`[SnapshotManager] Tracked created file: ${filePath}`);
                }
        }

        trackFileModified(snapshotId: string, filePath: string): void {
                const snapshot = this.snapshots.get(snapshotId);
                if (!snapshot || snapshot.status !== 'active') {
                        return;
                }

                // If the file was created in this task, it's not a "modification" of a pre-existing file
                if (snapshot.createdFiles.includes(filePath)) {
                        return;
                }

                // Only back up on first modification
                if (!snapshot.modifiedFiles.includes(filePath)) {
                        // Back up the file before first modification is tracked
                        this.backupFileBeforeModify(snapshot, filePath).catch(err => {
                                this.logService.warn(`[SnapshotManager] Failed to back up ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
                        });

                        snapshot.modifiedFiles.push(filePath);
                        this.persistSnapshot(snapshot);
                        this.logService.trace(`[SnapshotManager] Tracked modified file: ${filePath}`);
                }
        }

        trackFileDeleted(snapshotId: string, filePath: string): void {
                const snapshot = this.snapshots.get(snapshotId);
                if (!snapshot || snapshot.status !== 'active') {
                        return;
                }

                // If the file was created in this task, just remove it from createdFiles
                // since deleting something you just created is a no-op for undo purposes
                const createdIdx = snapshot.createdFiles.indexOf(filePath);
                if (createdIdx !== -1) {
                        snapshot.createdFiles.splice(createdIdx, 1);
                        this.persistSnapshot(snapshot);
                        this.logService.trace(`[SnapshotManager] Removed created-tracking for deleted file: ${filePath}`);
                        return;
                }

                // If the file was modified, move it from modifiedFiles to deletedFiles
                // (we still have the backup from before the modification)
                const modifiedIdx = snapshot.modifiedFiles.indexOf(filePath);
                if (modifiedIdx !== -1) {
                        snapshot.modifiedFiles.splice(modifiedIdx, 1);
                }

                if (!snapshot.deletedFiles.includes(filePath)) {
                        snapshot.deletedFiles.push(filePath);
                        this.persistSnapshot(snapshot);
                        this.logService.trace(`[SnapshotManager] Tracked deleted file: ${filePath}`);
                }
        }

        updateConfig(partial: Partial<ISnapshotConfig>): void {
                this._config = { ...this._config, ...partial };
                this.logService.info(`[SnapshotManager] Config updated: ${JSON.stringify(partial)}`);
        }

        // --- Git Strategy ----------------------------------------------------------

        private async createGitSnapshot(snapshot: ITaskSnapshot): Promise<void> {
                const stashMessage = `${CONSTRUCT_GIT_STASH_PREFIX}${snapshot.id}`;

                try {
                        const result = await this.terminalExecutor.execute(
                                `git stash push -m "${stashMessage}" --include-untracked`,
                                snapshot.workspacePath,
                                30000
                        );

                        if (result.exitCode !== 0) {
                                // `git stash` returns non-zero when there's nothing to stash.
                                // That's fine -- the snapshot still tracks file changes.
                                if (result.stderr.includes('No local changes to save')) {
                                        this.logService.info(`[SnapshotManager] No local changes to stash for ${snapshot.id}`);
                                        snapshot.gitStashRef = stashMessage;
                                        return;
                                }
                                throw new Error(`git stash failed (exit ${result.exitCode}): ${result.stderr}`);
                        }

                        snapshot.gitStashRef = stashMessage;
                        this.logService.info(`[SnapshotManager] Git stash created: ${stashMessage}`);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[SnapshotManager] Git stash creation failed: ${msg}`);
                        throw error;
                }
        }

        private async restoreGitSnapshot(snapshot: ITaskSnapshot): Promise<{ restoredCount: number; deletedCount: number }> {
                if (!snapshot.gitStashRef) {
                        throw new Error('No git stash reference found for snapshot');
                }

                // Find the stash index by its message
                const stashIndex = await this.findStashIndex(snapshot.gitStashRef);
                if (stashIndex === -1) {
                        throw new Error(`Git stash not found for message: ${snapshot.gitStashRef}`);
                }

                // Pop the stash to restore the state
                const result = await this.terminalExecutor.execute(
                        `git stash pop stash@{${stashIndex}}`,
                        snapshot.workspacePath,
                        30000
                );

                if (result.exitCode !== 0) {
                        throw new Error(`git stash pop failed (exit ${result.exitCode}): ${result.stderr}`);
                }

                // Count affected files from tracking arrays
                const restoredCount = snapshot.modifiedFiles.length + snapshot.deletedFiles.length;
                const deletedCount = snapshot.createdFiles.length;

                // Delete any files that were created by the agent (git stash won't
                // know about these if they were created after the stash)
                await this.deleteCreatedFiles(snapshot);

                return { restoredCount, deletedCount };
        }

        private async findStashIndex(stashMessage: string): Promise<number> {
                try {
                        const result = await this.terminalExecutor.execute(
                                'git stash list',
                                this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath,
                                10000
                        );

                        if (result.exitCode !== 0 || !result.stdout) {
                                return -1;
                        }

                        const lines = result.stdout.split('\n');
                        for (const line of lines) {
                                // Format: stash@{0}: On branch: construct-snapshot-<id>
                                const match = line.match(/^stash@\{(\d+)\}.*:\s*(.+)$/);
                                if (match && match[2].includes(stashMessage)) {
                                        return parseInt(match[1], 10);
                                }
                        }

                        return -1;
                } catch {
                        return -1;
                }
        }

        // --- File Strategy ---------------------------------------------------------

        private async createFileSnapshot(snapshot: ITaskSnapshot): Promise<void> {
                const workspaceUri = URI.file(snapshot.workspacePath);

                // List all existing files in the workspace
                const existingFiles: string[] = [];
                try {
                        await this.collectWorkspaceFiles(workspaceUri, existingFiles, snapshot.workspacePath);
                } catch (error) {
                        this.logService.warn(`[SnapshotManager] Could not enumerate workspace files: ${error instanceof Error ? error.message : String(error)}`);
                }

                snapshot.existingFiles = existingFiles;

                // Create the backup directory for this snapshot
                const backupDir = this.getBackupDir(snapshot);
                try {
                        await this.fileService.createFolder(URI.file(backupDir));
                } catch {
                        // Directory might already exist
                }

                this.logService.info(`[SnapshotManager] File snapshot created with ${existingFiles.length} existing files`);
        }

        private async collectWorkspaceFiles(uri: URI, results: string[], workspaceRoot: string): Promise<void> {
                try {
                        const stat = await this.fileService.resolve(uri);
                        if (!stat.children) {
                                return;
                        }

                        for (const child of stat.children) {
                                // Skip .construct directory (our own backup data)
                                const relativePath = child.resource.fsPath.substring(workspaceRoot.length + 1);
                                if (relativePath.startsWith('.construct') || relativePath.startsWith('.git')) {
                                        continue;
                                }

                                if (child.isDirectory) {
                                        await this.collectWorkspaceFiles(child.resource, results, workspaceRoot);
                                } else {
                                        results.push(relativePath);
                                }
                        }
                } catch {
                        // Permission errors, etc. -- skip
                }
        }

        private async restoreFileSnapshot(snapshot: ITaskSnapshot): Promise<{ restoredCount: number; deletedCount: number }> {
                const backupDir = this.getBackupDir(snapshot);
                let restoredCount = 0;
                let deletedCount = 0;

                // 1. Restore modified files from backup (parallel for speed)
                const modifiedRestores = snapshot.modifiedFiles.map(async (filePath) => {
                        const backupPath = `${backupDir}/${this.sanitizeFilePath(filePath)}`;
                        const targetUri = URI.file(`${snapshot.workspacePath}/${filePath}`);

                        try {
                                const backupContent = await this.fileService.readFile(URI.file(backupPath));
                                await this.fileService.writeFile(targetUri, backupContent.value);
                                restoredCount++;
                        } catch (error) {
                                this.logService.warn(`[SnapshotManager] Could not restore modified file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                });

                // 2. Recreate deleted files from backup (parallel for speed)
                const deletedRestores = snapshot.deletedFiles.map(async (filePath) => {
                        const backupPath = `${backupDir}/${this.sanitizeFilePath(filePath)}`;
                        const targetUri = URI.file(`${snapshot.workspacePath}/${filePath}`);

                        try {
                                const backupContent = await this.fileService.readFile(URI.file(backupPath));
                                // Ensure parent directory exists
                                await this.ensureParentDirectory(targetUri);
                                await this.fileService.writeFile(targetUri, backupContent.value);
                                restoredCount++;
                        } catch (error) {
                                this.logService.warn(`[SnapshotManager] Could not recreate deleted file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                });

                // 3. Delete files created by the agent (parallel for speed)
                const createdDeletes = snapshot.createdFiles.map(async (filePath) => {
                        const targetUri = URI.file(`${snapshot.workspacePath}/${filePath}`);

                        try {
                                await this.fileService.del(targetUri);
                                deletedCount++;
                        } catch (error) {
                                this.logService.warn(`[SnapshotManager] Could not delete created file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                });

                // Execute all operations in parallel for performance target: < 2s for 20 files
                await Promise.all([
                        Promise.all(modifiedRestores),
                        Promise.all(deletedRestores),
                        Promise.all(createdDeletes),
                ]);

                return { restoredCount, deletedCount };
        }

        // --- Backup Helpers --------------------------------------------------------

        private async backupFileBeforeModify(snapshot: ITaskSnapshot, filePath: string): Promise<void> {
                if (snapshot.strategy !== 'file') {
                        return; // Git strategy doesn't need explicit file backups
                }

                const backupDir = this.getBackupDir(snapshot);
                const sourceUri = URI.file(`${snapshot.workspacePath}/${filePath}`);
                const backupPath = `${backupDir}/${this.sanitizeFilePath(filePath)}`;

                try {
                        // Ensure backup subdirectories exist
                        await this.ensureParentDirectory(URI.file(backupPath));

                        // Copy current file content to backup
                        const content = await this.fileService.readFile(sourceUri);
                        await this.fileService.writeFile(URI.file(backupPath), content.value);
                } catch (error) {
                        // File might not exist yet (e.g., it could be a newly created file
                        // that's being tracked as modified due to race). Non-critical.
                        this.logService.trace(`[SnapshotManager] Could not back up ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private async deleteCreatedFiles(snapshot: ITaskSnapshot): Promise<void> {
                const deletes = snapshot.createdFiles.map(async (filePath) => {
                        const targetUri = URI.file(`${snapshot.workspacePath}/${filePath}`);
                        try {
                                await this.fileService.del(targetUri);
                        } catch {
                                // File might already be gone
                        }
                });
                await Promise.all(deletes);
        }

        private async cleanupBackupDirectory(snapshot: ITaskSnapshot): Promise<void> {
                const backupDir = this.getBackupDir(snapshot);
                try {
                        await this.fileService.del(URI.file(backupDir), { recursive: true });
                } catch {
                        // Non-critical
                }
        }

        // --- Git Detection ---------------------------------------------------------

        private async isGitRepository(workspacePath: string): Promise<boolean> {
                try {
                        const result = await this.terminalExecutor.execute(
                                'git rev-parse --is-inside-work-tree',
                                workspacePath,
                                5000
                        );
                        return result.exitCode === 0 && result.stdout.trim() === 'true';
                } catch {
                        return false;
                }
        }

        // --- Pruning ---------------------------------------------------------------

        private pruneExpiredSnapshots(): void {
                const now = Date.now();
                const expiryMs = this._config.expirySeconds * 1000;

                for (const [id, snapshot] of this.snapshots) {
                        if (snapshot.status === 'expired') {
                                continue; // Already marked
                        }

                        const age = now - snapshot.createdAt;
                        if (age > expiryMs) {
                                snapshot.status = 'expired';
                                this.persistSnapshot(snapshot);
                                this.logService.info(`[SnapshotManager] Expired snapshot ${id} (age: ${Math.round(age / 1000)}s)`);
                        }
                }

                // Clean up expired snapshots from storage
                for (const [id, snapshot] of this.snapshots) {
                        if (snapshot.status === 'expired') {
                                // Auto-delete expired snapshots that are older than 2x expiry
                                if ((now - snapshot.createdAt) > expiryMs * 2) {
                                        this.snapshots.delete(id);
                                        this.storageService.remove(`${SNAPSHOT_STORAGE_PREFIX}${id}`, StorageScope.WORKSPACE);
                                        this.logService.info(`[SnapshotManager] Pruned expired snapshot ${id}`);
                                }
                        }
                }
        }

        private enforceMaxSnapshots(): void {
                const sorted = this.getAllSnapshots(); // Newest first
                if (sorted.length >= this._config.maxSnapshots) {
                        const excess = sorted.slice(this._config.maxSnapshots - 1); // Keep one slot for the new snapshot
                        for (const snapshot of excess) {
                                this.snapshots.delete(snapshot.id);
                                this.storageService.remove(`${SNAPSHOT_STORAGE_PREFIX}${snapshot.id}`, StorageScope.WORKSPACE);
                                this.logService.info(`[SnapshotManager] Pruned excess snapshot ${snapshot.id}`);
                        }
                }
        }

        // --- Persistence -----------------------------------------------------------

        private persistSnapshot(snapshot: ITaskSnapshot): void {
                const serialized: ISerializedSnapshot = {
                        id: snapshot.id,
                        strategy: snapshot.strategy,
                        createdAt: snapshot.createdAt,
                        taskDescription: snapshot.taskDescription,
                        status: snapshot.status,
                        workspacePath: snapshot.workspacePath,
                        gitStashRef: snapshot.gitStashRef,
                        existingFiles: snapshot.existingFiles,
                        createdFiles: snapshot.createdFiles,
                        modifiedFiles: snapshot.modifiedFiles,
                        deletedFiles: snapshot.deletedFiles,
                };

                this.storageService.store(
                        `${SNAPSHOT_STORAGE_PREFIX}${snapshot.id}`,
                        serialized,
                        StorageScope.WORKSPACE,
                        StorageTarget.USER
                );
        }

        private loadPersistedSnapshots(): void {
                try {
                        const keys = this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.USER);
                        const snapshotKeys = keys.filter((k: string) => k.startsWith(SNAPSHOT_STORAGE_PREFIX));

                        for (const key of snapshotKeys) {
                                const serialized = this.storageService.getObject<ISerializedSnapshot>(key, StorageScope.WORKSPACE);
                                if (serialized) {
                                        const snapshot: ITaskSnapshot = {
                                                id: serialized.id,
                                                strategy: serialized.strategy,
                                                createdAt: serialized.createdAt,
                                                taskDescription: serialized.taskDescription,
                                                status: serialized.status,
                                                workspacePath: serialized.workspacePath,
                                                gitStashRef: serialized.gitStashRef,
                                                existingFiles: serialized.existingFiles,
                                                createdFiles: serialized.createdFiles,
                                                modifiedFiles: serialized.modifiedFiles,
                                                deletedFiles: serialized.deletedFiles,
                                        };
                                        this.snapshots.set(serialized.id, snapshot);
                                }
                        }

                        this.logService.info(`[SnapshotManager] Loaded ${this.snapshots.size} persisted snapshots`);
                } catch (error) {
                        this.logService.error('[SnapshotManager] Failed to load persisted snapshots:', error);
                }
        }

        // --- Utility ---------------------------------------------------------------

        private getBackupDir(snapshot: ITaskSnapshot): string {
                return `${snapshot.workspacePath}/${BACKUP_DIR_NAME}/${SNAPSHOT_SUBDIR}/${snapshot.id}`;
        }

        /**
         * Sanitize a file path so it can be used as a backup file name.
         * Replaces path separators with `__` to create a flat backup directory.
         */
        private sanitizeFilePath(filePath: string): string {
                return filePath.replace(/[/\\]/g, '__');
        }

        /**
         * Ensure the parent directory of a given URI exists.
         */
        private async ensureParentDirectory(targetUri: URI): Promise<void> {
                const parentPath = targetUri.fsPath.substring(0, targetUri.fsPath.lastIndexOf(/[/\\]/.test(targetUri.fsPath) ? (targetUri.fsPath.includes('\\') ? '\\' : '/') : '/'));
                if (parentPath) {
                        try {
                                await this.fileService.createFolder(URI.file(parentPath));
                        } catch {
                                // Might already exist
                        }
                }
        }

        /**
         * Refresh the file explorer to reflect restored/deleted files.
         */
        private async refreshExplorer(): Promise<void> {
                try {
                        await this.commandService.executeCommand('workbench.files.action.refreshFilesExplorer');
                } catch {
                        // Non-critical
                        try {
                                const rootUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
                                if (rootUri) {
                                        await this.fileService.stat(rootUri);
                                }
                        } catch {
                                // Non-critical
                        }
                }
        }

        override dispose(): void {
                // Persist all active snapshots before disposal
                for (const snapshot of this.snapshots.values()) {
                        this.persistSnapshot(snapshot);
                }
                super.dispose();
        }
}
