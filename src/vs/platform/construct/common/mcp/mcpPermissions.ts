/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

// --- Permission Levels -------------------------------------------------------

/**
 * MCP server permission levels, ordered from least to most privileged.
 *
 * - **UNTRUSTED**: No filesystem access, no network access, no subprocess spawning.
 *   Suitable for servers that only compute in-process responses (e.g. prompt templates).
 *
 * - **STANDARD**: Read-only filesystem within allowed paths (typically the workspace root),
 *   no network, no subprocesses. Suitable for file-read-only tools.
 *
 * - **ELEVATED**: Read-write filesystem within allowed paths, limited outbound network
 *   (allowedNetwork domain whitelist), no subprocesses. Suitable for servers that need
 *   to write files or fetch remote data.
 *
 * - **PRIVILEGED**: Full filesystem, unrestricted network, and subprocess spawning.
 *   Requires explicit user approval via IMCPApprovalService.
 */
export type MCPPermissionLevel = 'untrusted' | 'standard' | 'elevated' | 'privileged';

/** Numeric ordering for permission comparisons. */
export const MCP_PERMISSION_RANK: Record<MCPPermissionLevel, number> = {
	untrusted: 0,
	standard: 1,
	elevated: 2,
	privileged: 3,
};

// --- Permission Configuration ------------------------------------------------

export interface MCPPermissionConfig {
	level: MCPPermissionLevel;
	/** Filesystem paths the server may access. Only meaningful for standard/elevated. */
	allowedPaths?: string[];
	/** Network domain / URL patterns the server may access. Only meaningful for elevated. */
	allowedNetwork?: string[];
	/** Whether the server may spawn child processes. Only meaningful for privileged. */
	allowSubprocess?: boolean;
}

// --- Config Manifest (on-disk format in .kovix/mcp-config.json) ---------------

export interface MCPServerConfig {
	command: string;
	args: string[];
	permissions: MCPPermissionLevel;
	allowedPaths?: string[];
	allowedNetwork?: string[];
	env?: Record<string, string>;
}

export interface MCPConfigManifest {
	servers: Record<string, MCPServerConfig>;
}

// --- Audit Logging -----------------------------------------------------------

export interface MCPAuditEntry {
	timestamp: number;
	serverName: string;
	permissionLevel: MCPPermissionLevel;
	action: string;
	resource: string;
	allowed: boolean;
}

// --- Approval Service --------------------------------------------------------

export const IMCPApprovalService = createDecorator<IMCPApprovalService>('construct.mcpApprovalService');

/**
 * Service that prompts the user for approval when an MCP server requests
 * privileged-level access. Implementations should surface a VS Code
 * notification with approve/deny choices.
 */
export interface IMCPApprovalService {
	readonly _serviceBrand: undefined;

	/**
	 * Request user approval for the given server at the given permission level.
	 * Returns `true` if the user explicitly approves, `false` otherwise.
	 */
	requestApproval(serverName: string, level: MCPPermissionLevel): Promise<boolean>;

	/** Fires whenever an approval decision is made. */
	readonly onDidApprove: Event<{ serverName: string; level: MCPPermissionLevel; approved: boolean }>;
}

// --- Permission Enforcer -----------------------------------------------------

/**
 * Runtime permission enforcer for a single MCP server connection.
 *
 * Validates filesystem, network, and subprocess access according to the
 * permission configuration. Every check produces an {@link MCPAuditEntry}
 * that is stored in-memory for later inspection.
 *
 * Usage:
 * ```ts
 * const enforcer = new MCPPermissionEnforcer({
 *   level: 'elevated',
 *   allowedPaths: ['/workspace'],
 *   allowedNetwork: ['api.github.com'],
 * });
 * if (!enforcer.validateFileAccess('/workspace/src/foo.ts', 'read')) {
 *   throw new Error('File access denied');
 * }
 * ```
 */
export class MCPPermissionEnforcer {

	private readonly _auditLog: MCPAuditEntry[] = [];
	private readonly _maxAuditEntries = 10_000;

	constructor(
		private readonly config: MCPPermissionConfig,
		private readonly serverName: string = '<unknown>',
	) {}

	// --- Filesystem Access ----------------------------------------------------

	/**
	 * Validate whether the server may access the given path.
	 *
	 * - **untrusted**: always `false`
	 * - **standard**: `true` for `read` when path is within `allowedPaths`
	 * - **elevated**: `true` for `read`/`write` when path is within `allowedPaths`
	 * - **privileged**: always `true`
	 */
	validateFileAccess(path: string, mode: 'read' | 'write'): boolean {
		const { level } = this.config;

		// Privileged: everything allowed
		if (level === 'privileged') {
			this.audit('fileAccess', path, true);
			return true;
		}

		// Untrusted: nothing allowed
		if (level === 'untrusted') {
			this.audit('fileAccess', path, false);
			return false;
		}

		// standard / elevated — check path allowlist
		const allowedPaths = this.config.allowedPaths ?? [];
		const isWithinAllowed = allowedPaths.length === 0 || allowedPaths.some(allowed => path.startsWith(allowed));

		if (!isWithinAllowed) {
			this.audit('fileAccess', path, false);
			return false;
		}

		// Standard: read-only
		if (level === 'standard') {
			const allowed = mode === 'read';
			this.audit('fileAccess', path, allowed);
			return allowed;
		}

		// Elevated: read + write within allowed paths
		this.audit('fileAccess', path, true);
		return true;
	}

