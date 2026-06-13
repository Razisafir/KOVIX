// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { IKovixLicenseService, ILicenseInfo } from '../../../../../../platform/construct/common/license/kovixLicenseService.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';

const LICENSE_KEY_SETTING = 'construct.license.key';
const LICENSE_ENV_VAR = 'KOVIX_LICENSE_KEY';
const STORAGE_KEY_LICENSED = 'kovix.license.valid';
const STORAGE_KEY_INFO = 'kovix.license.info';

export class KovixLicenseServiceImpl implements IKovixLicenseService {
	readonly _serviceBrand: undefined;

	private _licenseInfo: ILicenseInfo;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		this._licenseInfo = this._loadLicenseInfo();
	}

	isValid(): boolean {
		return this._licenseInfo.licensed;
	}

	getLicenseInfo(): ILicenseInfo {
		return this._licenseInfo;
	}

	private _loadLicenseInfo(): ILicenseInfo {
		// Try environment variable first
		let envKey: string | undefined;
		if (typeof process !== 'undefined' && process.env) {
			envKey = process.env[LICENSE_ENV_VAR];
		}

		// Fall back to settings
		const settingKey = this.configurationService.getValue<string>(LICENSE_KEY_SETTING);

		const key = envKey || settingKey;

		if (key && typeof key === 'string' && key.trim().length > 0) {
			const info: ILicenseInfo = {
				licensed: true,
				key: key.trim(),
			};
			this._persistLicenseInfo(info);
			return info;
		}

		// Check persisted state from previous validation
		const persisted = this.storageService.get(STORAGE_KEY_LICENSED, StorageScope.APPLICATION);
		if (persisted === 'true') {
			const persistedInfo = this.storageService.get(STORAGE_KEY_INFO, StorageScope.APPLICATION);
			if (persistedInfo) {
				try {
					const parsed = JSON.parse(persistedInfo);
					if (parsed.licensed && parsed.key) {
						return {
							licensed: true,
							key: parsed.key,
							expiryDate: parsed.expiryDate ? new Date(parsed.expiryDate) : undefined,
						};
					}
				} catch {
					// Corrupted storage — ignore
				}
			}
		}

		return { licensed: false };
	}

	private _persistLicenseInfo(info: ILicenseInfo): void {
		this.storageService.store(STORAGE_KEY_LICENSED, String(info.licensed), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this.storageService.store(STORAGE_KEY_INFO, JSON.stringify({
			licensed: info.licensed,
			key: info.key,
			expiryDate: info.expiryDate?.toISOString(),
		}), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
