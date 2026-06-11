/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Razisafir. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConstructProjectService } from '../../../../../../platform/construct/common/project/constructProjectService.js';
import { IKovixProject, IProjectCreationInput, PROJECT_CONFIG_FILENAME, GLOBAL_PROJECT_REGISTRY_FILENAME, IProjectRegistryEntry } from '../../../../../../platform/construct/common/project/constructProjectTypes.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../../../../../platform/environment/common/environment.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';

/**
 * Shape of the global project registry file stored at ~/.kovix/projects.json
 */
interface IGlobalProjectRegistry {
        version: number;
        projects: IProjectRegistryEntry[];
}

/**
 * Browser-side implementation of IConstructProjectService.
 *
 * Manages Kovix project lifecycle: creation, persistence, status transitions,
 * and global registry coordination. Uses IFileService for all I/O so the
 * implementation works in both browser and electron environments.
 *
 * Registration: registerSingleton(IConstructProjectService, ConstructProjectService, InstantiationType.Delayed)
 */
export class ConstructProjectService extends Disposable implements IConstructProjectService {

        declare readonly _serviceBrand: undefined;

        // --- Active project state ---------------------------------------------------

        private _activeProject: IKovixProject | null = null;

        // --- Events -----------------------------------------------------------------

        private readonly _onDidCreateProject = this._register(new Emitter<IKovixProject>());
        readonly onDidCreateProject = this._onDidCreateProject.event;

        private readonly _onDidChangeActiveProject = this._register(new Emitter<IKovixProject | null>());
        readonly onDidChangeActiveProject = this._onDidChangeActiveProject.event;

        // --- Construction -----------------------------------------------------------

        constructor(
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ILogService private readonly logService: ILogService,
                @IEnvironmentService private readonly environmentService: IEnvironmentService,
        ) {
                super();
                this._initialize();
        }

        /**
         * Auto-load the project associated with the current workspace root (if any).
         * Runs asynchronously after construction — callers should not rely on
         * getActiveProject() being populated synchronously after `new`.
         */
        private async _initialize(): Promise<void> {
                try {
                        const workspace = this.workspaceContextService.getWorkspace();
                        if (workspace.folders.length > 0) {
                                const workspacePath = workspace.folders[0].uri.fsPath;
                                const project = await this._readProjectFromDisk(workspacePath);
                                if (project) {
                                        this._activeProject = project;
                                        this._onDidChangeActiveProject.fire(project);
                                        this.logService.info('[ConstructProjectService] Auto-loaded project:', project.name);
                                }
                        }
                } catch (error) {
                        this.logService.error('[ConstructProjectService] Failed to auto-load project', error);
                }
        }

        // --- URI helpers ------------------------------------------------------------

        private getProjectConfigUri(workspacePath: string): URI {
                const segments = PROJECT_CONFIG_FILENAME.split('/');
                return URI.joinPath(URI.file(workspacePath), ...segments);
        }

        private getConstructDirUri(workspacePath: string): URI {
                return URI.joinPath(URI.file(workspacePath), '.construct');
        }

        private getGlobalRegistryUri(): URI {
                const segments = GLOBAL_PROJECT_REGISTRY_FILENAME.split('/');
                return URI.joinPath((this.environmentService as INativeEnvironmentService).userHome, ...segments);
        }

        private getKovixDirUri(): URI {
                return URI.joinPath((this.environmentService as INativeEnvironmentService).userHome, '.kovix');
        }

        // --- Low-level disk helpers -------------------------------------------------

        /**
         * Read and parse the project config file from a workspace directory.
         * Returns null when the file does not exist or cannot be parsed.
         */
        private async _readProjectFromDisk(workspacePath: string): Promise<IKovixProject | null> {
                try {
                        const uri = this.getProjectConfigUri(workspacePath);
                        const content = await this.fileService.readFile(uri);
                        return JSON.parse(content.value.toString()) as IKovixProject;
                } catch {
                        return null;
                }
        }

        /**
         * Ensure a directory exists, creating it (and parents) when necessary.
         */
        private async _ensureDir(dirUri: URI): Promise<void> {
                if (!(await this.fileService.exists(dirUri))) {
                        await this.fileService.createFolder(dirUri);
                }
        }

        /**
         * Read the global project registry from disk. Returns an empty registry
         * when the file does not exist or cannot be parsed.
         */
        private async _readGlobalRegistry(): Promise<IGlobalProjectRegistry> {
                try {
                        const uri = this.getGlobalRegistryUri();
                        const content = await this.fileService.readFile(uri);
                        return JSON.parse(content.value.toString()) as IGlobalProjectRegistry;
                } catch {
                        return { version: 1, projects: [] };
                }
        }

