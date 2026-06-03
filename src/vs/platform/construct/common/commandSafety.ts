/*---------------------------------------------------------------------------------------------
 *  AI Execution Kernel -- Phase 4: Command Safety Engine
 *  Construct IDE -- AI-Native IDE
 *
 *  ICommandSafetyService -- Command validation and shell injection prevention.
 *
 *  REAL responsibilities:
 *    - Command tokenization: parse commands into tokens for analysis
 *    - Shell injection detection: detect dangerous shell metacharacters
 *    - Path traversal detection: detect attempts to access files outside workspace
 *    - Dangerous flag detection: detect rm -rf, --force, etc.
 *    - Recursive deletion detection: detect rm -r, rmdir /s, etc.
 *    - Privilege escalation detection: detect sudo, su, runas, etc.
 *    - Environment variable sanitization: prevent env var injection
 *    - Explicit risk levels for every command
 *    - Block destructive commands by default
 *    - Allow user overrides only with confirmation
 *
 *  HARD RULES:
 *    - Explicit risk levels for every command
 *    - Block destructive commands by default
 *    - Allow user overrides only with confirmation
 *
 *  HONEST limitations:
 *    - Command tokenization is regex-based; complex shell syntax may
 *      be parsed incorrectly
 *    - Cannot prevent all possible shell injection vectors
 *    - Path traversal detection works relative to workspace root;
 *      absolute paths outside workspace may not always be caught
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

// -- Enumerations --

/**
 * Risk level of a command.
 */
export enum CommandRisk {
	/** Safe: read-only, non-destructive (ls, cat, git status, etc.) */
	Safe = 'safe',
	/** Low risk: minor side effects (touch, mkdir, npm install, etc.) */
	LowRisk = 'lowRisk',
	/** Medium risk: modifies existing files (npm update, git commit, etc.) */
	MediumRisk = 'mediumRisk',
	/** High risk: destructive (rm, git reset --hard, etc.) */
	HighRisk = 'highRisk',
	/** Blocked: never allowed (sudo, rm -rf /, etc.) */
	Blocked = 'blocked',
}

// -- Data Types --

/**
 * Result of command safety analysis.
 */
export interface CommandSafetyResult {
	/** The original command string */
	readonly command: string;
	/** Overall risk level */
	readonly risk: CommandRisk;
	/** Whether the command is allowed under current policy */
	readonly allowed: boolean;
	/** Individual safety checks performed */
	readonly checks: SafetyCheck[];
	/** Suggested safe alternative (if the command is blocked) */
	readonly safeAlternative: string | null;
	/** Reason for blocking (if not allowed) */
	readonly blockReason: string | null;
}

/**
 * A single safety check on a command.
 */
export interface SafetyCheck {
	/** Check name */
	readonly name: string;
	/** Whether this check passed */
	readonly passed: boolean;
	/** Severity if failed */
	readonly severity: CommandRisk;
	/** Description of what was checked */
	readonly description: string;
	/** Details of what was found (if check failed) */
	readonly details: string | null;
}

/**
 * Parsed command tokens.
 */
export interface CommandTokens {
	/** The original command string */
	readonly original: string;
	/** The base command (first token) */
	readonly baseCommand: string;
	/** All arguments (excluding base command) */
	readonly args: string[];
	/** Flags (arguments starting with - or --) */
	readonly flags: string[];
	/** Paths detected in the command */
	readonly paths: string[];
	/** Shell operators detected (|, &&, ||, ;, >, >>, etc.) */
	readonly shellOperators: string[];
	/** Environment variable references detected */
	readonly envVars: string[];
	/** Whether the command uses shell expansion ($(), ``, ${}, etc.) */
	readonly usesShellExpansion: boolean;
}

/**
 * Safety policy configuration.
 */
export interface CommandSafetyPolicy {
	/** Whether to block high-risk commands by default */
	blockHighRisk: boolean;
	/** Whether to block all sudo/elevated commands */
	blockPrivilegeEscalation: boolean;
	/** Whether to block recursive deletion commands */
	blockRecursiveDeletion: boolean;
	/** Whether to check for path traversal */
	blockPathTraversal: boolean;
	/** Whether to check for shell injection */
	blockShellInjection: boolean;
	/** Whether to allow shell piping (|) */
	allowPiping: boolean;
	/** Whether to allow output redirection (>, >>) */
	allowRedirection: boolean;
	/** List of explicitly allowed commands (override risk assessment) */
	allowedCommands: string[];
	/** List of explicitly blocked commands (always blocked) */
	blockedCommands: string[];
	/** Maximum command length */
	maxCommandLength: number;
}

// -- Service Interface --

export interface ICommandSafetyService {
	readonly _serviceBrand: undefined;

	/**
	 * Analyze a command for safety risks.
	 * Returns a comprehensive safety result with risk level, checks,
	 * and suggested alternatives.
	 */
	analyzeCommand(command: string): CommandSafetyResult;

	/**
	 * Tokenize a command string into its components.
	 * Handles: base command, arguments, flags, paths, operators,
	 * environment variables, and shell expansion.
	 */
	tokenizeCommand(command: string): CommandTokens;

	/**
	 * Check if a command is allowed under the current safety policy.
	 * Returns true if allowed, false if blocked.
	 */
	isCommandAllowed(command: string): boolean;

	/**
	 * Get the risk level of a command.
	 */
	getCommandRisk(command: string): CommandRisk;

	/**
	 * Check for shell injection patterns.
	 * Detects: command substitution, semicolons, backticks,
	 * pipe to shell, and other injection vectors.
	 */
	checkShellInjection(command: string): SafetyCheck;

	/**
	 * Check for path traversal attempts.
	 * Detects: ../, absolute paths outside workspace,
	 * symlinks to sensitive locations.
	 */
	checkPathTraversal(command: string, workspaceRoot: string): SafetyCheck;

	/**
	 * Check for dangerous flags and arguments.
	 * Detects: --force, -rf, --no-dry-run, etc.
	 */
	checkDangerousFlags(tokens: CommandTokens): SafetyCheck;

	/**
	 * Check for recursive deletion commands.
	 * Detects: rm -r, rm -rf, rmdir /s, del /s, etc.
	 */
	checkRecursiveDeletion(tokens: CommandTokens): SafetyCheck;

	/**
	 * Check for privilege escalation attempts.
	 * Detects: sudo, su, runas, doas, etc.
	 */
	checkPrivilegeEscalation(tokens: CommandTokens): SafetyCheck;

	/**
	 * Sanitize environment variable references.
	 * Removes potentially dangerous env var expansions.
	 */
	sanitizeEnvironmentVars(command: string): string;

	/**
	 * Get the current safety policy.
	 */
	getPolicy(): CommandSafetyPolicy;

	/**
	 * Update the safety policy.
	 */
	updatePolicy(policy: Partial<CommandSafetyPolicy>): void;

	/**
	 * Temporarily allow a blocked command.
	 * Used when the user explicitly approves a command.
	 * The allowance is session-scoped and command-specific.
	 */
	allowOnce(command: string): void;

	/**
	 * Get the number of blocked commands in this session.
	 */
	getBlockedCount(): number;

	/**
	 * Get the number of allowed commands in this session.
	 */
	getAllowedCount(): number;
}

export const ICommandSafetyService = createDecorator<ICommandSafetyService>('construct.commandSafetyService');
