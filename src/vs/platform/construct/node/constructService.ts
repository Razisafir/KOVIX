/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { join } from '../../../base/common/path.js';
import { IConstructService } from '../common/construct.js';
import { IMCPProcessNodeService } from '../common/mcp/mcpProcessNode.js';
import { MCPProcessNodeService } from './mcpProcessNode.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions';

class ConstructService implements IConstructService {
        declare readonly _serviceBrand: undefined;
        private _agentProcess: ChildProcess | undefined;
        private _port: number = 8000;

        async start(): Promise<void> {
                const isDev = process.env.VSCODE_DEV === '1';
                if (isDev) {
                        this._agentProcess = spawn('python', ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(this._port)], {
                                cwd: join(__dirname, '..', '..', '..', '..', '..', 'agent-backend'),
                                env: { ...process.env as Record<string, string> }
                        });
                }
        }

        getPort(): number { return this._port; }

        async stop(): Promise<void> {
                this._agentProcess?.kill();
        }
}

registerSingleton(IConstructService, ConstructService, InstantiationType.Eager);

// Register the MCP node service for IPC exposure to the renderer.
// The browser-layer MCPProcessService will attempt to use this service
// via IPC when running in desktop mode. In browser-only mode (vscode.dev),
// it falls back to IFileService.
registerSingleton(IMCPProcessNodeService, MCPProcessNodeService, InstantiationType.Delayed);
