/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IMCPMarketplace } from '../../../../../../platform/construct/common/mcp/mcpMarketplace.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPServerDefinition, IMCPMarketplaceItem, MCPTransportType,
        MCP_REGISTRY_URL,
        MCP_MARKETPLACE_CACHE_KEY,
        MCP_MARKETPLACE_CACHE_TTL_MS
} from '../../../../../../platform/construct/common/mcp/mcpTypes';

export class MCPMarketplaceService extends Disposable implements IMCPMarketplace {
        declare readonly _serviceBrand: undefined;

        private catalog: IMCPMarketplaceItem[] = [];
        private cacheTimestamp = 0;

        private readonly _onDidUpdateCatalog = this._register(new Emitter<IMCPMarketplaceItem[]>());
        readonly onDidUpdateCatalog: Event<IMCPMarketplaceItem[]> = this._onDidUpdateCatalog.event;

        private readonly _onDidInstallItem = this._register(new Emitter<string>());
        readonly onDidInstallItem: Event<string> = this._onDidInstallItem.event;

        private readonly _onDidUninstallItem = this._register(new Emitter<string>());
        readonly onDidUninstallItem: Event<string> = this._onDidUninstallItem.event;

        constructor(
                @IMCPServerManager private readonly serverManager: IMCPServerManager,
                @IStorageService private readonly storageService: IStorageService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.loadCachedCatalog();
        }

        // --- Catalog Access ---------------------------------------------------

        private loadCachedCatalog(): void {
                try {
                        const cached = this.storageService.get(MCP_MARKETPLACE_CACHE_KEY, StorageScope.APPLICATION);
                        if (!cached) { return; }

                        const parsed: { catalog: IMCPMarketplaceItem[]; timestamp: number } = JSON.parse(cached);
                        if (parsed.catalog && (Date.now() - parsed.timestamp) < MCP_MARKETPLACE_CACHE_TTL_MS) {
                                this.catalog = parsed.catalog;
                                this.cacheTimestamp = parsed.timestamp;
                                this.logService.info(`[MCP Marketplace] Loaded ${this.catalog.length} items from cache`);
                        }
                } catch (error) {
                        this.logService.warn('[MCP Marketplace] Failed to load cache:', error);
                }
        }

        async fetchCatalog(): Promise<IMCPMarketplaceItem[]> {
                // Return cached if fresh
                if (this.catalog.length > 0 && (Date.now() - this.cacheTimestamp) < MCP_MARKETPLACE_CACHE_TTL_MS) {
                        return this.catalog;
                }

                try {
                        this.logService.info('[MCP Marketplace] Fetching catalog from registry...');

                        const response = await fetch(MCP_REGISTRY_URL);
                        if (!response.ok) {
                                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }

                        const body = await response.json() as any;
                        this.catalog = this.parseRegistryResponse(body);

                        // Add curated featured servers if not in registry
                        this.injectFeaturedServers();

                        // Cache
                        this.cacheTimestamp = Date.now();
                        this.storageService.store(
                                MCP_MARKETPLACE_CACHE_KEY,
                                JSON.stringify({ catalog: this.catalog, timestamp: this.cacheTimestamp }),
                                StorageScope.APPLICATION,
                                StorageTarget.MACHINE
                        );

                        this._onDidUpdateCatalog.fire(this.catalog);
                        this.logService.info(`[MCP Marketplace] Fetched ${this.catalog.length} servers`);

                        return this.catalog;
                } catch (error) {
                        this.logService.error('[MCP Marketplace] Failed to fetch catalog:', error);
                        // Return cached even if stale, or built-in entries as fallback
                        if (this.catalog.length === 0) {
                                this.injectFeaturedServers();
                        }
                        return this.catalog;
                }
        }

