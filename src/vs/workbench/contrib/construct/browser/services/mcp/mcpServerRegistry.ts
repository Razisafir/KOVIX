/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Server Registry
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPServerConfig, MCPServerConfigSchema, MCP_CONFIG_KEY, MCP_CREDENTIAL_KEY_PREFIX } from '../../../../platform/construct/common/mcp/mcpTypes.js';

/**
 * Cline-compatible JSON format.
 * This mirrors the structure of .claude-mcp/settings.json:
 * {
 *   "mcpServers": {
 *     "server-name": {
 *       "command": "...",
 *       "args": [...],
 *       "env": { ... }
 *     }
 *   }
 * }
 */
export interface IClineMcpSettings {
        mcpServers: Record<string, {
                command?: string;
                args?: string[];
                env?: Record<string, string>;
                url?: string;
        }>;
}

export class MCPServerRegistry extends Disposable {
        private readonly _servers = new Map<string, IMCPServerConfig>();
        private readonly _onDidChangeServers = this._register(new Emitter<void>());
        readonly onDidChangeServers: Event<void> = this._onDidChangeServers.event;

        private _loaded: boolean = false;

        constructor(
                @IConfigurationService private readonly _configurationService: IConfigurationService,
                @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
                @ILogService private readonly _logService: ILogService,
        ) {
                super();
        }

        // ─── Loading ──────────────────────────────────────────────────────────

        async ensureLoaded(): Promise<void> {
                if (this._loaded) { return; }
                await this._loadFromConfiguration();
                this._loaded = true;
        }

        private async _loadFromConfiguration(): Promise<void> {
                const configData = this._configurationService.getValue<Record<string, IMCPServerConfig>>(MCP_CONFIG_KEY);
                if (!configData || typeof configData !== 'object') {
                        this._logService.trace('[MCP Registry] No server configurations found');
                        return;
                }

                for (const [name, rawConfig] of Object.entries(configData)) {
                        try {
                                // Zod validation on load
                                const validatedConfig = MCPServerConfigSchema.parse({
                                        ...(rawConfig as Record<string, unknown>),
                                        name,
                                });

                                // Merge in credentials from SecretStorage
                                if (validatedConfig.credentials?.length) {
                                        for (const cred of validatedConfig.credentials) {
                                                const secretValue = await this._secretStorageService.get(`${MCP_CREDENTIAL_KEY_PREFIX}${name}.${cred.key}`);
                                                if (secretValue && validatedConfig.env) {
                                                        validatedConfig.env[cred.key] = secretValue;
                                                }
                                        }
                                }

                                this._servers.set(name, validatedConfig);
                        } catch (validationError) {
                                this._logService.error(`[MCP Registry] Invalid config for server "${name}": ${validationError}`);
                        }
                }

                this._logService.info(`[MCP Registry] Loaded ${this._servers.size} server configurations`);
        }

        // ─── CRUD Operations ──────────────────────────────────────────────────

        getServer(name: string): IMCPServerConfig | undefined {
                return this._servers.get(name);
        }

        getAllServers(): IMCPServerConfig[] {
                return [...this._servers.values()];
        }

        hasServer(name: string): boolean {
                return this._servers.has(name);
        }

        async registerServer(config: IMCPServerConfig): Promise<void> {
                // Validate with Zod
                const validatedConfig = MCPServerConfigSchema.parse(config);

                // Store credentials in SecretStorage, never plaintext
                if (validatedConfig.credentials?.length) {
                        for (const cred of validatedConfig.credentials) {
                                const envValue = validatedConfig.env?.[cred.key];
                                if (envValue) {
                                        await this._secretStorageService.set(`${MCP_CREDENTIAL_KEY_PREFIX}${validatedConfig.name}.${cred.key}`, envValue);
                                        // Remove from the config that gets stored in settings
                                        delete validatedConfig.env![cred.key];
                                }
                        }
                }

                this._servers.set(validatedConfig.name, validatedConfig);
                await this._persistToConfiguration();
                this._onDidChangeServers.fire();

                this._logService.info(`[MCP Registry] Registered server "${validatedConfig.name}"`);
        }

