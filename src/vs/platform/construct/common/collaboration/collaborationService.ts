/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Collaboration Service Interface
 *  Real-time multi-user collaboration service contract.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ICollaborationSession,
	ICollaborationPermission,
	ICollaborationState,
	IChatMessage,
	ICursorPosition,
	ISelection,
	ISharedAgent,
	IPresenceEvent,
	CollaborationRole
} from './collaborationTypes.js';

export const ICollaborationService = createDecorator<ICollaborationService>('construct.collaborationService');

export interface ICollaborationService extends IDisposable {
	readonly _serviceBrand: undefined;

	// ─── Session Lifecycle ──────────────────────────────────────────

	/** Create a new collaboration session for a project. Returns the session with a shareable link. */
	createSession(projectPath: string): Promise<ICollaborationSession>;

	/** Join an existing session by ID. */
	joinSession(sessionId: string, userInfo: { name: string; color: string }): Promise<ICollaborationSession>;

	/** Leave the specified session. */
	leaveSession(sessionId: string): Promise<void>;

	/** End a session for all participants (owner only). */
	endSession(sessionId: string): Promise<void>;

	/** Invite a user by email with a specified role. */
	inviteUser(sessionId: string, email: string, role: CollaborationRole): Promise<void>;

	// ─── Session Access ─────────────────────────────────────────────

	/** Get a session by ID, or undefined if not found. */
	getSession(sessionId: string): ICollaborationSession | undefined;

	/** Get all sessions the current user is part of. */
	getActiveSessions(): ICollaborationSession[];

	// ─── Real-time Presence ─────────────────────────────────────────

	/** Broadcast cursor position update to other participants. */
	updateCursor(sessionId: string, position: ICursorPosition): void;

	/** Broadcast text selection update to other participants. */
	updateSelection(sessionId: string, selection: ISelection): void;

	// ─── Chat ───────────────────────────────────────────────────────

	/** Send a chat message, optionally as a reply in a thread. */
	sendMessage(sessionId: string, content: string, threadId?: string): void;

	/** Retrieve recent chat messages. */
	getMessages(sessionId: string, limit?: number): IChatMessage[];

	// ─── Shared Agents ──────────────────────────────────────────────

	/** Share an agent with specified users (or all if no userIds). */
	shareAgent(sessionId: string, agentId: string, userIds?: string[]): void;

	/** Unshare an agent from the session. */
	unshareAgent(sessionId: string, agentId: string): void;

	// ─── Permissions ────────────────────────────────────────────────

	/** Get all permission records for a session. */
	getPermissions(sessionId: string): ICollaborationPermission[];

	/** Set a user's role in a session. */
	setPermission(sessionId: string, userId: string, role: CollaborationRole): void;

	// ─── State ──────────────────────────────────────────────────────

	/** Get the aggregated collaboration state for UI display. */
	getState(sessionId: string): ICollaborationState;

	// ─── Events ─────────────────────────────────────────────────────

	/** Fired when a user joins a session. */
	readonly onUserJoin: Event<{ sessionId: string; userId: string; name: string }>;

	/** Fired when a user leaves a session. */
	readonly onUserLeave: Event<{ sessionId: string; userId: string }>;

	/** Fired when any participant's cursor moves. */
	readonly onCursorChange: Event<{ sessionId: string; userId: string; position: ICursorPosition }>;

	/** Fired when any participant's selection changes. */
	readonly onSelectionChange: Event<{ sessionId: string; userId: string; selection: ISelection }>;

	/** Fired when a chat message is received. */
	readonly onMessageReceived: Event<{ sessionId: string; message: IChatMessage }>;

	/** Fired when an agent is shared or unshared. */
	readonly onAgentShared: Event<{ sessionId: string; agent: ISharedAgent }>;

	/** Fired when the collaboration state changes. */
	readonly onStateChange: Event<ICollaborationState>;

	/** Fired when a presence event occurs. */
	readonly onPresenceEvent: Event<IPresenceEvent>;
}
