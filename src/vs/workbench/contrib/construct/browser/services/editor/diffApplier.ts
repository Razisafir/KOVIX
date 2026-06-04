/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
		if (filePath.startsWith("file://") || filePath.startsWith("vscode://")) {
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
		// Check if the URI is within the workspace root
		return uri.path.startsWith(this._workspaceRoot.path);
	}

	async applyDiff(filePath: string, diff: string): Promise<IDiffApplyResult> {
		// Workspace validation
		if (!this.isWithinWorkspace(filePath)) {
			return {
				success: false,
				error: `Path "${filePath}" is outside the workspace root. Operation rejected for security.`,
			};
		}

		const uri = this.resolveUri(filePath);
		this.logService.info(`[DiffApplier] Applying diff to: ${filePath}`);

		try {
			// Read current file content (or empty if new file)
			let original = "";
			try {
				const content = await this.fileService.readFile(uri);
				original = content.value.toString();
			} catch {
				// File doesn't exist yet -- will be created
			}

			// Apply the unified diff
			const patched = this.applyUnifiedDiff(original, diff);
			if (patched === null) {
				return {
					success: false,
					error: `Failed to apply diff to "${filePath}". The diff may not match the file content.`,
				};
			}

			// Detect line ending from original file and normalize
			const lineEnding = this.detectLineEnding(original);
			const normalizedPatched =
				lineEnding === "\r\n" ? patched.replace(/(?<!\r)\n/g, "\r\n") : patched;

			// Ensure parent directory exists
			await this.ensureParentDirectory(uri);

			// Write the patched content with preserved line endings
			await this.fileService.writeFile(
				uri,
				VSBuffer.fromString(normalizedPatched),
			);

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
			throw new Error(`Path "${filePath}" is outside the workspace root.`);
		}

		const uri = this.resolveUri(filePath);
		await this.ensureParentDirectory(uri);
		await this.fileService.writeFile(uri, VSBuffer.fromString(content));
		this.logService.info(`[DiffApplier] File written: ${filePath}`);
	}

	async readFile(filePath: string): Promise<string> {
		const uri = this.resolveUri(filePath);
		try {
			const content = await this.fileService.readFile(uri);
			return content.value.toString();
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

		const uri = this.resolveUri(filePath);
		await this.ensureParentDirectory(uri);
		await this.fileService.writeFile(uri, VSBuffer.fromString(""));
		this.logService.info(`[DiffApplier] File created: ${filePath}`);
	}

	async deleteFile(filePath: string): Promise<void> {
		if (!this.isWithinWorkspace(filePath)) {
			throw new Error(`Path "${filePath}" is outside the workspace root.`);
		}

		const uri = this.resolveUri(filePath);
		await this.fileService.del(uri, { recursive: false, useTrash: true });
		this.logService.info(`[DiffApplier] File deleted: ${filePath}`);
	}

	async exists(filePath: string): Promise<boolean> {
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
	 * Detect the dominant line ending style from content.
	 */
	private detectLineEnding(content: string): string {
		const crlfCount = (content.match(/\r\n/g) ?? []).length;
		const lfCount = (content.match(/(?<!\r)\n/g) ?? []).length;
		return crlfCount > lfCount ? "\r\n" : "\n";
	}

	/**
	 * Ensure the parent directory of a URI exists.
	 */
	private async ensureParentDirectory(uri: URI): Promise<void> {
		const parentPath = uri.path.substring(0, uri.path.lastIndexOf("/")) || "/";
		const parent = URI.from({
			scheme: uri.scheme,
			authority: uri.authority,
			path: parentPath,
		});
		try {
			const exists = await this.fileService.exists(parent);
			if (!exists) {
				await this.fileService.createFolder(parent);
			}
		} catch {
			// Parent directory might be a root path
		}
	}

	override dispose(): void {
		super.dispose();
	}
}
