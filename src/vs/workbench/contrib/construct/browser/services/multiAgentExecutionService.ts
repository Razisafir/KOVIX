/*---------------------------------------------------------------------------------------------
 *  AI Execution Kernel - Multi-Agent Task Coordination Implementation
 *  Construct IDE - AI-Native IDE
 *
 *  MultiAgentExecutionService - Concrete implementation of IMultiAgentExecutionService.
 *  Manages task assignment, inter-agent handoffs, conflict detection/resolution,
 *  shared memory, and task routing across multiple agent roles.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import {
        IMultiAgentExecutionService,
        AgentRole,
        AgentTask,
        AgentHandoff,
        AgentConflict,
        SharedMemory,
} from '../../../../../platform/construct/common/multiAgentExecution.js';


// --- Storage Keys ---

const STORAGE_KEY_TASKS = 'construct.multiAgent.tasks';
const STORAGE_KEY_HANDOFFS = 'construct.multiAgent.handoffs';
const STORAGE_KEY_SHARED_MEMORY = 'construct.multiAgent.sharedMemory';
const STORAGE_KEY_CONFLICTS = 'construct.multiAgent.conflicts';

// --- File path extraction pattern ---

const FILE_PATH_PATTERN = /(?:^|\s|["'`])([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)(?:["'`]|$|\s)/g;

// --- Implementation ---

export class MultiAgentExecutionService extends Disposable implements IMultiAgentExecutionService {

        declare readonly _serviceBrand: undefined;

        // --- Internal State ---

        private readonly _tasks = new Map<string, AgentTask>();
        private readonly _handoffs: AgentHandoff[] = [];
        private readonly _conflicts: AgentConflict[] = [];
        private readonly _sharedMemory = new Map<string, SharedMemory>();

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
        ) {
                super();
                this._loadState();
                this.logService.trace('[MultiAgentExecutionService] Initialized');
        }

        // --- Task Management ---

        assignTask(role: AgentRole, description: string, input: string): AgentTask {
                const task: AgentTask = {
                        id: generateUuid(),
                        role,
                        description,
                        input,
                        status: 'pending',
                        assignedAt: Date.now(),
                };

                        // Credit tracking removed for MVP

                this._tasks.set(task.id, task);
                this._persistState();
                this.logService.trace(`[MultiAgentExecutionService] Task assigned: ${task.id} to role=${role}`);
                return task;
        }

        getTask(taskId: string): AgentTask | undefined {
                return this._tasks.get(taskId);
        }

        completeTask(taskId: string, result: string): boolean {
                const task = this._tasks.get(taskId);
                if (!task) {
                        this.logService.warn(`[MultiAgentExecutionService] completeTask: task ${taskId} not found`);
                        return false;
                }
                if (task.status !== 'pending' && task.status !== 'running') {
                        this.logService.warn(`[MultiAgentExecutionService] completeTask: task ${taskId} in status ${task.status}, cannot complete`);
                        return false;
                }
                task.status = 'completed';
                task.result = result;
                task.completedAt = Date.now();
                this._tasks.set(taskId, task);
                this._persistState();
                this.logService.trace(`[MultiAgentExecutionService] Task completed: ${taskId}`);
                return true;
        }

        failTask(taskId: string, error: string): boolean {
                const task = this._tasks.get(taskId);
                if (!task) {
                        this.logService.warn(`[MultiAgentExecutionService] failTask: task ${taskId} not found`);
                        return false;
                }
                if (task.status !== 'pending' && task.status !== 'running') {
                        this.logService.warn(`[MultiAgentExecutionService] failTask: task ${taskId} in status ${task.status}, cannot fail`);
                        return false;
                }
                task.status = 'failed';
                task.error = error;
                task.completedAt = Date.now();
                this._tasks.set(taskId, task);
                this._persistState();
                this.logService.trace(`[MultiAgentExecutionService] Task failed: ${taskId}`);
                return true;
        }

        // --- Handoff Management ---

        createHandoff(fromRole: AgentRole, toRole: AgentRole, taskId: string, summary: string, context: string): AgentHandoff {
                if (fromRole === toRole) {
                        this.logService.warn(`[MultiAgentExecutionService] createHandoff: fromRole and toRole are the same (${fromRole})`);
                }

                const task = this._tasks.get(taskId);
                if (!task) {
                        this.logService.warn(`[MultiAgentExecutionService] createHandoff: task ${taskId} not found`);
                }

                // Extract artifacts from the task result if available
                const artifacts: string[] = [];
                if (task?.result) {
                        const filePaths = this._extractFilePaths(task.result);
                        artifacts.push(...filePaths);
                }
                // Also extract file paths from the context string
                const contextPaths = this._extractFilePaths(context);
                for (const p of contextPaths) {
                        if (!artifacts.includes(p)) {
                                artifacts.push(p);
                        }
                }

                const handoff: AgentHandoff = {
                        fromRole,
                        toRole,
                        taskId,
                        summary,
                        context,
                        artifacts,
                };

                this._handoffs.push(handoff);
                this._persistState();
                this.logService.trace(`[MultiAgentExecutionService] Handoff created: ${fromRole} -> ${toRole} for task ${taskId}`);
                return handoff;
        }

        // --- Conflict Detection ---

        detectConflicts(tasks: AgentTask[]): AgentConflict[] {
                const conflicts: AgentConflict[] = [];
                const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'running');

                // Build a map of file paths to the tasks that touch them
                const fileToTasks = new Map<string, AgentTask[]>();
                for (const task of activeTasks) {
                        const paths = this._extractFilePaths(task.description + ' ' + task.input);
                        for (const p of paths) {
                                const existing = fileToTasks.get(p);
                                if (existing) {
                                        existing.push(task);
                                } else {
                                        fileToTasks.set(p, [task]);
                                }
                        }
                }

                // Detect file_edit conflicts: multiple tasks modifying the same file
                for (const [filePath, taskList] of fileToTasks) {
                        if (taskList.length > 1) {
                                conflicts.push({
                                        type: 'file_edit',
                                        description: `Multiple tasks target the same file: ${filePath}`,
                                        conflictingTasks: taskList.map(t => t.id),
                                        resolution: 'queue',
                                });
                        }
                }

                // Detect resource conflicts: tasks that depend on overlapping resources
                const resourceMap = new Map<string, AgentTask[]>();
                for (const task of activeTasks) {
                        const resources = this._extractResources(task.description + ' ' + task.input);
                        for (const r of resources) {
                                const existing = resourceMap.get(r);
                                if (existing) {
                                        existing.push(task);
                                } else {
                                        resourceMap.set(r, [task]);
                                }
                        }
                }
                for (const [resource, taskList] of resourceMap) {
                        if (taskList.length > 1) {
                                const alreadyTracked = conflicts.some(c =>
                                        c.type === 'resource' &&
                                        c.conflictingTasks.length === taskList.length &&
                                        c.conflictingTasks.every(id => taskList.some(t => t.id === id))
                                );
                                if (!alreadyTracked) {
                                        conflicts.push({
                                                type: 'resource',
                                                description: `Multiple tasks depend on the same resource: ${resource}`,
                                                conflictingTasks: taskList.map(t => t.id),
                                                resolution: 'merge',
                                        });
                                }
                        }
                }

                // Detect dependency conflicts: tasks with overlapping scope (same role + overlapping time)
                const roleTasks = new Map<AgentRole, AgentTask[]>();
                for (const task of activeTasks) {
                        const existing = roleTasks.get(task.role);
                        if (existing) {
                                existing.push(task);
                        } else {
                                roleTasks.set(task.role, [task]);
                        }
                }
                for (const [role, taskList] of roleTasks) {
                        if (taskList.length > 1) {
                                // Check for overlapping assignment windows
                                for (let i = 0; i < taskList.length; i++) {
                                        for (let j = i + 1; j < taskList.length; j++) {
                                                const a = taskList[i];
                                                const b = taskList[j];
                                                if (this._tasksOverlap(a, b)) {
                                                        const alreadyTracked = conflicts.some(c =>
                                                                c.type === 'dependency' &&
                                                                c.conflictingTasks.includes(a.id) &&
                                                                c.conflictingTasks.includes(b.id)
                                                        );
                                                        if (!alreadyTracked) {
                                                                conflicts.push({
                                                                        type: 'dependency',
                                                                        description: `Overlapping tasks for role ${role}: ${a.description} and ${b.description}`,
                                                                        conflictingTasks: [a.id, b.id],
                                                                        resolution: 'override',
                                                                });
                                                        }
                                                }
                                        }
                                }
                        }
                }

                return conflicts;
        }

        // --- Conflict Resolution ---

        resolveConflict(conflict: AgentConflict): 'queued' | 'resolved' | 'escalated' {
                switch (conflict.type) {
                        case 'file_edit': {
                                // Queue the second task after the first
                                const taskIds = conflict.conflictingTasks;
                                if (taskIds.length >= 2) {
                                        const firstTask = this._tasks.get(taskIds[0]);
                                        const secondTask = this._tasks.get(taskIds[1]);
                                        if (firstTask && secondTask) {
                                                // Keep the first task running, set the second to pending
                                                if (secondTask.status === 'running') {
                                                        // Cannot easily queue a running task, escalate
                                                        this._trackConflict(conflict);
                                                        this.logService.warn(`[MultiAgentExecutionService] Cannot queue running task ${secondTask.id}, escalating`);
                                                        return 'escalated';
                                                }
                                                this.logService.trace(`[MultiAgentExecutionService] Queued task ${secondTask.id} behind ${firstTask.id}`);
                                        }
                                }
                                this._trackConflict(conflict);
                                return 'queued';
                        }
                        case 'resource': {
                                // Attempt to merge: if tasks have compatible roles, they can share the resource
                                const taskIds = conflict.conflictingTasks;
                                const tasks = taskIds.map(id => this._tasks.get(id)).filter((t): t is AgentTask => t !== undefined);
                                const roles = new Set(tasks.map(t => t.role));
                                if (roles.size === 1) {
                                        // Same role competing for resource: queue
                                        this._trackConflict(conflict);
                                        return 'queued';
                                }
                                // Different roles: attempt merge (mark resolved)
                                this._removeTrackedConflict(conflict);
                                this.logService.trace(`[MultiAgentExecutionService] Resolved resource conflict via merge for tasks: ${taskIds.join(', ')}`);
                                return 'resolved';
                        }
                        case 'dependency': {
                                // Override: latest writer wins
                                const taskIds = conflict.conflictingTasks;
                                const tasks = taskIds.map(id => this._tasks.get(id)).filter((t): t is AgentTask => t !== undefined);
                                if (tasks.length >= 2) {
                                        // Sort by assignedAt descending, keep the latest
                                        const sorted = tasks.sort((a, b) => (b.assignedAt ?? 0) - (a.assignedAt ?? 0));
                                        // The latest task takes precedence; the earlier one can be noted
                                        this.logService.trace(`[MultiAgentExecutionService] Override: task ${sorted[0].id} takes precedence over ${sorted[1].id}`);
                                }
                                this._removeTrackedConflict(conflict);
                                return 'resolved';
                        }
                        default: {
                                this._trackConflict(conflict);
                                this.logService.warn(`[MultiAgentExecutionService] Unknown conflict type, escalating`);
                                return 'escalated';
                        }
                }
        }

        // --- Shared Memory ---

        writeSharedMemory(key: string, value: string, role: AgentRole): void {
                const existing = this._sharedMemory.get(key);
                const entry: SharedMemory = {
                        key,
                        value,
                        writtenBy: role,
                        writtenAt: Date.now(),
                        readBy: existing?.readBy ?? [],
                };
                this._sharedMemory.set(key, entry);
                this._persistState();
                this.logService.trace(`[MultiAgentExecutionService] Shared memory written: key=${key} by role=${role}`);
        }

        readSharedMemory(key: string, role: AgentRole): SharedMemory | undefined {
                const entry = this._sharedMemory.get(key);
                if (!entry) {
                        return undefined;
                }
                // Track which roles have read this entry
                if (!entry.readBy.includes(role)) {
                        entry.readBy.push(role);
                        this._sharedMemory.set(key, entry);
                        this._persistState();
                }
                return entry;
        }

        // --- Task Routing ---

        routeTask(description: string): AgentRole {
                const lower = description.toLowerCase();

                // Check for planning keywords
                if (/\b(plan|design|architect|strategy|roadmap|outline|scope|decompose)\b/.test(lower)) {
                        return AgentRole.Planner;
                }

                // Check for coding keywords
                if (/\b(code|implement|write|edit|create|build|develop|refactor|modify|update)\b/.test(lower)) {
                        return AgentRole.Coder;
                }

                // Check for verification keywords
                if (/\b(verify|test|check|validate|review|audit|inspect|assert|confirm)\b/.test(lower)) {
                        return AgentRole.Verifier;
                }

                // Check for repair keywords
                if (/\b(fix|repair|debug|resolve|patch|correct|remediate|troubleshoot)\b/.test(lower)) {
                        return AgentRole.Repairer;
                }

                // Check for memory keywords
                if (/\b(memory|context|history|recall|remember|retrieve|store|cache|persist)\b/.test(lower)) {
                        return AgentRole.MemoryManager;
                }

                // Default to Coder
                return AgentRole.Coder;
        }

        // --- Coordination Status ---

        getCoordinationStatus(): { activeTasks: number; pendingHandoffs: number; unresolvedConflicts: number } {
                let activeTasks = 0;
                for (const task of this._tasks.values()) {
                        if (task.status === 'running' || task.status === 'pending') {
                                activeTasks++;
                        }
                }

                // Handoffs that have not been consumed yet (the target task is still pending)
                let pendingHandoffs = 0;
                for (const handoff of this._handoffs) {
                        const targetTask = this._tasks.get(handoff.taskId);
                        if (!targetTask || targetTask.status === 'pending' || targetTask.status === 'running') {
                                pendingHandoffs++;
                        }
                }

                return {
                        activeTasks,
                        pendingHandoffs,
                        unresolvedConflicts: this._conflicts.length,
                };
        }

        // --- Private Helpers ---

        /**
         * Extract file paths from a string using a pattern matcher.
         */
        private _extractFilePaths(text: string): string[] {
                const paths: string[] = [];
                let match: RegExpExecArray | null;
                const pattern = new RegExp(FILE_PATH_PATTERN.source, FILE_PATH_PATTERN.flags);
                while ((match = pattern.exec(text)) !== null) {
                        const candidate = match[1];
                        // Filter out obvious non-file-paths
                        if (!candidate.startsWith('.') || candidate.length > 2) {
                                // Skip things that look like sentence endings or common words
                                const ext = candidate.split('.').pop();
                                if (ext && ext.length >= 2 && ext.length <= 10 && /^[a-zA-Z0-9]+$/.test(ext)) {
                                        paths.push(candidate);
                                }
                        }
                }
                return paths;
        }

        /**
         * Extract resource identifiers from a string.
         * Resources are broader than file paths and include things like
         * database connections, API endpoints, etc.
         */
        private _extractResources(text: string): string[] {
                const resources: string[] = [];

                // Look for explicit resource references
                const resourcePatterns = [
                        /(?:resource|dependency|dep|module|package)\s*[:=]\s*["']?([a-zA-Z0-9_./\-@]+)["']?/gi,
                        /(?:import|require|from)\s+["']([a-zA-Z0-9_./\-@]+)["']/gi,
                ];

                for (const pattern of resourcePatterns) {
                        let match: RegExpExecArray | null;
                        const regex = new RegExp(pattern.source, pattern.flags);
                        while ((match = regex.exec(text)) !== null) {
                                resources.push(match[1]);
                        }
                }

                // Also include file paths as resources
                const filePaths = this._extractFilePaths(text);
                for (const p of filePaths) {
                        if (!resources.includes(p)) {
                                resources.push(p);
                        }
                }

                return resources;
        }

        /**
         * Check if two tasks have overlapping time windows.
         */
        private _tasksOverlap(a: AgentTask, b: AgentTask): boolean {
                const aStart = a.assignedAt ?? 0;
                const aEnd = a.completedAt ?? Infinity;
                const bStart = b.assignedAt ?? 0;
                const bEnd = b.completedAt ?? Infinity;
                return aStart < bEnd && bStart < aEnd;
        }

        /**
         * Track a conflict internally for status reporting.
         */
        private _trackConflict(conflict: AgentConflict): void {
                const alreadyTracked = this._conflicts.some(c =>
                        c.type === conflict.type &&
                        c.description === conflict.description &&
                        c.conflictingTasks.length === conflict.conflictingTasks.length &&
                        c.conflictingTasks.every(id => conflict.conflictingTasks.includes(id))
                );
                if (!alreadyTracked) {
                        this._conflicts.push(conflict);
                        this._persistState();
                }
        }

        /**
         * Remove a tracked conflict once resolved.
         */
        private _removeTrackedConflict(conflict: AgentConflict): void {
                const idx = this._conflicts.findIndex(c =>
                        c.type === conflict.type &&
                        c.description === conflict.description &&
                        c.conflictingTasks.length === conflict.conflictingTasks.length &&
                        c.conflictingTasks.every(id => conflict.conflictingTasks.includes(id))
                );
                if (idx >= 0) {
                        this._conflicts.splice(idx, 1);
                        this._persistState();
                }
        }

        /**
         * Persist the current service state to storage.
         */
        private _persistState(): void {
                try {
                        const taskData: Record<string, AgentTask> = {};
                        for (const [id, task] of this._tasks) {
                                taskData[id] = task;
                        }
                        this.storageService.store(STORAGE_KEY_TASKS, JSON.stringify(taskData), StorageScope.WORKSPACE, StorageTarget.MACHINE);

                        this.storageService.store(STORAGE_KEY_HANDOFFS, JSON.stringify(this._handoffs), StorageScope.WORKSPACE, StorageTarget.MACHINE);

                        const memoryData: Record<string, SharedMemory> = {};
                        for (const [key, entry] of this._sharedMemory) {
                                memoryData[key] = entry;
                        }
                        this.storageService.store(STORAGE_KEY_SHARED_MEMORY, JSON.stringify(memoryData), StorageScope.WORKSPACE, StorageTarget.MACHINE);

                        this.storageService.store(STORAGE_KEY_CONFLICTS, JSON.stringify(this._conflicts), StorageScope.WORKSPACE, StorageTarget.MACHINE);
                } catch (err) {
                        this.logService.error(`[MultiAgentExecutionService] Failed to persist state: ${String(err)}`);
                }
        }

        /**
         * Load previously persisted state from storage.
         */
        private _loadState(): void {
                try {
                        const taskRaw = this.storageService.get(STORAGE_KEY_TASKS, StorageScope.WORKSPACE, undefined);
                        if (taskRaw) {
                                const taskData = JSON.parse(taskRaw) as Record<string, AgentTask>;
                                for (const [id, task] of Object.entries(taskData)) {
                                        this._tasks.set(id, task);
                                }
                        }

                        const handoffRaw = this.storageService.get(STORAGE_KEY_HANDOFFS, StorageScope.WORKSPACE, undefined);
                        if (handoffRaw) {
                                const handoffData = JSON.parse(handoffRaw) as AgentHandoff[];
                                this._handoffs.push(...handoffData);
                        }

                        const memoryRaw = this.storageService.get(STORAGE_KEY_SHARED_MEMORY, StorageScope.WORKSPACE, undefined);
                        if (memoryRaw) {
                                const memoryData = JSON.parse(memoryRaw) as Record<string, SharedMemory>;
                                for (const [key, entry] of Object.entries(memoryData)) {
                                        this._sharedMemory.set(key, entry);
                                }
                        }

                        const conflictRaw = this.storageService.get(STORAGE_KEY_CONFLICTS, StorageScope.WORKSPACE, undefined);
                        if (conflictRaw) {
                                const conflictData = JSON.parse(conflictRaw) as AgentConflict[];
                                this._conflicts.push(...conflictData);
                        }
                } catch (err) {
                        this.logService.error(`[MultiAgentExecutionService] Failed to load state: ${String(err)}`);
                }
        }

        // --- Lifecycle ---

        override dispose(): void {
                this._tasks.clear();
                this._handoffs.length = 0;
                this._conflicts.length = 0;
                this._sharedMemory.clear();
                super.dispose();
        }
}
