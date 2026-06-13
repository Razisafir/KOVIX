// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../instantiation/common/instantiation.js';

/**
 * @deprecated IConstructService is not registered in the DI container.
 * The main construct service entry point has been replaced by
 * individual feature services (IConstructAIService, ITerminalExecutor, etc.).
 * Do not inject this service.
 */
export const IConstructService = createDecorator<IConstructService>('constructService');

export interface IConstructService {
        readonly _serviceBrand: undefined;
        getPort(): number;
        start(): Promise<void>;
        stop(): Promise<void>;
}
