/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const IConstructSessionService = createDecorator<IConstructSessionService>('construct.sessionService');

/**
 * A conversation session with the AI agent.
 */
export interface IConstructSession {
        /** Unique identifier for this session. */
        readonly id: string;
        /** Display title (auto-generated from first message or user-set). */
        readonly title: string;
        /** When this session was created. */
        readonly createdAt: number;
        /** When this session was last active. */
        readonly lastActiveAt: number;
        /** Number of messages in the session. */
        readonly messageCount: number;
        /** The AI provider used in this session. */
        readonly providerType?: string;
        /** The model used in this session. */
        readonly modelId?: string;
}

/**
 * Service for managing AI conversation sessions.
 *
 * P1 FIX: Currently, conversations are lost when the agent panel closes.
 * This service provides session persistence so users can resume
 * previous conversations across IDE restarts.
 *
 * Sessions are persisted via the ChatHistoryService (SQLite) through IPC.
 */
export interface IConstructSessionService {
        readonly _serviceBrand: undefined;

        /** Event fired when a session is created. */
        readonly onDidCreateSession: Event<IConstructSession>;
        /** Event fired when a session is deleted. */
        readonly onDidDeleteSession: Event<string>;
        /** Event fired when the active session changes. */
        readonly onDidChangeActiveSession: Event<IConstructSession | null>;

        /** Currently active session. */
        readonly activeSession: IConstructSession | null;

        /** All sessions, sorted by most recent first. */
        readonly sessions: ReadonlyArray<IConstructSession>;

        /**
         * Create a new session.
         */
        createSession(title?: string): Promise<IConstructSession>;

        /**
         * Delete a session and all its messages.
         */
        deleteSession(id: string): Promise<void>;

        /**
         * Switch to a different session.
         */
        switchToSession(id: string): Promise<void>;

        /**
         * Get a session by ID.
         */
        getSession(id: string): IConstructSession | undefined;

        /**
         * Rename a session.
         */
        renameSession(id: string, newTitle: string): Promise<void>;

        /**
         * Auto-generate a session title from the first user message.
         * Only updates the title if it is still the default.
         */
        updateSessionFromFirstMessage(sessionId: string, firstMessage: string): void;

        /**
         * Increment the message count for a session.
         */
        incrementMessageCount(sessionId: string): void;

        /**
         * Update the provider/model info for a session.
         */
        updateSessionProviderInfo(sessionId: string, providerType?: string, modelId?: string): void;
}
