/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalExecutor } from '../common/terminal/terminalExecutor.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the terminal executor remote proxy so browser-layer DI resolves to the IPC channel
// This replaces the old browser-layer child_process usage (P0-4 fix)
registerMainProcessRemoteService(ITerminalExecutor, CONSTRUCT_CHANNELS.TERMINAL);
