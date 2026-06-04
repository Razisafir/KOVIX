/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import {
	IMCPServerDefinition,
	IMCPTool,
	IMCPResource,
	IMCPPrompt,
	IMCPHealthStatus,
	IMCPConnectionEvent,
	IMCPExecutionResult,
	IMCPResourceResult
} from './mcpTypes';

export const IMCPServerManager = createDecorator<IMCPServerManager>('construct.mcpServerManager');

export interface IMCPServerManager extends IDisposable {
	readonly _serviceBrand: undefined;

	// --- Discovery & Lifecycle ------------------------------------------

	/** Discover available MCP servers (installed + auto-detected). */
	discoverServers(): Promise<IMCPServerDefinition[]>;

	/** Install a server definition (persist + optionally start). */
	installServer(def: IMCPServerDefinition): Promise<void>;

	/** Uninstall: stop if running, then remove from registry. */
	uninstallServer(name: string): Promise<void>;

	/** Start a previously installed server. */
	startServer(name: string): Promise<void>;

	/** Stop a running server and clean up resources. */
	stopServer(name: string): Promise<void>;

	/** Stop then start. */
	restartServer(name: string): Promise<void>;

	/** List all installed server definitions. */
	listInstalledServers(): IMCPServerDefinition[];

	/** Get the current health status of a server. */
	getServerHealth(name: string): IMCPHealthStatus;

	// --- Tool Execution -------------------------------------------------

	/** Execute an MCP tool. 30-second timeout enforced. */
	executeTool(serverName: string, toolName: string, args: any): Promise<IMCPExecutionResult>;

	/** List tools from one server, or all connected servers. */
	listTools(serverName?: string): Promise<IMCPTool[]>;

	// --- Resource Access ------------------------------------------------

	/** Read a resource (5-minute TTL cache). */
	readResource(serverName: string, uri: string): Promise<IMCPResourceResult>;

	/** List resources from one server, or all connected servers. */
	listResources(serverName?: string): Promise<IMCPResource[]>;

	// --- Prompts --------------------------------------------------------

	/** List prompts from one server, or all connected servers. */
	listPrompts(serverName?: string): Promise<IMCPPrompt[]>;

	/** Get a rendered prompt. */
	getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<string>;

	// --- Events ---------------------------------------------------------

	readonly onDidChangeConnection: Event<IMCPConnectionEvent>;
	readonly onDidDiscoverTools: Event<IMCPTool[]>;
	readonly onDidDiscoverResources: Event<IMCPResource[]>;
	readonly onDidDiscoverPrompts: Event<IMCPPrompt[]>;
	readonly onDidUpdateHealth: Event<IMCPHealthStatus>;

	// --- Bulk Operations ------------------------------------------------

	/** Start all installed servers. */
	startAllServers(): Promise<void>;

	/** Stop all connected servers. */
	stopAllServers(): Promise<void>;

	/** Get the string representation of a server's connection state. */
	getServerStatus(name: string): string;
}
