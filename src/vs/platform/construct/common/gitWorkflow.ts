/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * gitWorkflow.ts -- Real Git Workflow Service Interface
 * Construct IDE -- AI-Native IDE
 *
 * Provides structured git operations with safety policies, checkpoint/milestone
 * commits, and repository status tracking. All operations are real git commands
 * executed against actual repositories.
 */

import { createDecorator } from '../../instantiation/common/instantiation.js';

// -- Service Identifier --

export const IGitWorkflowService = createDecorator<IGitWorkflowService>('construct.gitWorkflowService');

// -- Enumerations --

/**
 * Types of git operations that can be performed.
 */
export enum GitOperation {
	Branch = 'branch',
	Commit = 'commit',
	Checkout = 'checkout',
	Merge = 'merge',
	Stash = 'stash',
	Diff = 'diff',
	Log = 'log',
	Reset = 'reset',
	Revert = 'revert',
	Status = 'status',
}

// -- Data Types --

/**
 * Information about a git branch.
 */
export type GitBranch = {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	lastCommitHash: string;
	lastCommitMessage: string;
	lastCommitDate: number;
};

/**
 * Information about a single git commit.
 */
export type GitCommitInfo = {
	hash: string;
	shortHash: string;
	message: string;
	author: string;
	date: number;
	filesChanged: number;
	insertions: number;
	deletions: number;
};

/**
 * Current status of a git repository working tree.
 */
export type GitStatus = {
	branch: string;
	staged: string[];
	modified: string[];
	untracked: string[];
	deleted: string[];
	conflicted: string[];
	isClean: boolean;
};

/**
 * Result of a diff operation on a single file.
 */
export type GitDiffResult = {
	filePath: string;
	additions: number;
	deletions: number;
	diff: string;
	isBinary: boolean;
};

/**
 * Safety policy governing which git operations are permitted.
 */
export type GitSafetyPolicy = {
	allowForcePush: boolean;
	allowDeleteBranches: boolean;
	requireCommitMessage: boolean;
	protectedBranchPatterns: string[];
};

// -- Service Interface --

/**
 * IGitWorkflowService -- Real git operations with safety enforcement.
 *
 * Responsibilities:
 *   - Query repository status, branches, logs, and diffs
 *   - Create branches, commits, and checkouts
 *   - Create checkpoint and milestone commits for AI workflow tracking
 *   - Rollback commits via git revert
 *   - Stash and pop changes
 *   - Enforce safety policies for destructive operations
 *
 * Limitations:
 *   - Git execution requires the git CLI to be available
 *   - Browser-based VS Code instances cannot spawn child processes;
 *     operations are logged and routed through VS Code's terminal infrastructure
 *   - Safety policies prevent accidental destructive operations but cannot
 *     guarantee protection against all misuse
 */
export interface IGitWorkflowService {
	readonly _serviceBrand: undefined;

	/**
	 * Get the current working tree status of a repository.
	 */
	getStatus(repoPath: string): Promise<GitStatus>;

	/**
	 * Create a new branch. If checkout is true, switch to it immediately.
	 */
	createBranch(repoPath: string, name: string, checkout?: boolean): Promise<boolean>;

	/**
	 * Switch to an existing branch.
	 */
	checkoutBranch(repoPath: string, name: string): Promise<boolean>;

	/**
	 * Commit staged or specified files with the given message.
	 * Returns the commit info if successful, or null on failure.
	 */
	commit(repoPath: string, message: string, files?: string[]): Promise<GitCommitInfo | null>;

	/**
	 * Create a checkpoint commit: stage all modified files and commit
	 * with a message formatted as "[ai-checkpoint] <label>".
	 */
	createCheckpointCommit(repoPath: string, label: string): Promise<GitCommitInfo | null>;

	/**
	 * Create a milestone commit: stage all modified files and commit
	 * with a message formatted as "[ai-milestone] <milestoneName> (<milestoneId>)".
	 */
	createMilestoneCommit(repoPath: string, milestoneName: string, milestoneId: string): Promise<GitCommitInfo | null>;

	/**
	 * Revert a specific commit by hash. Checks safety policy before executing.
	 */
	rollbackCommit(repoPath: string, commitHash: string): Promise<boolean>;

	/**
	 * Get diff results. If file is specified, diff only that file.
	 * If staged is true, show staged changes.
	 */
	getDiff(repoPath: string, file?: string, staged?: boolean): Promise<GitDiffResult[]>;

	/**
	 * Get commit log entries, limited to maxCount.
	 */
	getLog(repoPath: string, maxCount?: number): Promise<GitCommitInfo[]>;

	/**
	 * Get all branches (local and remote) with their last commit info.
	 */
	getBranches(repoPath: string): Promise<GitBranch[]>;

	/**
	 * Stash current changes with an optional message.
	 */
	stash(repoPath: string, message?: string): Promise<boolean>;

	/**
	 * Pop the most recent stash.
	 */
	stashPop(repoPath: string): Promise<boolean>;

	/**
	 * Get the current safety policy.
	 */
	getSafetyPolicy(): GitSafetyPolicy;

	/**
	 * Update the safety policy. Only the provided fields are changed.
	 */
	setSafetyPolicy(policy: Partial<GitSafetyPolicy>): void;

	/**
	 * Determine whether a given operation with the given parameters
	 * would be considered destructive under the current safety policy.
	 */
	isDestructiveOperation(operation: GitOperation, params: Record<string, string>): boolean;
}
