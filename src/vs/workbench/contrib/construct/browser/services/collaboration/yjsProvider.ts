/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Yjs CRDT Provider
 *  Manages Yjs documents, awareness protocol, and persistence for collaboration.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as Y from 'yjs';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';

/**
 * YjsProvider manages CRDT documents for real-time collaboration.
 *
 * It wraps the Yjs library to provide:
 * - Document creation per session (Y.Doc)
 * - Shared text types for collaborative editing (Y.Text)
 * - Map types for metadata (Y.Map)
 * - Array types for chat messages (Y.Array)
 * - Awareness protocol for presence (cursors, selections, user info)
 * - Persistence via IStorageService for offline recovery
 * - Binary encoding using Yjs update format (Uint8Array)
 */
export class YjsProvider extends Disposable {

        /** Cache of active Yjs documents keyed by session ID. */
        private readonly _docs = new Map<string, Y.Doc>();

        /** Cache of awareness instances keyed by session ID. */
        private readonly _awareness = new Map<string, ICollabAwareness>();

        /** Storage key prefix for persisting Yjs updates. */
        private static readonly STORAGE_PREFIX = 'construct.collab.yjs.';

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
        ) {
                super();
        }

        // ─── Document Management ────────────────────────────────────────

        /**
         * Create a new Y.Doc for a session.
         * Sets up shared types: text, map, array.
         */
        createDoc(sessionId: string): Y.Doc {
                if (this._docs.has(sessionId)) {
                        return this._docs.get(sessionId)!;
                }

                const doc = new Y.Doc();

                // Define shared types
                doc.getArray('messages');     // Y.Array for chat messages
                doc.getMap('metadata');       // Y.Map for session metadata
                doc.getMap('cursors');        // Y.Map for cursor positions
                doc.getMap('selections');     // Y.Map for text selections
                doc.getMap('agents');         // Y.Map for shared agent state

                // Load persisted state if available
                this._loadPersistedState(sessionId, doc);

                // Listen for document updates and persist them
                doc.on('update', (update: Uint8Array) => {
                        this._persistUpdate(sessionId, update);
                });

                this._docs.set(sessionId, doc);
                this.logService.trace(`[YjsProvider] Created Y.Doc for session ${sessionId}`);
                return doc;
        }

        /**
         * Get an existing Y.Doc for a session.
         */
        getDoc(sessionId: string): Y.Doc | undefined {
                return this._docs.get(sessionId);
        }

        /**
         * Destroy and clean up a Y.Doc for a session.
         */
        destroyDoc(sessionId: string): void {
                const doc = this._docs.get(sessionId);
                if (doc) {
                        doc.destroy();
                        this._docs.delete(sessionId);
                }
                const awareness = this._awareness.get(sessionId);
                if (awareness) {
                        awareness.destroy();
                        this._awareness.delete(sessionId);
                }
                this.logService.trace(`[YjsProvider] Destroyed Y.Doc for session ${sessionId}`);
        }

        // ─── Awareness Protocol ─────────────────────────────────────────

        /**
         * Create or get an awareness instance for a session.
         * Awareness tracks user presence: cursor position, selection, user info.
         */
        getOrCreateAwareness(sessionId: string, doc: Y.Doc, localUserId: string): ICollabAwareness {
                if (this._awareness.has(sessionId)) {
                        return this._awareness.get(sessionId)!;
                }

                const awareness = this._createAwareness(doc, localUserId);
                this._awareness.set(sessionId, awareness);
                return awareness;
        }

        /**
         * Update a user's presence state in awareness.
         */
        updateAwareness(sessionId: string, userId: string, state: Record<string, unknown>): void {
                const awareness = this._awareness.get(sessionId);
                if (!awareness) {
                        this.logService.warn(`[YjsProvider] No awareness for session ${sessionId}`);
                        return;
                }

                // Set local state
                awareness.setLocalStateField(userId, state);
        }

        /**
         * Get all awareness states for a session.
         */
        getAwarenessStates(sessionId: string): Map<number, Record<string, unknown>> {
                const awareness = this._awareness.get(sessionId);
                if (!awareness) {
                        return new Map();
                }
                return awareness.getStates();
        }

        // ─── Shared Types ───────────────────────────────────────────────

        /**
         * Get the shared messages array for a session.
         */
        getMessagesArray(sessionId: string): unknown[] {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return [];
                }
                const messages = doc.getArray('messages');
                return messages.toArray();
        }

        /**
         * Push a chat message to the shared array.
         */
        pushMessage(sessionId: string, message: Record<string, unknown>): void {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        this.logService.warn(`[YjsProvider] No doc for session ${sessionId}`);
                        return;
                }
                const messages = doc.getArray<Y.Map<unknown>>('messages');
                doc.transact(() => {
                        const msgMap = new Y.Map();
                        Object.entries(message).forEach(([key, value]) => {
                                msgMap.set(key, value);
                        });
                        messages.push([msgMap]);
                });
        }

        /**
         * Update a metadata entry in the shared map.
         */
        setMetadata(sessionId: string, key: string, value: unknown): void {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return;
                }
                doc.getMap('metadata').set(key, value);
        }

        /**
         * Get a metadata entry from the shared map.
         */
        getMetadata(sessionId: string, key: string): unknown {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return undefined;
                }
                return doc.getMap('metadata').get(key);
        }

        /**
         * Update cursor position for a user.
         */
        setCursor(sessionId: string, userId: string, position: { file: string; line: number; column: number }): void {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return;
                }
                const cursors = doc.getMap<Y.Map<unknown>>('cursors');
                let cursorMap = cursors.get(userId);
                if (!cursorMap) {
                        cursorMap = new Y.Map();
                        cursors.set(userId, cursorMap);
                }
                cursorMap.set('file', position.file);
                cursorMap.set('line', position.line);
                cursorMap.set('column', position.column);
                cursorMap.set('timestamp', Date.now());
        }

        /**
         * Get all cursor positions.
         */
        getAllCursors(sessionId: string): Map<string, { file: string; line: number; column: number; timestamp: number }> {
                const result = new Map<string, { file: string; line: number; column: number; timestamp: number }>();
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return result;
                }
                const cursors = doc.getMap<Y.Map<unknown>>('cursors');
                for (const [userId, cursorMap] of cursors.entries()) {
                        result.set(userId, {
                                file: cursorMap.get('file') as string,
                                line: cursorMap.get('line') as number,
                                column: cursorMap.get('column') as number,
                                timestamp: cursorMap.get('timestamp') as number
                        });
                }
                return result;
        }

        // ─── Sync ───────────────────────────────────────────────────────

        /**
         * Encode the full document state as a binary Uint8Array.
         */
        encodeState(sessionId: string): Uint8Array | null {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return null;
                }
                return Y.encodeStateAsUpdate(doc);
        }

        /**
         * Apply a remote update to a document.
         */
        applyUpdate(sessionId: string, update: Uint8Array): void {
                const doc = this._docs.get(sessionId);
                if (!doc) {
                        return;
                }
                Y.applyUpdate(doc, update);
        }

        // ─── Persistence ────────────────────────────────────────────────

        /**
         * Persist a Yjs update to IStorageService for offline recovery.
         */
        private _persistUpdate(sessionId: string, update: Uint8Array): void {
                try {
                        const key = YjsProvider.STORAGE_PREFIX + sessionId;
                        const existing = this.storageService.get(key, StorageScope.WORKSPACE, '');
                        // Append the new update (base64 encoded) with a separator
                        const encoded = this._uint8ToBase64(update);
                        const value = existing ? existing + '|' + encoded : encoded;
                        this.storageService.store(key, value, StorageScope.WORKSPACE, StorageTarget.MACHINE);
                } catch (e) {
                        this.logService.warn(`[YjsProvider] Failed to persist update for session ${sessionId}: ${e}`);
                }
        }

        /**
         * Load persisted Yjs state from IStorageService.
         */
        private _loadPersistedState(sessionId: string, doc: Y.Doc): void {
                try {
                        const key = YjsProvider.STORAGE_PREFIX + sessionId;
                        const stored = this.storageService.get(key, StorageScope.WORKSPACE, '');
                        if (!stored) {
                                return;
                        }

                        const parts = stored.split('|');
                        for (const part of parts) {
                                if (part) {
                                        const update = this._base64ToUint8(part);
                                        Y.applyUpdate(doc, update);
                                }
                        }
                        this.logService.trace(`[YjsProvider] Loaded persisted state for session ${sessionId} (${parts.length} updates)`);
                } catch (e) {
                        this.logService.warn(`[YjsProvider] Failed to load persisted state for session ${sessionId}: ${e}`);
                }
        }

        // ─── Helpers ────────────────────────────────────────────────────

        /**
         * Create a minimal awareness instance.
         * In production, this would use y-protocols/awareness.
         */
        private _createAwareness(_doc: Y.Doc, localUserId: string): ICollabAwareness {
                const states = new Map<number, Record<string, unknown>>();
                let localClientId = 0;

                const awareness: ICollabAwareness = {
                        getStates: () => states,
                        setLocalStateField: (field: string, value: unknown) => {
                                const existing = states.get(localClientId) ?? {};
                                states.set(localClientId, { ...existing, [field]: value });
                        },
                        getLocalState: () => states.get(localClientId),
                        setLocalState: (state: Record<string, unknown>) => {
                                states.set(localClientId, state);
                        },
                        destroy: () => {
                                states.clear();
                        },
                        clientID: localClientId,
                };

                // Register local user
                states.set(localClientId, { userId: localUserId });
                return awareness;
        }

        /**
         * Convert a Uint8Array to a base64 string for storage.
         */
        private _uint8ToBase64(bytes: Uint8Array): string {
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                        binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
        }

        /**
         * Convert a base64 string back to Uint8Array.
         */
        private _base64ToUint8(base64: string): Uint8Array {
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                }
                return bytes;
        }

        override dispose(): void {
                super.dispose();
                // Destroy all documents
                for (const [, doc] of this._docs) {
                        try {
                                doc.destroy();
                        } catch {
                                // Best-effort cleanup
                        }
                }
                this._docs.clear();
                // Destroy all awareness instances
                for (const [, awareness] of this._awareness) {
                        try {
                                awareness.destroy();
                        } catch {
                                // Best-effort cleanup
                        }
                }
                this._awareness.clear();
        }
}

/**
 * Minimal awareness protocol interface for tracking user presence.
 * In production, this would be replaced by y-protocols/awareness.
 */
interface ICollabAwareness {
        getStates(): Map<number, Record<string, unknown>>;
        setLocalStateField(field: string, value: unknown): void;
        getLocalState(): Record<string, unknown> | undefined;
        setLocalState(state: Record<string, unknown>): void;
        destroy(): void;
        readonly clientID: number;
}
