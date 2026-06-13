/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

/**
 * Represents a detected Linux distribution, specifically for Kali Linux integration.
 */
export interface ILinuxDistribution {
	/** How Kali is running: natively, via WSL, or in Docker */
	type: 'native' | 'wsl' | 'docker';
	/** Human-readable distribution name */
	name: string;
	/** Whether Kali is available and accessible */
	available: boolean;
	/** List of detected security tools available in this distribution */
	tools?: string[];
}

/**
 * Service interface for detecting Linux distributions (Kali Linux).
 * Supports detection of native installations, WSL distributions, and Docker images.
 */
export interface IDistributionDetector {
	readonly _serviceBrand: undefined;

	/**
	 * Detect whether Kali Linux is available on this system.
	 * Checks in order: native Linux, WSL, Docker.
	 * Returns null if no Kali installation is found.
	 */
	detectDistribution(): Promise<ILinuxDistribution | null>;

	/**
	 * Get the cached distribution result.
	 * Returns null if detection has not yet been performed.
	 */
	readonly cachedDistribution: ILinuxDistribution | null;

	/**
	 * Force re-detection, ignoring any cached result.
	 */
	redetect(): Promise<ILinuxDistribution | null>;

	/**
	 * Detect which security tools are available in the given distribution.
	 * @param distribution The distribution to check tools for.
	 */
	detectTools(distribution: ILinuxDistribution): Promise<string[]>;
}

export const IDistributionDetector = createDecorator<IDistributionDetector>('distributionDetector');

/**
 * Well-known Kali security tools to check for availability.
 */
export const KALI_SECURITY_TOOLS: readonly string[] = [
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
 * Internal helper — detect Kali on native Linux by reading /etc/os-release.
 * Only works in a Node.js environment.
 */
export async function detectNativeKali(execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>): Promise<ILinuxDistribution | null> {
	try {
		// Check if /etc/os-release contains ID=kali
		const result = await execCommand('cat /etc/os-release');
		if (result.exitCode === 0 && result.stdout.includes('ID=kali')) {
			// Extract the NAME field for display
			const nameMatch = result.stdout.match(/^NAME="?(.+?)"?$/m);
			const name = nameMatch ? nameMatch[1] : 'Kali Linux';
			return {
				type: 'native',
				name,
				available: true,
			};
		}
	} catch {
		// Not on Linux or file not readable
	}
	return null;
}

/**
 * Internal helper — detect Kali in WSL by running wsl.exe -l -v.
 * Only works on Windows with WSL installed.
 */
export async function detectWSLKali(execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>): Promise<ILinuxDistribution | null> {
	try {
		// Check if wsl.exe exists and list distributions
		const result = await execCommand('wsl.exe -l -v');
		if (result.exitCode === 0) {
			const output = result.stdout.toLowerCase();
			if (output.includes('kali-linux') || output.includes('kali')) {
				return {
					type: 'wsl',
					name: 'Kali Linux (WSL)',
					available: true,
				};
			}
		}
	} catch {
		// WSL not available or not on Windows
	}
	return null;
}

/**
 * Internal helper — detect Kali Docker image by checking docker images.
 */
export async function detectDockerKali(execCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>): Promise<ILinuxDistribution | null> {
	try {
		const result = await execCommand('docker images kalilinux/kali-rolling --format "{{.Repository}}"');
		if (result.exitCode === 0 && result.stdout.trim().length > 0) {
			return {
				type: 'docker',
				name: 'Kali Linux (Docker)',
				available: true,
			};
		}
	} catch {
		// Docker not available
	}
	return null;
}
