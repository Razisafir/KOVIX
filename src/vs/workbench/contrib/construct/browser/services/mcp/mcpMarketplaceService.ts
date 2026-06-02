/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Marketplace Service
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IMCPMarketplace } from '../../../../platform/construct/common/mcp/mcpMarketplace.js';
import {
        IMCPMarketplaceEntry, MCPServerCategory,
        MCP_REGISTRY_URL, MCP_MARKETPLACE_CACHE_KEY, MCP_RATINGS_KEY,
        MCP_MARKETPLACE_CACHE_TTL_MS
} from '../../../../platform/construct/common/mcp/mcpTypes.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';

interface IMarketplaceCache {
        entries: IMCPMarketplaceEntry[];
        fetchedAt: number;
}

// Featured server IDs
const FEATURED_SERVER_IDS = [
        'github', 'filesystem', 'playwright', 'postgresql', 'brave-search', 'figma',
];

export class MCPMarketplaceService extends Disposable implements IMCPMarketplace {
        declare readonly _serviceBrand: undefined;

        private _catalogCache: IMCPMarketplaceEntry[] | null = null;
        private _lastFetchTime: number = 0;

        private readonly _onDidRefreshCatalog = this._register(new Emitter<IMCPMarketplaceEntry[]>());
        readonly onDidRefreshCatalog: Event<IMCPMarketplaceEntry[]> = this._onDidRefreshCatalog.event;

        private readonly _onDidInstallFromMarketplace = this._register(new Emitter<IMCPMarketplaceEntry>());
        readonly onDidInstallFromMarketplace: Event<IMCPMarketplaceEntry> = this._onDidInstallFromMarketplace.event;

        constructor(
                @IMCPServerManager private readonly _serverManager: IMCPServerManager,
                @IStorageService private readonly _storageService: IStorageService,
                @ILogService private readonly _logService: ILogService,
        ) {
                super();
                this._loadCacheFromStorage();
        }

        // ─── Catalog Access ───────────────────────────────────────────────────

        async fetchCatalog(): Promise<IMCPMarketplaceEntry[]> {
                // Check in-memory cache first
                if (this._catalogCache && this._isCacheValid()) {
                        this._logService.trace('[MCP Marketplace] Returning cached catalog');
                        return this._catalogCache;
                }

                // Check storage cache
                const storageCache = this._loadCacheFromStorage();
                if (storageCache) {
                        this._catalogCache = storageCache;
                        return storageCache;
                }

                // Fetch from remote
                return this._fetchFromRemote();
        }

        async searchCatalog(query: string): Promise<IMCPMarketplaceEntry[]> {
                const catalog = await this.fetchCatalog();
                const lowerQuery = query.toLowerCase();

                return catalog.filter(entry =>
                        entry.name.toLowerCase().includes(lowerQuery) ||
                        entry.description.toLowerCase().includes(lowerQuery) ||
                        entry.author.toLowerCase().includes(lowerQuery) ||
                        entry.tags.some((tag: string) => tag.toLowerCase().includes(lowerQuery))
                );
        }

        async getFeaturedServers(): Promise<IMCPMarketplaceEntry[]> {
                const catalog = await this.fetchCatalog();
                return catalog.filter(entry => FEATURED_SERVER_IDS.includes(entry.id) || entry.featured);
        }

        async getServerByCategory(category: MCPServerCategory): Promise<IMCPMarketplaceEntry[]> {
                const catalog = await this.fetchCatalog();
                return catalog.filter(entry => entry.category === category);
        }

        // ─── Install Flow ─────────────────────────────────────────────────────

        async installFromMarketplace(entryId: string): Promise<void> {
                this._logService.info(`[MCP Marketplace] Installing server "${entryId}"`);

                const catalog = await this.fetchCatalog();
                const entry = catalog.find(e => e.id === entryId);
                if (!entry) {
                        throw new Error(`Server "${entryId}" not found in marketplace catalog`);
                }

                // Validate the install config
                if (!entry.installConfig) {
                        throw new Error(`Server "${entryId}" does not have a valid install configuration`);
                }

                // Register -> Start (one-click install)
                await this._serverManager.installServer(entry.installConfig);

                try {
                        await this._serverManager.startServer(entry.installConfig.name);
                } catch (error) {
                        this._logService.warn(`[MCP Marketplace] Server "${entryId}" installed but failed to start: ${error}`);
                }

                this._onDidInstallFromMarketplace.fire(entry);
                this._logService.info(`[MCP Marketplace] Server "${entryId}" installed successfully`);
        }

