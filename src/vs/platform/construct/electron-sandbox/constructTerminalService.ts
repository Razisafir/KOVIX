// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { ITerminalExecutor } from '../common/terminal/terminalExecutor.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the terminal executor remote proxy so browser-layer DI resolves to the IPC channel
// This replaces the old browser-layer child_process usage (P0-4 fix)
registerMainProcessRemoteService(ITerminalExecutor, CONSTRUCT_CHANNELS.TERMINAL);
