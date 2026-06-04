/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMCPMarketplaceItem } from './mcpTypes.js';

export const IMCPMarketplace = createDecorator<IMCPMarketplace>('construct.mcpMarketplace');

export interface IMCPMarketplace extends IDisposable {
	readonly _serviceBrand: undefined;

	// --- Catalog Operations ---------------------------------------------

	/** Fetch the full marketplace catalog (1-hour cached). */
	fetchCatalog(): Promise<IMCPMarketplaceItem[]>;

	/** Search the catalog by keyword. */
	searchCatalog(query: string): Promise<IMCPMarketplaceItem[]>;

	/** Get the featured / recommended servers. */
	getFeaturedServers(): Promise<IMCPMarketplaceItem[]>;

	/** Get servers filtered by category. */
	getServersByCategory(category: string): Promise<IMCPMarketplaceItem[]>;

	/** Get all unique categories. */
	getAllCategories(): Promise<string[]>;

	// --- Installation ---------------------------------------------------

	/** One-click install from marketplace. */
	installFromMarketplace(itemId: string): Promise<void>;

	/** Uninstall a marketplace item. */
	uninstallMarketplaceItem(itemId: string): Promise<void>;

	/** Check if a marketplace item is installed. */
	isInstalled(itemId: string): boolean;

	// --- Rating & Metadata ----------------------------------------------

	/** Rate a server (1-5 stars), stored in IStorageService. */
	rateServer(itemId: string, rating: number): Promise<void>;

	/** Get the current rating for a server. */
	getServerRating(itemId: string): number;

	/** Get reviews for a server (placeholder for backend integration). */
	getServerReviews(itemId: string): Array<{ rating: number; comment: string; timestamp: number }>;

	// --- Events ---------------------------------------------------------

	readonly onDidUpdateCatalog: Event<IMCPMarketplaceItem[]>;
	readonly onDidInstallItem: Event<string>;
	readonly onDidUninstallItem: Event<string>;

	// --- Cache Management -----------------------------------------------

	/** Force-refresh the catalog from the remote registry. */
	refreshCatalog(): Promise<void>;

	/** Get the timestamp of the last successful catalog sync. */
	getLastSyncTime(): number;
}
