// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IProceduralMemoryService } from '../../../../../../platform/construct/common/memory/proceduralMemory.js';
import { IProceduralMemoryEntry, MemoryLayer } from '../../../../../../platform/construct/common/memory/memoryTypes';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import * as path from '../../../../../../base/common/path.js';

export class ProceduralMemoryService extends Disposable implements IProceduralMemoryService {
        readonly _serviceBrand: undefined;

        private patterns = new Map<string, IProceduralMemoryEntry[]>();
        private _persistTimeout: ReturnType<typeof setTimeout> | undefined;

        private readonly _onDidRecordPattern = this._register(new Emitter<IProceduralMemoryEntry>());
        readonly onDidRecordPattern = this._onDidRecordPattern.event;

        private readonly _onDidUpdatePattern = this._register(new Emitter<IProceduralMemoryEntry>());
        readonly onDidUpdatePattern = this._onDidUpdatePattern.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
        ) {
                super();
                this.logService.info('[ProceduralMemory] Initialized with in-memory storage');
                this.loadFromDisk();
        }

        recordPattern(entry: Omit<IProceduralMemoryEntry, 'id' | 'layer' | 'timestamp' | 'successCount' | 'failureCount' | 'totalAttempts' | 'lastUsed' | 'createdAt'>): void {
                const now = Date.now();
                const hash = this.hashPattern(entry.pattern, entry.context);
                const id = `procedural-${entry.projectId}-${hash}`;

                const fullEntry: IProceduralMemoryEntry = {
                        ...entry,
                        id,
                        layer: MemoryLayer.Procedural,
                        timestamp: now,
                        successCount: 0,
                        failureCount: 0,
                        totalAttempts: 0,
                        lastUsed: now,
                        createdAt: now
                };

                const projectPatterns = this.patterns.get(entry.projectId) ?? [];
                projectPatterns.push(fullEntry);
                this.patterns.set(entry.projectId, projectPatterns);

                this._onDidRecordPattern.fire(fullEntry);
                this.logService.info(`[ProceduralMemory] Recorded pattern: ${id}`);

                this.debouncedPersist();
        }

        getPatternsForContext(projectId: string, context: string): IProceduralMemoryEntry[] {
                const lowerContext = context.toLowerCase();

                const patterns = this.patterns.get(projectId) ?? [];
                return patterns
                        .filter(p =>
                                p.context.toLowerCase().includes(lowerContext) ||
                                p.pattern.toLowerCase().includes(lowerContext)
                        )
                        .sort((a, b) => this.patternScore(b) - this.patternScore(a));
        }

        getSuccessfulPatterns(projectId: string, taskType: string): IProceduralMemoryEntry[] {
                const patterns = this.patterns.get(projectId) ?? [];
                return patterns
                        .filter(p => p.context.toLowerCase().includes(taskType.toLowerCase()))
                        .sort((a, b) => this.patternScore(b) - this.patternScore(a));
        }

        updatePatternSuccess(projectId: string, id: string, success: boolean): void {
                const projectPatterns = this.patterns.get(projectId) ?? [];
                const pattern = projectPatterns.find(p => p.id === id);

                if (pattern) {
                        const updated: IProceduralMemoryEntry = {
                                ...pattern,
                                totalAttempts: pattern.totalAttempts + 1,
                                successCount: pattern.successCount + (success ? 1 : 0),
                                failureCount: pattern.failureCount + (success ? 0 : 1),
                                lastUsed: Date.now()
                        };

                        const idx = projectPatterns.indexOf(pattern);
                        projectPatterns[idx] = updated;
                        this._onDidUpdatePattern.fire(updated);
                }

                this.logService.info(`[ProceduralMemory] Updated pattern ${id}: ${success ? 'success' : 'failure'}`);

                this.debouncedPersist();
        }

        getPatternLeaderboard(projectId: string): IProceduralMemoryEntry[] {
                const patterns = this.patterns.get(projectId) ?? [];
                return [...patterns].sort((a, b) => this.patternScore(b) - this.patternScore(a)).slice(0, 50);
        }

        async extractPatternsFromEpisodes(projectId: string, episodes: string[]): Promise<void> {
                this.logService.info(`[ProceduralMemory] Extracting patterns from ${episodes.length} episodes...`);

                const commonPhrases = this.findCommonPhrases(episodes);
                for (const phrase of commonPhrases) {
                        this.recordPattern({
                                projectId,
                                pattern: phrase,
                                context: 'auto-extracted',
                                content: `Auto-extracted pattern: ${phrase}`,
                                examples: episodes.filter(e => e.includes(phrase)).slice(0, 3)
                        });
                }
        }

        // --- Private Helpers -------------------------------------------------------

        private hashPattern(pattern: string, context: string): string {
                let hash = 0;
                const str = pattern + '|' + context;
                for (let i = 0; i < str.length; i++) {
                        const char = str.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash;
                }
                return Math.abs(hash).toString(36);
        }

        private patternScore(pattern: IProceduralMemoryEntry): number {
                if (pattern.totalAttempts === 0) { return 0; }
                const successRate = pattern.successCount / pattern.totalAttempts;
                return successRate * Math.log(pattern.totalAttempts + 1);
        }

        private findCommonPhrases(episodes: string[]): string[] {
                const phrases: Map<string, number> = new Map();
                for (const episode of episodes) {
                        const words = episode.toLowerCase().split(/\s+/);
                        for (let i = 0; i < words.length - 2; i++) {
                                const phrase = words.slice(i, i + 3).join(' ');
                                phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
                        }
                }

                return Array.from(phrases.entries())
                        .filter(([_, count]) => count > 1)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([phrase, _]) => phrase);
        }

        // --- Disk Persistence -------------------------------------------------------

        private debouncedPersist(): void {
                if (this._persistTimeout) {
                        clearTimeout(this._persistTimeout);
                }
                this._persistTimeout = setTimeout(() => this.persistToDisk(), 1000);
        }

        private async persistToDisk(): Promise<void> {
                try {
                        const data = JSON.stringify(Array.from(this.patterns.entries()));
                        const storagePath = this.getStoragePath();
                        await this.fileService.writeFile(storagePath, VSBuffer.fromString(data));
                } catch (e) {
                        this.logService.warn('[ProceduralMemory] Failed to persist:', e);
                }
        }

        private async loadFromDisk(): Promise<void> {
                try {
                        const storagePath = this.getStoragePath();
                        const content = await this.fileService.readFile(storagePath);
                        const entries = JSON.parse(content.value.toString());
                        this.patterns = new Map(entries);
                } catch (e) {
                        /* first run, no file yet */
                }
        }

        private getStoragePath(): URI {
                const workspace = this.workspaceContextService.getWorkspace();
                const root = workspace.folders[0]?.uri.fsPath || '';
                return URI.file(path.join(root, '.kovix', 'memory', 'procedural', 'store.json'));
        }

        override dispose(): void {
                if (this._persistTimeout) {
                        clearTimeout(this._persistTimeout);
                }
                this.patterns.clear();
                super.dispose();
        }
}
