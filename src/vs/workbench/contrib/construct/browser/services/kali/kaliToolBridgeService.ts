/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ILinuxDistribution } from '../../../../../../platform/construct/common/terminal/distributionDetector.js';
import {
	IKaliToolBridge, routeCommand, isInternalTarget,
	INmapResult, INucleiResult, ISqlmapResult, IMsfResult,
	ICaptureResult, ICrackResult, IHydraResult, IAircrackResult, IGhidraResult
} from '../../../../../../platform/construct/common/terminal/kaliToolBridge.js';
import { ITerminalExecutor, sanitiseForAuditLog } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';

/**
 * Maximum concurrent security tool executions.
 */
const MAX_CONCURRENT_SECURITY_TOOLS = 5;

/**
 * Warning shown on first use of security tools.
 */
const SECURITY_FIRST_USE_WARNING = '⚠️ Security tools can be destructive. Only use on systems you have permission to test.';

/**
 * Browser-side implementation of IKaliToolBridge.
 * Routes security tool commands through the terminal executor with
 * command wrapping based on the detected distribution type.
 *
 * Safety features:
 * - Rate limiting: max 5 concurrent security tool executions
 * - Target validation: reject scanning internal IPs by default
 * - Audit logging: all executions logged to ~/.kovix/security-audit.log
 * - First-use warning displayed to user
 * - All commands go through terminal security layer
 */
export class KaliToolBridgeService extends Disposable implements IKaliToolBridge {
	readonly _serviceBrand: undefined;

