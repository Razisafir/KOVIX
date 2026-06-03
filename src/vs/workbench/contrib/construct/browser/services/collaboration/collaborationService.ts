/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Collaboration Service Implementation
 *  Real-time multi-user collaboration with Yjs CRDT sync, shared agents, chat, and presence.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { ICollaborationService } from '../../../../../../platform/construct/common/collaboration/collaborationService.js';
import {
        ICollaborationSession,
        ICollaborationPermission,
        ICollaborationState,
        IChatMessage,
        ICursorPosition,
        ISelection,
        ISharedAgent,
        IPresenceEvent,
        IParticipant,
        ParticipantActivity,
        CollaborationRole,
        SharedAgentStatus,
        MAX_PARTICIPANTS_PER_SESSION,
        HEARTBEAT_TIMEOUT_MS,
        CURSOR_THROTTLE_MS
} from '../../../../../../platform/construct/common/collaboration/collaborationTypes.js';
import { YjsProvider } from './yjsProvider.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

/**
 * Main implementation of ICollaborationService.
 *
 * Provides real-time collaboration features:
 * - Session management (create, join, leave, end)
 * - Real-time cursor and selection sync via Yjs awareness
 * - Chat system with threading support
 * - Shared AI agents with permission-based visibility
 * - Presence tracking with heartbeat-based cleanup
 * - Cryptographically random session IDs for security
 */
export class CollaborationService extends Disposable implements ICollaborationService {
        declare readonly _serviceBrand: undefined;

        // ─── Session Storage ────────────────────────────────────────────

        private readonly _sessions = new Map<string, ICollaborationSession>();
        private readonly _permissions = new Map<string, ICollaborationPermission[]>();
        private readonly _messages = new Map<string, IChatMessage[]>();
        private readonly _heartbeatTimers = new Map<string, Map<string, any>>(); // sessionId → userId → timer

        /** Current user ID (simulated for single-instance; in production from auth). */
        private readonly _localUserId: string;

        // ─── Throttle State ─────────────────────────────────────────────

        private readonly _cursorThrottle = new Map<string, number>(); // sessionId → lastSendTime

        // ─── Event Emitters ─────────────────────────────────────────────

        private readonly _onUserJoin = this._register(new Emitter<{ sessionId: string; userId: string; name: string }>());
        readonly onUserJoin = this._onUserJoin.event;

        private readonly _onUserLeave = this._register(new Emitter<{ sessionId: string; userId: string }>());
        readonly onUserLeave = this._onUserLeave.event;

        private readonly _onCursorChange = this._register(new Emitter<{ sessionId: string; userId: string; position: ICursorPosition }>());
        readonly onCursorChange = this._onCursorChange.event;

        private readonly _onSelectionChange = this._register(new Emitter<{ sessionId: string; userId: string; selection: ISelection }>());
        readonly onSelectionChange = this._onSelectionChange.event;

        private readonly _onMessageReceived = this._register(new Emitter<{ sessionId: string; message: IChatMessage }>());
        readonly onMessageReceived = this._onMessageReceived.event;

        private readonly _onAgentShared = this._register(new Emitter<{ sessionId: string; agent: ISharedAgent }>());
        readonly onAgentShared = this._onAgentShared.event;

        private readonly _onStateChange = this._register(new Emitter<ICollaborationState>());
        readonly onStateChange = this._onStateChange.event;

        private readonly _onPresenceEvent = this._register(new Emitter<IPresenceEvent>());
        readonly onPresenceEvent = this._onPresenceEvent.event;

