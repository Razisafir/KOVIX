// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { ISecureKeyManager } from '../common/security/secureKeyManager.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

registerMainProcessRemoteService(ISecureKeyManager, CONSTRUCT_CHANNELS.SECURE_KEYS);
