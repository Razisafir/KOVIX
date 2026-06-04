/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { join } from '../../../../base/common/path.js';
import { IConstructService } from '../common/construct.js';
import { IMCPProcessNodeService } from '../common/mcp/mcpProcessNode.js';
import { MCPProcessNodeService } from './mcpProcessNode.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';

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

	private async _waitForReady(): Promise<void> {
		for (let i = 0; i < 30; i++) {
			try {
				const response = await fetch(`http://127.0.0.1:${this._port}/health`);
				if (response.ok) { return; }
			} catch {
				// not ready yet
			}
			await new Promise<void>(r => setTimeout(r, 1000));
		}
		throw new Error('Agent backend failed to start');
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
