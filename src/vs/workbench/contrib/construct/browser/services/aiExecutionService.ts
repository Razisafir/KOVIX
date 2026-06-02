/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 2 Authoritative File Mutation Control
 *
 *  AIExecutionService — Concrete implementation of IAIExecutionService.
 *  Phase 2: Authoritative gateway for AI-driven workspace mutations.
 *
 *  Adapted from Real-vibecode for Construct IDE.
 *  Key adaptations:
 *    - Branding: vibecode → construct, VibeCode → Construct IDE
 *    - Import paths updated for CONSTRUCT-VSCODE directory structure
 *    - createDecorator symbols: vibecode.aiExecution → construct.aiExecution
 *    - IAIUnifiedStateService and IObservabilityService dependencies stubbed out
 *      (will be wired in when those services are ported in future phases)
 *    - Core logic preserved: policy validation, graph node tracking,
 *      IBulkEditService integration, pushEditOperations, recursion safety
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IBulkEditService, IBulkEditOptions, IBulkEditResult, ResourceEdit, ResourceTextEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { IProgress, IProgressStep, Progress } from '../../../../../platform/progress/common/progress.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { UndoRedoGroup, UndoRedoSource } from '../../../../../platform/undoRedo/common/undoRedo.js';
import {
	IAIExecutionService, IAIFileEdit, IAITerminalExecution, IAIWorkspaceChange, IAIAction,
	IAIExecutionRecord, IAIMutationContext, IAIControlledBulkEditOptions,
	AIMutationSource, AIMutationBypassToken, AIMutationPolicyResult, IAIMutationPolicy
} from '../../../../../platform/construct/common/aiExecutionService.js';
import {
	IExecutionGraphService, ExecutionNodeType, ExecutionEdgeType, RollbackStrategy,
	IExecutionNode
} from '../../../../../platform/construct/common/executionGraphService.js';

// ─── Default Mutation Policy ───────────────────────────────────────────────────

class DefaultMutationPolicy implements IAIMutationPolicy {
	evaluate(ctx: IAIMutationContext, _edits: IAIFileEdit[]): AIMutationPolicyResult {
		if (ctx.bypassToken) {
			return AIMutationPolicyResult.Allow;
		}
		if (ctx.source === AIMutationSource.AIAgent || ctx.source === AIMutationSource.AIInternal) {
			return ctx.trusted ? AIMutationPolicyResult.Allow : AIMutationPolicyResult.RequireApproval;
		}
		return AIMutationPolicyResult.Allow;
	}
}

// ─── AIExecutionService ────────────────────────────────────────────────────────

export class AIExecutionService extends Disposable implements IAIExecutionService {

	declare readonly _serviceBrand: undefined;

	// ─── Private State ─────────────────────────────────────────────────────────

	/** Execution history — kept for backward compatibility, but primary data is now the graph */
	private readonly _history: IAIExecutionRecord[] = [];

	/** Registered actions */
	private readonly _actions = new Map<string, IAIAction<unknown, unknown>>();

	/** Event emitter for execution history changes */
	private readonly _onDidRecordExecution = this._register(new Emitter<IAIExecutionRecord>());
	readonly onDidRecordExecution = this._onDidRecordExecution.event;

	/** Active bypass tokens */
	private readonly _activeBypassTokens = new Set<number>();

	/** Active mutation context */
	private _activeMutationContext: IAIMutationContext | undefined;
	get activeMutationContext(): IAIMutationContext | undefined { return this._activeMutationContext; }

	/** Mutation policy */
	private readonly _policy = new DefaultMutationPolicy();

	/** Execution stack depth (recursion safety) */
	private _executionStackDepth = 0;

