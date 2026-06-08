// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConstructVectorStore } from '../common/memory/vectorStore.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

// Register the vector store remote proxy so browser-layer DI resolves to the IPC channel
registerMainProcessRemoteService(IConstructVectorStore, CONSTRUCT_CHANNELS.VECTOR_STORE);