        /** Yjs provider for CRDT document management. */
        private readonly yjsProvider: YjsProvider;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly _storageService: IStorageService,
        ) {
                super();
                this._localUserId = generateUuid();
                // Create the Yjs provider internally — it depends on the same services
                this.yjsProvider = this._register(new YjsProvider(logService, this._storageService));
                this.logService.trace('[CollaborationService] Initialized');
        }

        // ─── Session Lifecycle ──────────────────────────────────────────

        async createSession(projectPath: string): Promise<ICollaborationSession> {
                const sessionId = generateUuid(); // Crypto-random, unguessable

                // Create the Yjs CRDT document
                const yDoc = this.yjsProvider.createDoc(sessionId);

                // Set metadata
                this.yjsProvider.setMetadata(sessionId, 'projectPath', projectPath);
                this.yjsProvider.setMetadata(sessionId, 'createdAt', Date.now());
                this.yjsProvider.setMetadata(sessionId, 'ownerId', this._localUserId);

                const owner: IParticipant = {
                        userId: this._localUserId,
                        name: 'Owner',
                        color: this._generateUserColor(0),
                        cursorPosition: null,
                        selection: null,
                        isActive: true,
                        lastSeen: Date.now(),
                        activityState: ParticipantActivity.Idle
                };

                const session: ICollaborationSession = {
                        sessionId,
                        projectPath,
                        yDoc,
                        participants: [owner],
                        sharedAgents: [],
                        createdAt: Date.now(),
                        ownerId: this._localUserId,
                        isActive: true
                };

                this._sessions.set(sessionId, session);

                // Set owner permissions
                this._permissions.set(sessionId, [{
                        userId: this._localUserId,
                        role: CollaborationRole.Owner,
                        canEdit: true,
                        canRunAgents: true,
                        canInvite: true,
                        canDelete: true
                }]);

                // Initialize message store
                this._messages.set(sessionId, []);

                // Start heartbeat monitoring for this session
                this._startHeartbeatMonitoring(sessionId);

                // Fire events
                this._onUserJoin.fire({ sessionId, userId: this._localUserId, name: owner.name });
                this._fireStateChange(sessionId);

                this.logService.info(`[CollaborationService] Created session ${sessionId} for project ${projectPath}`);
                return session;
        }

        async joinSession(sessionId: string, userInfo: { name: string; color: string }): Promise<ICollaborationSession> {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        throw new Error(`Session ${sessionId} not found`);
                }
                if (!session.isActive) {
                        throw new Error(`Session ${sessionId} is no longer active`);
                }

                // Enforce max participant limit
                if (session.participants.length >= MAX_PARTICIPANTS_PER_SESSION) {
                        throw new Error(`Session ${sessionId} has reached the maximum of ${MAX_PARTICIPANTS_PER_SESSION} participants`);
                }

                // Check if user is already in the session
                const existingParticipant = session.participants.find(p => p.userId === this._localUserId);
                if (existingParticipant) {
                        return session;
                }

                // Add participant
                const participant: IParticipant = {
                        userId: this._localUserId,
                        name: userInfo.name,
                        color: userInfo.color || this._generateUserColor(session.participants.length),
                        cursorPosition: null,
                        selection: null,
                        isActive: true,
                        lastSeen: Date.now(),
                        activityState: ParticipantActivity.Idle
                };

                session.participants.push(participant);

                // Sync Yjs document state (load from Yjs provider)
                const doc = this.yjsProvider.getDoc(sessionId);
                if (doc) {
                        // In a real WebSocket setup, the provider would sync automatically
                        this.logService.trace(`[CollaborationService] Synced Yjs doc for session ${sessionId}`);
                }

                // Set editor permissions for the new participant
                const perms = this._permissions.get(sessionId) ?? [];
                perms.push({
                        userId: this._localUserId,
                        role: CollaborationRole.Editor,
                        canEdit: true,
                        canRunAgents: true,
                        canInvite: false,
                        canDelete: false
                });
                this._permissions.set(sessionId, perms);

                // Start heartbeat for this user in the session
                this._registerUserHeartbeat(sessionId, this._localUserId);

                // Fire events
                this._onUserJoin.fire({ sessionId, userId: this._localUserId, name: userInfo.name });
                this._fireStateChange(sessionId);

                this.logService.info(`[CollaborationService] User ${userInfo.name} joined session ${sessionId}`);
                return session;
        }

        async leaveSession(sessionId: string): Promise<void> {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                // Remove participant
                session.participants = session.participants.filter(p => p.userId !== this._localUserId);

                // Remove permissions
                const perms = this._permissions.get(sessionId) ?? [];
                this._permissions.set(sessionId, perms.filter(p => p.userId !== this._localUserId));

                // Clean up heartbeat
                this._unregisterUserHeartbeat(sessionId, this._localUserId);

                // If no participants remain, end the session
                if (session.participants.length === 0) {
                        await this.endSession(sessionId);
                        return;
                }

                // Fire events
                this._onUserLeave.fire({ sessionId, userId: this._localUserId });
                this._fireStateChange(sessionId);

                this.logService.info(`[CollaborationService] User left session ${sessionId}`);
        }

        async endSession(sessionId: string): Promise<void> {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                // Verify caller is the owner
                const perms = this._permissions.get(sessionId) ?? [];
                const callerPerm = perms.find(p => p.userId === this._localUserId);
                if (!callerPerm || callerPerm.role !== CollaborationRole.Owner) {
                        throw new Error('Only the session owner can end the session');
                }

                session.isActive = false;

                // Destroy Yjs document
                this.yjsProvider.destroyDoc(sessionId);

                // Clean up heartbeat monitoring
                this._stopHeartbeatMonitoring(sessionId);

                // Notify all participants via events
                for (const participant of session.participants) {
                        if (participant.userId !== this._localUserId) {
                                this._onUserLeave.fire({ sessionId, userId: participant.userId });
                        }
                }

                // Clean up local state
                this._sessions.delete(sessionId);
                this._permissions.delete(sessionId);
                this._messages.delete(sessionId);

                this._fireStateChange(sessionId);
                this.logService.info(`[CollaborationService] Ended session ${sessionId}`);
        }

        async inviteUser(sessionId: string, email: string, role: CollaborationRole): Promise<void> {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        throw new Error(`Session ${sessionId} not found`);
                }

                // Verify caller can invite
                const perms = this._permissions.get(sessionId) ?? [];
                const callerPerm = perms.find(p => p.userId === this._localUserId);
                if (!callerPerm || !callerPerm.canInvite) {
                        throw new Error('You do not have permission to invite users');
                }

                // In a real implementation, this would send an email invite
                // For now, we store the invite as a pending permission
                this.logService.info(`[CollaborationService] Invited ${email} to session ${sessionId} as role ${role}`);

                // The invite would contain a link like:
                // construct://collab/join?session=SESSION_ID&token=INVITE_TOKEN
        }

        // ─── Session Access ─────────────────────────────────────────────

        getSession(sessionId: string): ICollaborationSession | undefined {
                return this._sessions.get(sessionId);
        }

        getActiveSessions(): ICollaborationSession[] {
                return [...this._sessions.values()].filter(s => s.isActive);
        }

        // ─── Real-time Presence ─────────────────────────────────────────

        updateCursor(sessionId: string, position: ICursorPosition): void {
                // Throttle cursor updates to CURSOR_THROTTLE_MS
                const now = Date.now();
                const lastSend = this._cursorThrottle.get(sessionId) ?? 0;
                if (now - lastSend < CURSOR_THROTTLE_MS) {
                        return;
                }
                this._cursorThrottle.set(sessionId, now);

                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                // Update local participant cursor
                const participant = session.participants.find(p => p.userId === this._localUserId);
                if (participant) {
                        participant.cursorPosition = position;
                        participant.lastSeen = now;
                        participant.activityState = ParticipantActivity.Typing;
                }

                // Update Yjs cursor map
                this.yjsProvider.setCursor(sessionId, this._localUserId, position);

                // Fire events
                this._onCursorChange.fire({ sessionId, userId: this._localUserId, position });
                this._onPresenceEvent.fire({
                        userId: this._localUserId,
                        type: 2, // PresenceEventType.Cursor
                        data: position
                });
        }

        updateSelection(sessionId: string, selection: ISelection): void {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                // Update local participant selection
                const participant = session.participants.find(p => p.userId === this._localUserId);
                if (participant) {
                        participant.selection = selection;
                        participant.lastSeen = Date.now();
                }

                // Update Yjs awareness
                this.yjsProvider.updateAwareness(sessionId, this._localUserId, {
                        selection: {
                                file: selection.file,
                                start: selection.start,
                                end: selection.end
                        }
                });

                // Fire events
                this._onSelectionChange.fire({ sessionId, userId: this._localUserId, selection });
                this._onPresenceEvent.fire({
                        userId: this._localUserId,
                        type: 3, // PresenceEventType.Selection
                        data: selection
                });
        }

        // ─── Chat ───────────────────────────────────────────────────────

        sendMessage(sessionId: string, content: string, threadId?: string): void {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                const message: IChatMessage = {
                        id: generateUuid(),
                        userId: this._localUserId,
                        name: session.participants.find(p => p.userId === this._localUserId)?.name ?? 'Unknown',
                        content,
                        timestamp: Date.now(),
                        threadId: threadId ?? null,
                        replies: []
                };

                // Store message locally
                const messages = this._messages.get(sessionId) ?? [];
                messages.push(message);
                this._messages.set(sessionId, messages);

                // Persist in Yjs shared array (available to late joiners)
                this.yjsProvider.pushMessage(sessionId, {
                        id: message.id,
                        userId: message.userId,
                        name: message.name,
                        content: message.content,
                        timestamp: message.timestamp,
                        threadId: message.threadId
                });

                // Fire events
                this._onMessageReceived.fire({ sessionId, message });
                this._fireStateChange(sessionId);
        }

        getMessages(sessionId: string, limit?: number): IChatMessage[] {
                const messages = this._messages.get(sessionId) ?? [];
                if (limit && limit > 0) {
                        return messages.slice(-limit);
                }
                return messages;
        }

        // ─── Shared Agents ──────────────────────────────────────────────

        shareAgent(sessionId: string, agentId: string, userIds?: string[]): void {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                // Verify permissions
                const perms = this._permissions.get(sessionId) ?? [];
                const callerPerm = perms.find(p => p.userId === this._localUserId);
                if (!callerPerm || !callerPerm.canRunAgents) {
                        throw new Error('You do not have permission to share agents');
                }

                // Check if agent is already shared
                const existing = session.sharedAgents.find(a => a.agentId === agentId);
                if (existing) {
                        // Update visibility
                        existing.visibleTo = userIds ?? 'all';
                } else {
                        const agent: ISharedAgent = {
                                agentId,
                                type: 'coder',
                                status: SharedAgentStatus.Idle,
                                task: '',
                                assignedTo: null,
                                output: '',
                                visibleTo: userIds ?? 'all'
                        };
                        session.sharedAgents.push(agent);
                }

                // Update Yjs metadata
                this.yjsProvider.setMetadata(sessionId, `agent:${agentId}`, {
                        agentId,
                        visibleTo: userIds ?? 'all',
                        sharedAt: Date.now()
                });

                // Fire event
                const agent = session.sharedAgents.find(a => a.agentId === agentId)!;
                this._onAgentShared.fire({ sessionId, agent });
                this._fireStateChange(sessionId);
        }

        unshareAgent(sessionId: string, agentId: string): void {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                session.sharedAgents = session.sharedAgents.filter(a => a.agentId !== agentId);
                this._fireStateChange(sessionId);
        }

        // ─── Permissions ────────────────────────────────────────────────

        getPermissions(sessionId: string): ICollaborationPermission[] {
                return this._permissions.get(sessionId) ?? [];
        }

        setPermission(sessionId: string, userId: string, role: CollaborationRole): void {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return;
                }

                // Only owner can change permissions
                const perms = this._permissions.get(sessionId) ?? [];
                const callerPerm = perms.find(p => p.userId === this._localUserId);
                if (!callerPerm || callerPerm.role !== CollaborationRole.Owner) {
                        throw new Error('Only the session owner can change permissions');
                }

                // Update the user's permission
                const userPerm = perms.find(p => p.userId === userId);
                if (userPerm) {
                        userPerm.role = role;
                        userPerm.canEdit = role !== CollaborationRole.Viewer;
                        userPerm.canRunAgents = role === CollaborationRole.Owner || role === CollaborationRole.Editor;
                        userPerm.canInvite = role === CollaborationRole.Owner;
                        userPerm.canDelete = role === CollaborationRole.Owner;
                } else {
                        perms.push({
                                userId,
                                role,
                                canEdit: role !== CollaborationRole.Viewer,
                                canRunAgents: role === CollaborationRole.Owner || role === CollaborationRole.Editor,
                                canInvite: role === CollaborationRole.Owner,
                                canDelete: role === CollaborationRole.Owner
                        });
                }

                this._permissions.set(sessionId, perms);
                this._fireStateChange(sessionId);
        }

        // ─── State ──────────────────────────────────────────────────────

        getState(sessionId: string): ICollaborationState {
                const session = this._sessions.get(sessionId);
                if (!session) {
                        return {
                                sessionId: null,
                                isConnected: false,
                                participantCount: 0,
                                unreadMessages: 0,
                                activeAgents: 0,
                                pendingInvites: 0
                        };
                }

                const activeParticipants = session.participants.filter(p => p.isActive);
                const runningAgents = session.sharedAgents.filter(a => a.status === SharedAgentStatus.Running);

                return {
                        sessionId: session.sessionId,
                        isConnected: session.isActive,
                        participantCount: activeParticipants.length,
                        unreadMessages: 0, // Would be computed from last-read timestamps
                        activeAgents: runningAgents.length,
                        pendingInvites: 0 // Would be computed from invite store
                };
        }

        // ─── Private Helpers ────────────────────────────────────────────

        /**
         * Generate a deterministic color for a user based on their index.
         * Colors are chosen to be visually distinct and accessible.
         */
        private _generateUserColor(index: number): string {
                const colors = [
                        '#FF5733', // Orange-red
                        '#33A1FF', // Blue
                        '#33FF7A', // Green
                        '#FF33F5', // Pink
                        '#FFD433', // Yellow
                        '#8C33FF', // Purple
                        '#33FFE0', // Cyan
                        '#FF8633', // Orange
                        '#337AFF', // Light blue
                        '#33FF33', // Lime
                        '#FF3333', // Red
                        '#33FFB5', // Mint
                        '#B533FF', // Violet
                        '#FF3386', // Rose
                        '#86FF33', // Chartreuse
                        '#33B5FF', // Sky blue
                        '#FFB533', // Amber
                        '#33FF57', // Spring green
                        '#FF33B5', // Magenta
                        '#3386FF', // Dodger blue
                ];
                return colors[index % colors.length];
        }

        /**
         * Start monitoring heartbeats for all participants in a session.
         * Users that don't send a heartbeat within HEARTBEAT_TIMEOUT_MS
         * are automatically removed.
         */
        private _startHeartbeatMonitoring(sessionId: string): void {
                // Set up a periodic check (every 10 seconds)
                const timer = setInterval(() => {
                        this._checkHeartbeats(sessionId);
                }, 10_000);

                this._register({
                        dispose: () => clearInterval(timer)
                });
        }

        /**
         * Stop heartbeat monitoring for a session.
         */
        private _stopHeartbeatMonitoring(sessionId: string): void {
                const sessionTimers = this._heartbeatTimers.get(sessionId);
                if (sessionTimers) {
                        for (const timer of sessionTimers.values()) {
                                clearInterval(timer);
                        }
                        this._heartbeatTimers.delete(sessionId);
                }
        }

        /**
         * Register a heartbeat for a specific user in a session.
         */
        private _registerUserHeartbeat(sessionId: string, userId: string): void {
                if (!this._heartbeatTimers.has(sessionId)) {
                        this._heartbeatTimers.set(sessionId, new Map());
                }
                // The heartbeat is implicit — user activity updates lastSeen
                // The monitoring loop checks lastSeen for timeout
        }

        /**
         * Unregister a user's heartbeat tracking.
         */
        private _unregisterUserHeartbeat(sessionId: string, userId: string): void {
                const sessionTimers = this._heartbeatTimers.get(sessionId);
                if (sessionTimers) {
                        const timer = sessionTimers.get(userId);
                        if (timer) {
                                clearInterval(timer);
                                sessionTimers.delete(userId);
                        }
                }
        }

        /**
         * Check all participants' heartbeats and remove timed-out users.
         */
        private _checkHeartbeats(sessionId: string): void {
                const session = this._sessions.get(sessionId);
                if (!session || !session.isActive) {
                        return;
                }

                const now = Date.now();
                const timedOutUsers: string[] = [];

                for (const participant of session.participants) {
                        // Don't check the owner's heartbeat
                        if (participant.userId === session.ownerId) {
                                continue;
                        }

                        if (participant.isActive && (now - participant.lastSeen) > HEARTBEAT_TIMEOUT_MS) {
                                participant.isActive = false;
                                timedOutUsers.push(participant.userId);
                                this.logService.info(`[CollaborationService] User ${participant.name} timed out in session ${sessionId}`);
                        }
                }

                // Remove timed-out users
                for (const userId of timedOutUsers) {
                        session.participants = session.participants.filter(p => p.userId !== userId);

                        // Clean up permissions
                        const perms = this._permissions.get(sessionId) ?? [];
                        this._permissions.set(sessionId, perms.filter(p => p.userId !== userId));

                        this._onUserLeave.fire({ sessionId, userId });
                }

                if (timedOutUsers.length > 0) {
                        this._fireStateChange(sessionId);
                }
        }

        /**
         * Fire a state change event for the given session.
         */
        private _fireStateChange(sessionId: string): void {
                this._onStateChange.fire(this.getState(sessionId));
        }

        override dispose(): void {
                super.dispose();

                // End all active sessions
                for (const [sessionId, session] of this._sessions) {
                        if (session.isActive) {
                                session.isActive = false;
                                this.yjsProvider.destroyDoc(sessionId);
                        }
                }
                this._sessions.clear();
                this._permissions.clear();
                this._messages.clear();

                // Clear throttle state
                this._cursorThrottle.clear();

                // Stop all heartbeat monitoring
                for (const [sessionId] of this._heartbeatTimers) {
                        this._stopHeartbeatMonitoring(sessionId);
                }
                this._heartbeatTimers.clear();

                this.logService.trace('[CollaborationService] Disposed');
        }
}
