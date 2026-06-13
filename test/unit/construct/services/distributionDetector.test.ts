/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for DistributionDetector — Linux distribution detection.
 * Source: src/vs/platform/construct/common/terminal/distributionDetector.ts
 *
 * Tests native Linux detection, WSL detection, Docker detection,
 * and the ILinuxDistribution return format.
 */

// ---- Replicate production types and logic ----

interface ILinuxDistribution {
	type: 'native' | 'wsl' | 'docker';
	name: string;
	available: boolean;
	tools?: string[];
}

const KALI_SECURITY_TOOLS: readonly string[] = [
	'nmap',
	'nuclei',
	'sqlmap',
	'msfconsole',
	'tshark',
	'john',
	'hydra',
	'aircrack-ng',
	'ghidra',
];

/**
 * Simulates detectNativeKali — checks /etc/os-release for ID=kali.
 */
async function detectNativeKali(
	execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<ILinuxDistribution | null> {
	try {
		const result = await execCommand('cat /etc/os-release');
		if (result.exitCode === 0 && result.stdout.includes('ID=kali')) {
			const nameMatch = result.stdout.match(/^NAME="?(.+?)"?$/m);
			const name = nameMatch ? nameMatch[1] : 'Kali Linux';
			return { type: 'native', name, available: true };
		}
	} catch {
		// Not on Linux or file not readable
	}
	return null;
}

/**
 * Simulates detectWSLKali — checks wsl.exe output for kali.
 */
async function detectWSLKali(
	execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<ILinuxDistribution | null> {
	try {
		const result = await execCommand('wsl.exe -l -v');
		if (result.exitCode === 0) {
			const output = result.stdout.toLowerCase();
			if (output.includes('kali-linux') || output.includes('kali')) {
				return { type: 'wsl', name: 'Kali Linux (WSL)', available: true };
			}
		}
	} catch {
		// WSL not available or not on Windows
	}
	return null;
}

/**
 * Simulates detectDockerKali — checks docker images for kalilinux.
 */
async function detectDockerKali(
	execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<ILinuxDistribution | null> {
	try {
		const result = await execCommand('docker images kalilinux/kali-rolling --format "{{.Repository}}"');
		if (result.exitCode === 0 && result.stdout.trim().length > 0) {
			return { type: 'docker', name: 'Kali Linux (Docker)', available: true };
		}
	} catch {
		// Docker not available
	}
	return null;
}

// ---- Tests ----

suite('DistributionDetector', () => {

	suite('Native Linux detection — /etc/os-release parsing', () => {
		test('detects Kali Linux from /etc/os-release', async () => {
			const mockExec = async () => ({
				stdout: 'NAME="Kali GNU/Linux"\nID=kali\nVERSION="2024.1"\nVERSION_ID="2024.1"',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectNativeKali(mockExec);
			assert.ok(result !== null, 'Should detect Kali Linux');
			assert.strictEqual(result!.type, 'native');
			assert.strictEqual(result!.name, 'Kali GNU/Linux');
			assert.strictEqual(result!.available, true);
		});

		test('returns null for Ubuntu', async () => {
			const mockExec = async () => ({
				stdout: 'NAME="Ubuntu"\nID=ubuntu\nVERSION="22.04.3 LTS (Jammy Jellyfish)"',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectNativeKali(mockExec);
			assert.strictEqual(result, null, 'Should not detect Kali from Ubuntu');
		});

		test('returns null when /etc/os-release cannot be read', async () => {
			const mockExec = async () => ({
				stdout: '',
				stderr: 'No such file or directory',
				exitCode: 1,
			});
			const result = await detectNativeKali(mockExec);
			assert.strictEqual(result, null);
		});

		test('returns null when exec throws', async () => {
			const mockExec = async () => { throw new Error('ENOENT'); };
			const result = await detectNativeKali(mockExec);
			assert.strictEqual(result, null);
		});

		test('extracts NAME field for display', async () => {
			const mockExec = async () => ({
				stdout: 'NAME="Kali Rolling"\nID=kali',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectNativeKali(mockExec);
			assert.strictEqual(result!.name, 'Kali Rolling');
		});

		test('defaults to "Kali Linux" when NAME is missing', async () => {
			const mockExec = async () => ({
				stdout: 'ID=kali\nVERSION=2024',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectNativeKali(mockExec);
			// When no NAME match, defaults to 'Kali Linux'
			assert.strictEqual(result!.name, 'Kali Linux');
		});
	});

	suite('WSL detection — WSL check', () => {
		test('detects Kali in WSL distribution list', async () => {
			const mockExec = async () => ({
				stdout: '  NAME                   STATE       VERSION\n* Ubuntu                 Running     2\n  kali-linux             Stopped     2',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectWSLKali(mockExec);
			assert.ok(result !== null);
			assert.strictEqual(result!.type, 'wsl');
			assert.strictEqual(result!.name, 'Kali Linux (WSL)');
			assert.strictEqual(result!.available, true);
		});

		test('returns null when WSL has no Kali', async () => {
			const mockExec = async () => ({
				stdout: '  NAME                   STATE       VERSION\n* Ubuntu                 Running     2',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectWSLKali(mockExec);
			assert.strictEqual(result, null);
		});

		test('returns null when wsl.exe fails', async () => {
			const mockExec = async () => ({
				stdout: '',
				stderr: 'wsl.exe not found',
				exitCode: 1,
			});
			const result = await detectWSLKali(mockExec);
			assert.strictEqual(result, null);
		});

		test('detects case-insensitive "kali" in WSL output', async () => {
			const mockExec = async () => ({
				stdout: '  Kali-Linux             Running     2',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectWSLKali(mockExec);
			assert.ok(result !== null, 'Should detect Kali case-insensitively');
		});
	});

	suite('Docker detection — Docker image check', () => {
		test('detects Kali Docker image', async () => {
			const mockExec = async () => ({
				stdout: 'kalilinux/kali-rolling',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectDockerKali(mockExec);
			assert.ok(result !== null);
			assert.strictEqual(result!.type, 'docker');
			assert.strictEqual(result!.name, 'Kali Linux (Docker)');
			assert.strictEqual(result!.available, true);
		});

		test('returns null when Docker has no Kali image', async () => {
			const mockExec = async () => ({
				stdout: '',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectDockerKali(mockExec);
			assert.strictEqual(result, null, 'Empty output means no Kali image');
		});

		test('returns null when docker command fails', async () => {
			const mockExec = async () => ({
				stdout: '',
				stderr: 'docker: command not found',
				exitCode: 127,
			});
			const result = await detectDockerKali(mockExec);
			assert.strictEqual(result, null);
		});

		test('returns null when docker throws', async () => {
			const mockExec = async () => { throw new Error('docker not installed'); };
			const result = await detectDockerKali(mockExec);
			assert.strictEqual(result, null);
		});
	});

	suite('Return format — ILinuxDistribution structure', () => {
		test('native distribution has correct structure', async () => {
			const mockExec = async () => ({
				stdout: 'NAME="Kali GNU/Linux"\nID=kali',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectNativeKali(mockExec);
			assert.ok(result !== null);

			// Verify all required fields
			assert.ok(['native', 'wsl', 'docker'].includes(result!.type), 'type must be valid');
			assert.strictEqual(typeof result!.name, 'string', 'name must be string');
			assert.strictEqual(typeof result!.available, 'boolean', 'available must be boolean');
		});

		test('WSL distribution has correct structure', async () => {
			const mockExec = async () => ({
				stdout: 'kali-linux',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectWSLKali(mockExec);
			assert.ok(result !== null);
			assert.strictEqual(result!.type, 'wsl');
			assert.strictEqual(result!.name, 'Kali Linux (WSL)');
			assert.strictEqual(result!.available, true);
		});

		test('Docker distribution has correct structure', async () => {
			const mockExec = async () => ({
				stdout: 'kalilinux/kali-rolling',
				stderr: '',
				exitCode: 0,
			});
			const result = await detectDockerKali(mockExec);
			assert.ok(result !== null);
			assert.strictEqual(result!.type, 'docker');
			assert.strictEqual(result!.name, 'Kali Linux (Docker)');
			assert.strictEqual(result!.available, true);
		});

		test('KALI_SECURITY_TOOLS contains expected entries', () => {
			assert.ok(KALI_SECURITY_TOOLS.includes('nmap'));
			assert.ok(KALI_SECURITY_TOOLS.includes('nuclei'));
			assert.ok(KALI_SECURITY_TOOLS.includes('sqlmap'));
			assert.ok(KALI_SECURITY_TOOLS.includes('msfconsole'));
			assert.ok(KALI_SECURITY_TOOLS.includes('hydra'));
			assert.strictEqual(KALI_SECURITY_TOOLS.length, 9);
		});
	});
});
