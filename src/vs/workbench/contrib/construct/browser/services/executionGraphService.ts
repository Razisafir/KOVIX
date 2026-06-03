/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 2 Execution Graph Engine
 *
 *  ExecutionGraphService — Concrete implementation of IExecutionGraphService.
 *  Hybrid memory/persisted model with async-safe writes.
 *
 *  Adapted from Real-construct for Construct IDE.
 *  Key adaptations:
 *    - Branding: construct → construct, Construct IDE → Construct IDE
 *    - Import paths updated for CONSTRUCT-VSCODE directory structure
 *    - createDecorator: executionGraphService → construct.executionGraphService
 *    - BFS cycle prevention logic preserved exactly as-is
 *    - Persistence layer preserved with JSONL format
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { AIMutationSource } from '../../../../../platform/construct/common/aiExecutionService.js';
import {
        IExecutionGraphService, IExecutionNode, IExecutionEdge, IExecutionScope,
        ExecutionNodeType, ExecutionEdgeType, RollbackStrategy,
        IExecutionNodeCreateParams, IExecutionNodeCompleteParams,
        IExecutionNodeFilter
} from '../../../../../platform/construct/common/executionGraphService.js';

// ─── Persistence Constants ─────────────────────────────────────────────────────

const GRAPH_DIR = 'construct-execution-graph';
const NODES_FILE = 'nodes.jsonl';
const EDGES_FILE = 'edges.jsonl';
const SCOPES_FILE = 'scopes.jsonl';
const FLUSH_INTERVAL_MS = 30_000; // Flush to disk every 30 seconds
const MAX_MEMORY_NODES = 10_000; // Prune nodes older than this from memory cache
const PRUNE_AGE_MS = 86_400_000; // 24 hours — nodes older than this are candidates for memory pruning

// ─── ExecutionGraphService ─────────────────────────────────────────────────────

export class ExecutionGraphService extends Disposable implements IExecutionGraphService {

        declare readonly _serviceBrand: undefined;

        // ─── In-Memory Graph Store ──────────────────────────────────────────────────

        private readonly _nodes = new Map<string, IExecutionNode>();
        private readonly _edges = new Map<string, IExecutionEdge>();
        private readonly _scopes = new Map<string, IExecutionScope>();

        // ─── Index Structures (for fast queries) ────────────────────────────────────

        /** Node ID → outgoing edge IDs */
        private readonly _outgoingEdges = new Map<string, Set<string>>();
        /** Node ID → incoming edge IDs */
        private readonly _incomingEdges = new Map<string, Set<string>>();
        /** File URI string → node IDs */
        private readonly _fileIndex = new Map<string, Set<string>>();
        /** Scope ID → node IDs */
        private readonly _scopeIndex = new Map<string, Set<string>>();
        /** Temporal ordering: ordered array of node IDs by createdAt */
        private _temporalOrder: string[] = [];

        // ─── Dirty Tracking (for persistence batching) ─────────────────────────────

        private _dirtyNodes = new Set<string>();
        private _dirtyEdges = new Set<string>();
        private _flushTimer: ReturnType<typeof setInterval> | undefined;

        // ─── Scope Stack ────────────────────────────────────────────────────────────

        private _activeScopeId: string | undefined;
        get activeScope(): IExecutionScope | undefined {
                return this._activeScopeId ? this._scopes.get(this._activeScopeId) : undefined;
        }

        // ─── Events ─────────────────────────────────────────────────────────────────

        private readonly _onDidCreateNode = this._register(new Emitter<IExecutionNode>());
        readonly onDidCreateNode: Event<IExecutionNode> = this._onDidCreateNode.event;

        private readonly _onDidCompleteNode = this._register(new Emitter<IExecutionNode>());
        readonly onDidCompleteNode: Event<IExecutionNode> = this._onDidCompleteNode.event;

        private readonly _onDidCreateEdge = this._register(new Emitter<IExecutionEdge>());
        readonly onDidCreateEdge: Event<IExecutionEdge> = this._onDidCreateEdge.event;

        // ─── Counters ───────────────────────────────────────────────────────────────

        get nodeCount(): number { return this._nodes.size; }
        get edgeCount(): number { return this._edges.size; }

        // ─── Constructor ────────────────────────────────────────────────────────────

