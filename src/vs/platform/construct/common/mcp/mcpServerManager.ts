/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Server Manager Interface
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	IMCPServerConfig, IMCPTool, IMCPResource, IMCPPrompt,
	MCPConnectionState, IMCPHealthCheck, IMCPToolExecutionResult,
	IMCPResourceReadResult
} from './mcpTypes.js';

export const IMCPServerManager = createDecorator<IMCPServerManager>('mcpServerManager');

export interface IMCPServerManager {
	readonly _serviceBrand: undefined;

	// ─── Server Lifecycle ──────────────────────────────────────────────────

	/**
	 * Discover available MCP servers from the marketplace registry.
	 * Returns a list of server configurations that can be installed.
	 */
	discoverServers(): Promise<IMCPServerConfig[]>;

	/**
	 * Install an MCP server by registering its configuration.
	 * This stores the server config and makes it available to start.
	 */
	installServer(config: IMCPServerConfig): Promise<void>;

	/**
	 * Uninstall an MCP server: stop it if running, then remove its config.
	 */
	uninstallServer(name: string): Promise<void>;

	/**
	 * Start a previously installed MCP server.
	 * Connects via the configured transport (stdio or SSE).
	 */
	startServer(name: string): Promise<void>;

	/**
	 * Stop a running MCP server and clean up resources.
	 */
	stopServer(name: string): Promise<void>;

	/**
	 * Restart a running MCP server (stop + start).
	 */
	restartServer(name: string): Promise<void>;

	/**
	 * List all installed server configurations.
	 */
	listInstalledServers(): IMCPServerConfig[];

	/**
	 * Get the current connection state of a server.
	 */
	getConnectionState(name: string): MCPConnectionState;

	// ─── Tool Execution ───────────────────────────────────────────────────

	/**
	 * Execute an MCP tool on a specific server.
	 * Enforces a 30-second timeout by default.
	 */
	executeTool(serverName: string, toolName: string, args: Record<string, unknown>, timeoutMs?: number): Promise<IMCPToolExecutionResult>;

	/**
	 * List all tools available on a connected server.
	 */
	listTools(serverName: string): Promise<IMCPTool[]>;

	// ─── Resource Access ──────────────────────────────────────────────────

	/**
	 * Read an MCP resource from a specific server.
	 * Uses a 5-minute TTL cache.
	 */
	readResource(serverName: string, uri: string): Promise<IMCPResourceReadResult>;

	/**
	 * List all resources available on a connected server.
	 */
	listResources(serverName: string): Promise<IMCPResource[]>;

	// ─── Prompts ──────────────────────────────────────────────────────────

	/**
	 * List all prompts available on a connected server.
	 */
	listPrompts(serverName: string): Promise<IMCPPrompt[]>;

	// ─── Health Monitoring ────────────────────────────────────────────────

	/**
	 * Get the health status of a server.
	 */
	getServerHealth(name: string): IMCPHealthCheck | undefined;

	// ─── Events ───────────────────────────────────────────────────────────

	/**
	 * Fired when any server's connection state changes.
	 */
	onDidChangeConnection: Event<{ serverName: string; state: MCPConnectionState }>;

	/**
	 * Fired when tools are discovered/updated on a server.
	 */
	onDidDiscoverTools: Event<{ serverName: string; tools: IMCPTool[] }>;

	/**
	 * Fired when a server's health status changes.
	 */
	onDidChangeHealth: Event<{ serverName: string; health: IMCPHealthCheck }>;
}
