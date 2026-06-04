/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const IMCPProcess = createDecorator<IMCPProcess>('construct.mcpProcess');

/**
 * Service providing filesystem operations through MCP-compatible interface.
 * Currently backed by CONSTRUCT IDE's IFileService for reliable file operations
 * within CONSTRUCT IDE's architecture. MCP server spawning is available when
 * the Node.js environment provides child_process access.
 */
export interface IMCPProcess {
        readonly _serviceBrand: undefined;

        /** Whether the filesystem service is connected and ready. */
        readonly connected: boolean;

        /** The root path for filesystem operations (workspace root). */
        readonly rootPath: string;

        /**
         * Initialize the filesystem service. Connects to the workspace root.
         */
        initialize(): Promise<void>;

        /**
         * Read a file's content as UTF-8 string.
         * @param path Relative or absolute path within workspace.
         */
        readFile(path: string): Promise<string>;

        /**
         * Write content to a file, creating it if it doesn't exist.
         * @param path Relative or absolute path within workspace.
         * @param content File content.
         */
        writeFile(path: string, content: string): Promise<void>;

        /**
         * List directory contents.
         * @param path Relative or absolute path within workspace.
         * @returns Array of entry names (files and directories).
         */
        listDirectory(path: string): Promise<string[]>;

        /**
         * Create a directory, including any necessary parent directories.
         * @param path Relative or absolute path within workspace.
         */
        createDirectory(path: string): Promise<void>;

        /**
         * Delete a file.
         * @param path Relative or absolute path within workspace.
         */
        deleteFile(path: string): Promise<void>;

        /**
         * Check if a file or directory exists.
         * @param path Relative or absolute path within workspace.
         */
        exists(path: string): Promise<boolean>;

        /** Events */
        readonly onDidConnect: Event<void>;
        readonly onDidDisconnect: Event<void>;
        readonly onError: Event<Error>;
}
