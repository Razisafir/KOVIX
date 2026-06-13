// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IDistributionDetector, ILinuxDistribution, KALI_SECURITY_TOOLS, detectNativeKali, detectWSLKali, detectDockerKali } from '../../../../../../platform/construct/common/terminal/distributionDetector.js';
import { ITerminalExecutor } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';

/**
 * Browser-side implementation of IDistributionDetector.
 * Uses ITerminalExecutor (which routes via IPC to the node process)
 * for all detection commands, ensuring we never use child_process directly.
 */
export class DistributionDetectorService extends Disposable implements IDistributionDetector {
	readonly _serviceBrand: undefined;

	private _cachedDistribution: ILinuxDistribution | null = null;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ITerminalExecutor private readonly terminalExecutor: ITerminalExecutor,
	) {
		super();
	}

	get cachedDistribution(): ILinuxDistribution | null {
		return this._cachedDistribution;
	}

	async detectDistribution(): Promise<ILinuxDistribution | null> {
		if (this._cachedDistribution) {
			return this._cachedDistribution;
		}

		const result = await this.redetect();
		return result;
	}

	async redetect(): Promise<ILinuxDistribution | null> {
		this.logService.info('[DistributionDetector] Starting Kali Linux detection...');

		const execCmd = async (cmd: string) => {
			try {
				return await this.terminalExecutor.execute(cmd, undefined, 10000);
			} catch {
				return { stdout: '', stderr: 'Detection command failed', exitCode: 1 };
			}
		};

		// Try detection in order: native → WSL → Docker
		let result: ILinuxDistribution | null = null;

		// 1. Native Linux detection
		result = await detectNativeKali(execCmd);
		if (result) {
			this.logService.info('[DistributionDetector] Found Kali Linux (native)');
			this._cachedDistribution = result;
			return result;
		}

		// 2. WSL detection
		result = await detectWSLKali(execCmd);
		if (result) {
			this.logService.info('[DistributionDetector] Found Kali Linux (WSL)');
			this._cachedDistribution = result;
			return result;
		}

		// 3. Docker detection
		result = await detectDockerKali(execCmd);
		if (result) {
			this.logService.info('[DistributionDetector] Found Kali Linux (Docker)');
			this._cachedDistribution = result;
			return result;
		}

		this.logService.info('[DistributionDetector] No Kali Linux installation detected');
		this._cachedDistribution = null;
		return null;
	}

	async detectTools(distribution: ILinuxDistribution): Promise<string[]> {
		const found: string[] = [];

		for (const tool of KALI_SECURITY_TOOLS) {
			try {
				const checkCmd = distribution.type === 'wsl'
					? `wsl -d kali-linux -- which ${tool}`
					: distribution.type === 'docker'
						? `docker run --rm kalilinux/kali-rolling which ${tool}`
						: `which ${tool}`;

				const result = await this.terminalExecutor.execute(checkCmd, undefined, 5000);
				if (result.exitCode === 0 && result.stdout.trim().length > 0) {
					found.push(tool);
				}
			} catch {
				// Tool not found — skip
			}
		}

		this.logService.info(`[DistributionDetector] Detected ${found.length}/${KALI_SECURITY_TOOLS.length} Kali tools: ${found.join(', ')}`);
		return found;
	}
}