        constructor(
                @ILogService private readonly logService: ILogService,
                @IEnvironmentService private readonly environmentService: IEnvironmentService,
                @IFileService private readonly fileService: IFileService,
        ) {
                super();

                // Start periodic flush timer
                this._flushTimer = setInterval(() => {
                        this.flush().catch(err => {
                                this.logService.error('[Construct ExecutionGraphService] Periodic flush failed:', err);
                        });
                }, FLUSH_INTERVAL_MS);

                // Load persisted graph on startup
                this._loadFromDisk().catch(err => {
                        this.logService.warn('[Construct ExecutionGraphService] Failed to load persisted graph:', err);
                });

                this.logService.trace('[Construct ExecutionGraphService] Phase 2 execution graph initialized');
        }

        // ─── Node Operations ────────────────────────────────────────────────────────

        createNode(params: IExecutionNodeCreateParams): IExecutionNode {
                const id = generateUuid();

                const node: IExecutionNode = {
                        id,
                        type: params.type,
                        label: params.label,
                        createdAt: Date.now(),
                        completedAt: undefined,
                        mutationSource: params.mutationSource,
                        trusted: params.trusted,
                        description: params.description,
                        fileUri: params.fileUri,
                        additionalFileUris: params.additionalFileUris ?? [],
                        success: false,
                        error: undefined,
                        pending: true,
                        beforeChecksum: params.beforeChecksum,
                        afterChecksum: undefined,
                        editCount: params.editCount ?? 0,
                        reversible: params.reversible ?? (params.rollbackStrategy !== undefined && params.rollbackStrategy !== RollbackStrategy.Irreversible),
                        rollbackStrategy: params.rollbackStrategy ?? RollbackStrategy.Irreversible,
                        snapshotReference: params.snapshotReference,
                        inverseOperationReference: params.inverseOperationReference,
                        rolledBack: false,
                        rolledBackBy: undefined,
                        scopeId: params.scopeId ?? this._activeScopeId,
                };

                // Insert into stores
                this._nodes.set(id, node);
                this._temporalOrder.push(id);
                this._dirtyNodes.add(id);

                // Update file index
                if (node.fileUri) {
                        const key = node.fileUri.toString();
                        let set = this._fileIndex.get(key);
                        if (!set) {
                                set = new Set();
                                this._fileIndex.set(key, set);
                        }
                        set.add(id);
                }
                for (const uri of node.additionalFileUris) {
                        const key = uri.toString();
                        let set = this._fileIndex.get(key);
                        if (!set) {
                                set = new Set();
                                this._fileIndex.set(key, set);
                        }
                        set.add(id);
                }

                // Update scope index
                if (node.scopeId) {
                        let set = this._scopeIndex.get(node.scopeId);
                        if (!set) {
                                set = new Set();
                                this._scopeIndex.set(node.scopeId, set);
                        }
                        set.add(id);
                }

                // Auto-create Parent edge if in an active scope
                if (node.scopeId) {
                        const scope = this._scopes.get(node.scopeId);
                        if (scope && scope.ownerNodeId !== id) {
                                this.createEdge(scope.ownerNodeId, id, ExecutionEdgeType.Parent);
                        }
                }

                // Prune memory cache if it exceeds the limit
                this._pruneMemoryCache();

                // Fire event
                this._onDidCreateNode.fire(node);

                this.logService.trace(`[Construct ExecutionGraphService] Node created: ${id} type=${node.type} label="${node.label}"`);
                return node;
        }

        completeNode(nodeId: string, result: IExecutionNodeCompleteParams): void {
                const node = this._nodes.get(nodeId);
                if (!node) {
                        this.logService.warn(`[Construct ExecutionGraphService] Cannot complete unknown node: ${nodeId}`);
                        return;
                }

                // Mutate the completion fields (these are the ONLY mutable fields)
                (node as { success: boolean }).success = result.success;
                (node as { error: string | undefined }).error = result.error;
                (node as { afterChecksum: string | undefined }).afterChecksum = result.afterChecksum;
                (node as { completedAt: number | undefined }).completedAt = Date.now();
                (node as { pending: boolean }).pending = false;

                this._dirtyNodes.add(nodeId);
                this._onDidCompleteNode.fire(node);

                this.logService.trace(`[Construct ExecutionGraphService] Node completed: ${nodeId} success=${result.success}`);
        }