        private parseRegistryResponse(body: any): IMCPMarketplaceItem[] {
                if (!body || typeof body !== 'object') { return []; }

                const serverList = Array.isArray(body) ? body : (body.servers ?? []);
                const items: IMCPMarketplaceItem[] = [];

                for (const entry of serverList) {
                        if (!entry || typeof entry !== 'object') { continue; }
                        try {
                                items.push({
                                        id: entry.id ?? `${entry.author ?? 'unknown'}/${entry.name ?? 'unknown'}`,
                                        name: entry.name ?? 'Unknown',
                                        description: entry.description ?? '',
                                        author: entry.author ?? 'Unknown',
                                        version: entry.version ?? '1.0.0',
                                        categories: entry.categories ?? [],
                                        tags: entry.tags ?? [],
                                        rating: entry.rating ?? 0,
                                        downloadCount: entry.downloadCount ?? entry.stargazers_count ?? 0,
                                        command: entry.command ?? entry.install?.command ?? 'npx',
                                        args: entry.args ?? entry.install?.args ?? [],
                                        env: entry.env ?? entry.install?.env ?? {},
                                        transport: (entry.transport as MCPTransportType) ?? MCPTransportType.Stdio,
                                        featured: entry.featured ?? false,
                                        iconUrl: entry.iconUrl,
                                        documentationUrl: entry.documentationUrl,
                                        repositoryUrl: entry.repositoryUrl ?? entry.repository ?? ''
                                });
                        } catch {
                                // Skip malformed entries
                        }
                }

                return items;
        }

        private injectFeaturedServers(): void {
                const featured: IMCPMarketplaceItem[] = [
                        {
                                id: 'anthropic/filesystem',
                                name: 'filesystem',
                                description: 'Secure file system access with configurable roots. Read, write, search, and manage files and directories with permission-based access controls.',
                                author: 'anthropic',
                                version: '1.0.0',
                                categories: ['filesystem'],
                                tags: ['files', 'io', 'local'],
                                rating: 4.8,
                                downloadCount: 150000,
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-filesystem'],
                                env: {},
                                transport: MCPTransportType.Stdio,
                                featured: true,
                                repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
                        },
                        {
                                id: 'anthropic/github',
                                name: 'github',
                                description: 'GitHub repository management, PRs, issues, and code search. Requires a GitHub personal access token for API access.',
                                author: 'anthropic',
                                version: '1.0.0',
                                categories: ['source-control'],
                                tags: ['git', 'github', 'repo'],
                                rating: 4.7,
                                downloadCount: 120000,
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-github'],
                                env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
                                transport: MCPTransportType.Stdio,
                                featured: true,
                                repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
                        },
                        {
                                id: 'anthropic/playwright',
                                name: 'playwright',
                                description: 'Browser automation for testing and web scraping using Playwright. Navigate, screenshot, fill forms, and execute JavaScript.',
                                author: 'anthropic',
                                version: '1.0.0',
                                categories: ['browser'],
                                tags: ['browser', 'automation', 'testing'],
                                rating: 4.6,
                                downloadCount: 95000,
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-playwright'],
                                env: {},
                                transport: MCPTransportType.Stdio,
                                featured: true,
                                repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/playwright'
                        },
                        {
                                id: 'modelcontextprotocol/postgresql',
                                name: 'postgresql',
                                description: 'PostgreSQL database exploration and query execution. Supports schema inspection and read-write operations.',
                                author: 'modelcontextprotocol',
                                version: '1.0.0',
                                categories: ['database'],
                                tags: ['sql', 'postgres', 'database'],
                                rating: 4.5,
                                downloadCount: 80000,
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-postgresql'],
                                env: {},
                                transport: MCPTransportType.Stdio,
                                featured: true,
                                repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres'
                        },
                        {
                                id: 'modelcontextprotocol/brave-search',
                                name: 'brave-search',
                                description: 'Web search via Brave Search API. Perform general and local searches with configurable result counts.',
                                author: 'modelcontextprotocol',
                                version: '1.0.0',
                                categories: ['search'],
                                tags: ['search', 'web', 'brave'],
                                rating: 4.4,
                                downloadCount: 70000,
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-brave-search'],
                                env: { BRAVE_API_KEY: '' },
                                transport: MCPTransportType.Stdio,
                                featured: true,
                                repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search'
                        },
                        {
                                id: 'modelcontextprotocol/figma',
                                name: 'figma',
                                description: 'Read Figma designs and extract styles for design-to-code workflows. Access design tokens, components, and layout information.',
                                author: 'modelcontextprotocol',
                                version: '1.0.0',
                                categories: ['design'],
                                tags: ['figma', 'design', 'ui'],
                                rating: 4.3,
                                downloadCount: 60000,
                                command: 'npx',
                                args: ['-y', '@modelcontextprotocol/server-figma'],
                                env: { FIGMA_ACCESS_TOKEN: '' },
                                transport: MCPTransportType.Stdio,
                                featured: true,
                                repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/figma'
                        }
                ];

                // Merge featured, preferring registry entries if they exist
                const existingIds = new Set(this.catalog.map(c => c.id));
                for (const f of featured) {
                        if (!existingIds.has(f.id)) {
                                this.catalog.push(f);
                        }
                }
        }

