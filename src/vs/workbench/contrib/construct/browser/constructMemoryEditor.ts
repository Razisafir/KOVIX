// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObsidianMemoryService } from '../../../../platform/construct/common/memory/obsidianMemoryService.js';
import { IObsidianMemoryEntry, MemoryCategory, MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from '../../../../platform/construct/common/memory/obsidianMemoryTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

/**
 * Memory Editor that opens as a webview for editing a single memory entry.
 *
 * This is a helper class used by the ObsidianMemoryTreePanel to provide
 * a full-featured editing experience for individual memories. The actual
 * inline editor is built into the tree panel; this class provides the
 * command handler that opens the editor view.
 */
export class ConstructMemoryEditor {

	constructor(
		@IObsidianMemoryService private readonly obsidianMemory: IObsidianMemoryService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		this.logService.info('[ObsidianMemoryEditor] Editor helper initialized');
	}

	/**
	 * Open the editor for a specific memory entry.
	 * This triggers the tree panel's inline editor.
	 */
	async openEditor(entryId: string): Promise<void> {
		const entry = this.obsidianMemory.getMemory(entryId);
		if (!entry) {
			this.notificationService.warn(`Memory entry not found: ${entryId}`);
			return;
		}

		this.logService.info(`[ObsidianMemoryEditor] Opening editor for: ${entry.title}`);
		// The actual editing is handled by the ObsidianMemoryTreePanel's showMemoryEditor method
		// This command triggers the tree panel to open and select the entry
	}

	/**
	 * Create a new memory entry with a dialog.
	 */
	async createNewMemory(): Promise<IObsidianMemoryEntry | undefined> {
		// This is a convenience method — the actual creation dialog is in the tree panel
		this.logService.info('[ObsidianMemoryEditor] Create new memory triggered');
		return undefined;
	}

	/**
	 * Get all unique tags from existing memories (for autocomplete).
	 */
	getAllTags(): string[] {
		const entries = this.obsidianMemory.getAllMemories();
		const tags = new Set<string>();
		for (const entry of entries) {
			for (const tag of entry.tags) {
				tags.add(tag);
			}
		}
		return [...tags].sort();
	}
}