        markRolledBack(nodeId: string, rolledBackByNodeId: string): void {
                const node = this._nodes.get(nodeId);
                if (!node) {
                        this.logService.warn(`[Construct ExecutionGraphService] Cannot mark unknown node as rolled back: ${nodeId}`);
                        return;
                }

                (node as { rolledBack: boolean }).rolledBack = true;
                (node as { rolledBackBy: string | undefined }).rolledBackBy = rolledBackByNodeId;

                // Create a RollbackOf edge
                this.createEdge(rolledBackByNodeId, nodeId, ExecutionEdgeType.RollbackOf);

                this._dirtyNodes.add(nodeId);
                this.logService.info(`[Construct ExecutionGraphService] Node rolled back: ${nodeId} by ${rolledBackByNodeId}`);
        }

        // ─── Edge Operations ────────────────────────────────────────────────────────

        createEdge(sourceId: string, targetId: string, type: ExecutionEdgeType, metadata?: Record<string, string>): IExecutionEdge | undefined {
                // Validate nodes exist
                if (!this._nodes.has(sourceId)) {
                        this.logService.warn(`[Construct ExecutionGraphService] Edge source not found: ${sourceId}`);
                        return undefined;
                }
                if (!this._nodes.has(targetId)) {
                        this.logService.warn(`[Construct ExecutionGraphService] Edge target not found: ${targetId}`);
                        return undefined;
                }

                // Cycle prevention: check if targetId is an ancestor of sourceId
                // If so, adding sourceId → targetId would create a cycle
                if (this._wouldCreateCycle(sourceId, targetId)) {
                        this.logService.warn(`[Construct ExecutionGraphService] Edge would create cycle: ${sourceId} → ${targetId}`);
                        return undefined;
                }

                // Deduplication: check for existing edge with same (source, target, type)
                const existingOutgoing = this._outgoingEdges.get(sourceId);
                if (existingOutgoing) {
                        for (const edgeId of existingOutgoing) {
                                const edge = this._edges.get(edgeId);
                                if (edge && edge.targetId === targetId && edge.type === type) {
                                        // Duplicate edge — skip
                                        return edge;
                                }
                        }
                }

                const id = generateUuid();
                const edge: IExecutionEdge = {
                        id,
                        sourceId,
                        targetId,
                        type,
                        createdAt: Date.now(),
                        metadata,
                };

                this._edges.set(id, edge);
                this._dirtyEdges.add(id);

                // Update adjacency indexes
                let outSet = this._outgoingEdges.get(sourceId);
                if (!outSet) {
                        outSet = new Set();
                        this._outgoingEdges.set(sourceId, outSet);
                }
                outSet.add(id);

                let inSet = this._incomingEdges.get(targetId);
                if (!inSet) {
                        inSet = new Set();
                        this._incomingEdges.set(targetId, inSet);
                }
                inSet.add(id);

                this._onDidCreateEdge.fire(edge);
                this.logService.trace(`[Construct ExecutionGraphService] Edge created: ${sourceId} --${type}--> ${targetId}`);
                return edge;
        }

        // ─── Scope Operations ───────────────────────────────────────────────────────

        beginScope(label: string, ownerNodeId: string, mutationSource: AIMutationSource): IExecutionScope {
                const id = generateUuid();
                const scope: IExecutionScope = {
                        id,
                        label,
                        ownerNodeId,
                        createdAt: Date.now(),
                        active: true,
                        mutationSource,
                };

                this._scopes.set(id, scope);
                this._activeScopeId = id;

                this.logService.trace(`[Construct ExecutionGraphService] Scope begun: ${id} label="${label}" owner=${ownerNodeId}`);
                return scope;
        }

        endScope(scopeId: string): void {
                const scope = this._scopes.get(scopeId);
                if (!scope) {
                        this.logService.warn(`[Construct ExecutionGraphService] Cannot end unknown scope: ${scopeId}`);
                        return;
                }

                scope.active = false;

                // If this was the active scope, clear it
                if (this._activeScopeId === scopeId) {
                        this._activeScopeId = undefined;
                }

                this.logService.trace(`[Construct ExecutionGraphService] Scope ended: ${scopeId}`);
        }

        // ─── Query API ──────────────────────────────────────────────────────────────

        getNode(id: string): IExecutionNode | undefined {
                return this._nodes.get(id);
        }