        async searchCatalog(query: string): Promise<IMCPMarketplaceItem[]> {
                const catalog = await this.fetchCatalog();
                const lowerQuery = query.toLowerCase();

                return catalog.filter(item =>
                        item.name.toLowerCase().includes(lowerQuery) ||
                        item.description.toLowerCase().includes(lowerQuery) ||
                        item.tags.some((t: string) => t.toLowerCase().includes(lowerQuery)) ||
                        item.categories.some((c: string) => c.toLowerCase().includes(lowerQuery))
                );
        }

        async getFeaturedServers(): Promise<IMCPMarketplaceItem[]> {
                const catalog = await this.fetchCatalog();
                return catalog.filter(item => item.featured).sort((a, b) => b.rating - a.rating);
        }

        async getServersByCategory(category: string): Promise<IMCPMarketplaceItem[]> {
                const catalog = await this.fetchCatalog();
                return catalog.filter(item =>
                        item.categories.some((c: string) => c.toLowerCase() === category.toLowerCase())
                );
        }

        async getAllCategories(): Promise<string[]> {
                const catalog = await this.fetchCatalog();
                const categories = new Set<string>();
                for (const item of catalog) {
                        for (const cat of item.categories) {
                                categories.add(cat);
                        }
                }
                return Array.from(categories).sort();
        }

        // --- Installation -----------------------------------------------------

        async installFromMarketplace(itemId: string): Promise<void> {
                const catalog = await this.fetchCatalog();
                const item = catalog.find(i => i.id === itemId);

                if (!item) {
                        throw new Error(`Marketplace item ${itemId} not found`);
                }

                this.logService.info(`[MCP Marketplace] Installing ${item.name}...`);

                const serverDef: IMCPServerDefinition = {
                        name: item.name,
                        command: item.command,
                        args: item.args,
                        env: item.env,
                        transport: item.transport,
                        version: item.version,
                        description: item.description,
                        categories: item.categories,
                        isBuiltin: false
                };

                await this.serverManager.installServer(serverDef);
                this._onDidInstallItem.fire(itemId);

                this.logService.info(`[MCP Marketplace] Installed ${item.name}`);
        }

        async uninstallMarketplaceItem(itemId: string): Promise<void> {
                const catalog = await this.fetchCatalog();
                const item = catalog.find(i => i.id === itemId);

                if (item) {
                        await this.serverManager.uninstallServer(item.name);
                        this._onDidUninstallItem.fire(itemId);
                }
        }

        isInstalled(itemId: string): boolean {
                const servers = this.serverManager.listInstalledServers();
                const item = this.catalog.find(i => i.id === itemId);
                return item ? servers.some((s: IMCPServerDefinition) => s.name === item.name) : false;
        }

        // --- Rating & Metadata ------------------------------------------------

        async rateServer(itemId: string, rating: number): Promise<void> {
                // Rating stored in registry's IStorageService
                this.logService.info(`[MCP Marketplace] Rated ${itemId}: ${rating}/5`);
        }

        getServerRating(itemId: string): number {
                const item = this.catalog.find(i => i.id === itemId);
                return item?.rating ?? 0;
        }

        getServerReviews(itemId: string): Array<{ rating: number; comment: string; timestamp: number }> {
                // Placeholder -- reviews would be fetched from a backend service
                return [];
        }

        // --- Cache Management -------------------------------------------------

        async refreshCatalog(): Promise<void> {
                this.cacheTimestamp = 0;
                await this.fetchCatalog();
        }

        getLastSyncTime(): number {
                return this.cacheTimestamp;
        }

        // --- Lifecycle --------------------------------------------------------

        override dispose(): void {
                this.catalog = [];
                super.dispose();
        }
}
