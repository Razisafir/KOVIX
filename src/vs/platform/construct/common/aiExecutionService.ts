/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 2 Authoritative File Mutation Control
 *
 *  IAIExecutionService — Core service contract for AI-driven workspace mutations.
 *  Phase 2: Authoritative gateway — all controlled edits route through this service.
 *  Includes mutation source tagging, recursion safety, and structured history.
 *
 *  Adapted from Real-vibecode for Construct IDE.
 *  Branding: vibecode → construct, VibeCode → Construct IDE
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IProgress, IProgressStep } from '../../progress/common/progress.js';
import { UndoRedoGroup, UndoRedoSource } from '../../undoRedo/common/undoRedo.js';
import { IBulkEditOptions, IBulkEditResult, ResourceEdit } from '../../../editor/browser/services/bulkEditService.js';

export const IAIExecutionService = createDecorator<IAIExecutionService>('construct.aiExecutionService');

// ─── Mutation Source Tagging ──────────────────────────────────────────────────

/**
 * Identifies the origin of a workspace mutation.
 * This is the foundation of trusted vs untrusted mutation routing.
 */
export const enum AIMutationSource {
	/** Mutation originated from a user typing in the editor */
	UserTyping = 'userTyping',
	/** Mutation originated from a user action (paste, cut, etc.) */
	UserAction = 'userAction',
	/** Mutation originated from an AI agent through the execution kernel */
	AIAgent = 'aiAgent',
	/** Mutation originated from a workspace edit (refactor, rename, etc.) */
	WorkspaceEdit = 'workspaceEdit',
	/** Mutation originated from a save participant (format on save, etc.) */
	SaveParticipant = 'saveParticipant',
	/** Mutation originated from an extension */
	Extension = 'extension',
	/** Mutation originated from undo/redo */
	UndoRedo = 'undoRedo',
	/** Mutation originated from the AI kernel itself (internal apply) */
	AIInternal = 'aiInternal',
	/** Unknown source — treated as untrusted */
	Unknown = 'unknown',
}

/**
 * Context attached to every mutation that flows through the AI kernel.
 * Used for recursion prevention, audit logging, and policy decisions.
 */
export interface IAIMutationContext {
	/** The source of this mutation */
	readonly source: AIMutationSource;
	/** Unique execution ID for tracing this mutation through the system */
	readonly executionId: string;
	/** Parent execution ID if this mutation was triggered by a prior mutation */
	readonly parentExecutionId: string | undefined;
	/** Whether this mutation comes from a trusted source */
	readonly trusted: boolean;
	/** Optional human-readable description of what triggered this mutation */
	readonly description?: string;
	/** The recursion safety token — if set, bypasses interception */
	readonly bypassToken?: AIMutationBypassToken;
}

// ─── Recursion Safety ─────────────────────────────────────────────────────────

/**
 * An opaque token that signals the interception layer to BYPASS interception.
 * When the AIExecutionService itself applies edits, it creates a bypass token
 * so those edits don't recursively trigger interception.
 *
 * The token is a unique symbol that only the AIExecutionService can create.
 */
export class AIMutationBypassToken {
	private static _nextId = 0;
	public readonly id: number;
	public readonly executionId: string;

	constructor(executionId: string) {
		this.id = AIMutationBypassToken._nextId++;
		this.executionId = executionId;
		Object.freeze(this);
	}
}

// ─── Data Types ────────────────────────────────────────────────────────────────

/**
 * Represents a single edit operation targeting a specific file region.
 * Compatible with the editor's IIdentifiedSingleEditOperation for seamless
 * integration with the editor model's applyEdits pipeline.
 */
export interface IAIFileEdit {
	/** URI of the file to edit */
	readonly resource: URI;
	/** Line number where the edit begins (1-based) */
	readonly rangeStartLineNumber: number;
	/** Column where the edit begins (1-based) */
	readonly rangeStartColumn: number;
	/** Line number where the edit ends (1-based) */
	readonly rangeEndLineNumber: number;
	/** Column where the edit ends (1-based) */
	readonly rangeEndColumn: number;
	/** New text to replace the range (empty string = deletion) */
	readonly newText: string;
}