        getOutgoingEdges(nodeId: string): IExecutionEdge[] {
                const edgeIds = this._outgoingEdges.get(nodeId);
                if (!edgeIds) { return []; }
                return Array.from(edgeIds).map(id => this._edges.get(id)!).filter(Boolean);
        }

        getIncomingEdges(nodeId: string): IExecutionEdge[] {
                const edgeIds = this._incomingEdges.get(nodeId);
                if (!edgeIds) { return []; }
                return Array.from(edgeIds).map(id => this._edges.get(id)!).filter(Boolean);
        }

        getChildren(nodeId: string): IExecutionNode[] {
                const edges = this.getOutgoingEdges(nodeId).filter(e => e.type === ExecutionEdgeType.Parent);
                return edges.map(e => this._nodes.get(e.targetId)!).filter(Boolean);
        }

        getParents(nodeId: string): IExecutionNode[] {
                const edges = this.getIncomingEdges(nodeId).filter(e => e.type === ExecutionEdgeType.Parent);
                return edges.map(e => this._nodes.get(e.sourceId)!).filter(Boolean);
        }

        getExecutionChain(nodeId: string): IExecutionNode[] {
                const chain: IExecutionNode[] = [];
                let currentId: string | undefined = nodeId;

                // Walk up the Parent edges to the root
                const visited = new Set<string>();
                while (currentId && !visited.has(currentId)) {
                        visited.add(currentId);
                        const node = this._nodes.get(currentId);
                        if (node) {
                                chain.unshift(node); // Prepend for root-first ordering
                        }
                        // Get the first parent via Parent edge
                        const parentEdges: IExecutionEdge[] = this.getIncomingEdges(currentId).filter(e => e.type === ExecutionEdgeType.Parent);
                        currentId = parentEdges.length > 0 ? parentEdges[0].sourceId : undefined;
                }

                return chain;
        }

        getRecentNodes(limit: number, filter?: IExecutionNodeFilter): IExecutionNode[] {
                let nodes: IExecutionNode[];

                if (filter) {
                        nodes = Array.from(this._nodes.values()).filter(n => this._matchesFilter(n, filter));
                } else {
                        nodes = Array.from(this._nodes.values());
                }

                // Sort by createdAt descending (most recent first)
                nodes.sort((a, b) => b.createdAt - a.createdAt);
                return nodes.slice(0, limit);
        }

        getNodesByFile(uri: URI): IExecutionNode[] {
                const key = uri.toString();
                const nodeIds = this._fileIndex.get(key);
                if (!nodeIds) { return []; }
                return Array.from(nodeIds).map(id => this._nodes.get(id)!).filter(Boolean);
        }

        getNodesByScope(scopeId: string): IExecutionNode[] {
                const nodeIds = this._scopeIndex.get(scopeId);
                if (!nodeIds) { return []; }
                return Array.from(nodeIds).map(id => this._nodes.get(id)!).filter(Boolean);
        }

        getRollbackChain(nodeId: string): IExecutionNode[] {
                const chain: IExecutionNode[] = [];
                const visited = new Set<string>();
                let currentId: string | undefined = nodeId;

                while (currentId && !visited.has(currentId)) {
                        visited.add(currentId);
                        const node = this._nodes.get(currentId);
                        if (node && node.rolledBack) {
                                // Find the RollbackOf edge pointing to this node
                                const rollbackEdges = this.getIncomingEdges(currentId).filter(e => e.type === ExecutionEdgeType.RollbackOf);
                                for (const edge of rollbackEdges) {
                                        const rollbackNode = this._nodes.get(edge.sourceId);
                                        if (rollbackNode) {
                                                chain.push(rollbackNode);
                                                currentId = rollbackNode.id;
                                        }
                                }
                                if (rollbackEdges.length === 0) {
                                        break;
                                }
                        } else {
                                break;
                        }
                }

                return chain;
        }

        // ─── Persistence ────────────────────────────────────────────────────────────

