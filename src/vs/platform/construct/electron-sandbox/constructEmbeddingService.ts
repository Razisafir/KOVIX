/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEmbeddingService } from '../common/memory/embeddingService.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the embedding remote proxy so browser-layer DI resolves to the IPC channel
registerMainProcessRemoteService(IEmbeddingService, CONSTRUCT_CHANNELS.EMBEDDING);
