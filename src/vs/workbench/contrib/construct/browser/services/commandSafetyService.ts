/*---------------------------------------------------------------------------------------------
 *  Construct IDE -- AI Execution Kernel -- Phase 29: Command Safety Service
 *
 *  CommandSafetyService -- Concrete implementation of ICommandSafetyService.
 *
 *  Provides command validation, shell injection prevention, and risk assessment
 *  for all commands before they are executed by the AI execution kernel.
 *
 *  Adapted from Real-construct for Construct IDE.
 *  Key adaptations:
 *    - Branding: construct → construct, Construct IDE → Construct IDE
 *    - Import paths updated for CONSTRUCT-VSCODE directory structure
 *    - Log prefixes: [CommandSafety] → [Construct CommandSafety]
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import {
	ICommandSafetyService,
	CommandRisk,
	CommandSafetyResult,
	CommandSafetyPolicy,
	SafetyCheck,
	CommandTokens,
} from '../../../../../platform/construct/common/commandSafety.js';

// -- Default policy --

const DEFAULT_POLICY: CommandSafetyPolicy = {
	blockHighRisk: true,
	blockPrivilegeEscalation: true,
	blockRecursiveDeletion: true,
	blockPathTraversal: true,
	blockShellInjection: true,
	allowPiping: true,
	allowRedirection: true,
	allowedCommands: [],
	blockedCommands: [],
	maxCommandLength: 4096,
};

// -- Known safe commands (read-only, non-destructive) --

const KNOWN_SAFE_COMMANDS = new Set([
	'ls', 'cat', 'head', 'tail', 'pwd', 'echo', 'which', 'where',
	'node --version', 'npm --version',
	'git status', 'git log', 'git diff', 'git branch', 'git remote',
	'tsc --noEmit', 'eslint --version',
	'wc', 'sort', 'uniq', 'grep', 'find', 'du', 'df', 'printenv',
]);

// -- Known dangerous commands (never allowed) --

const KNOWN_DANGEROUS_COMMANDS = new Set([
	'rm -rf /', 'rm -rf /*', 'sudo rm', 'mkfs', 'dd if=',
	':(){:|:&};:', 'format c:', 'del /s /q C:',
	'shutdown', 'reboot', 'halt', 'poweroff', 'init 0', 'init 6',
]);

export class CommandSafetyService extends Disposable implements ICommandSafetyService {
	declare readonly _serviceBrand: undefined;

	private policy: CommandSafetyPolicy;
	private blockedCount: number = 0;
	private allowedCount: number = 0;
	private readonly temporaryAllowSet: Set<string> = new Set();
	private readonly knownSafeCommands: Set<string>;
	private readonly knownDangerousCommands: Set<string>;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.policy = { ...DEFAULT_POLICY };
		this.knownSafeCommands = new Set(KNOWN_SAFE_COMMANDS);
		this.knownDangerousCommands = new Set(KNOWN_DANGEROUS_COMMANDS);
	}

	// -- Public API --

	analyzeCommand(command: string): CommandSafetyResult {
		const trimmed = command.trim();

		// Check command length
		if (trimmed.length > this.policy.maxCommandLength) {
			return {
				command: trimmed,
				risk: CommandRisk.Blocked,
				allowed: false,
				checks: [{
					name: 'command-length',
					passed: false,
					severity: CommandRisk.Blocked,
					description: 'Command exceeds maximum allowed length',
					details: `Command length ${trimmed.length} exceeds maximum ${this.policy.maxCommandLength}`,
				}],
				safeAlternative: null,
				blockReason: 'Command exceeds maximum allowed length',
			};
		}

		// Tokenize
		const tokens = this.tokenizeCommand(trimmed);

		// Run all checks
		const checks: SafetyCheck[] = [];
		checks.push(this.checkShellInjection(trimmed));
		checks.push(this.checkPathTraversal(trimmed, ''));
		checks.push(this.checkDangerousFlags(tokens));
		checks.push(this.checkRecursiveDeletion(tokens));
		checks.push(this.checkPrivilegeEscalation(tokens));

		// Determine overall risk
		let risk = CommandRisk.Safe;

		// Check known safe
		if (this.knownSafeCommands.has(trimmed) || this.knownSafeCommands.has(tokens.baseCommand)) {
			risk = CommandRisk.Safe;
		}

		// Check known dangerous
		if (this.knownDangerousCommands.has(trimmed)) {
			risk = CommandRisk.Blocked;
		}

		// Check explicitly blocked commands
		if (this.policy.blockedCommands.some(blocked => trimmed === blocked || trimmed.startsWith(blocked + ' '))) {
			risk = CommandRisk.Blocked;
		}

		// Check explicitly allowed commands
		const isExplicitlyAllowed = this.policy.allowedCommands.some(allowed => trimmed === allowed || trimmed.startsWith(allowed + ' '));

		// Elevate risk based on check failures
		for (const check of checks) {
			if (!check.passed) {
				// Map check severity to overall risk, but never downgrade
				const severityOrder = [
					CommandRisk.Safe,
					CommandRisk.LowRisk,
					CommandRisk.MediumRisk,
					CommandRisk.HighRisk,
					CommandRisk.Blocked,
				];
				const currentIndex = severityOrder.indexOf(risk);
				const checkIndex = severityOrder.indexOf(check.severity);
				if (checkIndex > currentIndex) {
					risk = check.severity;
				}
			}
		}

		// Additional risk heuristics based on base command
		if (risk === CommandRisk.Safe) {
			const base = tokens.baseCommand.toLowerCase();
			if (base === 'rm' || base === 'rmdir' || base === 'del') {
				risk = CommandRisk.HighRisk;
			} else if (base === 'mv' || base === 'cp' || base === 'chmod' || base === 'chown') {
				risk = CommandRisk.MediumRisk;
			} else if (base === 'mkdir' || base === 'touch' || base === 'npm' || base === 'npx' || base === 'pip') {
				risk = CommandRisk.LowRisk;
			} else if (tokens.shellOperators.length > 0 || tokens.usesShellExpansion) {
				risk = CommandRisk.MediumRisk;
			}
		}

		// Determine if allowed under policy
		let allowed = true;
		let blockReason: string | null = null;

		if (isExplicitlyAllowed) {
			allowed = true;
		} else if (risk === CommandRisk.Blocked) {
			allowed = false;
			blockReason = 'Command is blocked by safety policy';
		} else if (risk === CommandRisk.HighRisk && this.policy.blockHighRisk) {
			allowed = false;
			blockReason = 'High-risk command blocked by policy';
		}

		// Check individual policy flags
		if (!checks.find(c => c.name === 'privilege-escalation')?.passed && this.policy.blockPrivilegeEscalation) {
			allowed = false;
			blockReason = blockReason ?? 'Privilege escalation blocked by policy';
		}
		if (!checks.find(c => c.name === 'recursive-deletion')?.passed && this.policy.blockRecursiveDeletion) {
			allowed = false;
			blockReason = blockReason ?? 'Recursive deletion blocked by policy';
		}
		if (!checks.find(c => c.name === 'path-traversal')?.passed && this.policy.blockPathTraversal) {
			allowed = false;
			blockReason = blockReason ?? 'Path traversal blocked by policy';
		}
		if (!checks.find(c => c.name === 'shell-injection')?.passed && this.policy.blockShellInjection) {
			allowed = false;
			blockReason = blockReason ?? 'Shell injection blocked by policy';
		}

		// Compute safe alternative
		let safeAlternative: string | null = null;
		if (!allowed) {
			safeAlternative = this.computeSafeAlternative(trimmed, tokens, risk);
		}

		return {
			command: trimmed,
			risk,
			allowed,
			checks,
			safeAlternative,
			blockReason,
		};
	}

	tokenizeCommand(command: string): CommandTokens {
		const original = command;

		// Split by whitespace, respecting single and double quotes
		const tokens: string[] = [];
		let current = '';
		let inSingleQuote = false;
		let inDoubleQuote = false;

		for (let i = 0; i < command.length; i++) {
			const ch = command[i];

			if (ch === "'" && !inDoubleQuote) {
				inSingleQuote = !inSingleQuote;
				current += ch;
				continue;
			}

			if (ch === '"' && !inSingleQuote) {
				inDoubleQuote = !inDoubleQuote;
				current += ch;
				continue;
			}

			if (ch === ' ' && !inSingleQuote && !inDoubleQuote) {
				if (current.length > 0) {
					tokens.push(current);
					current = '';
				}
				continue;
			}

			current += ch;
		}
		if (current.length > 0) {
			tokens.push(current);
		}

		// Extract components
		const baseCommand = tokens.length > 0 ? tokens[0] : '';
		const args = tokens.slice(1);
		const flags: string[] = [];
		const paths: string[] = [];
		const shellOperators: string[] = [];
		const envVars: string[] = [];

		const SHELL_OPERATORS = ['|', '&&', '||', ';', '>', '>>', '<', '<<'];

		for (const token of args) {
			// Flags: start with - or --
			if (token.startsWith('-') || token.startsWith('--')) {
				flags.push(token);
			}

			// Paths: contain / or \
			if (token.includes('/') || token.includes('\\')) {
				paths.push(token);
			}

			// Shell operators
			if (SHELL_OPERATORS.includes(token)) {
				shellOperators.push(token);
			}

			// Environment variables: start with $
			if (token.startsWith('$')) {
				envVars.push(token);
			}
		}

		// Also detect shell operators embedded in the raw command
		// (e.g. "cmd1 && cmd2" may be a single token after quote handling)
		for (const op of SHELL_OPERATORS) {
			if (command.includes(op) && !shellOperators.includes(op)) {
				shellOperators.push(op);
			}
		}

		// Also detect env vars embedded in tokens
		const envVarRegex = /\$\w+/g;
		let envMatch: RegExpExecArray | null;
		while ((envMatch = envVarRegex.exec(command)) !== null) {
			if (!envVars.includes(envMatch[0])) {
				envVars.push(envMatch[0]);
			}
		}

		// Shell expansion detection
		const usesShellExpansion =
			command.includes('$(') ||
			command.includes('`') ||
			command.includes('${');

		return {
			original,
			baseCommand,
			args,
			flags,
			paths,
			shellOperators,
			envVars,
			usesShellExpansion,
		};
	}

	isCommandAllowed(command: string): boolean {
		const trimmed = command.trim();

		// Check temporary allow set
		if (this.temporaryAllowSet.has(trimmed)) {
			this.allowedCount++;
			return true;
		}

		// Check known dangerous commands
		if (this.knownDangerousCommands.has(trimmed)) {
			this.blockedCount++;
			this.logService.warn(`[Construct CommandSafety] Blocked known dangerous command: ${trimmed}`);
			return false;
		}

		// Full analysis
		const result = this.analyzeCommand(trimmed);
		if (result.allowed) {
			this.allowedCount++;
		} else {
			this.blockedCount++;
			this.logService.warn(`[Construct CommandSafety] Blocked command: ${trimmed} (risk: ${result.risk}, reason: ${result.blockReason})`);
		}

		return result.allowed;
	}

	getCommandRisk(command: string): CommandRisk {
		return this.analyzeCommand(command.trim()).risk;
	}

	checkShellInjection(command: string): SafetyCheck {
		const trimmed = command.trim();
		const details: string[] = [];

		// Check for semicolons with additional commands
		if (/;\s*\w+/.test(trimmed)) {
			details.push('Semicolon with additional command detected');
		}

		// Check for backticks (command substitution)
		if (/`[^`]+`/.test(trimmed)) {
			details.push('Backtick command substitution detected');
		}

		// Check for $() command substitution
		if (/\$\([^)]+\)/.test(trimmed)) {
			details.push('$() command substitution detected');
		}

		// Check for pipe to shell
		if (/\|\s*(sh|bash|zsh|fish|dash|ksh)\b/.test(trimmed)) {
			details.push('Pipe to shell detected');
		}

		// Check for && with suspicious commands
		const suspiciousAfterAnd = /&&\s*(rm|sudo|su|mkfs|dd|shutdown|reboot|halt|poweroff|format)\b/i;
		if (suspiciousAfterAnd.test(trimmed)) {
			details.push('&& with suspicious command detected');
		}

		const passed = details.length === 0;
		return {
			name: 'shell-injection',
			passed,
			severity: passed ? CommandRisk.Safe : CommandRisk.Blocked,
			description: 'Check for shell injection patterns',
			details: passed ? null : details.join('; '),
		};
	}

	checkPathTraversal(command: string, workspaceRoot: string): SafetyCheck {
		const trimmed = command.trim();
		const details: string[] = [];

		// Check for ../ patterns
		if (/\.\.[\\/]/.test(trimmed) || /\.\.[\\/]/.test(trimmed)) {
			details.push('Path traversal with ../ detected');
		}

		// Check for absolute paths outside workspace root (if provided)
		if (workspaceRoot) {
			const absolutePathRegex = /(?:(?:\/[a-zA-Z0-9_.-]+)+|[A-Za-z]:[\\/][^\s]*)/g;
			let pathMatch: RegExpExecArray | null;
			while ((pathMatch = absolutePathRegex.exec(trimmed)) !== null) {
				const pathStr = pathMatch[0].toLowerCase();
				if (!pathStr.startsWith(workspaceRoot.toLowerCase()) && !pathStr.startsWith('/')) {
					// skip flags that look like paths
					if (!pathMatch[0].startsWith('-')) {
						details.push(`Absolute path outside workspace: ${pathMatch[0]}`);
					}
				}
			}
		}

		// Check for sensitive system paths
		const sensitivePaths = ['/etc/', '/proc/', '/sys/', 'C:\\Windows\\', 'C:\\System32\\'];
		for (const sensitivePath of sensitivePaths) {
			if (trimmed.includes(sensitivePath) || trimmed.includes(sensitivePath.toLowerCase())) {
				details.push(`Access to sensitive path: ${sensitivePath}`);
			}
		}

		const passed = details.length === 0;
		return {
			name: 'path-traversal',
			passed,
			severity: passed ? CommandRisk.Safe : CommandRisk.HighRisk,
			description: 'Check for path traversal attempts',
			details: passed ? null : details.join('; '),
		};
	}

	checkDangerousFlags(tokens: CommandTokens): SafetyCheck {
		const details: string[] = [];
		const baseCommand = tokens.baseCommand.toLowerCase();

		for (const flag of tokens.flags) {
			const lower = flag.toLowerCase();

			// --force
			if (lower === '--force') {
				details.push('--force flag detected');
			}

			// -f with rm
			if (lower === '-f' && baseCommand === 'rm') {
				details.push('-f flag with rm detected');
			}

			// --no-dry-run
			if (lower === '--no-dry-run') {
				details.push('--no-dry-run flag detected');
			}

			// --dangerous
			if (lower === '--dangerous') {
				details.push('--dangerous flag detected');
			}

			// --yes / -y with apt/yum
			if ((lower === '--yes' || lower === '-y') && (baseCommand === 'apt' || baseCommand === 'apt-get' || baseCommand === 'yum' || baseCommand === 'dnf')) {
				details.push(`-y/--yes flag with ${baseCommand} detected`);
			}

			// --allow-root
			if (lower === '--allow-root') {
				details.push('--allow-root flag detected');
			}

			// --privileged
			if (lower === '--privileged') {
				details.push('--privileged flag detected');
			}
		}

		const passed = details.length === 0;
		return {
			name: 'dangerous-flags',
			passed,
			severity: passed ? CommandRisk.Safe : CommandRisk.HighRisk,
			description: 'Check for dangerous flags and arguments',
			details: passed ? null : details.join('; '),
		};
	}

	checkRecursiveDeletion(tokens: CommandTokens): SafetyCheck {
		const details: string[] = [];
		const baseCommand = tokens.baseCommand.toLowerCase();
		const allArgs = tokens.args.map(a => a.toLowerCase());
		const flagStr = tokens.flags.map(f => f.toLowerCase()).join(' ');

		// rm with -r or -rf or -fr
		if (baseCommand === 'rm') {
			if (flagStr.includes('-rf') || flagStr.includes('-fr') || flagStr.includes('-r')) {
				details.push('rm with recursive flag detected');
			}
			// Also check combined short flags like "rm -rf"
			for (const arg of allArgs) {
				if (arg === '-rf' || arg === '-fr' || arg === '-r') {
					if (!details.length) {
						details.push('rm with recursive flag detected');
					}
				}
			}
		}

		// rmdir /s
		if (baseCommand === 'rmdir' && allArgs.some(a => a === '/s' || a === '/s /q')) {
			details.push('rmdir /s detected');
		}

		// del /s
		if (baseCommand === 'del' && allArgs.some(a => a === '/s')) {
			details.push('del /s detected');
		}

		// rd /s
		if (baseCommand === 'rd' && allArgs.some(a => a === '/s')) {
			details.push('rd /s detected');
		}

		// Remove-Item -Recurse
		if (baseCommand === 'remove-item' && allArgs.some(a => a === '-recurse' || a === '-r')) {
			details.push('Remove-Item -Recurse detected');
		}

		const passed = details.length === 0;
		return {
			name: 'recursive-deletion',
			passed,
			severity: passed ? CommandRisk.Safe : CommandRisk.Blocked,
			description: 'Check for recursive deletion commands',
			details: passed ? null : details.join('; '),
		};
	}

	checkPrivilegeEscalation(tokens: CommandTokens): SafetyCheck {
		const details: string[] = [];
		const baseCommand = tokens.baseCommand.toLowerCase();
		const allTokens = [baseCommand, ...tokens.args.map(a => a.toLowerCase())];

		// sudo
		if (baseCommand === 'sudo') {
			details.push('sudo detected');
		}

		// su
		if (baseCommand === 'su') {
			details.push('su detected');
		}

		// su -
		if (baseCommand === 'su' && tokens.args.length > 0 && tokens.args[0] === '-') {
			details.push('su - (login shell) detected');
		}

		// runas (Windows)
		if (baseCommand === 'runas') {
			details.push('runas detected');
		}

		// doas (OpenBSD)
		if (baseCommand === 'doas') {
			details.push('doas detected');
		}

		// pkexec
		if (baseCommand === 'pkexec') {
			details.push('pkexec detected');
		}

		// gksudo
		if (baseCommand === 'gksudo') {
			details.push('gksudo detected');
		}

		// Also check if privilege escalation appears anywhere in tokens
		// (e.g. piped "sudo" after shell operator)
		const escalationCommands = ['sudo', 'su', 'runas', 'doas', 'pkexec', 'gksudo'];
		for (const esc of escalationCommands) {
			if (allTokens.includes(esc) && !details.some(d => d.includes(esc))) {
				details.push(`${esc} detected in arguments`);
			}
		}

		const passed = details.length === 0;
		return {
			name: 'privilege-escalation',
			passed,
			severity: passed ? CommandRisk.Safe : CommandRisk.Blocked,
			description: 'Check for privilege escalation attempts',
			details: passed ? null : details.join('; '),
		};
	}

	sanitizeEnvironmentVars(command: string): string {
		let sanitized = command;

		// Replace dangerous env var patterns
		// $IFS manipulation
		sanitized = sanitized.replace(/\$IFS\b/g, '<SANITIZED_IFS>');

		// $PATH manipulation (reassignment patterns)
		sanitized = sanitized.replace(/\$PATH\s*=/g, '<SANITIZED_PATH_ASSIGN>');

		// LD_PRELOAD
		sanitized = sanitized.replace(/\bLD_PRELOAD\b/g, '<SANITIZED_LD_PRELOAD>');

		// DYLD_INSERT_LIBRARIES
		sanitized = sanitized.replace(/\bDYLD_INSERT_LIBRARIES\b/g, '<SANITIZED_DYLD>');

		return sanitized;
	}

	getPolicy(): CommandSafetyPolicy {
		return { ...this.policy };
	}

	updatePolicy(policy: Partial<CommandSafetyPolicy>): void {
		this.policy = { ...this.policy, ...policy };
		this.logService.info('[Construct CommandSafety] Policy updated');
	}

	allowOnce(command: string): void {
		this.temporaryAllowSet.add(command.trim());
		this.logService.info(`[Construct CommandSafety] Temporarily allowed command: ${command.trim()}`);
	}

	getBlockedCount(): number {
		return this.blockedCount;
	}

	getAllowedCount(): number {
		return this.allowedCount;
	}

	// -- Private helpers --

	private computeSafeAlternative(command: string, tokens: CommandTokens, risk: CommandRisk): string | null {
		const baseCommand = tokens.baseCommand.toLowerCase();

		// Suggest alternatives based on the command type
		if (baseCommand === 'rm' && tokens.flags.some(f => f.includes('r') || f.includes('f'))) {
			// Remove recursive/force flags
			const safeFlags = tokens.flags.filter(f => !f.includes('r') && !f.includes('f'));
			const nonFlagArgs = tokens.args.filter(a => !a.startsWith('-'));
			const safeCmd = ['rm', ...safeFlags, ...nonFlagArgs].filter(Boolean).join(' ');
			return safeCmd !== command ? safeCmd : null;
		}

		if (baseCommand === 'sudo') {
			// Remove sudo and suggest running without it
			const withoutSudo = tokens.args.join(' ');
			return withoutSudo || null;
		}

		if (baseCommand === 'su') {
			return null; // No safe alternative for su
		}

		if (risk === CommandRisk.Blocked && command.includes('|')) {
			// Suggest running without the pipe
			const beforePipe = command.split('|')[0].trim();
			return beforePipe || null;
		}

		if (risk === CommandRisk.HighRisk && tokens.shellOperators.length > 0) {
			// Suggest running just the first command
			return tokens.baseCommand || null;
		}

		return null;
	}
}
