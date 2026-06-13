// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IEmbeddingService } from '../common/memory/embeddingService.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the embedding remote proxy so browser-layer DI resolves to the IPC channel
registerMainProcessRemoteService(IEmbeddingService, CONSTRUCT_CHANNELS.EMBEDDING);
