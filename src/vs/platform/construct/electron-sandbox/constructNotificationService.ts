// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IConstructNotificationService } from '../common/notification/constructNotificationService.js';
import { CONSTRUCT_CHANNELS } from '../common/constructIpcChannels.js';
import { registerMainProcessRemoteService } from '../../ipc/electron-sandbox/services.js';

registerMainProcessRemoteService(IConstructNotificationService, CONSTRUCT_CHANNELS.NOTIFICATION);