        // ─── Ratings ──────────────────────────────────────────────────────────

        async rateServer(entryId: string, rating: number): Promise<void> {
                if (rating < 1 || rating > 5) {
                        throw new Error('Rating must be between 1 and 5');
                }

                const ratings = this._getStoredRatings();
                ratings[entryId] = rating;
                this._storageService.store(
                        MCP_RATINGS_KEY,
                        JSON.stringify(ratings),
                        StorageScope.APPLICATION,
                        StorageTarget.USER,
                );
        }

        getUserRating(entryId: string): number | undefined {
                return this._getStoredRatings()[entryId];
        }

        // ─── Private: Remote Fetch ────────────────────────────────────────────

        private async _fetchFromRemote(): Promise<IMCPMarketplaceEntry[]> {
                this._logService.info(`[MCP Marketplace] Fetching catalog from ${MCP_REGISTRY_URL}`);

                try {
                        const response = await fetch(MCP_REGISTRY_URL);
                        if (!response.ok) {
                                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }

                        const data = await response.json() as any;
                        const entries = this._parseRegistryData(data);

                        // Update cache
                        this._catalogCache = entries;
                        this._lastFetchTime = Date.now();
                        this._saveCacheToStorage(entries);

                        this._onDidRefreshCatalog.fire(entries);
                        this._logService.info(`[MCP Marketplace] Fetched ${entries.length} server entries`);

                        return entries;
                } catch (error) {
                        this._logService.error(`[MCP Marketplace] Failed to fetch catalog: ${error}`);

                        // Return stale cache if available
                        if (this._catalogCache) {
                                this._logService.warn('[MCP Marketplace] Returning stale cache due to fetch failure');
                                return this._catalogCache;
                        }

                        // Return built-in entries as fallback
                        return this._getBuiltinEntries();
                }
        }

        private _parseRegistryData(data: any): IMCPMarketplaceEntry[] {
                if (!data || typeof data !== 'object') {
                        return this._getBuiltinEntries();
                }

                const entries: IMCPMarketplaceEntry[] = [];

                // Handle different registry formats
                const serverList = Array.isArray(data) ? data : (data.servers ?? data.mcpServers ?? []);

                for (const server of serverList) {
                        if (!server || typeof server !== 'object') { continue; }

                        try {
                                const entry: IMCPMarketplaceEntry = {
                                        id: server.id ?? server.name?.toLowerCase().replace(/\s+/g, '-') ?? `server-${entries.length}`,
                                        name: server.name ?? server.id ?? 'Unknown',
                                        description: server.description ?? '',
                                        author: server.author ?? server.owner ?? 'Unknown',
                                        repository: server.repository ?? server.url ?? server.html_url ?? '',
                                        category: this._inferCategory(server),
                                        icon: server.icon,
                                        featured: server.featured ?? FEATURED_SERVER_IDS.includes(server.id ?? server.name?.toLowerCase()),
                                        installConfig: {
                                                name: server.name?.toLowerCase().replace(/\s+/g, '-') ?? server.id,
                                                command: server.install?.command ?? server.command,
                                                args: server.install?.args ?? server.args,
                                                env: server.install?.env ?? server.env,
                                                url: server.install?.url ?? server.url,
                                                transport: (server.install?.url ?? server.url) ? 'sse' : 'stdio',
                                                enabled: true,
                                                autoRestart: true,
                                                description: server.description,
                                                icon: server.icon,
                                                category: this._inferCategory(server),
                                        },
                                        tags: server.tags ?? [server.category].filter(Boolean),
                                        downloads: server.downloads ?? server.stargazers_count ?? 0,
                                        rating: server.rating ?? 0,
                                        ratingCount: server.ratingCount ?? 0,
                                        verified: server.verified ?? false,
                                };
                                entries.push(entry);
                        } catch {
                                // Skip malformed entries
                        }
                }

                // If no entries parsed, use built-in
                return entries.length > 0 ? entries : this._getBuiltinEntries();
        }

