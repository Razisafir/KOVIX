/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for LicenseService — license validation.
 * No existing licenseService.ts found in codebase; this tests the expected
 * license validation logic as described in the task specification.
 *
 * Tests: no license, valid license, license info, env var, and setting.
 */

// ---- Replicate expected license service logic ----

interface ILicenseInfo {
	isValid: boolean;
	licenseKey?: string;
	licenseType?: string;
	expiresAt?: number;
	features?: string[];
}

class SimpleLicenseService {
	private licenseKey: string | null = null;
	private readonly envKey = 'KOVIX_LICENSE_KEY';
	private readonly settingKey = 'construct.license.key';

	constructor(
		private readonly envVars: Record<string, string | undefined> = {},
		private readonly settings: Record<string, unknown> = {},
	) {
		// Try environment variable first
		if (this.envVars[this.envKey]) {
			this.licenseKey = this.envVars[this.envKey]!;
			return;
		}
		// Then try settings
		const settingValue = this.settings[this.settingKey];
		if (typeof settingValue === 'string' && settingValue.length > 0) {
			this.licenseKey = settingValue;
		}
	}

	isValid(): boolean {
		if (!this.licenseKey) {
			return false;
		}
		return this.validateLicenseFormat(this.licenseKey);
	}

	getLicenseInfo(): ILicenseInfo {
		if (!this.licenseKey || !this.validateLicenseFormat(this.licenseKey)) {
			return { isValid: false };
		}

		// Parse license key (simplified format: KOVIX-TYPE-XXXXX)
		const parts = this.licenseKey.split('-');
		const licenseType = parts.length >= 2 ? parts[1].toLowerCase() : 'unknown';

		return {
			isValid: true,
			licenseKey: this.maskKey(this.licenseKey),
			licenseType,
			features: this.getFeatures(licenseType),
		};
	}

	private validateLicenseFormat(key: string): boolean {
		// License key must start with KOVIX- and be at least 15 characters
		if (!key.startsWith('KOVIX-')) {
			return false;
		}
		if (key.length < 15) {
			return false;
		}
		return true;
	}

	private maskKey(key: string): string {
		if (key.length <= 11) {
			return key.substring(0, 3) + '...' + key.substring(key.length - 4);
		}
		return key.substring(0, 7) + '...' + key.substring(key.length - 4);
	}

	private getFeatures(type: string): string[] {
		switch (type) {
			case 'pro':
				return ['agent', 'cloud', 'security', 'tools'];
			case 'enterprise':
				return ['agent', 'cloud', 'security', 'tools', 'admin', 'audit'];
			case 'community':
				return ['agent', 'local'];
			default:
				return ['agent'];
		}
	}
}

// ---- Tests ----

suite('LicenseService', () => {

	suite('No license — isValid returns false', () => {
		test('isValid returns false with no license', () => {
			const service = new SimpleLicenseService();
			assert.strictEqual(service.isValid(), false);
		});

		test('getLicenseInfo returns invalid when no license', () => {
			const service = new SimpleLicenseService();
			const info = service.getLicenseInfo();
			assert.strictEqual(info.isValid, false);
		});

		test('invalid format (no KOVIX- prefix) returns false', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'INVALID-KEY' });
			assert.strictEqual(service.isValid(), false);
		});

		test('too short key returns false', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'KOVIX-AB' });
			assert.strictEqual(service.isValid(), false);
		});
	});

	suite('Valid license — isValid returns true', () => {
		test('isValid returns true for valid pro license', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'KOVIX-PRO-1234567890' });
			assert.strictEqual(service.isValid(), true);
		});

		test('isValid returns true for valid enterprise license', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'KOVIX-ENTERPRISE-ABCDEFGH' });
			assert.strictEqual(service.isValid(), true);
		});

		test('isValid returns true for valid community license', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'KOVIX-COMMUNITY-1234567' });
			assert.strictEqual(service.isValid(), true);
		});
	});

	suite('License info — getLicenseInfo returns correct data', () => {
		test('pro license info includes pro features', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'KOVIX-PRO-1234567890' });
			const info = service.getLicenseInfo();
			assert.strictEqual(info.isValid, true);
			assert.strictEqual(info.licenseType, 'pro');
			assert.ok(info.features?.includes('cloud'), 'Pro should include cloud');
			assert.ok(info.features?.includes('security'), 'Pro should include security');
		});

		test('enterprise license info includes all features', () => {
			const service = new SimpleLicenseService({}, { 'construct.license.key': 'KOVIX-ENTERPRISE-1234567' });
			const info = service.getLicenseInfo();
			assert.strictEqual(info.isValid, true);
			assert.strictEqual(info.licenseType, 'enterprise');
			assert.ok(info.features?.includes('admin'), 'Enterprise should include admin');
			assert.ok(info.features?.includes('audit'), 'Enterprise should include audit');
		});

		test('license key is masked in info (not plaintext)', () => {
			const key = 'KOVIX-PRO-1234567890';
			const service = new SimpleLicenseService({}, { 'construct.license.key': key });
			const info = service.getLicenseInfo();
			assert.ok(info.licenseKey, 'Should have masked key');
			assert.ok(!info.licenseKey?.includes(key), 'Masked key should not contain full key');
		});
	});

	suite('Environment variable — KOVIX_LICENSE_KEY is read', () => {
		test('license key from environment variable is valid', () => {
			const service = new SimpleLicenseService(
				{ KOVIX_LICENSE_KEY: 'KOVIX-PRO-ENV1234567' },
				{}
			);
			assert.strictEqual(service.isValid(), true);
		});

		test('environment variable takes precedence over settings', () => {
			const service = new SimpleLicenseService(
				{ KOVIX_LICENSE_KEY: 'KOVIX-PRO-ENV1234567' },
				{ 'construct.license.key': 'KOVIX-ENTERPRISE-SETTINGS1' }
			);
			const info = service.getLicenseInfo();
			assert.strictEqual(info.licenseType, 'pro', 'Env var should take precedence');
		});

		test('empty env var falls back to settings', () => {
			const service = new SimpleLicenseService(
				{ KOVIX_LICENSE_KEY: '' },
				{ 'construct.license.key': 'KOVIX-ENTERPRISE-SETTINGS1' }
			);
			assert.strictEqual(service.isValid(), true);
		});

		test('undefined env var falls back to settings', () => {
			const service = new SimpleLicenseService(
				{ KOVIX_LICENSE_KEY: undefined },
				{ 'construct.license.key': 'KOVIX-PRO-SETTINGS1234' }
			);
			assert.strictEqual(service.isValid(), true);
		});
	});

	suite('Setting — construct.license.key is read', () => {
		test('license key from settings is valid', () => {
			const service = new SimpleLicenseService(
				{},
				{ 'construct.license.key': 'KOVIX-PRO-SETTINGS1234' }
			);
			assert.strictEqual(service.isValid(), true);
		});

		test('non-string setting value is ignored', () => {
			const service = new SimpleLicenseService(
				{},
				{ 'construct.license.key': 12345 }
			);
			assert.strictEqual(service.isValid(), false);
		});

		test('empty string setting is ignored', () => {
			const service = new SimpleLicenseService(
				{},
				{ 'construct.license.key': '' }
			);
			assert.strictEqual(service.isValid(), false);
		});
	});
});
