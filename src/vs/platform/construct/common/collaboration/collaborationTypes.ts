/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Collaboration Types
 *  Real-time multi-user collaboration type definitions.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/** Represents an active collaboration session bound to a project. */
export interface ICollaborationSession {
	/** Unique session identifier (crypto-random UUID). */
	sessionId: string;
	/** Absolute path of the project this session is bound to. */
	projectPath: string;
	/** Yjs CRDT document for real-time sync. */
	yDoc: object; // Y.Doc — typed as object to avoid importing yjs in platform layer
	/** Current participants in the session. */
	participants: IParticipant[];
	/** Agents shared across participants. */
	sharedAgents: ISharedAgent[];
	/** Timestamp when the session was created. */
	createdAt: number;
	/** User ID of the session owner. */
	ownerId: string;
	/** Whether the session is currently active. */
	isActive: boolean;
}

/** A user participating in a collaboration session. */
export interface IParticipant {
	/** Unique user identifier. */
	userId: string;
	/** Display name. */
	name: string;
	/** Assigned color for cursors and decorations (hex, e.g. '#FF5733'). */
	color: string;
	/** Current cursor position in an editor. */
	cursorPosition: ICursorPosition | null;
	/** Current text selection, if any. */
	selection: ISelection | null;
	/** Whether the participant is currently connected. */
	isActive: boolean;
	/** Timestamp of last activity/heartbeat. */
	lastSeen: number;
	/** Current activity state. */
	activityState: ParticipantActivity;
}

/** Cursor position within a file. */
export interface ICursorPosition {
	/** File URI or path. */
	file: string;
	/** Zero-based line number. */
	line: number;
	/** Zero-based column number. */
	column: number;
}

/** Text selection range within a file. */
export interface ISelection {
	/** File URI or path. */
	file: string;
	/** Start position. */
	start: ICursorPosition;
	/** End position. */
	end: ICursorPosition;
}

/** Participant activity states. */
export const enum ParticipantActivity {
	/** Actively typing or interacting. */
	Typing = 0,
	/** Connected but idle. */
	Idle = 1,
	/** Marked as away. */
	Away = 2
}

/** An AI agent shared across collaboration participants. */
export interface ISharedAgent {
	/** Agent instance identifier. */
	agentId: string;
	/** Agent type (coder, architect, reviewer, etc.). */
	type: string;
	/** Current execution status. */
	status: SharedAgentStatus;
	/** Description of the agent's current task. */
	task: string;
	/** User ID the agent is assigned to, or null for shared. */
	assignedTo: string | null;
	/** Most recent output text. */
	output: string;
	/** User IDs that can see this agent, or 'all'. */
	visibleTo: string[] | 'all';
}

/** Shared agent execution status. */
export const enum SharedAgentStatus {
	Idle = 0,
	Running = 1,
	Paused = 2,
	Completed = 3,
	Failed = 4
}

/** A real-time presence event broadcast to participants. */
export interface IPresenceEvent {
	/** User that triggered the event. */
	userId: string;
	/** Type of presence event. */
	type: PresenceEventType;
	/** Event-specific data. */
	data: unknown;
}

/** Presence event types. */
export const enum PresenceEventType {
	Join = 0,
	Leave = 1,
	Cursor = 2,
	Selection = 3,
	Typing = 4
}

/** A chat message within a session. */
export interface IChatMessage {
	/** Unique message identifier. */
	id: string;
	/** User ID of the sender. */
	userId: string;
	/** Display name of the sender. */
	name: string;
	/** Message text content. */
	content: string;
	/** Timestamp (epoch ms). */
	timestamp: number;
	/** Thread ID for threaded discussions. */
	threadId: string | null;
	/** Replies to this message. */
	replies: IChatMessage[];
}

/** Permission record for a user in a session. */
export interface ICollaborationPermission {
	/** User ID. */
	userId: string;
	/** Role within the session. */
	role: CollaborationRole;
	/** Whether the user can edit files. */
	canEdit: boolean;
	/** Whether the user can run/modify AI agents. */
	canRunAgents: boolean;
	/** Whether the user can invite other users. */
	canInvite: boolean;
	/** Whether the user can delete the session. */
	canDelete: boolean;
}

/** Collaboration roles. */
export const enum CollaborationRole {
	Owner = 0,
	Editor = 1,
	Viewer = 2
}

/** Aggregated collaboration session state for UI binding. */
export interface ICollaborationState {
	/** Active session ID, or null if not in a session. */
	sessionId: string | null;
	/** Whether the WebSocket is connected. */
	isConnected: boolean;
	/** Number of participants currently online. */
	participantCount: number;
	/** Count of unread chat messages. */
	unreadMessages: number;
	/** Number of agents currently running. */
	activeAgents: number;
	/** Pending invite count. */
	pendingInvites: number;
}

/** Maximum number of participants allowed per session. */
export const MAX_PARTICIPANTS_PER_SESSION = 20;

/** Heartbeat timeout in milliseconds before a user is considered offline. */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

/** Cursor broadcast throttle interval in milliseconds. */
export const CURSOR_THROTTLE_MS = 50;

/** Idle timeout before hiding a participant's cursor overlay. */
export const IDLE_CURSOR_TIMEOUT_MS = 300_000; // 5 minutes
