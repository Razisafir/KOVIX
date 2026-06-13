// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files';
import { IPendingChangesService, PendingChangeEntry } from '../../../../../../platform/construct/common/diff/pendingChanges.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';

export class PendingChangesService extends Disposable implements IPendingChangesService {
        readonly _serviceBrand: undefined;

        private readonly _entries = new Map<string, PendingChangeEntry>();
        private readonly _onDidChangePendingChanges = this._register(new Emitter<void>());
        readonly onDidChangePendingChanges = this._onDidChangePendingChanges.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IFileService private readonly fileService: IFileService,
        ) {
                super();
                this.logService.info('[PendingChanges] Service created');
        }

        get pendingEntries(): ReadonlyArray<PendingChangeEntry> {
                return Array.from(this._entries.values()).filter(e => e.accepted === undefined);
        }

        hasPendingChanges(): boolean {
                return this.pendingEntries.length > 0;
        }

        async stageFile(uri: URI, proposedContent: string): Promise<void> {
                const key = uri.toString();

                // 1. Read current file content BEFORE any modification
                let originalContent = '';
                let isNewFile = false;
                try {
                        const content = await this.fileService.readFile(uri);
                        originalContent = content.value.toString();
                } catch {
                        // File doesn't exist yet — this is a new file creation
                        isNewFile = true;
                }

                // 2. If there's an existing pending entry for this URI, update it
                const existing = this._entries.get(key);
                if (existing) {
                        this._entries.set(key, {
                                uri,
                                originalContent: existing.originalContent, // Keep the REAL original
                                proposedContent,
                                isNewFile: existing.isNewFile,
                                accepted: undefined,
                        });
                } else {
                        this._entries.set(key, {
                                uri,
                                originalContent,
                                proposedContent,
                                isNewFile,
                                accepted: undefined,
                        });
                }

                this.logService.info(`[PendingChanges] Staged file: ${uri.fsPath} (new: ${isNewFile}, ${proposedContent.length} chars)`);
                this._onDidChangePendingChanges.fire();
        }

        async stageEdit(uri: URI, diff: string): Promise<void> {
                // For edit_file, we stage the diff itself — the diff will be applied
                // at accept time. We still capture the original content.
                const key = uri.toString();

                let originalContent = '';
                let isNewFile = false;
                try {
                        // Check if there's already a pending change for this file
                        const existing = this._entries.get(key);
                        if (existing) {
                                originalContent = existing.originalContent;
                                isNewFile = existing.isNewFile;
                        } else {
                                const content = await this.fileService.readFile(uri);
                                originalContent = content.value.toString();
                        }
                } catch {
                        isNewFile = true;
                }

                // Store the diff as proposedContent marker — actual diff application
                // happens at accept time via DiffApplierService
                this._entries.set(key, {
                        uri,
                        originalContent,
                        proposedContent: diff, // The diff content
                        isNewFile,
                        accepted: undefined,
                });

                this.logService.info(`[PendingChanges] Staged edit: ${uri.fsPath} (${diff.length} chars diff)`);
                this._onDidChangePendingChanges.fire();
        }

        async accept(uri: URI): Promise<void> {
                const key = uri.toString();
                const entry = this._entries.get(key);
                if (!entry) {
                        this.logService.warn(`[PendingChanges] No pending change for: ${uri.fsPath}`);
                        return;
                }

                // NOW write to disk
                try {
                        // Ensure parent directory exists
                        const parentPath = uri.path.substring(0, uri.path.lastIndexOf('/')) || '/';
                        const parent = URI.from({ scheme: uri.scheme, authority: uri.authority, path: parentPath });
                        try {
                                const parentExists = await this.fileService.exists(parent);
                                if (!parentExists) {
                                        await this.fileService.createFolder(parent);
                                }
                        } catch { /* concurrent creation is fine */ }

                        await this.fileService.writeFile(uri, VSBuffer.fromString(entry.proposedContent));
                        entry.accepted = true;
                        this.logService.info(`[PendingChanges] Accepted and written to disk: ${uri.fsPath}`);
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[PendingChanges] Failed to write accepted change: ${msg}`);
                        throw error;
                }

                this._onDidChangePendingChanges.fire();
        }

        async reject(uri: URI): Promise<void> {
                const key = uri.toString();
                const entry = this._entries.get(key);
                if (!entry) {
                        this.logService.warn(`[PendingChanges] No pending change for: ${uri.fsPath}`);
                        return;
                }

                // DO NOT write to disk. Just discard the in-memory entry.
                // If the file was newly created (no original), and the file somehow
                // exists on disk (shouldn't happen with our fix), clean it up.
                if (entry.isNewFile) {
                        try {
                                const exists = await this.fileService.exists(uri);
                                if (exists) {
                                        await this.fileService.del(uri, { recursive: false, useTrash: true });
                                        this.logService.info(`[PendingChanges] Rejected new file, deleted from disk: ${uri.fsPath}`);
                                }
                        } catch { /* non-critical */ }
                }

                entry.accepted = false;
                this._entries.delete(key);
                this.logService.info(`[PendingChanges] Rejected: ${uri.fsPath}`);
                this._onDidChangePendingChanges.fire();
        }

        async acceptAll(): Promise<void> {
                const pending = this.pendingEntries;
                this.logService.info(`[PendingChanges] Accepting all ${pending.length} changes`);
                for (const entry of pending) {
                        await this.accept(entry.uri);
                }
        }

        async rejectAll(): Promise<void> {
                const pending = [...this.pendingEntries];
                this.logService.info(`[PendingChanges] Rejecting all ${pending.length} changes`);
                for (const entry of pending) {
                        await this.reject(entry.uri);
                }
        }

        getOriginalContent(uri: URI): string | undefined {
                return this._entries.get(uri.toString())?.originalContent;
        }

        getProposedContent(uri: URI): string | undefined {
                return this._entries.get(uri.toString())?.proposedContent;
        }

        override dispose(): void {
                this._entries.clear();
                super.dispose();
        }
}