        /**
         * Persist the global project registry to disk, creating the ~/.kovix
         * directory if it does not exist yet.
         */
        private async _writeGlobalRegistry(registry: IGlobalProjectRegistry): Promise<void> {
                await this._ensureDir(this.getKovixDirUri());
                const uri = this.getGlobalRegistryUri();
                await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(registry, null, 2)));
        }

        /**
         * Upsert a registry entry for the given project.
         */
        private async _upsertRegistryEntry(project: IKovixProject): Promise<void> {
                const registry = await this._readGlobalRegistry();

                const entry: IProjectRegistryEntry = {
                        id: project.id,
                        name: project.name,
                        workspacePath: project.workspacePath,
                        status: project.status,
                        updatedAt: project.updatedAt,
                };

                const existingIndex = registry.projects.findIndex(p => p.id === project.id);
                if (existingIndex >= 0) {
                        registry.projects[existingIndex] = entry;
                } else {
                        registry.projects.push(entry);
                }

                await this._writeGlobalRegistry(registry);
        }

        /**
         * Locate a project by ID. Checks the in-memory active project first,
         * then falls back to searching the global registry.
         */
        private async _findProjectById(projectId: string): Promise<IKovixProject | null> {
                // Fast-path: already in memory
                if (this._activeProject?.id === projectId) {
                        return this._activeProject;
                }

                // Fall back to global registry
                const registry = await this._readGlobalRegistry();
                const entry = registry.projects.find(p => p.id === projectId);
                if (entry) {
                        return await this._readProjectFromDisk(entry.workspacePath);
                }

                return null;
        }

        // --- Public API: IConstructProjectService ------------------------------------

        async createProject(input: IProjectCreationInput, workspacePath: string): Promise<IKovixProject> {
                const now = Date.now();
                const project: IKovixProject = {
                        id: crypto.randomUUID(),
                        name: input.name,
                        description: input.description,
                        techStack: input.techStack,
                        goals: input.goals,
                        createdAt: now,
                        updatedAt: now,
                        workspacePath,
                        sessionIds: [],
                        status: 'active',
                };

                // Persist project file
                await this._ensureDir(this.getConstructDirUri(workspacePath));
                const projectConfigUri = this.getProjectConfigUri(workspacePath);
                await this.fileService.writeFile(projectConfigUri, VSBuffer.fromString(JSON.stringify(project, null, 2)));

                // Register globally
                await this._upsertRegistryEntry(project);

                // Activate
                this._activeProject = project;
                this._onDidCreateProject.fire(project);
                this._onDidChangeActiveProject.fire(project);

                this.logService.info('[ConstructProjectService] Created project:', project.name);
                return project;
        }

        async loadProject(workspacePath: string): Promise<IKovixProject | null> {
                const project = await this._readProjectFromDisk(workspacePath);
                if (project) {
                        this._activeProject = project;
                        this._onDidChangeActiveProject.fire(project);
                        this.logService.info('[ConstructProjectService] Loaded project:', project.name);
                } else {
                        this.logService.info('[ConstructProjectService] No project found at workspace:', workspacePath);
                }
                return project;
        }

        async saveProject(project: IKovixProject): Promise<void> {
                project.updatedAt = Date.now();

                // Persist to workspace
                await this._ensureDir(this.getConstructDirUri(project.workspacePath));
                const projectConfigUri = this.getProjectConfigUri(project.workspacePath);
                await this.fileService.writeFile(projectConfigUri, VSBuffer.fromString(JSON.stringify(project, null, 2)));

                // Update global registry entry
                await this._upsertRegistryEntry(project);

                // Keep in-memory active project reference in sync
                if (this._activeProject?.id === project.id) {
                        this._activeProject = project;
                }

                this.logService.info('[ConstructProjectService] Saved project:', project.name);
        }

        getActiveProject(): IKovixProject | null {
                return this._activeProject;
        }

        async listAllProjects(): Promise<IKovixProject[]> {
                const registry = await this._readGlobalRegistry();
                if (registry.projects.length === 0) {
                        return [];
                }

                const projects: IKovixProject[] = [];
                const validEntries: IProjectRegistryEntry[] = [];
                let needsCleanup = false;

                for (const entry of registry.projects) {
                        try {
                                const project = await this._readProjectFromDisk(entry.workspacePath);
                                if (project) {
                                        projects.push(project);
                                        validEntries.push(entry);
                                } else {
                                        needsCleanup = true;
                                        this.logService.warn(
                                                `[ConstructProjectService] Project file missing for "${entry.name}" at ${entry.workspacePath}, removing from registry`
                                        );
                                }
                        } catch (error) {
                                needsCleanup = true;
                                this.logService.warn(
                                        `[ConstructProjectService] Failed to load project "${entry.name}" at ${entry.workspacePath}, removing from registry`,
                                        error
                                );
                        }
                }

                // Clean up stale entries from the global registry
                if (needsCleanup) {
                        registry.projects = validEntries;
                        await this._writeGlobalRegistry(registry);
                }

                return projects;
        }

        async updateProjectStatus(projectId: string, status: IKovixProject['status']): Promise<void> {
                const project = await this._findProjectById(projectId);
                if (!project) {
                        throw new Error(`[ConstructProjectService] Project not found: ${projectId}`);
                }

                project.status = status;
                await this.saveProject(project);

                if (this._activeProject?.id === projectId) {
                        this._onDidChangeActiveProject.fire(this._activeProject);
                }

                this.logService.info(`[ConstructProjectService] Updated project status to "${status}" for: ${project.name}`);
        }

        async storeRefinedIdea(projectId: string, refinedIdea: string): Promise<void> {
                const project = await this._findProjectById(projectId);
                if (!project) {
                        throw new Error(`[ConstructProjectService] Project not found: ${projectId}`);
                }

                project.lastIdeaRefinement = refinedIdea;
                await this.saveProject(project);
                this.logService.info('[ConstructProjectService] Stored refined idea for project:', project.name);
        }

        async storePlan(projectId: string, planJson: string): Promise<void> {
                const project = await this._findProjectById(projectId);
                if (!project) {
                        throw new Error(`[ConstructProjectService] Project not found: ${projectId}`);
                }

                project.lastPlan = planJson;
                await this.saveProject(project);
                this.logService.info('[ConstructProjectService] Stored plan for project:', project.name);
        }
}