        async flush(): Promise<void> {
                if (this._dirtyNodes.size === 0 && this._dirtyEdges.size === 0) {
                        return; // Nothing to flush
                }

                try {
                        const graphDir = this._getGraphDir();

                        // Ensure directory exists
                        await this.fileService.createFolder(URI.file(graphDir));

                        // Append dirty nodes as JSONL
                        if (this._dirtyNodes.size > 0) {
                                const lines: string[] = [];
                                for (const nodeId of this._dirtyNodes) {
                                        const node = this._nodes.get(nodeId);
                                        if (node) {
                                                lines.push(JSON.stringify(this._serializeNode(node)));
                                        }
                                }
                                if (lines.length > 0) {
                                        const nodesFile = URI.file(this._joinPath(graphDir, NODES_FILE));
                                        const existing = await this._readFileContent(nodesFile);
                                        await this.fileService.writeFile(nodesFile, this._encodeString(existing + lines.join('\n') + '\n'));
                                }
                                this._dirtyNodes.clear();
                        }

                        // Append dirty edges as JSONL
                        if (this._dirtyEdges.size > 0) {
                                const lines: string[] = [];
                                for (const edgeId of this._dirtyEdges) {
                                        const edge = this._edges.get(edgeId);
                                        if (edge) {
                                                lines.push(JSON.stringify(this._serializeEdge(edge)));
                                        }
                                }
                                if (lines.length > 0) {
                                        const edgesFile = URI.file(this._joinPath(graphDir, EDGES_FILE));
                                        const existing = await this._readFileContent(edgesFile);
                                        await this.fileService.writeFile(edgesFile, this._encodeString(existing + lines.join('\n') + '\n'));
                                }
                                this._dirtyEdges.clear();
                        }

                        this.logService.trace(`[Construct ExecutionGraphService] Flushed to disk`);
                } catch (err) {
                        this.logService.error('[Construct ExecutionGraphService] Flush failed:', err);
                }
        }

        // ─── Private: Cycle Detection ───────────────────────────────────────────────

        /**
         * BFS cycle prevention — preserved exactly from Real-construct.
         * Check if adding an edge from sourceId → targetId would create a cycle.
         * A cycle would exist if targetId is already an ancestor of sourceId.
         * We do a BFS from sourceId following incoming Parent/CausedBy/Triggered/DerivedFrom edges.
         */
        private _wouldCreateCycle(sourceId: string, targetId: string): boolean {
                // Self-loop is always a cycle
                if (sourceId === targetId) {
                        return true;
                }

                // BFS: can we reach targetId by walking UP from sourceId?
                const visited = new Set<string>();
                const queue: string[] = [sourceId];

                while (queue.length > 0) {
                        const currentId = queue.shift()!;
                        if (currentId === targetId) {
                                return true; // Cycle detected
                        }
                        if (visited.has(currentId)) {
                                continue;
                        }
                        visited.add(currentId);

                        // Walk up via incoming edges (any type that implies ancestry)
                        const incomingEdgeIds = this._incomingEdges.get(currentId);
                        if (incomingEdgeIds) {
                                for (const edgeId of incomingEdgeIds) {
                                        const edge = this._edges.get(edgeId);
                                        if (edge && (
                                                edge.type === ExecutionEdgeType.Parent ||
                                                edge.type === ExecutionEdgeType.CausedBy ||
                                                edge.type === ExecutionEdgeType.Triggered ||
                                                edge.type === ExecutionEdgeType.DerivedFrom
                                        )) {
                                                queue.push(edge.sourceId);
                                        }
                                }
                        }
                }

                return false;
        }

        // ─── Private: Filter Matching ───────────────────────────────────────────────

        private _matchesFilter(node: IExecutionNode, filter: IExecutionNodeFilter): boolean {
                if (filter.type !== undefined && node.type !== filter.type) { return false; }
                if (filter.mutationSource !== undefined && node.mutationSource !== filter.mutationSource) { return false; }
                if (filter.fileUri !== undefined) {
                        const key = filter.fileUri.toString();
                        const matches = node.fileUri?.toString() === key || node.additionalFileUris.some(u => u.toString() === key);
                        if (!matches) { return false; }
                }
                if (filter.scopeId !== undefined && node.scopeId !== filter.scopeId) { return false; }
                if (filter.trusted !== undefined && node.trusted !== filter.trusted) { return false; }
                if (filter.rolledBack !== undefined && node.rolledBack !== filter.rolledBack) { return false; }
                if (filter.pending !== undefined && node.pending !== filter.pending) { return false; }
                if (filter.createdAfter !== undefined && node.createdAt < filter.createdAfter) { return false; }
                if (filter.createdBefore !== undefined && node.createdAt > filter.createdBefore) { return false; }
                return true;
        }

