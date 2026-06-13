// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IConstructChatHistory } from '../common/memory/vectorStore.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the chat history remote proxy so browser-layer DI resolves to the IPC channel
registerMainProcessRemoteService(IConstructChatHistory, CONSTRUCT_CHANNELS.CHAT_HISTORY);