        private _inferCategory(server: any): MCPServerCategory {
                const text = `${server.name ?? ''} ${server.description ?? ''} ${(server.tags ?? []).join(' ')}`.toLowerCase();

                if (text.includes('file') || text.includes('filesystem') || text.includes('fs')) { return MCPServerCategory.FileSystem; }
                if (text.includes('browser') || text.includes('playwright') || text.includes('puppeteer') || text.includes('selenium')) { return MCPServerCategory.Browser; }
                if (text.includes('database') || text.includes('postgres') || text.includes('mysql') || text.includes('sqlite') || text.includes('mongo')) { return MCPServerCategory.Database; }
                if (text.includes('search') || text.includes('brave') || text.includes('google')) { return MCPServerCategory.Search; }
                if (text.includes('slack') || text.includes('discord') || text.includes('email') || text.includes('chat')) { return MCPServerCategory.Communication; }
                if (text.includes('github') || text.includes('git') || text.includes('docker') || text.includes('kubernetes')) { return MCPServerCategory.DevTools; }
                if (text.includes('figma') || text.includes('design') || text.includes('sketch')) { return MCPServerCategory.Design; }
                if (text.includes('data') || text.includes('csv') || text.includes('json') || text.includes('api')) { return MCPServerCategory.Data; }

                return MCPServerCategory.DevTools;
        }

        // ─── Private: Built-in Entries ────────────────────────────────────────

        private _getBuiltinEntries(): IMCPMarketplaceEntry[] {
                return [
                        {
                                id: 'filesystem',
                                name: 'Filesystem',
                                description: 'Secure file system operations with configurable access controls. Read, write, search, and manage files and directories on the local system with permission-based access.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
                                category: MCPServerCategory.FileSystem,
                                featured: true,
                                installConfig: {
                                        name: 'filesystem',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'Secure file system operations',
                                        category: MCPServerCategory.FileSystem,
                                },
                                tags: ['files', 'filesystem', 'read', 'write'],
                                downloads: 50000,
                                rating: 4.8,
                                ratingCount: 120,
                                verified: true,
                        },
                        {
                                id: 'github',
                                name: 'GitHub',
                                description: 'Comprehensive GitHub integration for repository management, issue tracking, pull requests, code search, and workflow automation. Requires a GitHub personal access token.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
                                category: MCPServerCategory.DevTools,
                                featured: true,
                                installConfig: {
                                        name: 'github',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-github'],
                                        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'GitHub API integration',
                                        category: MCPServerCategory.DevTools,
                                        credentials: [
                                                { key: 'GITHUB_PERSONAL_ACCESS_TOKEN', required: true, description: 'GitHub Personal Access Token' },
                                        ],
                                },
                                tags: ['github', 'git', 'issues', 'pr', 'repository'],
                                downloads: 45000,
                                rating: 4.7,
                                ratingCount: 95,
                                verified: true,
                        },
                        {
                                id: 'playwright',
                                name: 'Playwright',
                                description: 'Browser automation using Playwright. Navigate pages, take screenshots, execute JavaScript, fill forms, and extract data from web pages with full browser control.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/playwright',
                                category: MCPServerCategory.Browser,
                                featured: true,
                                installConfig: {
                                        name: 'playwright',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-playwright'],
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'Browser automation with Playwright',
                                        category: MCPServerCategory.Browser,
                                },
                                tags: ['browser', 'automation', 'testing', 'playwright'],
                                downloads: 38000,
                                rating: 4.6,
                                ratingCount: 72,
                                verified: true,
                        },
                        {
                                id: 'postgresql',
                                name: 'PostgreSQL',
                                description: 'Direct PostgreSQL database access for querying, schema inspection, and data manipulation. Supports read-only and read-write modes with configurable access controls.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
                                category: MCPServerCategory.Database,
                                featured: true,
                                installConfig: {
                                        name: 'postgresql',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/mydb'],
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'PostgreSQL database access',
                                        category: MCPServerCategory.Database,
                                },
                                tags: ['database', 'postgresql', 'sql', 'postgres'],
                                downloads: 28000,
                                rating: 4.5,
                                ratingCount: 58,
                                verified: true,
                        },
                        {
                                id: 'brave-search',
                                name: 'Brave Search',
                                description: 'Web search using the Brave Search API. Perform general and local searches with configurable result counts and offset. Requires a Brave Search API key.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
                                category: MCPServerCategory.Search,
                                featured: true,
                                installConfig: {
                                        name: 'brave-search',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-brave-search'],
                                        env: { BRAVE_API_KEY: '' },
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'Web search via Brave Search API',
                                        category: MCPServerCategory.Search,
                                        credentials: [
                                                { key: 'BRAVE_API_KEY', required: true, description: 'Brave Search API Key' },
                                        ],
                                },
                                tags: ['search', 'web', 'brave', 'api'],
                                downloads: 32000,
                                rating: 4.4,
                                ratingCount: 45,
                                verified: true,
                        },
                        {
                                id: 'figma',
                                name: 'Figma',
                                description: 'Access Figma design files, components, and styles. Read design tokens, extract component properties, and integrate design system data directly into your development workflow.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/figma',
                                category: MCPServerCategory.Design,
                                featured: true,
                                installConfig: {
                                        name: 'figma',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-figma'],
                                        env: { FIGMA_ACCESS_TOKEN: '' },
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'Figma design file access',
                                        category: MCPServerCategory.Design,
                                        credentials: [
                                                { key: 'FIGMA_ACCESS_TOKEN', required: true, description: 'Figma Personal Access Token' },
                                        ],
                                },
                                tags: ['design', 'figma', 'ui', 'components'],
                                downloads: 22000,
                                rating: 4.3,
                                ratingCount: 33,
                                verified: true,
                        },
                        {
                                id: 'slack',
                                name: 'Slack',
                                description: 'Interact with Slack workspaces: send messages, read channels, manage threads, and search message history. Requires a Slack Bot OAuth Token.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
                                category: MCPServerCategory.Communication,
                                featured: false,
                                installConfig: {
                                        name: 'slack',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-slack'],
                                        env: { SLACK_BOT_OAUTH_TOKEN: '' },
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'Slack workspace integration',
                                        category: MCPServerCategory.Communication,
                                        credentials: [
                                                { key: 'SLACK_BOT_OAUTH_TOKEN', required: true, description: 'Slack Bot OAuth Token' },
                                        ],
                                },
                                tags: ['slack', 'communication', 'messaging'],
                                downloads: 18000,
                                rating: 4.2,
                                ratingCount: 28,
                                verified: true,
                        },
                        {
                                id: 'sqlite',
                                name: 'SQLite',
                                description: 'SQLite database access for querying and modifying local database files. Supports schema inspection, query execution, and data exploration.',
                                author: 'Model Context Protocol',
                                repository: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
                                category: MCPServerCategory.Database,
                                featured: false,
                                installConfig: {
                                        name: 'sqlite',
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/path/to/database.db'],
                                        transport: 'stdio',
                                        enabled: true,
                                        autoRestart: true,
                                        description: 'SQLite database access',
                                        category: MCPServerCategory.Database,
                                },
                                tags: ['database', 'sqlite', 'sql', 'local'],
                                downloads: 15000,
                                rating: 4.1,
                                ratingCount: 22,
                                verified: true,
                        },
                ];
        }

