/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Diff Applier Service Interface
 *  MVP: Apply file edits with rollback support
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

export const IDiffApplierService = createDecorator<IDiffApplierService>('construct.diffApplier');

export interface IDiffApplierService {
	readonly _serviceBrand: undefined;

	/** Apply a diff — replaces old content with new content in a file */
	applyDiff(filePath: string, oldContent: string, newContent: string): Promise<DiffResult>;

	/** Write entire file content */
	writeFile(filePath: string, content: string): Promise<DiffResult>;

	/** Read file content */
	readFile(filePath: string): Promise<string>;

	/** Create a new file */
	createFile(filePath: string, content: string): Promise<DiffResult>;

	/** Delete a file */
	deleteFile(filePath: string): Promise<DiffResult>;

	/** Rollback last change to a file */
	rollback(filePath: string): Promise<boolean>;

	/** Get pending changes (not yet committed to disk) */
	getPendingChanges(): ReadonlyMap<string, FileChange>;

	/** Events */
	readonly onDidChangeFile: Event<{ filePath: string; type: 'create' | 'modify' | 'delete' }>;
}

export interface DiffResult {
	success: boolean;
	filePath: string;
	linesAdded: number;
	linesRemoved: number;
	error?: string;
}

export interface FileChange {
	filePath: string;
	type: 'create' | 'modify' | 'delete';
	originalContent?: string;
	newContent?: string;
	timestamp: number;
}
