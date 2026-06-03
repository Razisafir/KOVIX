/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISkill, ISkillSearchQuery, SkillCategory } from './skillsTypes.js';

export const ISkillsMarketplace = createDecorator<ISkillsMarketplace>('construct.skillsMarketplace');

export interface ISkillsMarketplace extends IDisposable {
	readonly _serviceBrand: undefined;

	// Catalog
	fetchCatalog(): Promise<ISkill[]>;
	searchCatalog(query: ISkillSearchQuery): Promise<{ skills: ISkill[]; total: number }>;
	getFeaturedSkills(): Promise<ISkill[]>;
	getSkillsByCategory(category: SkillCategory): Promise<ISkill[]>;
	getAllCategories(): Promise<SkillCategory[]>;
	getSkillById(id: string): Promise<ISkill | undefined>;

	// Installation
	installSkill(skillId: string): Promise<void>;
	uninstallSkill(skillId: string): Promise<void>;
	isInstalled(skillId: string): boolean;
	getInstalledSkills(): ISkill[];

	// Ratings
	rateSkill(skillId: string, rating: number, comment?: string): Promise<void>;
	getSkillRating(skillId: string): number;
	getSkillReviews(skillId: string): Array<{ rating: number; comment: string; author: string; timestamp: number }>;

	// Management
	refreshCatalog(): Promise<void>;
	getLastSyncTime(): number;
	getCatalogVersion(): string;

	// Events
	readonly onDidUpdateCatalog: Event<ISkill[]>;
	readonly onDidInstallSkill: Event<string>;
	readonly onDidUninstallSkill: Event<string>;
}
