/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Collaboration View
 *  ViewPane subclass for the real-time collaboration panel.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions } from '../../../../workbench/browser/parts/views/viewPane.js';
import { ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICollaborationService } from '../../../../platform/construct/common/collaboration/collaborationService.js';
import {
	ICollaborationState,
	IChatMessage,
	IParticipant,
	ISharedAgent,
	SharedAgentStatus,
	ParticipantActivity
} from '../../../../platform/construct/common/collaboration/collaborationTypes.js';

/**
 * ConstructCollaborationView is a ViewPane that provides a collaboration
 * panel for real-time multi-user sessions. It shows:
 * - Session info with shareable link
 * - Participant list with avatars, roles, and status
 * - Chat panel with threaded messages
 * - Shared agents with status, assignment, and output preview
 * - Activity feed with recent actions
 */
export class ConstructCollaborationView extends ViewPane {
	static readonly ID = 'workbench.view.construct.collaboration';
	static readonly TITLE = 'Collaboration';

	private _sessionId: string | null = null;

	// Section containers
	private _sessionInfoSection!: HTMLElement;
	private _participantSection!: HTMLElement;
	private _chatSection!: HTMLElement;
	private _agentSection!: HTMLElement;
	private _activitySection!: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@ILogService private readonly logService: ILogService,
		@ICollaborationService private readonly collaborationService: ICollaborationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

		// Subscribe to collaboration events for real-time updates
		this._register(this.collaborationService.onStateChange((state: ICollaborationState) => {
			this._onStateChange(state);
		}));

		this._register(this.collaborationService.onUserJoin((e: { sessionId: string; userId: string; name: string }) => {
			this._refreshParticipants();
			this._addActivityEntry(`${e.name} joined the session`, 'join');
		}));

		this._register(this.collaborationService.onUserLeave((e: { sessionId: string; userId: string }) => {
			this._refreshParticipants();
			this._addActivityEntry('A user left the session', 'leave');
		}));

		this._register(this.collaborationService.onMessageReceived((e: { sessionId: string; message: IChatMessage }) => {
			this._appendChatMessage(e.message);
		}));

