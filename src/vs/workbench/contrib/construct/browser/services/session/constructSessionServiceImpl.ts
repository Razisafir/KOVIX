/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IConstructSessionService, IConstructSession } from '../../../../../../platform/construct/common/session/constructSessionService.js';

/**
 * Storage key for persisting session data.
 */
const SESSIONS_STORAGE_KEY = 'construct.sessions';

/**
 * Default title assigned to sessions when no title is provided.
 */
const DEFAULT_SESSION_TITLE = 'New Session';

/**
 * Maximum number of sessions to keep in storage.
 * Oldest sessions are pruned when this limit is exceeded.
 */
const MAX_SESSIONS = 100;

/**
 * Implementation of IConstructSessionService that uses the VS Code
 * IStorageService for persistence. Sessions survive across IDE restarts
 * via workspace-scoped machine-targeted storage.
 *
 * Each session stores minimal metadata (id, title, timestamps, provider/model)
 * while the full conversation history is managed by the ChatHistoryService
 * through IPC.
 */
export class ConstructSessionServiceImpl extends Disposable implements IConstructSessionService {
	readonly _serviceBrand: undefined;

	private readonly _onDidCreateSession = this._register(new Emitter<IConstructSession>());
	readonly onDidCreateSession = this._onDidCreateSession.event;

	private readonly _onDidDeleteSession = this._register(new Emitter<string>());
	readonly onDidDeleteSession = this._onDidDeleteSession.event;

	private readonly _onDidChangeActiveSession = this._register(new Emitter<IConstructSession | null>());
	readonly onDidChangeActiveSession = this._onDidChangeActiveSession.event;

