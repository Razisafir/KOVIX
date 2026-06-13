// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.


import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IConstructChatHistory, IChatSession, IChatHistoryMessage } from '../common/memory/vectorStore.js';

/**
 * ConstructChatHistoryService — SQLite-backed chat history store.
 *
 * Uses better-sqlite3 for fast, synchronous access to chat history.
 * The database file is stored at .construct/chat-history.db in the
 * workspace root directory.
 *
 * OFFLINE FIRST: SQLite runs entirely locally. No network required.
 *
 * Schema:
 * - sessions: id, title, createdAt, updatedAt
 * - messages: id, sessionId, role, content, toolCalls, toolCallId, createdAt
 */
export class ConstructChatHistoryService extends Disposable implements IConstructChatHistory {
        readonly _serviceBrand: undefined;

        private _db: unknown = null;
        private _initialized = false;

        constructor(
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[ChatHistory] Service created');
        }

        async initialize(workspaceRoot: string): Promise<boolean> {
                try {
                        const fs = await import('fs');
                        const path = await import('path');
                        const Database = (await import('better-sqlite3')).default;

                        // Ensure .construct directory exists
                        const constructDir = path.join(workspaceRoot, '.construct');
                        if (!fs.existsSync(constructDir)) {
                                fs.mkdirSync(constructDir, { recursive: true });
                        }

                        const dbPath = path.join(constructDir, 'chat-history.db');
                        this._db = new Database(dbPath);

                        // Enable WAL mode for better concurrent read performance
                        const db = this._db as { exec: (sql: string) => void; prepare: (sql: string) => unknown };
                        db.exec('PRAGMA journal_mode = WAL');
                        db.exec('PRAGMA foreign_keys = ON');

                        // Create tables if they don't exist
                        db.exec(`
                                CREATE TABLE IF NOT EXISTS sessions (
                                        id TEXT PRIMARY KEY,
                                        title TEXT NOT NULL DEFAULT '',
                                        createdAt INTEGER NOT NULL,
                                        updatedAt INTEGER NOT NULL
                                );

                                CREATE TABLE IF NOT EXISTS messages (
                                        id TEXT PRIMARY KEY,
                                        sessionId TEXT NOT NULL,
                                        role TEXT NOT NULL,
                                        content TEXT NOT NULL,
                                        toolCalls TEXT,
                                        toolCallId TEXT,
                                        createdAt INTEGER NOT NULL,
                                        FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
                                );

                                CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
                                CREATE INDEX IF NOT EXISTS idx_messages_createdAt ON messages(createdAt);
                                CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt ON sessions(updatedAt);
                        `);

                        this._initialized = true;
                        this.logService.info('[ChatHistory] Initialized at ' + dbPath);
                        return true;
                } catch (error) {
                        this._initialized = false;
                        this.logService.error('[ChatHistory] Failed to initialize: ' + (error instanceof Error ? error.message : String(error)));
                        return false;
                }
        }

        isInitialized(): boolean {
                return this._initialized;
        }

        async createSession(title?: string): Promise<IChatSession> {
                const now = Date.now();
                const session: IChatSession = {
                        id: 'session_' + now.toString(36) + '_' + Math.random().toString(36).substring(2, 8),
                        title: title ?? 'New Chat',
                        createdAt: now,
                        updatedAt: now,
                };

                const db = this._db as { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
                db.prepare('INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run(
                        session.id, session.title, session.createdAt, session.updatedAt
                );

                return session;
        }

        async getSession(sessionId: string): Promise<IChatSession | undefined> {
                const db = this._db as { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
                const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Record<string, unknown> | undefined;
                if (!row) { return undefined; }
                return {
                        id: String(row.id),
                        title: String(row.title),
                        createdAt: Number(row.createdAt),
                        updatedAt: Number(row.updatedAt),
                };
        }

        async listSessions(): Promise<IChatSession[]> {
                const db = this._db as { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
                const rows = db.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC').all() as Array<Record<string, unknown>>;
                return rows.map(row => ({
                        id: String(row.id),
                        title: String(row.title),
                        createdAt: Number(row.createdAt),
                        updatedAt: Number(row.updatedAt),
                }));
        }

        async addMessage(sessionId: string, role: IChatHistoryMessage['role'], content: string, toolCalls?: string, toolCallId?: string): Promise<IChatHistoryMessage> {
                const now = Date.now();
                const message: IChatHistoryMessage = {
                        id: 'msg_' + now.toString(36) + '_' + Math.random().toString(36).substring(2, 8),
                        sessionId,
                        role,
                        content,
                        toolCalls,
                        toolCallId,
                        createdAt: now,
                };

                const db = this._db as { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
                const insertMsg = db.prepare('INSERT INTO messages (id, sessionId, role, content, toolCalls, toolCallId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
                const updateSession = db.prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?');

                // Use a transaction for atomicity
                const transaction = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
                        insertMsg.run(message.id, sessionId, role, content, toolCalls ?? null, toolCallId ?? null, now);
                        updateSession.run(now, sessionId);
                });
                transaction();

                return message;
        }

        async getMessages(sessionId: string): Promise<IChatHistoryMessage[]> {
                const db = this._db as { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
                const rows = db.prepare('SELECT * FROM messages WHERE sessionId = ? ORDER BY createdAt ASC').all(sessionId) as Array<Record<string, unknown>>;
                return rows.map(row => ({
                        id: String(row.id),
                        sessionId: String(row.sessionId),
                        role: String(row.role) as IChatHistoryMessage['role'],
                        content: String(row.content),
                        toolCalls: row.toolCalls ? String(row.toolCalls) : undefined,
                        toolCallId: row.toolCallId ? String(row.toolCallId) : undefined,
                        createdAt: Number(row.createdAt),
                }));
        }

        async deleteSession(sessionId: string): Promise<void> {
                const db = this._db as { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
                db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        }

        async getOrCreateCurrentSession(): Promise<IChatSession> {
                const sessions = await this.listSessions();
                if (sessions.length > 0) {
                        return sessions[0]; // Most recent session
                }
                return this.createSession();
        }

                override dispose(): void {
                if (this._db) {
                        try {
                                const db = this._db as { close: () => void };
                                db.close();
                        } catch {
                                // Ignore close errors
                        }
                        this._db = null;
                }
                this._initialized = false;
                super.dispose();
        }
}
