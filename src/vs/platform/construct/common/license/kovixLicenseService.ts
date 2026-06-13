/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
