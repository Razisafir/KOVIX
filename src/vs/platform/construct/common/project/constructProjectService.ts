/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IKovixProject, IProjectCreationInput } from './constructProjectTypes.js';

export const IConstructProjectService = createDecorator<IConstructProjectService>('constructProjectService');

/**
 * Service for managing Kovix projects.
 *
 * A project is the central organizing unit in Kovix. It ties together
 * the workspace folder, conversation sessions, refined ideas, plans,
 * and execution state into a single persistent record.
 *
 * The project record is stored in .construct/project.json in the workspace
 * root. A global registry at ~/.kovix/projects.json enables cross-project
 * discovery without reading every workspace.
 */
export interface IConstructProjectService {
	readonly _serviceBrand: undefined;

	/**
	 * Create a new project in the current workspace.
	 * Writes .construct/project.json and updates the global registry.
	 */
	createProject(input: IProjectCreationInput, workspacePath: string): Promise<IKovixProject>;

	/**
	 * Load the project from .construct/project.json in the given workspace.
	 * Returns null if no project exists.
	 */
	loadProject(workspacePath: string): Promise<IKovixProject | null>;

	/**
	 * Save/update the project record to .construct/project.json
	 * and refresh the global registry entry.
	 */
	saveProject(project: IKovixProject): Promise<void>;

	/**
	 * Get the active project (loaded from the current workspace).
	 * Returns null if no project is loaded yet.
	 */
	getActiveProject(): IKovixProject | null;

	/**
	 * List all known projects from the global registry (~/.kovix/projects.json).
	 * Does NOT read individual workspace project files — only the registry.
	 */
	listAllProjects(): Promise<IKovixProject[]>;

	/**
	 * Update a project's lifecycle status.
	 */
	updateProjectStatus(projectId: string, status: IKovixProject['status']): Promise<void>;

	/**
	 * Store the refined idea text after idea refinement completes.
	 * Updates .construct/project.json with the refined idea.
	 */
	storeRefinedIdea(projectId: string, refinedIdea: string): Promise<void>;

	/**
	 * Store the approved plan as JSON after planning completes.
	 * Updates .construct/project.json with the plan.
	 */
	storePlan(projectId: string, planJson: string): Promise<void>;

	/**
	 * Event fired when a project is created.
	 */
	readonly onDidCreateProject: import('../../../../base/common/event.js').Event<IKovixProject>;

	/**
	 * Event fired when the active project changes (loaded, created, or switched).
	 */
	readonly onDidChangeActiveProject: import('../../../../base/common/event.js').Event<IKovixProject | null>;
}