        async unregisterServer(name: string): Promise<void> {
                if (!this._servers.has(name)) {
                        return;
                }

                // Clean up stored credentials
                const config = this._servers.get(name)!;
                if (config.credentials?.length) {
                        for (const cred of config.credentials) {
                                await this._secretStorageService.delete(`${MCP_CREDENTIAL_KEY_PREFIX}${name}.${cred.key}`);
                        }
                }

                this._servers.delete(name);
                await this._persistToConfiguration();
                this._onDidChangeServers.fire();

                this._logService.info(`[MCP Registry] Unregistered server "${name}"`);
        }

        async updateServer(name: string, updates: Partial<IMCPServerConfig>): Promise<void> {
                const existing = this._servers.get(name);
                if (!existing) {
                        throw new Error(`Server "${name}" is not registered`);
                }

                const merged = { ...existing, ...updates, name }; // name is immutable
                const validatedConfig = MCPServerConfigSchema.parse(merged);
                this._servers.set(name, validatedConfig);
                await this._persistToConfiguration();
                this._onDidChangeServers.fire();
        }

        // ─── Cline Compatibility ──────────────────────────────────────────────

        /**
         * Export the registry in Cline-compatible format (.claude-mcp/settings.json).
         */
        toClineFormat(): IClineMcpSettings {
                const mcpServers: IClineMcpSettings['mcpServers'] = {};

                for (const [name, config] of this._servers) {
                        mcpServers[name] = {};
                        if (config.command) { mcpServers[name].command = config.command; }
                        if (config.args) { mcpServers[name].args = config.args; }
                        if (config.env) { mcpServers[name].env = config.env; }
                        if (config.url) { mcpServers[name].url = config.url; }
                }

                return { mcpServers };
        }

        /**
         * Import from Cline-compatible format.
         */
        async fromClineFormat(settings: IClineMcpSettings): Promise<void> {
                for (const [name, serverConfig] of Object.entries(settings.mcpServers)) {
                        const config: IMCPServerConfig = {
                                name,
                                command: serverConfig.command,
                                args: serverConfig.args,
                                env: serverConfig.env,
                                url: serverConfig.url,
                                transport: serverConfig.url ? 'sse' : 'stdio',
                                enabled: true,
                                autoRestart: true,
                        };
                        await this.registerServer(config);
                }
        }

        // ─── Credential Management ────────────────────────────────────────────

        async getCredential(serverName: string, key: string): Promise<string | undefined> {
                return this._secretStorageService.get(`${MCP_CREDENTIAL_KEY_PREFIX}${serverName}.${key}`);
        }

        async setCredential(serverName: string, key: string, value: string): Promise<void> {
                await this._secretStorageService.set(`${MCP_CREDENTIAL_KEY_PREFIX}${serverName}.${key}`, value);
        }

        async deleteCredential(serverName: string, key: string): Promise<void> {
                await this._secretStorageService.delete(`${MCP_CREDENTIAL_KEY_PREFIX}${serverName}.${key}`);
        }

        // ─── Persistence ──────────────────────────────────────────────────────

        private async _persistToConfiguration(): Promise<void> {
                const configData: Record<string, unknown> = {};
                for (const [name, config] of this._servers) {
                        // Strip the name field since it's the key
                        const { name: _, ...rest } = config;
                        configData[name] = rest;
                }

                await this._configurationService.updateValue(MCP_CONFIG_KEY, configData);
                this._logService.trace(`[MCP Registry] Persisted ${this._servers.size} server configurations`);
        }

        // ─── Lifecycle ────────────────────────────────────────────────────────

        override dispose(): void {
                this._servers.clear();
                super.dispose();
        }
}