	private _sessions: IConstructSession[] = [];
	private _activeSession: IConstructSession | null = null;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._sessions = this.loadSessionsFromStorage();
		this.logService.info(`[ConstructSession] Loaded ${this._sessions.length} sessions from storage`);
	}

	get activeSession(): IConstructSession | null {
		return this._activeSession;
	}

	get sessions(): ReadonlyArray<IConstructSession> {
		return this._sessions;
	}

	async createSession(title?: string): Promise<IConstructSession> {
		const now = Date.now();
		const session: IConstructSession = {
			id: generateUuid(),
			title: title ?? DEFAULT_SESSION_TITLE,
			createdAt: now,
			lastActiveAt: now,
			messageCount: 0,
		};

		this._sessions.unshift(session);
		this.pruneOldSessions();
		this.persistSessions();

		this._activeSession = session;
		this._onDidCreateSession.fire(session);
		this._onDidChangeActiveSession.fire(session);

		this.logService.info(`[ConstructSession] Created session: ${session.id} "${session.title}"`);
		return session;
	}

	async deleteSession(id: string): Promise<void> {
		const index = this._sessions.findIndex(s => s.id === id);
		if (index === -1) {
			this.logService.warn(`[ConstructSession] Delete failed — session not found: ${id}`);
			return;
		}

		this._sessions.splice(index, 1);
		this.persistSessions();

		// If the deleted session was active, clear the active session
		if (this._activeSession?.id === id) {
			this._activeSession = null;
			this._onDidChangeActiveSession.fire(null);
		}

		this._onDidDeleteSession.fire(id);
		this.logService.info(`[ConstructSession] Deleted session: ${id}`);
	}

	async switchToSession(id: string): Promise<void> {
		const session = this._sessions.find(s => s.id === id);
		if (!session) {
			this.logService.warn(`[ConstructSession] Switch failed — session not found: ${id}`);
			return;
		}

		// Update lastActiveAt
		const updated: IConstructSession = {
			...session,
			lastActiveAt: Date.now(),
		};

		// Replace in the array
		const index = this._sessions.findIndex(s => s.id === id);
		this._sessions[index] = updated;

		this._activeSession = updated;
		this.persistSessions();

		this._onDidChangeActiveSession.fire(updated);
		this.logService.info(`[ConstructSession] Switched to session: ${id} "${updated.title}"`);
	}

	getSession(id: string): IConstructSession | undefined {
		return this._sessions.find(s => s.id === id);
	}

	async renameSession(id: string, newTitle: string): Promise<void> {
		const index = this._sessions.findIndex(s => s.id === id);
		if (index === -1) {
			this.logService.warn(`[ConstructSession] Rename failed — session not found: ${id}`);
			return;
		}

		const existing = this._sessions[index];
		const updated: IConstructSession = {
			...existing,
			title: newTitle,
		};

		this._sessions[index] = updated;
		this.persistSessions();

		// If this is the active session, update the reference
		if (this._activeSession?.id === id) {
			this._activeSession = updated;
			this._onDidChangeActiveSession.fire(updated);
		}

		this.logService.info(`[ConstructSession] Renamed session ${id} to "${newTitle}"`);
	}

	// --- Public Helpers -------------------------------------------------------

	/**
	 * Auto-generate a session title from the first user message.
	 * Called by the agent loop after the first message is sent.
	 */
	updateSessionFromFirstMessage(sessionId: string, firstMessage: string): void {
		const index = this._sessions.findIndex(s => s.id === sessionId);
		if (index === -1) {
			return;
		}

		// Only auto-generate title if it's still the default
		const existing = this._sessions[index];
		if (existing.title !== DEFAULT_SESSION_TITLE) {
			return;
		}

		// Generate a concise title from the first message
		const title = this.generateTitleFromMessage(firstMessage);
		const updated: IConstructSession = {
			...existing,
			title,
			messageCount: 1,
		};

		this._sessions[index] = updated;

		if (this._activeSession?.id === sessionId) {
			this._activeSession = updated;
		}

		this.persistSessions();
		this.logService.info(`[ConstructSession] Auto-titled session ${sessionId}: "${title}"`);
	}

	/**
	 * Increment the message count for a session.
	 */
	incrementMessageCount(sessionId: string): void {
		const index = this._sessions.findIndex(s => s.id === sessionId);
		if (index === -1) {
			return;
		}

		const existing = this._sessions[index];
		const updated: IConstructSession = {
			...existing,
			messageCount: existing.messageCount + 1,
			lastActiveAt: Date.now(),
		};

		this._sessions[index] = updated;

		if (this._activeSession?.id === sessionId) {
			this._activeSession = updated;
		}

		this.persistSessions();
	}

	/**
	 * Update the provider/model info for a session.
	 */
	updateSessionProviderInfo(sessionId: string, providerType?: string, modelId?: string): void {
		const index = this._sessions.findIndex(s => s.id === sessionId);
		if (index === -1) {
			return;
		}

		const existing = this._sessions[index];
		const updated: IConstructSession = {
			...existing,
			providerType,
			modelId,
		};

		this._sessions[index] = updated;

		if (this._activeSession?.id === sessionId) {
			this._activeSession = updated;
		}

		this.persistSessions();
	}

	// --- Private: Storage -----------------------------------------------------

	private loadSessionsFromStorage(): IConstructSession[] {
		try {
			const raw = this.storageService.get(SESSIONS_STORAGE_KEY, StorageScope.WORKSPACE);
			if (!raw) {
				return [];
			}

			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) {
				this.logService.warn('[ConstructSession] Invalid session data in storage — resetting');
				return [];
			}

			// Validate each session has required fields
			return parsed.filter((s: any) =>
				typeof s?.id === 'string' &&
				typeof s?.title === 'string' &&
				typeof s?.createdAt === 'number' &&
				typeof s?.lastActiveAt === 'number'
			) as IConstructSession[];
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[ConstructSession] Failed to load sessions from storage: ${msg}`);
			return [];
		}
	}

	private persistSessions(): void {
		try {
			const data = JSON.stringify(this._sessions);
			this.storageService.store(SESSIONS_STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logService.error(`[ConstructSession] Failed to persist sessions: ${msg}`);
		}
	}

	private pruneOldSessions(): void {
		if (this._sessions.length <= MAX_SESSIONS) {
			return;
		}

		// Sort by lastActiveAt, keep the most recent
		this._sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
		const removed = this._sessions.splice(MAX_SESSIONS);

		this.logService.info(`[ConstructSession] Pruned ${removed.length} old sessions (limit: ${MAX_SESSIONS})`);
	}

	// --- Private: Title Generation --------------------------------------------

	private generateTitleFromMessage(message: string): string {
		// Take the first line, truncate to 60 chars
		const firstLine = message.split('\n')[0].trim();

		if (firstLine.length <= 60) {
			return firstLine;
		}

		// Try to break at a word boundary
		const truncated = firstLine.substring(0, 57);
		const lastSpace = truncated.lastIndexOf(' ');
		if (lastSpace > 30) {
			return truncated.substring(0, lastSpace) + '...';
		}

		return truncated + '...';
	}

	override dispose(): void {
		this._sessions = [];
		this._activeSession = null;
		super.dispose();
	}
}