	private _distribution: ILinuxDistribution | null = null;
	private _activeExecutions: number = 0;
	private _firstUseWarningShown: boolean = false;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
	}

	get distribution(): ILinuxDistribution | null {
		return this._distribution;
	}

	setDistribution(distribution: ILinuxDistribution | null): void {
		this._distribution = distribution;
		this.logService.info(`[KaliToolBridge] Distribution set to: ${distribution ? `${distribution.type} - ${distribution.name}` : 'null'}`);
	}

	// ─── Tool Implementations ──────────────────────────────────────────────────

	async nmapScan(target: string, options: string): Promise<INmapResult> {
		const targetError = this.validateTarget(target);
		if (targetError) {
			return { success: false, output: targetError, error: targetError };
		}

		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const command = `nmap ${options} -oX - ${target}`.replace(/\s+/g, ' ').trim();
		return this.executeTool<INmapResult>(command, (output) => ({
			success: true,
			output,
		}));
	}

	async nucleiScan(target: string, templates?: string): Promise<INucleiResult> {
		const targetError = this.validateTarget(target);
		if (targetError) {
			return { success: false, output: targetError, error: targetError };
		}

		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const templateArg = templates ? `-t ${templates}` : '';
		const command = `nuclei -u ${target} ${templateArg} -json`.replace(/\s+/g, ' ').trim();
		return this.executeTool<INucleiResult>(command, (output) => ({
			success: true,
			output,
		}));
	}

	async sqlmapTest(url: string, options?: string): Promise<ISqlmapResult> {
		const targetError = this.validateTarget(url);
		if (targetError) {
			return { success: false, output: targetError, error: targetError };
		}

		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const optArg = options ?? '';
		const command = `sqlmap -u "${url}" ${optArg} --batch`.replace(/\s+/g, ' ').trim();
		return this.executeTool<ISqlmapResult>(command, (output) => ({
			success: true,
			output,
		}));
	}

	async metasploitRun(module: string, options: Record<string, string>): Promise<IMsfResult> {
		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const optionsStr = Object.entries(options).map(([k, v]) => `set ${k} ${v}`).join('; ');
		const command = `msfconsole -q -x "use ${module}; ${optionsStr}; run; exit"`.replace(/\s+/g, ' ').trim();
		return this.executeTool<IMsfResult>(command, (output) => ({
			success: true,
			output,
			module,
		}));
	}

	async wiresharkCapture(iface: string, duration: number): Promise<ICaptureResult> {
		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const command = `tshark -i ${iface} -a duration:${duration} -w /tmp/kovix-capture.pcap`;
		return this.executeTool<ICaptureResult>(command, (output) => ({
			success: true,
			output,
			captureFilePath: '/tmp/kovix-capture.pcap',
		}));
	}

	async johnCrack(hashFile: string, wordlist?: string): Promise<ICrackResult> {
		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const wordlistArg = wordlist ? `--wordlist=${wordlist}` : '';
		const command = `john ${wordlistArg} ${hashFile}`.replace(/\s+/g, ' ').trim();
		return this.executeTool<ICrackResult>(command, (output) => ({
			success: true,
			output,
		}));
	}

	async hydraBrute(target: string, service: string, wordlist: string): Promise<IHydraResult> {
		const targetError = this.validateTarget(target);
		if (targetError) {
			return { success: false, output: targetError, error: targetError };
		}

		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const command = `hydra -L ${wordlist} -P ${wordlist} ${target} ${service}`;
		return this.executeTool<IHydraResult>(command, (output) => ({
			success: true,
			output,
		}));
	}

	async aircrackCapture(iface: string): Promise<IAircrackResult> {
		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		const command = `airmon-ng start ${iface} && airodump-ng ${iface}mon`;
		return this.executeTool<IAircrackResult>(command, (output) => ({
			success: true,
			output,
		}));
	}

	async ghidraDecompile(binaryPath: string): Promise<IGhidraResult> {
		const guardError = await this.preExecutionGuard();
		if (guardError) {
			return { success: false, output: guardError, error: guardError };
		}

		// Check if Docker is available first
		try {
			const dockerCheck = await this.terminalExecutor.execute('docker --version', undefined, 10000);
			if (dockerCheck.exitCode !== 0) {
				return { success: false, output: 'Docker not found — Ghidra decompilation requires Docker for isolation. Install Docker first.', error: 'Docker not available' };
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Docker check failed: ${msg}. Ghidra decompilation requires Docker.`, error: msg };
		}

		const command = `docker run --rm -v "${binaryPath}:${binaryPath}" ghidra/ghidra ${binaryPath}`;
		return this.executeTool<IGhidraResult>(command, (output) => ({
			success: true,
			output,
			analysisPath: binaryPath,
		}));
	}

	// ─── Safety Guards ─────────────────────────────────────────────────────────

	/**
	 * Validate that a target is not an internal IP address (unless explicitly allowed).
	 */
	private validateTarget(target: string): string | null {
		const allowInternal = this.configurationService.getValue<boolean>('construct.security.allowInternalScanning') ?? false;
		if (!allowInternal && isInternalTarget(target)) {
			const msg = `Target "${target}" appears to be an internal/loopback address. Security tools cannot scan internal IPs unless "construct.security.allowInternalScanning" is enabled.`;
			this.logService.warn(`[KaliToolBridge] ${msg}`);
			return msg;
		}
		return null;
	}

	/**
	 * Pre-execution safety guard. Checks:
	 * 1. Kali integration is enabled
	 * 2. Concurrent execution limit
	 * 3. First-use warning
	 */
	private async preExecutionGuard(): Promise<string | null> {
		const kaliEnabled = this.configurationService.getValue<boolean>('construct.security.kaliIntegration') ?? false;
		if (!kaliEnabled) {
			return 'Kali Linux integration is disabled. Enable "construct.security.kaliIntegration" in settings to use security tools.';
		}

		if (this._activeExecutions >= MAX_CONCURRENT_SECURITY_TOOLS) {
			return `Rate limit: Maximum ${MAX_CONCURRENT_SECURITY_TOOLS} concurrent security tool executions. Please wait for current operations to complete.`;
		}

		if (!this._firstUseWarningShown) {
			this._firstUseWarningShown = true;
			this.logService.warn(`[KaliToolBridge] ${SECURITY_FIRST_USE_WARNING}`);
		}

		return null;
	}

	/**
	 * Execute a routed command through the terminal, with rate limiting and audit logging.
	 */
	private async executeTool<T extends { success: boolean; output: string; error?: string }>(
		rawCommand: string,
		successParser: (output: string) => T
	): Promise<T> {
		this._activeExecutions++;
		const startTime = Date.now();

		try {
			const command = routeCommand(this._distribution, rawCommand);
			this.logService.info(`[KaliToolBridge] Executing: ${sanitiseForAuditLog(rawCommand)}`);

			const result = await this.terminalExecutor.execute(command, undefined, 300000);

			// Audit log
			await this.securityAuditLog(rawCommand, result.exitCode, Date.now() - startTime);

			if (result.exitCode !== 0 && !result.stdout) {
				return {
					success: false,
					output: `Command failed: ${result.stderr || 'exit code ' + result.exitCode}`,
					error: result.stderr || `exit code ${result.exitCode}`,
				} as T;
			}

			const output = result.stdout || result.stderr;
			return successParser(output);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			await this.securityAuditLog(rawCommand, -1, Date.now() - startTime);

			if (msg.includes('not found') || msg.includes('ENOENT')) {
				return {
					success: false,
					output: `Tool not found. Ensure it is installed in your Kali environment. Error: ${msg}`,
					error: msg,
				} as T;
			}

			return {
				success: false,
				output: `Execution error: ${msg}`,
				error: msg,
			} as T;
		} finally {
			this._activeExecutions--;
		}
	}

	/**
	 * Write a security audit log entry.
	 */
	private async securityAuditLog(command: string, exitCode: number, durationMs: number): Promise<void> {
		try {
			const pathModule = await import('path');
			const fs = await import('fs');
			const os = await import('os');

			const homeDir = os.homedir();
			const kovixDir = pathModule.join(homeDir, '.kovix');
			const auditPath = pathModule.join(kovixDir, 'security-audit.log');

			// Ensure ~/.kovix directory exists
			if (!fs.existsSync(kovixDir)) {
				fs.mkdirSync(kovixDir, { recursive: true });
			}

			const timestamp = new Date().toISOString();
			const safeCommand = sanitiseForAuditLog(command);
			const logLine = `${timestamp} | cmd:${safeCommand} | exit:${exitCode} | duration:${durationMs}ms\n`;

			fs.appendFileSync(auditPath, logLine, 'utf-8');
		} catch {
			// Audit logging is best-effort
		}
	}
}
