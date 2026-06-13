/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Transport & Connection Enums ------------------------------------------

export const enum MCPTransportType {
        Stdio = 'stdio',
        SSE = 'sse'
}

export const enum MCPConnectionState {
        Disconnected = 'disconnected',
        Connecting = 'connecting',
        Connected = 'connected',
        Reconnecting = 'reconnecting',
        Error = 'error',
        Stopping = 'stopping'
}

export const enum MCPHealthStatus {
        Healthy = 'healthy',
        Degraded = 'degraded',
        Unhealthy = 'unhealthy',
        Unknown = 'unknown'
}

// --- Server Definition -----------------------------------------------------

export interface IMCPServerDefinition {
        readonly name: string;
        readonly command: string;
        readonly args: string[];
        readonly env: Record<string, string>;
        readonly transport: MCPTransportType;
        readonly version?: string;
        readonly description?: string;
        readonly categories: string[];
        readonly installPath?: string;
        readonly isBuiltin?: boolean;
        readonly enabled?: boolean;
        readonly autoRestart?: boolean;
        readonly icon?: string;
        /** Keys that should be stored in ISecretStorage (never plaintext) */
        readonly secretEnvKeys?: string[];
        /**
         * SEC-P2: Permission model for MCP server capabilities.
         * Controls what resources the server can access at runtime.
         */
        readonly permissions?: {
                /** Filesystem access level: 'none' = no FS, 'workspace' = within workspace, 'full' = unrestricted */
                fileSystem: 'none' | 'workspace' | 'full';
                /** Whether the server may make outbound network requests */
                network: boolean;
                /** Whether the server may spawn child processes */
                subprocess: boolean;
                /** Environment variable keys the server is allowed to read */
                envAccess: string[];
        };
}

// --- Tool, Resource, Prompt ------------------------------------------------

export interface IMCPTool {
        readonly name: string;
        readonly description: string;
        readonly inputSchema: object;
        readonly serverName: string;
}

export interface IMCPResource {
        readonly uri: string;
        readonly mimeType: string;
        readonly name: string;
        readonly description: string;
        readonly serverName: string;
}

export interface IMCPPrompt {
        readonly name: string;
        readonly description: string;
        readonly arguments?: Array<{ name: string; description: string; required?: boolean }>;
        readonly serverName: string;
}

// --- Health & Connection Events --------------------------------------------

export interface IMCPHealthStatus {
        readonly serverName: string;
        readonly status: MCPHealthStatus;
        readonly lastPing: number;
        readonly errorCount: number;
        readonly latencyMs: number;
        readonly message?: string;
}

export interface IMCPConnectionEvent {
        readonly serverName: string;
        readonly state: MCPConnectionState;
        readonly timestamp: number;
        readonly error?: string;
}

// --- Marketplace -----------------------------------------------------------

export interface IMCPMarketplaceItem {
        readonly id: string;
        readonly name: string;
        readonly description: string;
        readonly author: string;
        readonly version: string;
        readonly categories: string[];
        readonly tags: string[];
        readonly rating: number;
        readonly downloadCount: number;
        readonly command: string;
        readonly args: string[];
        readonly env: Record<string, string>;
        readonly transport: MCPTransportType;
        readonly featured?: boolean;
        readonly iconUrl?: string;
        readonly documentationUrl?: string;
        readonly repositoryUrl?: string;
}

// --- Execution Results -----------------------------------------------------

export interface IMCPExecutionResult {
        readonly success: boolean;
        readonly data?: any;
        readonly error?: string;
        readonly durationMs: number;
        readonly toolName: string;
        readonly serverName: string;
}

export interface IMCPResourceResult {
        readonly success: boolean;
        readonly content?: string;
        readonly mimeType?: string;
        readonly error?: string;
        readonly serverName: string;
        readonly uri: string;
}

// --- Constants -------------------------------------------------------------

export const MCP_REGISTRY_URL = 'https://raw.githubusercontent.com/modelcontextprotocol/servers/main/registry.json';
export const MCP_CONFIG_KEY = 'construct.mcp.servers';
export const MCP_CREDENTIALS_PREFIX = 'construct.mcp.credentials.';
export const MCP_MARKETPLACE_CACHE_KEY = 'construct.mcp.marketplace.cache';
export const MCP_MARKETPLACE_RATINGS_KEY = 'construct.mcp.marketplace.ratings';
export const MCP_INSTALLED_MARKETPLACE_KEY = 'construct.mcp.marketplace.installed';

export const MCP_MAX_CONCURRENT_SERVERS = 10;
export const MCP_DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const MCP_HEALTH_CHECK_INTERVAL_MS = 30_000;
export const MCP_RESOURCE_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
export const MCP_MARKETPLACE_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour
export const MCP_MAX_RESTART_BACKOFF_MS = 60_000;
export const MCP_RESTART_BACKOFF_BASE_MS = 1_000;
