/*---------------------------------------------------------------------------------------------
 *  Construct IDE — MCP Process Service Interface
 *  MVP: Real stdio-based MCP server management with JSON-RPC
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export const IMCPProcessService = createDecorator<IMCPProcessService>('construct.mcpProcess');

export interface IMCPProcessService {
	readonly _serviceBrand: undefined;

	/** Server lifecycle */
	startServer(config: MCPServerConfig): Promise<void>;
	stopServer(serverId: string): Promise<void>;
	restartServer(serverId: string): Promise<void>;
	stopAllServers(): Promise<void>;

	/** Discovery */
	getAllTools(): MCPTool[];
	getAllResources(): MCPResource[];
	getToolsForServer(serverId: string): MCPTool[];

	/** Execution */
	callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolResult>;
	readResource(serverId: string, uri: string): Promise<MCPResourceContent[]>;

	/** Status */
	getServerStatus(serverId: string): MCPServerStatus | undefined;
	getAllServerStatuses(): MCPServerStatus[];

	/** Config management */
	getServers(): MCPServerConfig[];
	addServer(config: MCPServerConfig): void;
	removeServer(serverId: string): Promise<void>;

	/** Events */
	readonly onDidChangeServerState: Event<{ serverId: string; state: MCPServerState }>;
	readonly onDidDiscoverTools: Event<{ serverId: string; tools: MCPTool[] }>;
	readonly onDidServerError: Event<{ serverId: string; error: string }>;
}

// -- Data Types --

export interface MCPServerConfig {
	id: string;
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	enabled: boolean;
	autoStart: boolean;
	timeout?: number;
}

export type MCPServerState = 'stopped' | 'starting' | 'running' | 'error' | 'stopping';

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: object;
	serverId: string;
}

export interface MCPResource {
	uri: string;
	name: string;
	description?: string;
	serverId: string;
}

export interface MCPToolResult {
	success: boolean;
	content: string;
	error?: string;
	isError: boolean;
	duration: number;
}

export interface MCPResourceContent {
	uri: string;
	mimeType?: string;
	text: string;
}

export interface MCPServerStatus {
	id: string;
	name: string;
	state: MCPServerState;
	toolCount: number;
	lastError?: string;
	pid?: number;
	uptime?: number;
}
