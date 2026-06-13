// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IConstructConfigService } from '../common/config/constructConfigService.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

registerMainProcessRemoteService(IConstructConfigService, CONSTRUCT_CHANNELS.CONFIG);