        // ─── Private: Memory Pruning ────────────────────────────────────────────────

        private _pruneMemoryCache(): void {
                if (this._nodes.size <= MAX_MEMORY_NODES) {
                        return;
                }

                const cutoff = Date.now() - PRUNE_AGE_MS;
                let pruned = 0;

                for (const [id, node] of this._nodes) {
                        if (!node.pending && !node.rolledBack && node.completedAt !== undefined && node.completedAt < cutoff) {
                                this._removeNodeFromIndexes(node);
                                this._nodes.delete(id);
                                pruned++;
                                if (this._nodes.size <= MAX_MEMORY_NODES * 0.8) {
                                        break;
                                }
                        }
                }

                if (pruned > 0) {
                        this.logService.info(`[Construct ExecutionGraphService] Pruned ${pruned} nodes from memory cache`);
                }
        }

        private _removeNodeFromIndexes(node: IExecutionNode): void {
                if (node.fileUri) {
                        const set = this._fileIndex.get(node.fileUri.toString());
                        set?.delete(node.id);
                }
                for (const uri of node.additionalFileUris) {
                        const set = this._fileIndex.get(uri.toString());
                        set?.delete(node.id);
                }
                if (node.scopeId) {
                        const set = this._scopeIndex.get(node.scopeId);
                        set?.delete(node.id);
                }
                const idx = this._temporalOrder.indexOf(node.id);
                if (idx >= 0) {
                        this._temporalOrder.splice(idx, 1);
                }
        }

        // ─── Private: Serialization ─────────────────────────────────────────────────

        private _serializeNode(node: IExecutionNode): object {
                return {
                        id: node.id,
                        type: node.type,
                        label: node.label,
                        createdAt: node.createdAt,
                        completedAt: node.completedAt,
                        mutationSource: node.mutationSource,
                        trusted: node.trusted,
                        description: node.description,
                        fileUri: node.fileUri?.toString(),
                        additionalFileUris: node.additionalFileUris.map(u => u.toString()),
                        success: node.success,
                        error: node.error,
                        pending: node.pending,
                        beforeChecksum: node.beforeChecksum,
                        afterChecksum: node.afterChecksum,
                        editCount: node.editCount,
                        reversible: node.reversible,
                        rollbackStrategy: node.rollbackStrategy,
                        snapshotReference: node.snapshotReference,
                        inverseOperationReference: node.inverseOperationReference,
                        rolledBack: node.rolledBack,
                        rolledBackBy: node.rolledBackBy,
                        scopeId: node.scopeId,
                };
        }

        private _serializeEdge(edge: IExecutionEdge): object {
                return {
                        id: edge.id,
                        sourceId: edge.sourceId,
                        targetId: edge.targetId,
                        type: edge.type,
                        createdAt: edge.createdAt,
                        metadata: edge.metadata,
                };
        }

        private _deserializeNode(data: any): IExecutionNode {
                return {
                        id: data.id,
                        type: data.type as ExecutionNodeType,
                        label: data.label,
                        createdAt: data.createdAt,
                        completedAt: data.completedAt,
                        mutationSource: data.mutationSource as AIMutationSource,
                        trusted: data.trusted,
                        description: data.description,
                        fileUri: data.fileUri ? URI.parse(data.fileUri) : undefined,
                        additionalFileUris: (data.additionalFileUris ?? []).map((u: string) => URI.parse(u)),
                        success: data.success,
                        error: data.error,
                        pending: data.pending,
                        beforeChecksum: data.beforeChecksum,
                        afterChecksum: data.afterChecksum,
                        editCount: data.editCount,
                        reversible: data.reversible,
                        rollbackStrategy: data.rollbackStrategy as RollbackStrategy,
                        snapshotReference: data.snapshotReference,
                        inverseOperationReference: data.inverseOperationReference,
                        rolledBack: data.rolledBack,
                        rolledBackBy: data.rolledBackBy,
                        scopeId: data.scopeId,
                };
        }

        private _deserializeEdge(data: any): IExecutionEdge {
                return {
                        id: data.id,
                        sourceId: data.sourceId,
                        targetId: data.targetId,
                        type: data.type as ExecutionEdgeType,
                        createdAt: data.createdAt,
                        metadata: data.metadata,
                };
        }

        // ─── Private: File I/O Helpers ──────────────────────────────────────────────

