/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILinuxDistribution } from './distributionDetector.js';

// ─── Result Interfaces ──────────────────────────────────────────────────────────

/** Result from an nmap scan */
export interface INmapResult {
	success: boolean;
	output: string;
	error?: string;
	/** Number of hosts discovered */
	hostsFound?: number;
	/** List of open ports detected */
	openPorts?: Array<{ port: number; service: string; state: string }>;
}

/** Result from a Nuclei vulnerability scan */
export interface INucleiResult {
	success: boolean;
	output: string;
	error?: string;
	/** Number of vulnerabilities found */
	vulnerabilitiesFound?: number;
	/** Severity breakdown */
	severityBreakdown?: Record<string, number>;
}

/** Result from SQL injection testing */
export interface ISqlmapResult {
	success: boolean;
	output: string;
	error?: string;
	/** Whether an injection was found */
	injectionFound?: boolean;
	/** Database type detected */
	dbms?: string;
}

/** Result from a Metasploit module run */
export interface IMsfResult {
	success: boolean;
	output: string;
	error?: string;
	/** Module that was executed */
	module?: string;
	/** Session ID if a session was opened */
	sessionId?: number;
}

/** Result from a packet capture */
export interface ICaptureResult {
	success: boolean;
	output: string;
	error?: string;
	/** Path to the capture file */
	captureFilePath?: string;
	/** Number of packets captured */
	packetsCaptured?: number;
}

/** Result from password cracking */
export interface ICrackResult {
	success: boolean;
	output: string;
	error?: string;
	/** Number of hashes cracked */
	crackedCount?: number;
	/** Total hashes in file */
	totalHashes?: number;
}

/** Result from brute force attack */
export interface IHydraResult {
	success: boolean;
	output: string;
	error?: string;
	/** Number of valid credentials found */
	validCredentials?: number;
}

/** Result from WiFi assessment */
export interface IAircrackResult {
	success: boolean;
	output: string;
	error?: string;
	/** Number of access points discovered */
	accessPoints?: number;
	/** Number of handshakes captured */
	handshakesCaptured?: number;
}

/** Result from Ghidra decompilation */
export interface IGhidraResult {
	success: boolean;
	output: string;
	error?: string;
	/** Decompiled function names */
	functions?: string[];
	/** Path to analysis output */
	analysisPath?: string;
}

// ─── Service Interface ──────────────────────────────────────────────────────────

/**
 * Kali Tool Bridge — routes security tool commands through the appropriate
 * execution backend based on the detected Kali distribution type.
 *
 * Command routing:
 * - **Native**: Execute directly via terminal
 * - **WSL**: Route through `wsl -d kali-linux -- <command>`
 * - **Docker**: Route through `docker run --rm kalilinux/kali-rolling <command>`
 *
 * All commands MUST go through the terminal security layer.
 */
export interface IKaliToolBridge {
	readonly _serviceBrand: undefined;

	/** Run an nmap network scan */
	nmapScan(target: string, options: string): Promise<INmapResult>;

	/** Run a Nuclei vulnerability scan */
	nucleiScan(target: string, templates?: string): Promise<INucleiResult>;

	/** Run SQL injection testing */
	sqlmapTest(url: string, options?: string): Promise<ISqlmapResult>;

	/** Run a Metasploit module */
	metasploitRun(module: string, options: Record<string, string>): Promise<IMsfResult>;

	/** Capture packets using Wireshark/tshark */
	wiresharkCapture(iface: string, duration: number): Promise<ICaptureResult>;

	/** Crack password hashes using John the Ripper */
	johnCrack(hashFile: string, wordlist?: string): Promise<ICrackResult>;

	/** Brute force attack using Hydra */
	hydraBrute(target: string, service: string, wordlist: string): Promise<IHydraResult>;

	/** WiFi assessment using Aircrack-ng */
	aircrackCapture(iface: string): Promise<IAircrackResult>;

	/** Decompile a binary using Ghidra headless analysis */
	ghidraDecompile(binaryPath: string): Promise<IGhidraResult>;

	/** Get the current distribution this bridge is targeting */
	readonly distribution: ILinuxDistribution | null;

	/** Set the distribution target for command routing */
	setDistribution(distribution: ILinuxDistribution | null): void;
}

export const IKaliToolBridge = createDecorator<IKaliToolBridge>('kaliToolBridge');

// ─── Command Routing Helper ─────────────────────────────────────────────────────

/**
 * Route a command based on the distribution type.
 * - Native: Execute directly
 * - WSL: Wrap with `wsl -d kali-linux -- <command>`
 * - Docker: Wrap with `docker run --rm kalilinux/kali-rolling <command>`
 */
export function routeCommand(distribution: ILinuxDistribution | null, command: string): string {
	if (!distribution || !distribution.available) {
		return command;
	}

	switch (distribution.type) {
		case 'native':
			return command;
		case 'wsl':
			return `wsl -d kali-linux -- bash -c "${command.replace(/"/g, '\\"')}"`;
		case 'docker':
			return `docker run --rm kalilinux/kali-rolling bash -c "${command.replace(/"/g, '\\"')}"`;
		default:
			return command;
	}
}

/**
 * Internal IPs that are rejected by default for security scanning.
 */
const INTERNAL_IP_PATTERNS = [
	/^127\./,                                       // 127.0.0.0/8 (loopback)
	/^10\./,                                        // 10.0.0.0/8
	/^172\.(1[6-9]|2\d|3[0-1])\./,                  // 172.16.0.0/12
	/^192\.168\./,                                  // 192.168.0.0/16
	/^localhost$/i,                                  // localhost
	/^0\.0\.0\.0$/,                                 // 0.0.0.0
	/^\[::1?\]$/,                                   // IPv6 loopback
	/^::1?$/,                                       // IPv6 loopback short
];

/**
 * Check if a target is an internal IP address.
 * Returns true if the target appears to be an internal/loopback address.
 */
export function isInternalTarget(target: string): boolean {
	// Strip protocol prefix
	const cleaned = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
	for (const pattern of INTERNAL_IP_PATTERNS) {
		if (pattern.test(cleaned)) {
			return true;
		}
	}
	return false;
}