	// ─── Constructor (DI-injected dependencies) ────────────────────────────────

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBulkEditService private readonly bulkEditService: IBulkEditService,
		@IExecutionGraphService private readonly graphService: IExecutionGraphService,
	) {
		super();
		this.logService.trace('[Construct AIExecutionService] Phase 2 execution kernel initialized');
	}

	// ─── Recursion Safety ──────────────────────────────────────────────────────

	createBypassToken(executionId: string): AIMutationBypassToken {
		const token = new AIMutationBypassToken(executionId);
		this._activeBypassTokens.add(token.id);
		// TODO: Wire to IAIUnifiedStateService.trackBypassToken when available
		return token;
	}

	isBypassTokenValid(token: AIMutationBypassToken): boolean {
		return this._activeBypassTokens.has(token.id);
	}

	revokeBypassToken(token: AIMutationBypassToken): void {
		this._activeBypassTokens.delete(token.id);
		// TODO: Wire to IAIUnifiedStateService.untrackBypassToken when available
	}

	// ─── Mutation Context ──────────────────────────────────────────────────────

	createAIContext(description?: string, parentExecutionId?: string): IAIMutationContext {
		return {
			source: AIMutationSource.AIAgent,
			executionId: generateUuid(),
			parentExecutionId,
			trusted: true,
			description,
		};
	}

	// ─── Authoritative File Mutation (Fully Integrated Pipeline) ───────────────

	async requestFileEdit(edit: IAIFileEdit, context?: IAIMutationContext): Promise<void> {
		const entryId = generateUuid();
		const mutationCtx = context ?? this.createAIContext(`requestFileEdit: ${edit.resource.toString()}`);
		const isBypass = mutationCtx.bypassToken && this.isBypassTokenValid(mutationCtx.bypassToken);

		this.logService.trace(`[Construct AIExecutionService] requestFileEdit: ${edit.resource.toString()} source=${mutationCtx.source} bypass=${!!isBypass}`);

		// ── STEP 1: Policy Validation ────────────────────────────────────────────
		if (!isBypass) {
			const policyResult = this._policy.evaluate(mutationCtx, [edit]);

			if (policyResult === AIMutationPolicyResult.Deny) {
				// Create graph node recording the denial
				const node = this.graphService.createNode({
					type: ExecutionNodeType.FileEdit,
					label: `Denied: ${edit.resource.fsPath}`,
					mutationSource: mutationCtx.source,
					trusted: mutationCtx.trusted,
					description: 'Mutation denied by policy',
					fileUri: edit.resource,
					editCount: 1,
					reversible: false,
					rollbackStrategy: RollbackStrategy.Irreversible,
					scopeId: mutationCtx.parentExecutionId,
				});
				this.graphService.completeNode(node.id, { success: false, error: 'Mutation denied by policy' });
				throw new Error(`Construct AIExecutionService: Mutation denied by policy for ${edit.resource.toString()}`);
			}
		}

		// ── STEP 2: Compute Before Checksum ──────────────────────────────────────
		let beforeChecksum: string | undefined;
		try {
			const model = await this.textFileService.files.resolve(edit.resource);
			if (!model || !model.textEditorModel) {
				throw new Error(`Cannot resolve text model for ${edit.resource.toString()}`);
			}
			beforeChecksum = this._computeChecksum(model.textEditorModel.getValue());
		} catch (err) {
			// Can't resolve model — still create node but without checksum
		}

		// ── STEP 3: Create Graph Node (pending state) ────────────────────────────
		const graphNode = this.graphService.createNode({
			type: ExecutionNodeType.FileEdit,
			label: `Edit ${edit.resource.fsPath} L${edit.rangeStartLineNumber}-${edit.rangeEndLineNumber}`,
			mutationSource: mutationCtx.source,
			trusted: mutationCtx.trusted,
			description: mutationCtx.description,
			fileUri: edit.resource,
			beforeChecksum,
			editCount: 1,
			reversible: true,
			rollbackStrategy: RollbackStrategy.InverseEdit,
			scopeId: mutationCtx.parentExecutionId,
		});

		// ── STEP 4: Create Causal Edge ───────────────────────────────────────────
		if (mutationCtx.parentExecutionId) {
			this.graphService.createEdge(mutationCtx.parentExecutionId, graphNode.id, ExecutionEdgeType.CausedBy);
		}

		// ── STEP 5: Create bypass token for recursion safety ─────────────────────
		const bypassToken = this.createBypassToken(graphNode.id);

		try {
			// ── STEP 6: Apply the Mutation to Editor Model ───────────────────────
			const model = await this.textFileService.files.resolve(edit.resource);
			if (!model || !model.textEditorModel) {
				throw new Error(`Cannot resolve text model for ${edit.resource.toString()}`);
			}

			const prevContext = this._activeMutationContext;
			this._activeMutationContext = mutationCtx;
			this._executionStackDepth++;

			if (this._executionStackDepth > 10) {
				throw new Error(`Construct AIExecutionService: Recursion depth exceeded. Possible infinite mutation loop.`);
			}

			let afterChecksum: string | undefined;
			try {
				model.textEditorModel.pushEditOperations(
					null,
					[{
						range: {
							startLineNumber: edit.rangeStartLineNumber,
							startColumn: edit.rangeStartColumn,
							endLineNumber: edit.rangeEndLineNumber,
							endColumn: edit.rangeEndColumn,
						},
						text: edit.newText,
					}],
					() => null
				);
				afterChecksum = this._computeChecksum(model.textEditorModel.getValue());
			} finally {
				this._executionStackDepth--;
				this._activeMutationContext = prevContext;
			}

			// ── STEP 7: Complete Graph Node ──────────────────────────────────────
			this.graphService.completeNode(graphNode.id, {
				success: true,
				afterChecksum,
			});

			// ── STEP 8: Record in History ────────────────────────────────────────
			const record = this._createRecord(entryId, mutationCtx, edit.resource, 1, 'fileEdit',
				`Edit ${edit.resource.fsPath} L${edit.rangeStartLineNumber}-${edit.rangeEndLineNumber}`,
				true, beforeChecksum, undefined, afterChecksum);
			this._recordEntry(record);

		} catch (err) {
			// Complete graph node with error
			this.graphService.completeNode(graphNode.id, {
				success: false,
				error: String(err),
			});

			const record = this._createRecord(entryId, mutationCtx, edit.resource, 1, 'fileEdit',
				`Edit ${edit.resource.fsPath} FAILED`, false, beforeChecksum, String(err));
			this._recordEntry(record);

			this.logService.error(`[Construct AIExecutionService] File edit failed: ${String(err)}`);
			throw err;
		} finally {
			this.revokeBypassToken(bypassToken);
		}
	}

	// ─── Workspace Edit Pipeline ────────────────────────────────────────────────

	async applyWorkspaceEdit(edits: ResourceEdit[], options?: IAIControlledBulkEditOptions): Promise<IBulkEditResult> {
		const entryId = generateUuid();
		const mutationCtx = options?.aiContext ?? this.createAIContext(`applyWorkspaceEdit: ${edits.length} edits`);

		const textEdits = edits.filter(e => e instanceof ResourceTextEdit) as ResourceTextEdit[];
		const affectedUris = new Set<string>();
		for (const e of textEdits) { affectedUris.add(e.resource.toString()); }

		// STEP 1: Create graph node for the workspace edit (parent node)
		const graphNode = this.graphService.createNode({
			type: ExecutionNodeType.WorkspaceEdit,
			label: options?.label ?? `Workspace Edit (${edits.length} edits)`,
			mutationSource: mutationCtx.source,
			trusted: mutationCtx.trusted,
			description: mutationCtx.description,
			fileUri: textEdits.length > 0 ? textEdits[0].resource : undefined,
			additionalFileUris: textEdits.length > 1 ? textEdits.slice(1).map(e => e.resource) : [],
			editCount: textEdits.length,
			reversible: true,
			rollbackStrategy: RollbackStrategy.EditorUndo,
		});

		// STEP 2: Begin execution scope
		const scope = this.graphService.beginScope(
			`Workspace Edit ${graphNode.id.slice(0, 8)}`,
			graphNode.id,
			mutationCtx.source
		);
		// TODO: Wire to IAIUnifiedStateService.setActiveScope when available

		// STEP 3: Create causal edge
		if (mutationCtx.parentExecutionId) {
			this.graphService.createEdge(mutationCtx.parentExecutionId, graphNode.id, ExecutionEdgeType.CausedBy);
		}

		// STEP 4: Create bypass token for recursion safety
		const bypassToken = this.createBypassToken(graphNode.id);

		try {
			const bulkOptions: IBulkEditOptions = {
				editor: options?.editor,
				progress: options?.progress ?? Progress.None,
				token: options?.token ?? CancellationToken.None,
				showPreview: options?.showPreview,
				label: options?.label ?? 'Construct AI Execution Kernel',
				code: options?.code ?? 'construct.aiExecution.kernel',
				quotableLabel: options?.quotableLabel,
				undoRedoGroupId: options?.undoRedoGroupId,
				undoRedoSource: options?.undoRedoSource,
				confirmBeforeUndo: options?.confirmBeforeUndo,
				respectAutoSaveConfig: options?.respectAutoSaveConfig,
				reason: options?.reason,
			};

			// STEP 5: Apply via bulk edit service
			const prevContext = this._activeMutationContext;
			this._activeMutationContext = mutationCtx;
			this._executionStackDepth++;

			if (this._executionStackDepth > 10) {
				throw new Error(`Construct AIExecutionService: Recursion depth exceeded.`);
			}

			let result: IBulkEditResult;
			try {
				result = await this.bulkEditService.apply(edits, bulkOptions);
			} finally {
				this._executionStackDepth--;
				this._activeMutationContext = prevContext;
			}

			// STEP 6: Complete graph node + end scope
			this.graphService.completeNode(graphNode.id, { success: true });
			this.graphService.endScope(scope.id);

			// STEP 7: Record in history
			const primaryUri = textEdits.length > 0 ? textEdits[0].resource : URI.parse('untitled:bulk-edit');
			const record = this._createRecord(entryId, mutationCtx, primaryUri, textEdits.length, 'bulkEdit',
				`Workspace edit: ${edits.length} edits across ${affectedUris.size} files`, true);
			this._recordEntry(record);

			return result;
		} catch (err) {
			this.graphService.completeNode(graphNode.id, { success: false, error: String(err) });
			this.graphService.endScope(scope.id);

			const primaryUri = textEdits.length > 0 ? textEdits[0].resource : URI.parse('untitled:bulk-edit');
			const record = this._createRecord(entryId, mutationCtx, primaryUri, textEdits.length, 'bulkEdit',
				`Workspace edit FAILED`, false, undefined, String(err));
			this._recordEntry(record);

			throw err;
		} finally {
			this.revokeBypassToken(bypassToken);
		}
	}

	// ─── Workspace Mutation ────────────────────────────────────────────────────

	async applyWorkspaceChange(change: IAIWorkspaceChange, context?: IAIMutationContext): Promise<void> {
		const mutationCtx = context ?? this.createAIContext(change.description, undefined);
		const resourceEdits: ResourceEdit[] = change.edits.map(edit =>
			new ResourceTextEdit(edit.resource, {
				range: {
					startLineNumber: edit.rangeStartLineNumber,
					startColumn: edit.rangeStartColumn,
					endLineNumber: edit.rangeEndLineNumber,
					endColumn: edit.rangeEndColumn,
				},
				text: edit.newText,
			}, undefined, undefined)
		);
		await this.applyWorkspaceEdit(resourceEdits, {
			aiContext: mutationCtx,
			label: change.description,
			code: `construct.aiExecution.workspaceChange.${change.id}`,
		});
	}

	// ─── Terminal Execution (Stub) ─────────────────────────────────────────────

	async requestTerminalExecution(execution: IAITerminalExecution): Promise<void> {
		const entryId = generateUuid();

		const graphNode = this.graphService.createNode({
			type: ExecutionNodeType.TerminalExecution,
			label: `Terminal: ${execution.command.slice(0, 50)}`,
			mutationSource: AIMutationSource.AIAgent,
			trusted: true,
			description: `Terminal stub: ${execution.command}`,
			editCount: 0,
			reversible: false,
			rollbackStrategy: RollbackStrategy.Irreversible,
		});
		this.graphService.completeNode(graphNode.id, { success: true });

		const record = this._createRecord(entryId,
			{ source: AIMutationSource.AIAgent, executionId: entryId, parentExecutionId: undefined, trusted: true },
			URI.parse('terminal:stub'), 0, 'terminalExecution',
			`Terminal request (stub): ${execution.command}`, true);
		this._recordEntry(record);
	}

	// ─── Action Registry ───────────────────────────────────────────────────────

	registerAction<TArgs = unknown, TResult = unknown>(action: IAIAction<TArgs, TResult>): IDisposable {
		if (this._actions.has(action.id)) {
			this.logService.warn(`[Construct AIExecutionService] Action "${action.id}" re-registered`);
		}
		this._actions.set(action.id, action as IAIAction<unknown, unknown>);
		return toDisposable(() => { this._actions.delete(action.id); });
	}

	// ─── Execution History ─────────────────────────────────────────────────────

	getExecutionHistory(): IAIExecutionRecord[] {
		return [...this._history];
	}

	// ─── Private Helpers ───────────────────────────────────────────────────────

	private _createRecord(
		id: string, ctx: IAIMutationContext, fileUri: URI, editCount: number,
		type: IAIExecutionRecord['type'], description: string, success: boolean,
		beforeChecksum?: string, error?: string, afterChecksum?: string,
	): IAIExecutionRecord {
		return {
			id, timestamp: Date.now(), mutationSource: ctx.source, fileUri, editCount,
			beforeChecksum, afterChecksum, trusted: ctx.trusted, rolledBack: false,
			parentExecutionId: ctx.parentExecutionId, type, description, success, error,
		};
	}

	private _recordEntry(record: IAIExecutionRecord): void {
		this._history.push(record);
		this._onDidRecordExecution.fire(record);
	}

	private _computeChecksum(content: string): string {
		// FNV-1a hash for fast content fingerprinting
		let hash = 2166136261;
		for (let i = 0; i < content.length; i++) {
			hash ^= content.charCodeAt(i);
			hash = (hash * 16777619) >>> 0;
		}
		return hash.toString(16).padStart(8, '0');
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────

	override dispose(): void {
		this._actions.clear();
		this._history.length = 0;
		this._activeBypassTokens.clear();
		super.dispose();
	}
}