        // ─── Private: Cache Management ────────────────────────────────────────

        private _isCacheValid(): boolean {
                return this._catalogCache !== null &&
                        (Date.now() - this._lastFetchTime) < MCP_MARKETPLACE_CACHE_TTL_MS;
        }

        private _loadCacheFromStorage(): IMCPMarketplaceEntry[] | null {
                try {
                        const stored = this._storageService.get(MCP_MARKETPLACE_CACHE_KEY, StorageScope.APPLICATION);
                        if (!stored) { return null; }

                        const cache: IMarketplaceCache = JSON.parse(stored);
                        if (!cache.entries || !Array.isArray(cache.entries)) { return null; }

                        // Check if storage cache is still valid
                        if ((Date.now() - cache.fetchedAt) < MCP_MARKETPLACE_CACHE_TTL_MS) {
                                this._catalogCache = cache.entries;
                                this._lastFetchTime = cache.fetchedAt;
                                return cache.entries;
                        }

                        return null;
                } catch {
                        return null;
                }
        }

        private _saveCacheToStorage(entries: IMCPMarketplaceEntry[]): void {
                const cache: IMarketplaceCache = {
                        entries,
                        fetchedAt: Date.now(),
                };
                this._storageService.store(
                        MCP_MARKETPLACE_CACHE_KEY,
                        JSON.stringify(cache),
                        StorageScope.APPLICATION,
                        StorageTarget.USER,
                );
        }

        private _getStoredRatings(): Record<string, number> {
                try {
                        const stored = this._storageService.get(MCP_RATINGS_KEY, StorageScope.APPLICATION);
                        return stored ? JSON.parse(stored) : {};
                } catch {
                        return {};
                }
        }

        // ─── Lifecycle ────────────────────────────────────────────────────────

        override dispose(): void {
                this._catalogCache = null;
                super.dispose();
        }
}