/**
 * Represents a terminal command execution request from the AI kernel.
 * Phase 2: stub only — no terminal integration yet.
 */
export interface IAITerminalExecution {
	/** Command string to execute */
	readonly command: string;
	/** Optional working directory override */
	readonly cwd?: URI;
	/** Whether the command requires user confirmation before execution */
	readonly requiresConfirmation: boolean;
}

/**
 * A workspace-level change that may span multiple files.
 * Used by applyWorkspaceChange() to batch mutations atomically.
 */
export interface IAIWorkspaceChange {
	/** Unique identifier for this change set */
	readonly id: string;
	/** Human-readable description of what the change does */
	readonly description: string;
	/** File edits included in this change */
	readonly edits: IAIFileEdit[];
	/** Timestamp when the change was created */
	readonly createdAt: number;
}

/**
 * An action that can be registered with the AI execution kernel.
 * Actions are named, parameterized operations that AI agents can invoke.
 */
export interface IAIAction<TArgs = unknown, TResult = unknown> {
	/** Unique identifier for this action */
	readonly id: string;
	/** Human-readable label */
	readonly label: string;
	/** Execute the action with the given arguments */
	execute(args: TArgs): Promise<TResult>;
}

// ─── Execution History (Phase 2 Structured Records) ───────────────────────────

/**
 * Structured execution record with graph-compatible fields.
 * Every mutation through the AI kernel produces one of these.
 * Designed for future graph-based orchestration with parent/child links.
 */
export interface IAIExecutionRecord {
	/** Unique ID for this execution record */
	readonly id: string;
	/** Timestamp of the operation */
	readonly timestamp: number;
	/** The source that triggered this mutation */
	readonly mutationSource: AIMutationSource;
	/** The primary file URI affected */
	readonly fileUri: URI;
	/** Number of individual edits in this execution */
	readonly editCount: number;
	/** Content checksum before the edit (SHA-256 hex) */
	readonly beforeChecksum: string | undefined;
	/** Content checksum after the edit (SHA-256 hex) */
	readonly afterChecksum: string | undefined;
	/** Whether this mutation came from a trusted source */
	readonly trusted: boolean;
	/** Whether this execution has been rolled back */
	rolledBack: boolean;
	/** Parent execution ID for graph linkage */
	readonly parentExecutionId: string | undefined;
	/** Type of operation */
	readonly type: 'fileEdit' | 'terminalExecution' | 'workspaceChange' | 'action' | 'bulkEdit';
	/** Human-readable description */
	readonly description: string;
	/** Whether the operation succeeded */
	readonly success: boolean;
	/** Error message if the operation failed */
	readonly error?: string;
}

// ─── Mutation Policy ───────────────────────────────────────────────────────────

/**
 * Policy for controlling whether a mutation is allowed, denied, or requires
 * approval. Phase 2: basic implementation. Future phases will add
 * path-based rules, user approval UI, and rate limiting.
 */
export interface IAIMutationPolicy {
	/** Evaluate whether a mutation is allowed */
	evaluate(ctx: IAIMutationContext, edits: IAIFileEdit[]): AIMutationPolicyResult;
}

export const enum AIMutationPolicyResult {
	/** Mutation is allowed */
	Allow = 'allow',
	/** Mutation is denied */
	Deny = 'deny',
	/** Mutation requires user approval (future: shows approval UI) */
	RequireApproval = 'requireApproval',
}

// ─── Service Interface ─────────────────────────────────────────────────────────

/**
 * IAIExecutionService — The AI Execution Kernel (Phase 2: Authoritative Gateway).
 *
 * This service is the AUTHORITATIVE gateway for controlled workspace file mutations.
 * All AI-driven edits, workspace edits from refactors, and programmatic mutations
 * route through this service to ensure:
 *
 *   1. Auditability — every mutation is recorded with structured execution records
 *   2. Authority — mutations are validated against policy before application
 *   3. Recursion safety — internal mutations bypass interception to prevent loops
 *   4. Atomicity — workspace changes are batched and applied as units
 *   5. Reversibility — structured records enable graph-based undo chains
 *
 * Phase 2 upgrades from passive observation to authoritative control:
 *   - requestFileEdit() now uses pushEditOperations (preserves undo stack)
 *   - applyWorkspaceEdit() integrates with IBulkEditService pipeline
 *   - Mutation source tagging enables trusted vs untrusted routing
 *   - Recursion safety prevents infinite interception loops
 *   - Structured execution records are graph-compatible
 */
