/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConstructConfigService, IConstructConfigEntry, ConstructConfigScope } from '../common/config/constructConfigService.js';
import { ILogService } from '../../log/common/log.js';
import { IFileService } from '../../files/common/files.js';
import { URI } from '../../../base/common/uri.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { joinPath } from '../../../base/common/resources.js';
import { VSBuffer } from '../../../base/common/buffer.js';

const CONFIG_DIR_NAME = '.construct';
const CONFIG_FILE_NAME = 'settings.json';

/**
 * Default CONSTRUCT configuration values.
 */
const DEFAULTS: Record<string, unknown> = {
	'construct.cloud.baseUrl': 'https://api.openai.com/v1',
	'construct.cloud.model': 'gpt-4o-mini',
	'construct.anthropic.model': 'claude-sonnet-4-20250514',
	'construct.ollama.baseUrl': 'http://localhost:11434',
	'construct.ollama.model': 'codellama',
	'construct.agent.maxRounds': 15,
	'construct.agent.autoAccept': false,
	'construct.memory.autoLearn': true,
	'construct.telemetry.enabled': false,
	'construct.debug': false,
};

/**
 * Node-layer implementation of IConstructConfigService.
 * Reads/writes .construct/settings.json as the single source of truth.
 * In the main process, workspace info is set via setWorkspace() when available.
 */
export class ConstructConfigService extends Disposable implements IConstructConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<string>());
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	private _config: Map<string, unknown> = new Map();
	private _configUri: URI | null = null;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this.logService.info('[ConstructConfig] Service created');
	}

	/**
	 * Set the workspace root URI. Called when workspace info becomes available.
	 */
	setWorkspace(workspaceRoot: URI): void {
		this._configUri = joinPath(workspaceRoot, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
		this.loadConfig().catch(err => {
			this.logService.warn('[ConstructConfig] Failed to load config:', err instanceof Error ? err.message : String(err));
		});
	}

	private async loadConfig(): Promise<void> {
		if (!this._configUri) { return; }

		try {
			const content = await this.fileService.readFile(this._configUri);
			const parsed = JSON.parse(content.value.toString());
			for (const [key, value] of Object.entries(parsed)) {
				this._config.set(key, value);
			}
			this.logService.info(`[ConstructConfig] Loaded ${this._config.size} settings from ${this._configUri.fsPath}`);
		} catch {
			this.logService.info('[ConstructConfig] No existing config file, using defaults');
		}
	}

	private async saveConfig(): Promise<void> {
		if (!this._configUri) { return; }

		const obj: Record<string, unknown> = {};
		for (const [key, value] of this._config) {
			obj[key] = value;
		}

		// Ensure .construct directory exists
		const configDir = joinPath(this._configUri, '..');
		try {
			const dirExists = await this.fileService.exists(configDir);
			if (!dirExists) {
				await this.fileService.createFolder(configDir);
			}
		} catch { /* concurrent creation is fine */ }

		await this.fileService.writeFile(this._configUri, VSBuffer.fromString(JSON.stringify(obj, null, 2)));
	}

	getValue<T>(key: string, scope?: ConstructConfigScope): T {
		if (this._config.has(key)) {
			return this._config.get(key) as T;
		}
		return DEFAULTS[key] as T;
	}

	async setValue<T>(key: string, value: T, scope: ConstructConfigScope): Promise<void> {
		this._config.set(key, value);
		await this.saveConfig();
		this._onDidChangeConfiguration.fire(key);
		this.logService.info(`[ConstructConfig] Set ${key} = ${typeof value === 'string' ? '***' : String(value)}`);
	}

	async removeValue(key: string): Promise<void> {
		this._config.delete(key);
		await this.saveConfig();
		this._onDidChangeConfiguration.fire(key);
	}

	getAllEntries(prefix?: string): IConstructConfigEntry[] {
		const entries: IConstructConfigEntry[] = [];
		const allKeys = new Set([...Object.keys(DEFAULTS), ...this._config.keys()]);

		for (const key of allKeys) {
			if (prefix && !key.startsWith(prefix)) { continue; }
			const defaultValue = DEFAULTS[key];
			const currentValue = this._config.has(key) ? this._config.get(key) : defaultValue;
			entries.push({
				key,
				value: currentValue,
				scope: 'workspace',
				isModified: this._config.has(key) && this._config.get(key) !== defaultValue,
				defaultValue,
				description: '',
			});
		}

		return entries;
	}

	hasValue(key: string): boolean {
		return this._config.has(key) || key in DEFAULTS;
	}

	async resetAll(): Promise<void> {
		this._config.clear();
		await this.saveConfig();
		this._onDidChangeConfiguration.fire('*');
	}

	getConstructDir(): URI {
		if (this._configUri) {
			return joinPath(this._configUri, '..');
		}
		return URI.file('.construct');
	}

	exportSettings(): Record<string, unknown> {
		const obj: Record<string, unknown> = {};
		for (const [key, value] of this._config) {
			obj[key] = value;
		}
		return obj;
	}

	async importSettings(settings: Record<string, unknown>): Promise<void> {
		for (const [key, value] of Object.entries(settings)) {
			this._config.set(key, value);
		}
		await this.saveConfig();
		this._onDidChangeConfiguration.fire('*');
	}

	override dispose(): void {
		this._config.clear();
		super.dispose();
	}
}
