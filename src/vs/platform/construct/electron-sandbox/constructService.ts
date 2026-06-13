// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IConstructService } from '../common/construct.js';
import { IMCPProcessNodeService } from '../common/mcp/mcpProcessNode.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services';

class ConstructService implements IConstructService {
        declare readonly _serviceBrand: undefined;

        async start(): Promise<void> {
                // Python backend removed — all AI capabilities are now handled
                // natively by the TypeScript agent loop + ConstructToolRegistryService.
        }

        getPort(): number { return 0; }

        async stop(): Promise<void> {
                // No-op in renderer process
        }
}

registerSingleton(IConstructService, ConstructService, InstantiationType.Delayed);

// Register the MCP node service as a remote service that communicates
// with the main process via IPC. The ProxyChannel automatically creates
// a transparent proxy that delegates all method calls to the main process.
// In browser-only mode (vscode.dev), this service will be unavailable and
// the browser-layer MCPProcessService falls back to IFileService.
registerMainProcessRemoteService(IMCPProcessNodeService, CONSTRUCT_CHANNELS.MCP);
