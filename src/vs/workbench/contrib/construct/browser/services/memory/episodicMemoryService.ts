/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEpisodicMemoryService } from '../../../../platform/construct/common/memory/episodicMemory.js';
import { IEpisodicMemoryEntry, MemoryLayer } from '../../../../platform/construct/common/memory/memoryTypes.js';

interface IInMemoryEpisode {
	entry: IEpisodicMemoryEntry;
	sequence: number;
}

export class EpisodicMemoryService extends Disposable implements IEpisodicMemoryService {
	readonly _serviceBrand: undefined;

	private episodes = new Map<string, IInMemoryEpisode[]>();
	private sequences = new Map<string, number>();

	private readonly _onDidRecordEvent = this._register(new Emitter<IEpisodicMemoryEntry>());
	readonly onDidRecordEvent = this._onDidRecordEvent.event;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	recordEvent(entry: Omit<IEpisodicMemoryEntry, 'id' | 'layer' | 'timestamp'>): void {
		const projectId = entry.projectId;
		const now = Date.now();
		const seq = (this.sequences.get(projectId) ?? 0) + 1;
		this.sequences.set(projectId, seq);

		const fullEntry: IEpisodicMemoryEntry = {
			...entry,
			id: `episodic-${projectId}-${now}-${seq}`,
			layer: MemoryLayer.Episodic,
			timestamp: now
		};

		const projectEpisodes = this.episodes.get(projectId) ?? [];
		projectEpisodes.push({ entry: fullEntry, sequence: seq });
		this.episodes.set(projectId, projectEpisodes);

		this._onDidRecordEvent.fire(fullEntry);
		this.logService.info(`[EpisodicMemory] Recorded: ${entry.action} (${entry.success ? 'success' : 'failure'})`);
	}

	getRecentEvents(projectId: string, limit: number): IEpisodicMemoryEntry[] {
		const episodes = this.episodes.get(projectId) ?? [];
		return episodes
			.sort((a, b) => b.sequence - a.sequence)
			.slice(0, limit)
			.map(e => e.entry);
	}

	getEventsByTimeRange(projectId: string, start: number, end: number): IEpisodicMemoryEntry[] {
		const episodes = this.episodes.get(projectId) ?? [];
		return episodes
			.filter(e => e.entry.timestamp >= start && e.entry.timestamp <= end)
			.sort((a, b) => b.sequence - a.sequence)
			.map(e => e.entry);
	}

	searchEvents(projectId: string, query: string): IEpisodicMemoryEntry[] {
		const lowerQuery = query.toLowerCase();
		const episodes = this.episodes.get(projectId) ?? [];
		return episodes
			.filter(e =>
				e.entry.action.toLowerCase().includes(lowerQuery) ||
				e.entry.outcome.toLowerCase().includes(lowerQuery) ||
				e.entry.content.toLowerCase().includes(lowerQuery) ||
				(e.entry.errorMessage?.toLowerCase()?.includes(lowerQuery) ?? false)
			)
			.sort((a, b) => b.sequence - a.sequence)
			.map(e => e.entry);
	}

	getEventsByActionType(projectId: string, actionType: string): IEpisodicMemoryEntry[] {
		const episodes = this.episodes.get(projectId) ?? [];
		return episodes
			.filter(e => e.entry.action === actionType)
			.sort((a, b) => b.sequence - a.sequence)
			.map(e => e.entry);
	}

	summarizeSession(projectId: string, sessionId: string): string {
		const episodes = this.episodes.get(projectId) ?? [];
		const sessionEpisodes = episodes.filter(e => e.entry.taskId === sessionId || e.entry.metadata?.sessionId === sessionId);

		if (sessionEpisodes.length === 0) { return 'No events recorded for this session.'; }

		const successes = sessionEpisodes.filter(e => e.entry.success).length;
		const failures = sessionEpisodes.length - successes;
		const totalDuration = sessionEpisodes.reduce((sum, e) => sum + e.entry.durationMs, 0);
		const filesTouched = new Set<string>();
		for (const e of sessionEpisodes) {
			for (const f of e.entry.filesAffected) { filesTouched.add(f); }
		}

		const actionCounts = new Map<string, number>();
		for (const e of sessionEpisodes) {
			actionCounts.set(e.entry.action, (actionCounts.get(e.entry.action) ?? 0) + 1);
		}

		const parts: string[] = [];
		parts.push(`Session Summary (${sessionId})`);
		parts.push(`Total events: ${sessionEpisodes.length} (${successes} success, ${failures} failure)`);
		parts.push(`Duration: ${(totalDuration / 1000).toFixed(1)}s`);
		parts.push(`Files touched: ${Array.from(filesTouched).join(', ')}`);
		parts.push('');
		parts.push('Actions breakdown:');
		for (const [action, count] of actionCounts.entries()) {
			parts.push(`  - ${action}: ${count}`);
		}

		return parts.join('\n');
	}

	getSessionIds(projectId: string): string[] {
		const episodes = this.episodes.get(projectId) ?? [];
		const ids = new Set<string>();
		for (const e of episodes) {
			if (e.entry.taskId) { ids.add(e.entry.taskId); }
			if (e.entry.metadata?.sessionId) { ids.add(e.entry.metadata.sessionId); }
		}
		return Array.from(ids);
	}

	override dispose(): void {
		super.dispose();
	}
}
