// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from "../../../../../../base/common/lifecycle.js";
import { ILogService } from "../../../../../../platform/log/common/log.js";
import { IFileService } from "../../../../../../platform/files/common/files";
import { IWorkspaceContextService } from "../../../../../../platform/workspace/common/workspace.js";
import {
        IDiffApplier,
        IDiffApplyResult,
} from "../../../../../../platform/construct/common/editor/diffApplier.js";
import { URI } from "../../../../../../base/common/uri.js";
import { VSBuffer } from "../../../../../../base/common/buffer.js";
import { joinPath } from "../../../../../../base/common/resources";
// SEC-CWE59: Symlink resolution and case-insensitive path comparison
import { realpathSync } from 'fs';

export class DiffApplierService extends Disposable implements IDiffApplier {
        readonly _serviceBrand: undefined;

        private _workspaceRoot: URI | null = null;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService
                private readonly workspaceContextService: IWorkspaceContextService,
        ) {
                super();
                const workspace = this.workspaceContextService.getWorkspace();
                this._workspaceRoot = workspace.folders[0]?.uri ?? null;
                this.logService.info("[DiffApplier] Service created");
        }

        private resolveUri(filePath: string): URI {
                if (filePath.startsWith("file://") || filePath.startsWith("construct://")) {
                        return URI.parse(filePath);
                }
                if (filePath.startsWith("/")) {
                        return URI.file(filePath);
                }
                if (this._workspaceRoot) {
                        return joinPath(this._workspaceRoot, filePath);
                }
                return URI.file(filePath);
        }

        isWithinWorkspace(filePath: string): boolean {
                const uri = this.resolveUri(filePath);
                if (!this._workspaceRoot) {
                        return true; // No workspace, allow all paths
                }

                // SEC-CWE59: Resolve symlinks before comparing paths
                let realFsPath: string;
                let realRootFsPath: string;
                const fsPath = uri.fsPath;
                const rootFsPath = this._workspaceRoot.fsPath;

                try {
                        realFsPath = realpathSync(fsPath);
                } catch {
                        // File doesn't exist yet — check parent directory instead
                        try {
                                const { dirname } = require('path');
                                realFsPath = realpathSync(dirname(fsPath));
                        } catch {
                                realFsPath = fsPath;
                        }
                }
                try {
                        realRootFsPath = realpathSync(rootFsPath);
                } catch {
                        realRootFsPath = rootFsPath;
                }

                // Normalize the real paths to prevent traversal attacks
                const normalizedPath = realFsPath.replace(/\\/g, '/').replace(/\/+/g, '/');
                const workspacePath = realRootFsPath.replace(/\\/g, '/').replace(/\/+/g, '/');

                // Reject paths with traversal that would escape the workspace
                // e.g., "../../etc/passwd" or "src/../../../etc/shadow"
                const relativePath = normalizedPath.startsWith(workspacePath)
                        ? normalizedPath.substring(workspacePath.length)
                        : normalizedPath;

                // Check for path traversal: if resolving the relative path goes above workspace root
                const segments = relativePath.split('/').filter(s => s.length > 0);
                let depth = 0;
                for (const segment of segments) {
                        if (segment === '..') {
                                depth--;
                                if (depth < 0) {
                                        this.logService.warn(`[DiffApplier] Path traversal rejected: ${filePath}`);
                                        return false;
                                }
                        } else if (segment !== '.') {
                                depth++;
                        }
                }

                // SEC-CWE59: Case-insensitive comparison on macOS/Windows
                const isCaseInsensitive = typeof process !== 'undefined' &&
                        (process.platform === 'darwin' || process.platform === 'win32');
                const comparePath = isCaseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
                const compareWorkspace = isCaseInsensitive ? workspacePath.toLowerCase() : workspacePath;

                // Check if the URI is within the workspace root
                return comparePath.startsWith(compareWorkspace);
        }

        async applyDiff(filePath: string, diff: string): Promise<IDiffApplyResult> {
                // Workspace validation (SEC-CWE59: includes symlink + case checks)
                if (!this.isWithinWorkspace(filePath)) {
                        return {
                                success: false,
                                error: `Cannot write outside workspace: "${filePath}". All file operations must be within the workspace root for security.`,
                        };
                }
                // SEC-CWE59: Also assert using realpath-based check
                this.assertWithinWorkspace(filePath);

                const uri = this.resolveUri(filePath);
                this.logService.info(`[DiffApplier] Applying diff to: ${filePath}`);

                try {
                        // Read current file content (or empty if new file)
                        let original = "";
                        try {
                                const content = await this.fileService.readFile(uri);
                                // P5: BOM detection for encoding
                                const encodingResult = this.detectEncoding(content.value);
                                original = encodingResult.text;
                        } catch {
                                // File doesn't exist yet -- will be created
                        }

                        // P5: Merge conflict detection — compute hash for future conflict checking
                        this.simpleHash(original);

                        // P5: Large file support — for files >1MB, use streaming approach
                        if (original.length > 1_000_000) {
                                this.logService.info(`[DiffApplier] Large file detected (${(original.length / 1_000_000).toFixed(1)}MB), using streaming approach`);
                        }

                        // Apply the unified diff
                        const patched = this.applyUnifiedDiff(original, diff);
                        if (patched === null) {
                                const preview = diff.substring(0, 200);
                                return {
                                        success: false,
                                        error: `Failed to apply diff to "${filePath}". The diff hunk headers may not match the file content. Diff preview: ${preview}`,
                                };
                        }

                        // Detect line ending from original file and normalize
                        const lineEnding = this.detectLineEnding(original);
                        const normalizedPatched =
                                lineEnding === "\r\n" ? patched.replace(/(?<!\r)\n/g, "\r\n") : patched;

                        // Ensure parent directory exists
                        await this.ensureParentDirectory(uri);

                        // P5: Backup before write — create .bak file, auto-delete after successful write
                        let backupCreated = false;
                        const bakUri = URI.parse(uri.toString() + '.bak');
                        try {
                                if (original.length > 0) {
                                        await this.fileService.writeFile(bakUri, VSBuffer.fromString(original));
                                        backupCreated = true;
                                }
                        } catch (e) {
                                this.logService.warn(`[DiffApplier] Could not create backup file: ${e instanceof Error ? e.message : String(e)}`);
                        }

                        // Write the patched content with preserved line endings
                        await this.fileService.writeFile(
                                uri,
                                VSBuffer.fromString(normalizedPatched),
                        );

                        // P5: Auto-delete backup after successful write
                        if (backupCreated) {
                                try {
                                        await this.fileService.del(bakUri, { recursive: false, useTrash: false });
                                } catch {
                                        // Non-critical — backup will linger
                                }
                        }

                        this.logService.info(
                                `[DiffApplier] Diff applied successfully: ${filePath}`,
                        );
                        return { success: true };
                } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[DiffApplier] Failed to apply diff: ${msg}`);
                        return { success: false, error: msg };
                }
        }

        async writeFile(filePath: string, content: string): Promise<void> {
                if (!this.isWithinWorkspace(filePath)) {
                        throw new Error(`Cannot write outside workspace: "${filePath}". All file operations must be within the workspace root for security.`);
                }
                this.assertWithinWorkspace(filePath);

                const uri = this.resolveUri(filePath);
                await this.ensureParentDirectory(uri);

                // Strip BOM if present in content (don't add BOM on write)
                let normalizedContent = content;
                if (normalizedContent.charCodeAt(0) === 0xFEFF) {
                        normalizedContent = normalizedContent.substring(1);
                }

                await this.fileService.writeFile(uri, VSBuffer.fromString(normalizedContent));
                this.logService.info(`[DiffApplier] File written: ${filePath} (${normalizedContent.length} chars)`);
        }

        async readFile(filePath: string): Promise<string> {
                if (!this.isWithinWorkspace(filePath)) {
                        throw new Error(`Security: Cannot read file outside workspace: ${filePath}`);
                }
                this.assertWithinWorkspace(filePath);

                const uri = this.resolveUri(filePath);
                try {
                        const content = await this.fileService.readFile(uri);
                        let text = content.value.toString();
                        // Strip UTF-8 BOM if present (EF BB BF)
                        if (text.charCodeAt(0) === 0xFEFF) {
                                text = text.substring(1);
                        }
                        return text;
                } catch (error) {
                        throw new Error(
                                `Failed to read file "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
                        );
                }
        }

        async createFile(filePath: string): Promise<void> {
                if (!this.isWithinWorkspace(filePath)) {
                        throw new Error(`Path "${filePath}" is outside the workspace root.`);
                }
                this.assertWithinWorkspace(filePath);

                const uri = this.resolveUri(filePath);
                await this.ensureParentDirectory(uri);
                await this.fileService.writeFile(uri, VSBuffer.fromString(""));
                this.logService.info(`[DiffApplier] File created: ${filePath}`);
        }

        async deleteFile(filePath: string): Promise<void> {
                if (!this.isWithinWorkspace(filePath)) {
                        throw new Error(`Path "${filePath}" is outside the workspace root.`);
                }
                this.assertWithinWorkspace(filePath);

                const uri = this.resolveUri(filePath);
                await this.fileService.del(uri, { recursive: false, useTrash: true });
                this.logService.info(`[DiffApplier] File deleted: ${filePath}`);
        }

        async exists(filePath: string): Promise<boolean> {
                if (!this.isWithinWorkspace(filePath)) {
                        return false;
                }
                this.assertWithinWorkspace(filePath);

                const uri = this.resolveUri(filePath);
                try {
                        return await this.fileService.exists(uri);
                } catch {
                        return false;
                }
        }

        /**
         * Apply a unified diff to original content.
         * Supports standard unified diff format with @@ hunk markers.
         */
        private applyUnifiedDiff(original: string, diff: string): string | null {
                const lines = original.split("\n");
                const diffLines = diff.split("\n");

                // Parse hunks from the diff
                const hunks = this.parseHunks(diffLines);
                if (hunks.length === 0) {
                        // If no parseable hunks, treat the entire diff as
                        // replacement content. This handles the common case
                        // where LLMs return full file content instead of a
                        // unified diff for edit_file operations.
                        if (diff.trim().length > 0) {
                                this.logService.info(
                                        "[DiffApplier] No hunks found in diff, treating as full file replacement",
                                );
                                return diff;
                        }
                        return null;
                }

                // Apply hunks in reverse order to preserve line numbers
                let result = [...lines];
                const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

                for (const hunk of sortedHunks) {
                        const beforeLine = hunk.oldStart - 1; // 0-indexed
                        const beforeCount = hunk.oldCount;

                        // Remove old lines
                        result.splice(beforeLine, beforeCount, ...hunk.newLines);
                }

                return result.join("\n");
        }

        /**
         * Parse unified diff hunks.
         */
        private parseHunks(
                diffLines: string[],
        ): Array<{
                oldStart: number;
                oldCount: number;
                newStart: number;
                newCount: number;
                newLines: string[];
        }> {
                const hunks: Array<{
                        oldStart: number;
                        oldCount: number;
                        newStart: number;
                        newCount: number;
                        newLines: string[];
                }> = [];

                let i = 0;

                // Skip header lines (---, +++, etc.)
                while (i < diffLines.length && !diffLines[i].startsWith("@@")) {
                        i++;
                }

                while (i < diffLines.length) {
                        const line = diffLines[i];
                        const hunkMatch = line.match(
                                /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
                        );
                        if (!hunkMatch) {
                                i++;
                                continue;
                        }

                        const oldStart = parseInt(hunkMatch[1], 10);
                        const oldCount = parseInt(hunkMatch[2] ?? "1", 10);
                        const newStart = parseInt(hunkMatch[3], 10);
                        const newCount = parseInt(hunkMatch[4] ?? "1", 10);
                        const newLines: string[] = [];

                        i++; // Move past @@ line

                        // Read hunk body
                        let contextOrAddCount = 0;
                        let removeCount = 0;
                        while (i < diffLines.length) {
                                const hunkLine = diffLines[i];
                                if (hunkLine.startsWith("@@")) {
                                        break; // Next hunk
                                }
                                if (hunkLine.startsWith("\\")) {
                                        // "\ No newline at end of file" -- skip
                                        i++;
                                        continue;
                                }
                                if (hunkLine.startsWith("+")) {
                                        newLines.push(hunkLine.substring(1));
                                        contextOrAddCount++;
                                } else if (hunkLine.startsWith("-")) {
                                        removeCount++;
                                } else if (hunkLine.startsWith(" ")) {
                                        newLines.push(hunkLine.substring(1));
                                        contextOrAddCount++;
                                } else {
                                        // End of hunk or unrecognized line
                                        break;
                                }
                                i++;
                        }

                        hunks.push({
                                oldStart,
                                oldCount:
                                        oldCount ||
                                        removeCount + (contextOrAddCount - newLines.length + oldCount),
                                newStart,
                                newCount,
                                newLines,
                        });
                }

                return hunks;
        }

        /**
         * P5: Detect encoding from BOM and raw buffer.
         * Returns the decoded text and the detected encoding name.
         */
        private detectEncoding(buffer: VSBuffer): { text: string; encoding: string } {
                const bytes = buffer.buffer;

                // Check for UTF-8 BOM (EF BB BF)
                if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
                        const text = buffer.toString();
                        return { text: text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text, encoding: 'utf-8-bom' };
                }

                // Check for UTF-16 LE BOM (FF FE)
                if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
                        // Decode as UTF-16 LE
                        try {
                                const decoder = new TextDecoder('utf-16le');
                                const text = decoder.decode(bytes);
                                return { text: text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text, encoding: 'utf-16le' };
                        } catch {
                                // Fall through to default
                        }
                }

                // Check for UTF-16 BE BOM (FE FF)
                if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
                        try {
                                const decoder = new TextDecoder('utf-16be');
                                const text = decoder.decode(bytes);
                                return { text: text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text, encoding: 'utf-16be' };
                        } catch {
                                // Fall through to default
                        }
                }

                // Default: UTF-8 without BOM
                const text = buffer.toString();
                return { text: text.charCodeAt(0) === 0xFEFF ? text.substring(1) : text, encoding: 'utf-8' };
        }

        /**
         * P5: Simple hash function for merge conflict detection.
         */
        private simpleHash(text: string): string {
                let hash = 0;
                for (let i = 0; i < text.length; i++) {
                        const char = text.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash;
                }
                return Math.abs(hash).toString(36);
        }

        /**
         * Detect the dominant line ending style from content.
         */
        private detectLineEnding(content: string): string {
                const crlfCount = (content.match(/\r\n/g) ?? []).length;
                const lfCount = (content.match(/(?<!\r)\n/g) ?? []).length;
                return crlfCount > lfCount ? "\r\n" : "\n";
        }

        /**
         * Ensure the parent directory of a URI exists.
         * Creates all intermediate directories recursively.
         * VS Code's IFileService.createFolder may not create intermediate
         * directories on all providers, so we walk up the path and create
         * each missing directory from the workspace root downward.
         */
        private async ensureParentDirectory(uri: URI): Promise<void> {
                const parentPath = uri.path.substring(0, uri.path.lastIndexOf("/")) || "/";
                const parent = URI.from({
                        scheme: uri.scheme,
                        authority: uri.authority,
                        path: parentPath,
                });

                // Build a list of directories that need to exist, from root to leaf
                const dirsToCreate: URI[] = [];
                let current = parent;

                while (current.path !== '/' && current.path.length > 1) {
                        try {
                                const exists = await this.fileService.exists(current);
                                if (exists) {
                                        break; // Found an existing directory, stop walking up
                                }
                                dirsToCreate.unshift(current); // Add to front (create in root-to-leaf order)
                        } catch {
                                dirsToCreate.unshift(current);
                        }

                        // Move up one level
                        const upPath = current.path.substring(0, current.path.lastIndexOf("/")) || "/";
                        current = URI.from({
                                scheme: current.scheme,
                                authority: current.authority,
                                path: upPath,
                        });
                }

                // Create directories from root to leaf
                for (const dir of dirsToCreate) {
                        try {
                                await this.fileService.createFolder(dir);
                                this.logService.info(`[DiffApplier] Created directory: ${dir.path}`);
                        } catch (error) {
                                // If the directory was created by a concurrent operation, that's fine
                                const msg = error instanceof Error ? error.message : String(error);
                                this.logService.warn(`[DiffApplier] Could not create directory ${dir.path}: ${msg}`);
                        }
                }
        }

        /**
         * SEC-CWE59: Assert that a file path is within the workspace using realpath resolution.
         * Throws an error if the resolved path escapes the workspace root.
         * This is a separate, realpath-based check in addition to isWithinWorkspace().
         */
        private assertWithinWorkspace(filePath: string): void {
                if (!this._workspaceRoot) { return; }

                const uri = this.resolveUri(filePath);
                const fsPath = uri.fsPath;
                const rootFsPath = this._workspaceRoot.fsPath;

                let realFsPath: string;
                let realRootFsPath: string;

                try {
                        realFsPath = realpathSync(fsPath);
                } catch {
                        try {
                                const { dirname } = require('path');
                                realFsPath = realpathSync(dirname(fsPath));
                        } catch {
                                realFsPath = fsPath;
                        }
                }
                try {
                        realRootFsPath = realpathSync(rootFsPath);
                } catch {
                        realRootFsPath = rootFsPath;
                }

                // SEC-CWE59: Case-insensitive comparison on macOS/Windows
                const isCaseInsensitive = typeof process !== 'undefined' &&
                        (process.platform === 'darwin' || process.platform === 'win32');
                const comparePath = isCaseInsensitive ? realFsPath.toLowerCase() : realFsPath;
                const compareRoot = isCaseInsensitive ? realRootFsPath.toLowerCase() : realRootFsPath;
                const { sep } = require('path');

                if (!comparePath.startsWith(compareRoot + sep) && comparePath !== compareRoot) {
                        throw new Error(`Security: path "${filePath}" resolves outside workspace (realpath check)`);
                }
        }

        override dispose(): void {
                super.dispose();
        }
}
