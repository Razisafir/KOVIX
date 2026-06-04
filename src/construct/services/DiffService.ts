/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Diff Service (Diff-Based File Updates)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as Diff from 'diff';

export interface DiffResult {
        success: boolean;
        patchedContent: string;
        hunksApplied: number;
        conflicts: number;
}

export class DiffError extends Error {
        constructor(message: string) {
                super(message);
                this.name = 'DiffError';
        }
}

export class DiffService {
        /**
         * Apply a unified diff patch to content, preserving formatting.
         * Returns a DiffResult with details about the operation.
         */
        applyPatch(originalContent: string, patch: string): DiffResult {
                try {
                        const parsed = Diff.parsePatch(patch);
                        if (parsed.length === 0) {
                                // No hunks found — return original content unchanged
                                return {
                                        success: true,
                                        patchedContent: originalContent,
                                        hunksApplied: 0,
                                        conflicts: 0,
                                };
                        }

                        let patchedContent = originalContent;
                        let totalHunksApplied = 0;
                        let totalConflicts = 0;

                        for (const p of parsed) {
                                // Apply each parsed patch part
                                const result = Diff.applyPatch(patchedContent, p);
                                if (result === false) {
                                        // Patch failed to apply cleanly — try partial application
                                        totalConflicts++;
                                        continue;
                                }
                                patchedContent = result;
                                totalHunksApplied += (p.hunks?.length ?? 0);
                        }

                        return {
                                success: totalConflicts === 0,
                                patchedContent,
                                hunksApplied: totalHunksApplied,
                                conflicts: totalConflicts,
                        };
                } catch (err) {
                        if (err instanceof DiffError) throw err;
                        throw new DiffError(`Failed to apply patch: ${(err as Error).message}`);
                }
        }

        /**
         * Create a unified diff between two strings.
         */
        createPatch(oldContent: string, newContent: string, filePath: string = 'file'): string {
                return Diff.createPatch(filePath, oldContent, newContent, '', '');
        }

        /**
         * Apply a search/replace edit to content.
         * Falls back to line-by-line matching if exact match fails.
         */
        applyEdit(originalContent: string, search: string, replace: string): DiffResult {
                if (originalContent.includes(search)) {
                        const patchedContent = originalContent.replace(search, replace);
                        return {
                                success: true,
                                patchedContent,
                                hunksApplied: 1,
                                conflicts: 0,
                        };
                }

                // Try fuzzy matching — normalize whitespace
                const normalizedOriginal = originalContent.replace(/\s+/g, ' ').trim();
                const normalizedSearch = search.replace(/\s+/g, ' ').trim();

                if (normalizedOriginal.includes(normalizedSearch)) {
                        // Find the actual block in the original content
                        const lines = originalContent.split('\n');
                        const searchLines = search.split('\n').map(l => l.trim().replace(/\s+/g, ' '));
                        const replaceLines = replace.split('\n');

                        // Try to find the matching lines
                        for (let i = 0; i <= lines.length - searchLines.length; i++) {
                                let match = true;
                                for (let j = 0; j < searchLines.length; j++) {
                                        if (lines[i + j].trim().replace(/\s+/g, ' ') !== searchLines[j]) {
                                                match = false;
                                                break;
                                        }
                                }
                                if (match) {
                                        const newLines = [
                                                ...lines.slice(0, i),
                                                ...replaceLines,
                                                ...lines.slice(i + searchLines.length),
                                        ];
                                        return {
                                                success: true,
                                                patchedContent: newLines.join('\n'),
                                                hunksApplied: 1,
                                                conflicts: 0,
                                        };
                                }
                        }
                }

                return {
                        success: false,
                        patchedContent: originalContent,
                        hunksApplied: 0,
                        conflicts: 1,
                };
        }

        /**
         * Get a summary of changes between two strings.
         */
        getChangeSummary(oldContent: string, newContent: string): { added: number; removed: number; unchanged: number } {
                const changes = Diff.diffLines(oldContent, newContent);
                let added = 0;
                let removed = 0;
                let unchanged = 0;

                for (const change of changes) {
                        const lineCount = (change.count ?? 0);
                        if (change.added) {
                                added += lineCount;
                        } else if (change.removed) {
                                removed += lineCount;
                        } else {
                                unchanged += lineCount;
                        }
                }

                return { added, removed, unchanged };
        }
}
