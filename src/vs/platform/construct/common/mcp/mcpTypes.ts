/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Types and Interfaces
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';

// ─── Zod Schemas for Runtime Validation ──────────────────────────────────────

export const MCPServerConfigSchema = z.object({
        name: z.string().min(1),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().url().optional(),
        transport: z.enum(['stdio', 'sse', 'streamable-http']),
        enabled: z.boolean().default(true),
        autoRestart: z.boolean().default(true),
        description: z.string().optional(),
        icon: z.string().optional(),
        category: z.string().optional(),
        credentials: z.array(z.object({
                key: z.string(),
                required: z.boolean().default(false),
                description: z.string().optional(),
        })).optional(),
});

export type IMCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export const MCPToolSchema = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        outputSchema: z.record(z.string(), z.unknown()).optional(),
        annotations: z.record(z.string(), z.unknown()).optional(),
});

export type IMCPTool = z.infer<typeof MCPToolSchema>;

export const MCPResourceSchema = z.object({
        uri: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        mimeType: z.string().optional(),
});

export type IMCPResource = z.infer<typeof MCPResourceSchema>;

export const MCPPromptSchema = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        arguments: z.array(z.object({
                name: z.string(),
                description: z.string().optional(),
                required: z.boolean().optional(),
        })).optional(),
});

export type IMCPPrompt = z.infer<typeof MCPPromptSchema>;

// ─── Connection & Health Types ───────────────────────────────────────────────

export const enum MCPConnectionState {
        Disconnected = 'disconnected',
        Connecting = 'connecting',
        Connected = 'connected',
        Reconnecting = 'reconnecting',
        Error = 'error',
        Stopping = 'stopping',
}

export const enum MCPHealthStatus {
        Healthy = 'healthy',
        Degraded = 'degraded',
        Unhealthy = 'unhealthy',
        Unknown = 'unknown',
}

export interface IMCPHealthCheck {
        status: MCPHealthStatus;
        latencyMs: number;
        lastChecked: number;
        errorMessage?: string;
        consecutiveFailures: number;
}

// ─── Marketplace Types ───────────────────────────────────────────────────────

export const enum MCPServerCategory {
        FileSystem = 'filesystem',
        Browser = 'browser',
        Database = 'database',
        Search = 'search',
        Communication = 'communication',
        DevTools = 'devtools',
        Design = 'design',
        Data = 'data',
}

export const MCP_CATEGORIES: readonly { id: MCPServerCategory; label: string }[] = [
        { id: MCPServerCategory.FileSystem, label: 'File System' },
        { id: MCPServerCategory.Browser, label: 'Browser Automation' },
        { id: MCPServerCategory.Database, label: 'Database' },
        { id: MCPServerCategory.Search, label: 'Search' },
        { id: MCPServerCategory.Communication, label: 'Communication' },
        { id: MCPServerCategory.DevTools, label: 'Developer Tools' },
        { id: MCPServerCategory.Design, label: 'Design' },
        { id: MCPServerCategory.Data, label: 'Data' },
];

export interface IMCPMarketplaceEntry {
        id: string;
        name: string;
        description: string;
        author: string;
        repository: string;
        category: MCPServerCategory;
        icon?: string;
        featured: boolean;
        installConfig: IMCPServerConfig;
        tags: string[];
        downloads: number;
        rating: number;
        ratingCount: number;
        verified: boolean;
}

export interface IMCPToolExecutionResult {
        success: boolean;
        data: unknown;
        error?: string;
        executionTimeMs: number;
        toolName: string;
        serverName: string;
}

export interface IMCPResourceReadResult {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
        cached: boolean;
        serverName: string;
}

export const MCP_REGISTRY_URL = 'https://raw.githubusercontent.com/modelcontextprotocol/servers/main/registry.json';

export const MCP_CONFIG_KEY = 'construct.mcp.servers';
export const MCP_CREDENTIAL_KEY_PREFIX = 'construct.mcp.credentials.';
export const MCP_MARKETPLACE_CACHE_KEY = 'construct.mcp.marketplace.cache';
export const MCP_RATINGS_KEY = 'construct.mcp.ratings';

export const MCP_MAX_CONCURRENT_SERVERS = 10;
export const MCP_DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const MCP_HEALTH_PING_INTERVAL_MS = 30_000;
export const MCP_RESOURCE_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
export const MCP_MARKETPLACE_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour
export const MCP_MAX_RESTART_BACKOFF_MS = 60_000;
export const MCP_RESTART_BACKOFF_BASE_MS = 1_000;
