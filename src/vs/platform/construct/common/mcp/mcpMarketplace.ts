/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Marketplace Interface
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMCPMarketplaceEntry, MCPServerCategory } from './mcpTypes.js';

export const IMCPMarketplace = createDecorator<IMCPMarketplace>('mcpMarketplace');

export interface IMCPMarketplace {
	readonly _serviceBrand: undefined;

	// ─── Catalog Access ───────────────────────────────────────────────────

	/**
	 * Fetch the full marketplace catalog from the remote registry.
	 * Uses a 1-hour local cache to avoid hammering GitHub.
	 */
	fetchCatalog(): Promise<IMCPMarketplaceEntry[]>;

	/**
	 * Search the catalog by keyword. Searches name, description,
	 * author, and tags.
	 */
	searchCatalog(query: string): Promise<IMCPMarketplaceEntry[]>;

	/**
	 * Get the featured / recommended servers.
	 * These are hand-picked high-quality servers: github, filesystem,
	 * playwright, postgresql, brave-search, figma.
	 */
	getFeaturedServers(): Promise<IMCPMarketplaceEntry[]>;

	/**
	 * Get servers filtered by category.
	 */
	getServerByCategory(category: MCPServerCategory): Promise<IMCPMarketplaceEntry[]>;

	// ─── Install Flow ─────────────────────────────────────────────────────

	/**
	 * One-click install from the marketplace.
	 * Flow: validate config -> register -> start server.
	 */
	installFromMarketplace(entryId: string): Promise<void>;

	// ─── Ratings ──────────────────────────────────────────────────────────

	/**
	 * Rate a server (1-5 stars). Stored locally in IStorageService.
	 */
	rateServer(entryId: string, rating: number): Promise<void>;

	/**
	 * Get the current user rating for a server.
	 */
	getUserRating(entryId: string): number | undefined;

	// ─── Events ───────────────────────────────────────────────────────────

	/**
	 * Fired when the catalog is refreshed.
	 */
	onDidRefreshCatalog: Event<IMCPMarketplaceEntry[]>;

	/**
	 * Fired when a server is installed from the marketplace.
	 */
	onDidInstallFromMarketplace: Event<IMCPMarketplaceEntry>;
}