	// --- Network Access -------------------------------------------------------

	/**
	 * Validate whether the server may access the given URL.
	 *
	 * - **untrusted** / **standard**: always `false`
	 * - **elevated**: `true` when the URL's hostname matches an `allowedNetwork` entry
	 * - **privileged**: always `true`
	 */
	validateNetworkAccess(url: string): boolean {
		const { level } = this.config;

		if (level === 'privileged') {
			this.audit('networkAccess', url, true);
			return true;
		}

		if (level === 'untrusted' || level === 'standard') {
			this.audit('networkAccess', url, false);
			return false;
		}

		// Elevated: check allowedNetwork
		const allowedNetwork = this.config.allowedNetwork ?? [];
		if (allowedNetwork.length === 0) {
			this.audit('networkAccess', url, false);
			return false;
		}

		let hostname: string;
		try {
			hostname = new URL(url).hostname;
		} catch {
			// If it's not a valid URL, treat the whole string as a hostname pattern
			hostname = url;
		}

		const allowed = allowedNetwork.some(pattern => {
			// Support wildcard subdomain matching: *.github.com
			if (pattern.startsWith('*.')) {
				const base = pattern.slice(2); // e.g. "github.com"
				return hostname === base || hostname.endsWith('.' + base);
			}
			return hostname === pattern || hostname.endsWith('.' + pattern);
		});

		this.audit('networkAccess', url, allowed);
		return allowed;
	}

	// --- Subprocess Access ----------------------------------------------------

	/**
	 * Validate whether the server may spawn a subprocess.
	 *
	 * - **untrusted** / **standard** / **elevated**: always `false`
	 * - **privileged**: `true` only if `allowSubprocess` is set
	 */
	validateSubprocess(): boolean {
		const { level } = this.config;

		if (level !== 'privileged') {
			this.audit('subprocess', '<spawn>', false);
			return false;
		}

		const allowed = this.config.allowSubprocess === true;
		this.audit('subprocess', '<spawn>', allowed);
		return allowed;
	}

	// --- Accessors ------------------------------------------------------------

	getPermissionLevel(): MCPPermissionLevel {
		return this.config.level;
	}

	/** Returns whether this enforcer's level is at least the given level. */
	hasLevel(minimum: MCPPermissionLevel): boolean {
		return MCP_PERMISSION_RANK[this.config.level] >= MCP_PERMISSION_RANK[minimum];
	}

	/** Return a read-only snapshot of the audit log. */
	getAuditLog(): ReadonlyArray<MCPAuditEntry> {
		return this._auditLog;
	}

	/** Clear the in-memory audit log. */
	clearAuditLog(): void {
		this._auditLog.length = 0;
	}

	// --- Internal -------------------------------------------------------------

	private audit(action: string, resource: string, allowed: boolean): void {
		const entry: MCPAuditEntry = {
			timestamp: Date.now(),
			serverName: this.serverName,
			permissionLevel: this.config.level,
			action,
			resource,
			allowed,
		};
		this._auditLog.push(entry);

		// Evict oldest entries when the log grows too large
		if (this._auditLog.length > this._maxAuditEntries) {
			this._auditLog.splice(0, this._auditLog.length - this._maxAuditEntries);
		}
	}
}

// --- Helper: Build config from manifest --------------------------------------

/**
 * Derive an {@link MCPPermissionConfig} from a raw {@link MCPServerConfig}
 * manifest entry. This handles the mapping from the on-disk format to the
 * runtime enforcer configuration.
 */
export function permissionConfigFromManifest(serverName: string, manifest: MCPServerConfig): MCPPermissionConfig {
	return {
		level: manifest.permissions,
		allowedPaths: manifest.allowedPaths,
		allowedNetwork: manifest.allowedNetwork,
		allowSubprocess: manifest.permissions === 'privileged' ? true : undefined,
	};
}

// --- Default configs per level -----------------------------------------------

/** Default permission configs for each level, useful for quick lookups. */
export const MCP_DEFAULT_PERMISSIONS: Record<MCPPermissionLevel, MCPPermissionConfig> = {
	untrusted: { level: 'untrusted' },
	standard: { level: 'standard', allowedPaths: [] },
	elevated: { level: 'elevated', allowedPaths: [], allowedNetwork: [] },
	privileged: { level: 'privileged', allowSubprocess: true },
};
