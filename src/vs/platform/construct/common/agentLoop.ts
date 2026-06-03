/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Agent Loop Service Interface
 *  MVP: Single coder agent with tool execution loop
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export const IAgentLoopService = createDecorator<IAgentLoopService>('construct.agentLoop');

export interface IAgentLoopService {
	readonly _serviceBrand: undefined;

	/** Main entry — process a user message through the agent loop */
	processMessage(message: string): Promise<AgentLoopResult>;

	/** Loop control */
	cancel(): void;
	getState(): AgentLoopState;
	getConversationHistory(): AgentMessage[];

	/** File context for current conversation */
	setWorkingDirectory(dir: string): void;

	/** Events */
	readonly onStateChange: Event<AgentLoopState>;
	readonly onMessage: Event<AgentMessage>;
	readonly onToolCall: Event<ToolCallEvent>;
	readonly onToolResult: Event<ToolResultEvent>;
}

// -- Data Types --

export type AgentLoopState = 'idle' | 'thinking' | 'executing_tool' | 'cancelled' | 'error';

export interface AgentLoopResult {
	response: string;
	toolCallsMade: number;
	tokensUsed: number;
	stoppedEarly: boolean;
	error?: string;
}

export interface AgentMessage {
	role: 'user' | 'assistant';
	content: string;
	timestamp: number;
	toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
	id: string;
	name: string;
	input: any;
	result?: any;
}

export interface ToolCallEvent {
	id: string;
	name: string;
	input: any;
	serverId?: string;
}

export interface ToolResultEvent {
	id: string;
	name: string;
	success: boolean;
	output: string;
	durationMs: number;
}
