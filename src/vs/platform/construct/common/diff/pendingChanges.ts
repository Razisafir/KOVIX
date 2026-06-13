/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';

export const IPendingChangesService = createDecorator<IPendingChangesService>('construct.pendingChanges');

/**
 * A single pending change entry staged by the agent.
 * The change exists in memory only — disk is not modified until accept().
 */
export interface PendingChangeEntry {
        /** URI of the file being changed. */
        readonly uri: URI;
        /** The file content BEFORE the agent's change (captured at staging time). */
        readonly originalContent: string;
        /** The content the agent proposes (new file content or patched content). */
        readonly proposedContent: string;
        /** Whether this is a new file creation (no original content on disk). */
        readonly isNewFile: boolean;
        /** Whether the user has accepted or rejected this change. undefined = pending. */
        accepted?: boolean;
}

/**
 * Service for staging agent-proposed file changes in memory.
 *
 * P0-5 FIX: The agent loop no longer writes directly to disk.
 * All changes are staged here, and the user must explicitly accept
 * before the change is persisted to disk via IFileService.
 *
 * This mirrors VS Code's chatEditingModifiedFileEntry pattern where
 * edits are applied to in-memory ITextModel instances with a docSnapshot
 * for the original content.
 */
export interface IPendingChangesService {
        readonly _serviceBrand: undefined;

        /** Event fired when pending changes are added, accepted, or rejected. */
        readonly onDidChangePendingChanges: Event<void>;

        /** Current list of pending changes (not yet accepted or rejected). */
        readonly pendingEntries: ReadonlyArray<PendingChangeEntry>;

        /**
         * Stage a new file creation or full file replacement.
         * Captures the original file content BEFORE staging.
         * Does NOT write to disk — the change is in memory only.
         */
        stageFile(uri: URI, proposedContent: string): Promise<void>;

        /**
         * Stage an edit (diff) to an existing file.
         * The diff is applied to the current file content in memory.
         * Does NOT write to disk.
         */
        stageEdit(uri: URI, diff: string): Promise<void>;

        /**
         * Accept a pending change — writes the proposed content to disk.
         */
        accept(uri: URI): Promise<void>;

        /**
         * Reject a pending change — discards the in-memory proposal.
         * If this was a new file that doesn't exist on disk, nothing happens.
         * If the file existed before, the disk remains unchanged.
         */
        reject(uri: URI): Promise<void>;

        /**
         * Accept ALL pending changes.
         */
        acceptAll(): Promise<void>;

        /**
         * Reject ALL pending changes.
         */
        rejectAll(): Promise<void>;

        /**
         * Get the original content for a URI (before the agent's change).
         */
        getOriginalContent(uri: URI): string | undefined;

        /**
         * Get the proposed content for a URI (the agent's change).
         */
        getProposedContent(uri: URI): string | undefined;

        /**
         * Check if there are any pending changes.
         */
        hasPendingChanges(): boolean;
}