export interface IAIExecutionService {
	readonly _serviceBrand: undefined;

	// ─── Authoritative File Mutation ─────────────────────────────────────────

	/**
	 * Request a file edit through the AI kernel.
	 * The edit is validated against mutation policy, recorded in history,
	 * and applied using pushEditOperations to preserve the undo stack.
	 *
	 * @param edit The edit operation to apply
	 * @param context Mutation context including source and bypass token
	 * @returns A promise that resolves when the edit has been applied
	 */
	requestFileEdit(edit: IAIFileEdit, context?: IAIMutationContext): Promise<void>;

	// ─── Workspace Edit Pipeline ────────────────────────────────────────────

	/**
	 * Apply a workspace edit through the AI kernel's controlled pipeline.
	 * This routes through IBulkEditService with AI kernel oversight,
	 * preserving multi-file batching, preview, cancellation, and undo groups.
	 *
	 * @param edits The resource edits to apply
	 * @param options Bulk edit options (label, token, progress, undo group, etc.)
	 * @returns The bulk edit result
	 */
	applyWorkspaceEdit(edits: ResourceEdit[], options?: IAIControlledBulkEditOptions): Promise<IBulkEditResult>;

	// ─── Workspace Mutation (legacy path) ───────────────────────────────────

	/**
	 * Apply a workspace-level change that may span multiple files.
	 * Routes through applyWorkspaceEdit() internally.
	 *
	 * @param change The workspace change to apply
	 * @param context Mutation context
	 */
	applyWorkspaceChange(change: IAIWorkspaceChange, context?: IAIMutationContext): Promise<void>;

	// ─── Terminal Execution (Phase 2 Stub) ──────────────────────────────────

	/**
	 * Request a terminal command execution.
	 * Phase 2: Records the request in history but does NOT execute.
	 */
	requestTerminalExecution(execution: IAITerminalExecution): Promise<void>;

	// ─── Action Registry ────────────────────────────────────────────────────

	/**
	 * Register a named action with the AI execution kernel.
	 */
	registerAction<TArgs = unknown, TResult = unknown>(action: IAIAction<TArgs, TResult>): IDisposable;

	// ─── Execution History ──────────────────────────────────────────────────

	/**
	 * Get the full execution history as structured records.
	 */
	getExecutionHistory(): IAIExecutionRecord[];

	/**
	 * Event that fires when a new record is added to execution history.
	 */
	readonly onDidRecordExecution: Event<IAIExecutionRecord>;

	// ─── Recursion Safety ───────────────────────────────────────────────────

	/**
	 * Create a bypass token for the given execution ID.
	 * Only the AIExecutionService should create these tokens.
	 * They are passed in IAIMutationContext.bypassToken to skip interception.
	 */
	createBypassToken(executionId: string): AIMutationBypassToken;

	/**
	 * Check if a bypass token is currently valid.
	 */
	isBypassTokenValid(token: AIMutationBypassToken): boolean;

	/**
	 * Revoke a bypass token after internal mutation completes.
	 */
	revokeBypassToken(token: AIMutationBypassToken): void;

	// ─── Mutation Context ───────────────────────────────────────────────────

	/**
	 * Create a mutation context for AI-sourced mutations.
	 */
	createAIContext(description?: string, parentExecutionId?: string): IAIMutationContext;

	/**
	 * Get the current active mutation context, if any.
	 * Used by interception hooks to determine if they should bypass.
	 */
	readonly activeMutationContext: IAIMutationContext | undefined;
}

// ─── Bulk Edit Options Extension ───────────────────────────────────────────────

/**
 * Extended bulk edit options that carry AI kernel context.
 * When AIExecutionService.applyWorkspaceEdit() is called, it creates
 * an IBulkEditOptions from these, preserving all standard options
 * and adding the mutation context for interception routing.
 */
export interface IAIControlledBulkEditOptions extends IBulkEditOptions {
	/** The AI mutation context for this edit */
	readonly aiContext?: IAIMutationContext;
}