		this._register(this.collaborationService.onAgentShared((e: { sessionId: string; agent: ISharedAgent }) => {
			this._refreshAgents();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('construct-collab-view');

		// Create sections
		this._sessionInfoSection = this._createSection(container, 'session-info', 'Session');
		this._participantSection = this._createSection(container, 'participants', 'Participants');
		this._chatSection = this._createSection(container, 'chat', 'Chat');
		this._agentSection = this._createSection(container, 'agents', 'Shared Agents');
		this._activitySection = this._createSection(container, 'activity', 'Activity');

		// Show empty state
		this._renderEmptyState();
	}

	protected override layoutBody(height: number, width: number): void {
		// Layout is handled by CSS flexbox
	}

	// ─── Section Creation ───────────────────────────────────────────

	private _createSection(parent: HTMLElement, className: string, title: string): HTMLElement {
		const section = document.createElement('div');
		section.className = `construct-collab-section construct-collab-${className}`;

		const header = document.createElement('div');
		header.className = 'construct-collab-section-header';
		header.textContent = title;
		section.appendChild(header);

		const content = document.createElement('div');
		content.className = 'construct-collab-section-content';
		section.appendChild(content);

		parent.appendChild(section);
		return section;
	}

	// ─── Empty State ────────────────────────────────────────────────

	private _renderEmptyState(): void {
		const empty = document.createElement('div');
		empty.className = 'construct-collab-empty';
		empty.innerHTML = `
			<div class="construct-collab-empty-icon">&#x1F465;</div>
			<div class="construct-collab-empty-text">Start a collaboration session to invite team members</div>
		`;

		const btn = document.createElement('button');
		btn.className = 'construct-collab-start-btn';
		btn.textContent = 'Start Session';
		btn.addEventListener('click', () => {
			this._createNewSession();
		});
		empty.appendChild(btn);

		const content = this._sessionInfoSection.querySelector('.construct-collab-section-content')!;
		content.appendChild(empty);
	}

	// ─── Session Management ─────────────────────────────────────────

	private async _createNewSession(): Promise<void> {
		try {
			const session = await this.collaborationService.createSession('/');
			this._sessionId = session.sessionId;
			this._renderSessionContent(session.sessionId);
		} catch (e) {
			this.logService.error(`[CollabView] Failed to create session: ${e}`);
		}
	}

	private _renderSessionContent(sessionId: string): void {
		// Clear empty state
		const infoContent = this._sessionInfoSection.querySelector('.construct-collab-section-content')!;
		infoContent.innerHTML = '';

		const session = this.collaborationService.getSession(sessionId);
		if (!session) {
			return;
		}

		// Session info header
		const infoRow = document.createElement('div');
		infoRow.className = 'construct-collab-session-row';

		const linkRow = document.createElement('div');
		linkRow.className = 'construct-collab-session-link';

		const linkText = document.createElement('span');
		linkText.className = 'link-text';
		linkText.title = 'Click to copy';
		linkText.textContent = `${session.sessionId.substring(0, 8)}...`;

		const copyBtn = document.createElement('button');
		copyBtn.className = 'copy-btn';
		copyBtn.title = 'Copy session link';
		copyBtn.textContent = 'Copy Link';
		copyBtn.addEventListener('click', () => {
			navigator.clipboard.writeText(session.sessionId).catch(() => { /* ignore */ });
		});

		linkRow.appendChild(linkText);
		linkRow.appendChild(copyBtn);

		const metaRow = document.createElement('div');
		metaRow.className = 'construct-collab-session-meta';

		const countSpan = document.createElement('span');
		countSpan.className = 'participant-count';
		countSpan.textContent = `${session.participants.length} participant${session.participants.length !== 1 ? 's' : ''}`;

		const pathSpan = document.createElement('span');
		pathSpan.className = 'project-path';
		pathSpan.textContent = session.projectPath;

		metaRow.appendChild(countSpan);
		metaRow.appendChild(pathSpan);

		const endBtn = document.createElement('button');
		endBtn.className = 'construct-collab-end-btn';
		endBtn.textContent = 'End Session';
		endBtn.addEventListener('click', () => {
			this.collaborationService.endSession(sessionId);
			this._sessionId = null;
			this._renderEmptyState();
		});

		infoRow.appendChild(linkRow);
		infoRow.appendChild(metaRow);
		infoRow.appendChild(endBtn);
		infoContent.appendChild(infoRow);

		// Render participants, chat, and agents
		this._refreshParticipants();
		this._refreshChat();
		this._refreshAgents();
		this._refreshActivity();
	}

	// ─── Participants ───────────────────────────────────────────────

	private _refreshParticipants(): void {
		if (!this._sessionId) {
			return;
		}

		const session = this.collaborationService.getSession(this._sessionId);
		if (!session) {
			return;
		}

		const content = this._participantSection.querySelector('.construct-collab-section-content')!;
		content.innerHTML = '';

		const list = document.createElement('div');
		list.className = 'construct-collab-participant-list';

		for (const participant of session.participants) {
			const item = this._createParticipantElement(participant, session.ownerId);
			list.appendChild(item);
		}

		content.appendChild(list);

		// Update participant count in session info
		const countEl = this._sessionInfoSection.querySelector('.participant-count');
		if (countEl) {
			countEl.textContent = `${session.participants.length} participant${session.participants.length !== 1 ? 's' : ''}`;
		}
	}

	private _createParticipantElement(participant: IParticipant, ownerId: string): HTMLElement {
		const item = document.createElement('div');
		item.className = 'construct-collab-participant';

		// Avatar (colored circle with initials)
		const avatar = document.createElement('div');
		avatar.className = 'construct-collab-avatar';
		avatar.style.backgroundColor = participant.color;
		avatar.textContent = participant.name.substring(0, 2).toUpperCase();

		// Status dot
		const statusDot = document.createElement('span');
		statusDot.className = `construct-collab-status-dot status-${this._getActivityClass(participant)}`;
		avatar.appendChild(statusDot);

		// Info
		const info = document.createElement('div');
		info.className = 'construct-collab-participant-info';

		const nameEl = document.createElement('span');
		nameEl.className = 'construct-collab-participant-name';
		nameEl.textContent = participant.name;

		const roleEl = document.createElement('span');
		roleEl.className = 'construct-collab-participant-role';
		roleEl.textContent = participant.userId === ownerId ? 'Owner' : 'Editor';

		info.appendChild(nameEl);
		info.appendChild(roleEl);

		item.appendChild(avatar);
		item.appendChild(info);

		// Click to follow (jump to cursor)
		item.addEventListener('click', () => {
			if (participant.cursorPosition) {
				this._followUserCursor(participant);
			}
		});

		return item;
	}

	private _getActivityClass(participant: IParticipant): string {
		if (!participant.isActive) {
			return 'offline';
		}
		switch (participant.activityState) {
			case ParticipantActivity.Typing:
				return 'typing';
			case ParticipantActivity.Idle:
				return 'online';
			case ParticipantActivity.Away:
				return 'away';
			default:
				return 'online';
		}
	}

	private _followUserCursor(participant: IParticipant): void {
		this.logService.trace(`[CollabView] Following cursor of ${participant.name}`);
	}

	// ─── Chat ───────────────────────────────────────────────────────

	private _refreshChat(): void {
		if (!this._sessionId) {
			return;
		}

		const content = this._chatSection.querySelector('.construct-collab-section-content')!;
		content.innerHTML = '';

		// Message list
		const messageList = document.createElement('div');
		messageList.className = 'construct-collab-message-list';

		const messages = this.collaborationService.getMessages(this._sessionId, 50);
		for (const message of messages) {
			messageList.appendChild(this._createMessageElement(message));
		}

		content.appendChild(messageList);

		// Input area
		const inputArea = document.createElement('div');
		inputArea.className = 'construct-collab-chat-input';

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'construct-collab-chat-input-field';
		input.placeholder = 'Type a message...';

		const sendBtn = document.createElement('button');
		sendBtn.className = 'construct-collab-chat-send';
		sendBtn.textContent = 'Send';

		const sendMessage = () => {
			const text = input.value.trim();
			if (text && this._sessionId) {
				this.collaborationService.sendMessage(this._sessionId, text);
				input.value = '';
			}
		};

		sendBtn.addEventListener('click', sendMessage);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				sendMessage();
			}
		});

