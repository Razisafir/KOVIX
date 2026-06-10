// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IConstructToolRegistry = createDecorator<IConstructToolRegistry>('construct.toolRegistry');

// Re-export from the canonical location for backward compatibility
export { assertWithinWorkspace } from '../security/workspaceGuard.js';

/**
 * Schema definition for a tool's input parameters.
 * Uses a simplified JSON Schema format compatible with zod validation.
 */
export interface IToolParameterSchema {
        type: 'string' | 'number' | 'boolean' | 'object' | 'array';
        description: string;
        properties?: Record<string, IToolParameterSchema>;
        items?: IToolParameterSchema;
        required?: string[];
        enum?: string[];
        default?: unknown;
}

/**
 * Definition of a tool that can be executed by the agent.
 * Each tool has a name, description, input schema, and execute function.
 */
export interface IToolDefinition {
        /** Unique name for this tool (e.g., 'read_file', 'run_terminal') */
        name: string;
        /** Human-readable description of what the tool does */
        description: string;
        /** JSON Schema for the tool's input parameters */
        inputSchema: {
                type: 'object';
                properties: Record<string, IToolParameterSchema>;
                required?: string[];
        };
        /** Whether this tool modifies files (requires user approval) */
        modifiesFiles: boolean;
        /** Whether this tool requires network access */
        requiresNetwork: boolean;
        /** Category for UI grouping */
        category: 'file' | 'terminal' | 'search' | 'network' | 'system' | 'security';
}

/**
 * Result of executing a tool.
 */
export interface IToolResult {
        /** Whether the execution was successful */
        success: boolean;
        /** The output text (or error message if not successful) */
        output: string;
        /** Whether the output is truncated due to size limits */
        truncated: boolean;
        /** Additional metadata about the execution */
        metadata?: {
                /** Duration of execution in milliseconds */
                durationMs?: number;
                /** Number of bytes read/written */
                bytesProcessed?: number;
                /** Exit code for terminal commands */
                exitCode?: number;
        };
}

/**
 * IConstructToolRegistry — registry and executor for agent tools.
 *
 * Manages the lifecycle of tools available to the agent, including:
 * - Built-in tools (read_file, write_file, run_terminal, search_codebase, web_search)
 * - MCP tools (dynamically loaded from MCP servers)
 * - Custom tools (registered by extensions or user configuration)
 *
 * All tool execution goes through this registry, ensuring:
 * - User approval is required for file-modifying tools
 * - Terminal commands are checked against a blocklist
 * - Network access is gated by the offline mode setting
 * - Tool results are properly formatted for the agent
 *
 * KALI INTEGRATION:
 * On Windows, the registry detects Kali WSL2 via `wsl.exe -l -v`.
 * If found, it adds a "Kali Terminal" profile and routes terminal
 * execution to the Kali shell when that profile is selected.
 */
export interface IConstructToolRegistry {
        readonly _serviceBrand: undefined;

        /**
         * List all registered tools.
         */
        listTools(): IToolDefinition[];

        /**
         * Get a tool definition by name.
         */
        getTool(name: string): IToolDefinition | undefined;

        /**
         * Execute a tool by name.
         *
         * IMPORTANT: If the tool modifies files, this method shows a diff
         * preview and waits for user approval before applying changes.
         * The agent loop must never auto-apply changes silently.
         *
         * @param name Tool name.
         * @param input Tool input parameters.
         * @param signal Optional AbortSignal for cancellation.
         * @returns The execution result.
         */
        execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult>;

        /**
         * Register a new tool.
         *
         * @param tool The tool definition.
         * @param executeFn The function to execute when the tool is called.
         */
        registerTool(tool: IToolDefinition, executeFn: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<IToolResult>): void;

        /**
         * Unregister a tool by name.
         */
        unregisterTool(name: string): void;

        /**
         * Check if Kali WSL2 is available.
         * Only relevant on Windows.
         */
        isKaliWSLAvailable(): Promise<boolean>;

        /**
         * Get the current terminal profile.
         * Returns 'kali' if Kali WSL is selected, 'default' otherwise.
         */
        getTerminalProfile(): string;

        /**
         * Set the terminal profile.
         *
         * @param profile 'kali' for Kali WSL, 'default' for normal terminal.
         */
        setTerminalProfile(profile: string): void;
}
