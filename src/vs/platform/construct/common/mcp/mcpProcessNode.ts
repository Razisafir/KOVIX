/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IMCPProcessNodeService = createDecorator<IMCPProcessNodeService>('construct.mcpProcessNode');

/**
 * Node-layer MCP process service interface.
 *
 * Spawns a real MCP filesystem server and communicates over stdio using
 * JSON-RPC 2.0. This service runs in the main process and is exposed
 * to the renderer via IPC.
 *
 * In desktop CONSTRUCT IDE: the node service is available via IPC and provides
 * spec-compliant MCP protocol communication.
 * In browser mode (vscode.dev): this service is unavailable and the
 * browser-layer MCPProcessService falls back to IFileService.
 */
export interface IMCPProcessNodeService {
        readonly _serviceBrand: undefined;

        /** Whether the MCP server process is running and initialized. */
        readonly isRunning: boolean;

        /** Whether the MCP server has completed the initialization handshake. */
        readonly isInitialized: boolean;

        /**
         * Start the MCP filesystem server with the given workspace root path.
         * @param rootPath Absolute path to the workspace root.
         */
        start(rootPath: string): Promise<void>;

        /**
         * Stop the MCP server process and clean up resources.
         */
        stop(): Promise<void>;

        /**
         * Send a JSON-RPC request to the MCP server and wait for the response.
         * @param method The JSON-RPC method name (e.g., 'tools/call').
         * @param params Optional parameters for the request.
         */
        sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;

        /**
         * Call a tool on the MCP server.
         * @param name The tool name (e.g., 'read_file').
         * @param args The tool arguments.
         */
        callTool(name: string, args: Record<string, unknown>): Promise<unknown>;

        /**
         * List available tools on the MCP server.
         */
        listTools(): Promise<unknown>;
}
