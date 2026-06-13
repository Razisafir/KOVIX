// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IKovixLicenseService = createDecorator<IKovixLicenseService>('kovixLicenseService');

export interface ILicenseInfo {
        licensed: boolean;
        key?: string;
        expiryDate?: Date;
}

export interface IKovixLicenseService {
        readonly _serviceBrand: undefined;
        isValid(): boolean;
        getLicenseInfo(): ILicenseInfo;
}