		inputArea.appendChild(input);
		inputArea.appendChild(sendBtn);
		content.appendChild(inputArea);
	}

	private _appendChatMessage(message: IChatMessage): void {
		const messageList = this._chatSection.querySelector('.construct-collab-message-list');
		if (!messageList) {
			return;
		}
		messageList.appendChild(this._createMessageElement(message));
		messageList.scrollTop = messageList.scrollHeight;
	}

	private _createMessageElement(message: IChatMessage): HTMLElement {
		const el = document.createElement('div');
		el.className = 'construct-collab-message';

		const header = document.createElement('div');
		header.className = 'construct-collab-message-header';

		const nameEl = document.createElement('span');
		nameEl.className = 'construct-collab-message-name';
		nameEl.textContent = message.name;

		const timeEl = document.createElement('span');
		timeEl.className = 'construct-collab-message-time';
		timeEl.textContent = new Date(message.timestamp).toLocaleTimeString();

		header.appendChild(nameEl);
		header.appendChild(timeEl);

		const body = document.createElement('div');
		body.className = 'construct-collab-message-body';
		body.textContent = message.content;

		el.appendChild(header);
		el.appendChild(body);

		// Thread replies
		if (message.replies && message.replies.length > 0) {
			const repliesContainer = document.createElement('div');
			repliesContainer.className = 'construct-collab-message-replies';
			for (const reply of message.replies) {
				repliesContainer.appendChild(this._createMessageElement(reply));
			}
			el.appendChild(repliesContainer);
		}

		return el;
	}

	// ─── Shared Agents ──────────────────────────────────────────────

	private _refreshAgents(): void {
		if (!this._sessionId) {
			return;
		}

		const session = this.collaborationService.getSession(this._sessionId);
		if (!session) {
			return;
		}

		const content = this._agentSection.querySelector('.construct-collab-section-content')!;
		content.innerHTML = '';

		if (session.sharedAgents.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'construct-collab-agents-empty';
			empty.textContent = 'No shared agents';
			content.appendChild(empty);
			return;
		}

		const list = document.createElement('div');
		list.className = 'construct-collab-agent-list';

		for (const agent of session.sharedAgents) {
			list.appendChild(this._createAgentElement(agent));
		}

		content.appendChild(list);
	}

	private _createAgentElement(agent: ISharedAgent): HTMLElement {
		const el = document.createElement('div');
		el.className = 'construct-collab-agent';

		const header = document.createElement('div');
		header.className = 'construct-collab-agent-header';

		const nameEl = document.createElement('span');
		nameEl.className = 'construct-collab-agent-name';
		nameEl.textContent = `${agent.type} Agent`;

		const statusEl = document.createElement('span');
		statusEl.className = `construct-collab-agent-status status-${agent.status}`;
		statusEl.textContent = this._getAgentStatusLabel(agent.status);

		header.appendChild(nameEl);
		header.appendChild(statusEl);

		el.appendChild(header);

		// Task description
		if (agent.task) {
			const taskEl = document.createElement('div');
			taskEl.className = 'construct-collab-agent-task';
			taskEl.textContent = agent.task;
			el.appendChild(taskEl);
		}

		// Assignment info
		if (agent.assignedTo) {
			const assignEl = document.createElement('div');
			assignEl.className = 'construct-collab-agent-assigned';
			assignEl.textContent = `Assigned to: ${agent.assignedTo}`;
			el.appendChild(assignEl);
		}

		// Output preview
		if (agent.output) {
			const outputEl = document.createElement('div');
			outputEl.className = 'construct-collab-agent-output';
			outputEl.textContent = agent.output.substring(0, 100) + (agent.output.length > 100 ? '...' : '');
			el.appendChild(outputEl);
		}

		return el;
	}

	private _getAgentStatusLabel(status: SharedAgentStatus): string {
		switch (status) {
			case SharedAgentStatus.Idle: return 'Idle';
			case SharedAgentStatus.Running: return 'Running';
			case SharedAgentStatus.Paused: return 'Paused';
			case SharedAgentStatus.Completed: return 'Completed';
			case SharedAgentStatus.Failed: return 'Failed';
			default: return 'Unknown';
		}
	}

	// ─── Activity Feed ──────────────────────────────────────────────

	private _refreshActivity(): void {
		const content = this._activitySection.querySelector('.construct-collab-section-content')!;
		content.innerHTML = '';
	}

	private _addActivityEntry(text: string, type: string): void {
		const content = this._activitySection.querySelector('.construct-collab-section-content');
		if (!content) {
			return;
		}

		const entry = document.createElement('div');
		entry.className = 'construct-collab-activity-entry';

		const icon = document.createElement('span');
		icon.className = `construct-collab-activity-icon icon-${type}`;

		const textEl = document.createElement('span');
		textEl.className = 'construct-collab-activity-text';
		textEl.textContent = text;

		const time = document.createElement('span');
		time.className = 'construct-collab-activity-time';
		time.textContent = new Date().toLocaleTimeString();

		entry.appendChild(icon);
		entry.appendChild(textEl);
		entry.appendChild(time);

		content.insertBefore(entry, content.firstChild);
	}

	// ─── State Updates ──────────────────────────────────────────────

	private _onStateChange(state: ICollaborationState): void {
		if (state.sessionId && !this._sessionId) {
			this._sessionId = state.sessionId;
			this._renderSessionContent(state.sessionId);
		}
	}
}
