// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IConstructVectorStore } from '../common/memory/vectorStore.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the vector store remote proxy so browser-layer DI resolves to the IPC channel
registerMainProcessRemoteService(IConstructVectorStore, CONSTRUCT_CHANNELS.VECTOR_STORE);