        private _getGraphDir(): string {
                return this._joinPath(this.environmentService.userRoamingDataHome.fsPath, GRAPH_DIR);
        }

        private _joinPath(...segments: string[]): string {
                return segments.join('/');
        }

        private async _readFileContent(uri: URI): Promise<string> {
                try {
                        const content = await this.fileService.readFile(uri);
                        return content.value.toString();
                } catch {
                        return ''; // File doesn't exist yet
                }
        }

        private _encodeString(content: string): VSBuffer {
                return VSBuffer.fromString(content);
        }

        private async _loadFromDisk(): Promise<void> {
                const graphDir = this._getGraphDir();

                // Load nodes
                const nodesContent = await this._readFileContent(URI.file(this._joinPath(graphDir, NODES_FILE)));
                if (nodesContent) {
                        for (const line of nodesContent.split('\n')) {
                                if (line.trim()) {
                                        try {
                                                const node = this._deserializeNode(JSON.parse(line));
                                                this._nodes.set(node.id, node);
                                                this._rebuildIndexesForNode(node);
                                        } catch (err) {
                                                this.logService.warn('[Construct ExecutionGraphService] Failed to parse node:', err);
                                        }
                                }
                        }
                }

                // Load edges
                const edgesContent = await this._readFileContent(URI.file(this._joinPath(graphDir, EDGES_FILE)));
                if (edgesContent) {
                        for (const line of edgesContent.split('\n')) {
                                if (line.trim()) {
                                        try {
                                                const edge = this._deserializeEdge(JSON.parse(line));
                                                this._edges.set(edge.id, edge);
                                                this._rebuildIndexesForEdge(edge);
                                        } catch (err) {
                                                this.logService.warn('[Construct ExecutionGraphService] Failed to parse edge:', err);
                                        }
                                }
                        }
                }

                // Load scopes
                const scopesContent = await this._readFileContent(URI.file(this._joinPath(graphDir, SCOPES_FILE)));
                if (scopesContent) {
                        for (const line of scopesContent.split('\n')) {
                                if (line.trim()) {
                                        try {
                                                const scope = JSON.parse(line);
                                                this._scopes.set(scope.id, scope);
                                                // Don't restore active scope on reload
                                        } catch (err) {
                                                this.logService.warn('[Construct ExecutionGraphService] Failed to parse scope:', err);
                                        }
                                }
                        }
                }

                this.logService.info(`[Construct ExecutionGraphService] Loaded ${this._nodes.size} nodes, ${this._edges.size} edges, ${this._scopes.size} scopes from disk`);
        }

        private _rebuildIndexesForNode(node: IExecutionNode): void {
                if (node.fileUri) {
                        let set = this._fileIndex.get(node.fileUri.toString());
                        if (!set) { set = new Set(); this._fileIndex.set(node.fileUri.toString(), set); }
                        set.add(node.id);
                }
                for (const uri of node.additionalFileUris) {
                        let set = this._fileIndex.get(uri.toString());
                        if (!set) { set = new Set(); this._fileIndex.set(uri.toString(), set); }
                        set.add(node.id);
                }
                if (node.scopeId) {
                        let set = this._scopeIndex.get(node.scopeId);
                        if (!set) { set = new Set(); this._scopeIndex.set(node.scopeId, set); }
                        set.add(node.id);
                }
                this._temporalOrder.push(node.id);
        }

        private _rebuildIndexesForEdge(edge: IExecutionEdge): void {
                let outSet = this._outgoingEdges.get(edge.sourceId);
                if (!outSet) { outSet = new Set(); this._outgoingEdges.set(edge.sourceId, outSet); }
                outSet.add(edge.id);

                let inSet = this._incomingEdges.get(edge.targetId);
                if (!inSet) { inSet = new Set(); this._incomingEdges.set(edge.targetId, inSet); }
                inSet.add(edge.id);
        }

        // ─── Lifecycle ──────────────────────────────────────────────────────────────

        override dispose(): void {
                if (this._flushTimer) {
                        clearInterval(this._flushTimer);
                }
                // Final flush before dispose
                this.flush().catch(err => {
                        this.logService.error('[Construct ExecutionGraphService] Final flush failed:', err);
                });
                super.dispose();
                this.logService.trace('[Construct ExecutionGraphService] Disposed');
        }
}
