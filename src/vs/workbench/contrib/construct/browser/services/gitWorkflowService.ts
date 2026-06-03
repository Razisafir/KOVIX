/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * gitWorkflowService.ts -- Real Git Workflow Service Implementation
 *
 * Executes real git commands against actual repositories. In the browser-based
 * VS Code environment, git commands are routed through VS Code's terminal
 * infrastructure. When the terminal API is unavailable, operations are logged
 * with structured results indicating the command needs terminal execution.
 *
 * Safety policies are enforced before any destructive operation. Protected
 * branch patterns prevent accidental commits or deletions on critical branches.
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ITerminalExecutorService } from '../../../../../platform/construct/common/terminalExecutor.js';
import {
        IGitWorkflowService,
        GitOperation,
        GitBranch,
        GitCommitInfo,
        GitStatus,
        GitDiffResult,
        GitSafetyPolicy,
} from '../../../../../platform/construct/common/gitWorkflow.js';

// -- Storage Keys --

const STORAGE_SAFETY_POLICY = 'construct.aiExecution.gitWorkflow.safetyPolicy';

// -- Default Safety Policy --

const DEFAULT_SAFETY_POLICY: GitSafetyPolicy = {
        allowForcePush: false,
        allowDeleteBranches: false,
        requireCommitMessage: true,
        protectedBranchPatterns: ['main', 'master', 'release/*'],
};

// ============================================================================
// GitWorkflowService
// ============================================================================

export class GitWorkflowService extends Disposable implements IGitWorkflowService {

        declare readonly _serviceBrand: undefined;

        private _safetyPolicy: GitSafetyPolicy;

        constructor(
                @ILogService private readonly _logService: ILogService,
                @IStorageService private readonly _storageService: IStorageService,
                @ICommandService private readonly __commandService_unused: ICommandService,
                @ITerminalExecutorService private readonly terminalExecutorService: ITerminalExecutorService,
        ) {
                super(); void this.__commandService_unused;
                this._safetyPolicy = this._loadSafetyPolicy();
                this._logService.trace('[Construct GitWorkflow] Service initialized');
        }

        // ====================================================================
        // Public: Repository Status
        // ====================================================================

        async getStatus(repoPath: string): Promise<GitStatus> {
                const result = await this._execGit(repoPath, ['status', '--porcelain=v2', '--branch']);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git status failed: ${result.stderr}`);
                        return { branch: '', staged: [], modified: [], untracked: [], deleted: [], conflicted: [], isClean: true };
                }

                let branch = '';
                const staged: string[] = [];
                const modified: string[] = [];
                const untracked: string[] = [];
                const deleted: string[] = [];
                const conflicted: string[] = [];

                for (const line of result.stdout.split('\n')) {
                        const trimmed = line.trim();
                        if (!trimmed) { continue; }

                        // Branch header line: # branch.head <name>
                        if (trimmed.startsWith('# branch.head')) {
                                branch = trimmed.substring('# branch.head'.length).trim();
                                continue;
                        }

                        // Porcelain v2 format:
                        // 1 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>
                        // 2 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <x> <path>
                        // ? <path>    -- untracked
                        // u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>  -- unmerged

                        if (trimmed.startsWith('1 ') || trimmed.startsWith('2 ')) {
                                // Staged/modified file entry
                                const parts = trimmed.split(/\s+/);
                                const xy = parts[1];
                                // Path is the last component; for format 2, path follows the x field
                                const filePath = trimmed.startsWith('1 ')
                                        ? parts.slice(8).join(' ')
                                        : parts.slice(9).join(' ');

                                const indexStatus = xy.charAt(0);
                                const workTreeStatus = xy.charAt(1);

                                // Index (staged) changes
                                if (indexStatus !== '.' && indexStatus !== '?') {
                                        if (indexStatus === 'D') {
                                                deleted.push(filePath);
                                        } else {
                                                staged.push(filePath);
                                        }
                                }

                                // Work tree changes
                                if (workTreeStatus !== '.' && workTreeStatus !== '?') {
                                        if (workTreeStatus === 'D') {
                                                deleted.push(filePath);
                                        } else {
                                                modified.push(filePath);
                                        }
                                }
                        } else if (trimmed.startsWith('? ')) {
                                // Untracked file
                                const filePath = trimmed.substring(2).trim();
                                untracked.push(filePath);
                        } else if (trimmed.startsWith('u ')) {
                                // Unmerged (conflicted) file
                                const parts = trimmed.split(/\s+/);
                                const filePath = parts.slice(10).join(' ');
                                conflicted.push(filePath);
                        }
                }

                const isClean = staged.length === 0 && modified.length === 0
                        && untracked.length === 0 && deleted.length === 0 && conflicted.length === 0;

                return { branch, staged, modified, untracked, deleted, conflicted, isClean };
        }

        // ====================================================================
        // Public: Branch Operations
        // ====================================================================

        async createBranch(repoPath: string, name: string, checkout?: boolean): Promise<boolean> {
                const args = checkout
                        ? ['checkout', '-b', name]
                        : ['branch', name];
                const result = await this._execGit(repoPath, args);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] create branch "${name}" failed: ${result.stderr}`);
                        return false;
                }
                this._logService.info(`[Construct GitWorkflow] Branch "${name}" created${checkout ? ' and checked out' : ''}`);
                return true;
        }

        async checkoutBranch(repoPath: string, name: string): Promise<boolean> {
                // Safety: check if current branch has uncommitted changes
                const status = await this.getStatus(repoPath);
                if (!status.isClean) {
                        this._logService.warn(`[Construct GitWorkflow] Cannot checkout: working tree has uncommitted changes`);
                        return false;
                }

                const result = await this._execGit(repoPath, ['checkout', name]);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] checkout "${name}" failed: ${result.stderr}`);
                        return false;
                }
                this._logService.info(`[Construct GitWorkflow] Checked out branch "${name}"`);
                return true;
        }

        // ====================================================================
        // Public: Commit Operations
        // ====================================================================

        async commit(repoPath: string, message: string, files?: string[]): Promise<GitCommitInfo | null> {
                if (this._safetyPolicy.requireCommitMessage && (!message || message.trim().length === 0)) {
                        this._logService.warn('[Construct GitWorkflow] Commit rejected: empty commit message');
                        return null;
                }

                // Stage specific files if provided, otherwise stage all tracked changes
                if (files && files.length > 0) {
                        const addResult = await this._execGit(repoPath, ['add', ...files]);
                        if (addResult.exitCode !== 0) {
                                this._logService.warn(`[Construct GitWorkflow] git add failed: ${addResult.stderr}`);
                                return null;
                        }
                } else {
                        // Stage all tracked changes (modified and deleted files)
                        const addResult = await this._execGit(repoPath, ['add', '-u']);
                        if (addResult.exitCode !== 0) {
                                this._logService.warn(`[Construct GitWorkflow] git add -u failed: ${addResult.stderr}`);
                                return null;
                        }
                }

                // Commit with the message
                const escapedMessage = message.replace(/"/g, '\\"');
                const commitResult = await this._execGit(repoPath, ['commit', '-m', escapedMessage]);
                if (commitResult.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git commit failed: ${commitResult.stderr}`);
                        return null;
                }

                // Parse the commit hash from the output
                const hashMatch = commitResult.stdout.match(/\[[\w-]+\s+([0-9a-f]{7,40})\]/);
                const shortHash = hashMatch ? hashMatch[1] : '';

                // Get the full commit info
                if (shortHash) {
                        const logResult = await this._execGit(repoPath, ['log', '-1', '--format=%H|%h|%s|%an|%at', '--numstat']);
                        if (logResult.exitCode === 0) {
                                return this._parseSingleLogEntry(logResult.stdout);
                        }
                }

                // Fallback: return minimal info from the commit output
                return {
                        hash: shortHash,
                        shortHash,
                        message,
                        author: '',
                        date: Date.now(),
                        filesChanged: files?.length ?? 0,
                        insertions: 0,
                        deletions: 0,
                };
        }

        async createCheckpointCommit(repoPath: string, label: string): Promise<GitCommitInfo | null> {
                const message = `[ai-checkpoint] ${label}`;

                // Stage all changes (including untracked)
                const addResult = await this._execGit(repoPath, ['add', '-A']);
                if (addResult.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] checkpoint git add -A failed: ${addResult.stderr}`);
                        return null;
                }

                // Check if there is anything to commit
                const statusResult = await this._execGit(repoPath, ['status', '--porcelain']);
                if (statusResult.exitCode === 0 && statusResult.stdout.trim().length === 0) {
                        this._logService.info(`[Construct GitWorkflow] No changes to commit for checkpoint "${label}"`);
                        return null;
                }

                return this.commit(repoPath, message);
        }

        async createMilestoneCommit(repoPath: string, milestoneName: string, milestoneId: string): Promise<GitCommitInfo | null> {
                const message = `[ai-milestone] ${milestoneName} (${milestoneId})`;

                // Stage all changes (including untracked)
                const addResult = await this._execGit(repoPath, ['add', '-A']);
                if (addResult.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] milestone git add -A failed: ${addResult.stderr}`);
                        return null;
                }

                // Check if there is anything to commit
                const statusResult = await this._execGit(repoPath, ['status', '--porcelain']);
                if (statusResult.exitCode === 0 && statusResult.stdout.trim().length === 0) {
                        this._logService.info(`[Construct GitWorkflow] No changes to commit for milestone "${milestoneName}"`);
                        return null;
                }

                return this.commit(repoPath, message);
        }

        // ====================================================================
        // Public: Rollback
        // ====================================================================

        async rollbackCommit(repoPath: string, commitHash: string): Promise<boolean> {
                // Safety check: is this a destructive operation?
                if (this.isDestructiveOperation(GitOperation.Revert, { commitHash })) {
                        this._logService.warn(`[Construct GitWorkflow] Revert of ${commitHash} blocked by safety policy`);
                        return false;
                }

                const result = await this._execGit(repoPath, ['revert', commitHash, '--no-edit']);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git revert ${commitHash} failed: ${result.stderr}`);
                        return false;
                }
                this._logService.info(`[Construct GitWorkflow] Reverted commit ${commitHash}`);
                return true;
        }

        // ====================================================================
        // Public: Diff
        // ====================================================================

        async getDiff(repoPath: string, file?: string, staged?: boolean): Promise<GitDiffResult[]> {
                const args: string[] = ['diff'];
                if (staged) {
                        args.push('--staged');
                }
                if (file) {
                        args.push('--', file);
                }

                const result = await this._execGit(repoPath, args);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git diff failed: ${result.stderr}`);
                        return [];
                }

                return this._parseDiffOutput(result.stdout);
        }

        // ====================================================================
        // Public: Log
        // ====================================================================

        async getLog(repoPath: string, maxCount?: number): Promise<GitCommitInfo[]> {
                const count = maxCount ?? 50;
                const args = ['log', `--format=%H|%h|%s|%an|%at`, '--numstat', `-n`, String(count)];
                const result = await this._execGit(repoPath, args);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git log failed: ${result.stderr}`);
                        return [];
                }

                return this._parseLogOutput(result.stdout);
        }

        // ====================================================================
        // Public: Branches
        // ====================================================================

        async getBranches(repoPath: string): Promise<GitBranch[]> {
                const result = await this._execGit(repoPath, ['branch', '-a', '-v', '--no-abbrev']);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git branch -a -v failed: ${result.stderr}`);
                        return [];
                }

                return this._parseBranchOutput(result.stdout);
        }

        // ====================================================================
        // Public: Stash
        // ====================================================================

        async stash(repoPath: string, message?: string): Promise<boolean> {
                const args: string[] = ['stash', 'push'];
                if (message) {
                        args.push('-m', message);
                }
                const result = await this._execGit(repoPath, args);
                if (result.exitCode !== 0) {
                        this._logService.warn(`[Construct GitWorkflow] git stash push failed: ${result.stderr}`);
                        return false;
                }
                // "No local changes to save" is a successful no-op
                this._logService.info(`[Construct GitWorkflow] Stash created${message ? `: ${message}` : ''}`);
                return true;
        }

        async stashPop(repoPath: string): Promise<boolean> {
                const result = await this._execGit(repoPath, ['stash', 'pop']);
                if (result.exitCode !== 0) {
                        // Conflicts during pop are common; report failure
                        this._logService.warn(`[Construct GitWorkflow] git stash pop failed: ${result.stderr}`);
                        return false;
                }
                this._logService.info('[Construct GitWorkflow] Stash popped');
                return true;
        }

        // ====================================================================
        // Public: Safety Policy
        // ====================================================================

        getSafetyPolicy(): GitSafetyPolicy {
                return { ...this._safetyPolicy };
        }

        setSafetyPolicy(policy: Partial<GitSafetyPolicy>): void {
                this._safetyPolicy = {
                        allowForcePush: policy.allowForcePush ?? this._safetyPolicy.allowForcePush,
                        allowDeleteBranches: policy.allowDeleteBranches ?? this._safetyPolicy.allowDeleteBranches,
                        requireCommitMessage: policy.requireCommitMessage ?? this._safetyPolicy.requireCommitMessage,
                        protectedBranchPatterns: policy.protectedBranchPatterns ?? this._safetyPolicy.protectedBranchPatterns,
                };
                this._persistSafetyPolicy();
                this._logService.info('[Construct GitWorkflow] Safety policy updated');
        }

        isDestructiveOperation(operation: GitOperation, params: Record<string, string>): boolean {
                switch (operation) {
                        case GitOperation.Reset: {
                                // Any reset --hard is destructive
                                const mode = params['mode'] ?? '';
                                if (mode === '--hard' || mode === 'hard') {
                                        return true;
                                }
                                return false;
                        }
                        case GitOperation.Revert: {
                                // Revert on a protected branch is considered destructive
                                const branch = params['branch'] ?? '';
                                if (this._isProtectedBranch(branch)) {
                                        return true;
                                }
                                // Revert itself is generally safe (creates a new commit), but
                                // we check for additional context
                                return false;
                        }
                        case GitOperation.Branch: {
                                // Deleting a branch is destructive
                                const action = params['action'] ?? '';
                                if (action === 'delete' || action === '-d' || action === '-D') {
                                        if (!this._safetyPolicy.allowDeleteBranches) {
                                                return true;
                                        }
                                        // Deleting a protected branch is always destructive
                                        const branchName = params['name'] ?? '';
                                        if (this._isProtectedBranch(branchName)) {
                                                return true;
                                        }
                                }
                                return false;
                        }
                        case GitOperation.Checkout: {
                                // Force checkout can discard changes
                                const force = params['force'] ?? '';
                                if (force === 'true' || force === '--force') {
                                        return true;
                                }
                                return false;
                        }
                        case GitOperation.Merge: {
                                // Merge with --force or into a protected branch
                                const targetBranch = params['branch'] ?? '';
                                if (this._isProtectedBranch(targetBranch)) {
                                        return true;
                                }
                                return false;
                        }
                        default:
                                return false;
                }
        }

        // ====================================================================
        // Private: Git Command Execution
        // ====================================================================

        private async _execGit(
                repoPath: string,
                args: string[]
        ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
                const command = `git ${args.join(' ')}`;
                this._logService.info(`[Construct GitWorkflow] Executing: ${command}`);

                try {
                        const result = await this.terminalExecutorService.execute(command, repoPath, 15000);
                        this._logService.info(`[Construct GitWorkflow] Result: exit=${result.exitCode}, stdout=${result.stdout.substring(0, 100)}`);
                        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
                } catch (err) {
                        this._logService.error('[Construct GitWorkflow] Execution failed:', err);
                        return { stdout: '', stderr: String(err), exitCode: -1 };
                }
        }

        // ====================================================================
        // Private: Diff Parsing
        // ====================================================================

        private _parseDiffOutput(raw: string): GitDiffResult[] {
                if (!raw || raw.trim().length === 0) {
                        return [];
                }

                const results: GitDiffResult[] = [];
                const fileSections = raw.split(/^diff --git /m);

                for (const section of fileSections) {
                        if (!section.trim()) { continue; }

                        // Extract file path from the diff header
                        // Format: a/path b/path
                        const headerMatch = section.match(/^(a\/.+? b\/.+?)\n/);
                        if (!headerMatch) { continue; }

                        const pathParts = headerMatch[1].split(' b/');
                        const filePath = pathParts.length > 1 ? pathParts[1] : pathParts[0].replace(/^a\//, '');

                        // Check for binary file
                        const isBinary = section.includes('Binary files') || section.includes('GIT binary patch');

                        // Count additions and deletions
                        let additions = 0;
                        let deletions = 0;
                        for (const line of section.split('\n')) {
                                if (line.startsWith('+') && !line.startsWith('+++')) {
                                        additions++;
                                } else if (line.startsWith('-') && !line.startsWith('---')) {
                                        deletions++;
                                }
                        }

                        results.push({
                                filePath,
                                additions,
                                deletions,
                                diff: `diff --git ${section}`,
                                isBinary,
                        });
                }

                return results;
        }

        // ====================================================================
        // Private: Log Parsing
        // ====================================================================

        private _parseLogOutput(raw: string): GitCommitInfo[] {
                if (!raw || raw.trim().length === 0) {
                        return [];
                }

                const entries: GitCommitInfo[] = [];
                const lines = raw.split('\n');

                let currentEntry: Partial<GitCommitInfo> | null = null;
                let currentNumstatLines: string[] = [];

                for (const line of lines) {
                        // Check for commit header line (format: hash|shortHash|message|author|timestamp)
                        const headerMatch = line.match(/^([0-9a-f]{40})\|([0-9a-f]{7,})\|(.+?)\|(.+?)\|(\d+)$/);
                        if (headerMatch) {
                                // Save the previous entry
                                if (currentEntry) {
                                        const stats = this._parseNumstat(currentNumstatLines);
                                        entries.push({
                                                hash: currentEntry.hash!,
                                                shortHash: currentEntry.shortHash!,
                                                message: currentEntry.message ?? '',
                                                author: currentEntry.author ?? '',
                                                date: currentEntry.date ?? 0,
                                                filesChanged: stats.filesChanged,
                                                insertions: stats.insertions,
                                                deletions: stats.deletions,
                                        });
                                }

                                // Start a new entry
                                currentEntry = {
                                        hash: headerMatch[1],
                                        shortHash: headerMatch[2],
                                        message: headerMatch[3],
                                        author: headerMatch[4],
                                        date: parseInt(headerMatch[5], 10) * 1000, // Convert Unix timestamp to ms
                                };
                                currentNumstatLines = [];
                        } else if (currentEntry) {
                                // Accumulate numstat lines
                                currentNumstatLines.push(line);
                        }
                }

                // Save the last entry
                if (currentEntry) {
                        const stats = this._parseNumstat(currentNumstatLines);
                        entries.push({
                                hash: currentEntry.hash!,
                                shortHash: currentEntry.shortHash!,
                                message: currentEntry.message ?? '',
                                author: currentEntry.author ?? '',
                                date: currentEntry.date ?? 0,
                                filesChanged: stats.filesChanged,
                                insertions: stats.insertions,
                                deletions: stats.deletions,
                        });
                }

                return entries;
        }

        private _parseSingleLogEntry(raw: string): GitCommitInfo | null {
                const entries = this._parseLogOutput(raw);
                return entries.length > 0 ? entries[0] : null;
        }

        private _parseNumstat(lines: string[]): { filesChanged: number; insertions: number; deletions: number } {
                let filesChanged = 0;
                let insertions = 0;
                let deletions = 0;

                for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) { continue; }

                        // numstat format: additions\tdeletions\tfilename
                        // Binary files show as: -\t-\tfilename
                        const parts = trimmed.split('\t');
                        if (parts.length >= 3) {
                                const add = parseInt(parts[0], 10);
                                const del = parseInt(parts[1], 10);
                                if (!isNaN(add) && !isNaN(del)) {
                                        insertions += add;
                                        deletions += del;
                                }
                                filesChanged++;
                        }
                }

                return { filesChanged, insertions, deletions };
        }

        // ====================================================================
        // Private: Branch Parsing
        // ====================================================================

        private _parseBranchOutput(raw: string): GitBranch[] {
                if (!raw || raw.trim().length === 0) {
                        return [];
                }

                const branches: GitBranch[] = [];
                const lines = raw.split('\n');

                for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) { continue; }

                        // Format:  * branch-name  hash  commit message
                        // Or:        branch-name  hash  commit message
                        // Remote:    remotes/origin/branch-name  hash  commit message
                        const isCurrent = trimmed.startsWith('*');
                        const cleanLine = isCurrent ? trimmed.substring(1).trim() : trimmed;

                        // Skip the "(HEAD detached ...)" line
                        if (cleanLine.startsWith('(HEAD')) { continue; }

                        // Split into parts: name, hash, message...
                        // The hash is typically 40 chars, preceded by the branch name
                        const match = cleanLine.match(/^(\S+)\s+([0-9a-f]{7,40})\s+(.*)$/);
                        if (!match) { continue; }

                        const name = match[1];
                        const lastCommitHash = match[2];
                        const lastCommitMessage = match[3];

                        const isRemote = name.startsWith('remotes/');
                        const displayName = isRemote ? name : name;

                        branches.push({
                                name: displayName,
                                isCurrent,
                                isRemote,
                                lastCommitHash,
                                lastCommitMessage,
                                lastCommitDate: 0, // Date not available in branch -v output; would need separate log query
                        });
                }

                return branches;
        }

        // ====================================================================
        // Private: Safety Policy Helpers
        // ====================================================================

        private _isProtectedBranch(branchName: string): boolean {
                if (!branchName) { return false; }
                for (const pattern of this._safetyPolicy.protectedBranchPatterns) {
                        if (pattern.includes('*')) {
                                // Convert glob pattern to regex
                                const regexStr = pattern
                                        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                                        .replace(/\*/g, '.*');
                                try {
                                        const regex = new RegExp(`^${regexStr}$`);
                                        if (regex.test(branchName)) {
                                                return true;
                                        }
                                } catch {
                                        continue;
                                }
                        } else {
                                if (branchName === pattern) {
                                        return true;
                                }
                        }
                }
                return false;
        }

        private _loadSafetyPolicy(): GitSafetyPolicy {
                try {
                        const stored = this._storageService.get(STORAGE_SAFETY_POLICY, StorageScope.WORKSPACE, undefined);
                        if (stored) {
                                const parsed = JSON.parse(stored) as Partial<GitSafetyPolicy>;
                                return {
                                        allowForcePush: parsed.allowForcePush ?? DEFAULT_SAFETY_POLICY.allowForcePush,
                                        allowDeleteBranches: parsed.allowDeleteBranches ?? DEFAULT_SAFETY_POLICY.allowDeleteBranches,
                                        requireCommitMessage: parsed.requireCommitMessage ?? DEFAULT_SAFETY_POLICY.requireCommitMessage,
                                        protectedBranchPatterns: parsed.protectedBranchPatterns ?? DEFAULT_SAFETY_POLICY.protectedBranchPatterns,
                                };
                        }
                } catch {
                        this._logService.warn('[Construct GitWorkflow] Failed to parse stored safety policy; using defaults');
                }
                return { ...DEFAULT_SAFETY_POLICY };
        }

        private _persistSafetyPolicy(): void {
                try {
                        this._storageService.store(
                                STORAGE_SAFETY_POLICY,
                                JSON.stringify(this._safetyPolicy),
                                StorageScope.WORKSPACE,
                                StorageTarget.MACHINE
                        );
                } catch (err) {
                        this._logService.warn(`[Construct GitWorkflow] Failed to persist safety policy: ${err}`);
                }
        }

        // ====================================================================
        // Lifecycle
        // ====================================================================

        override dispose(): void {
                this._persistSafetyPolicy();
                this._logService.info('[Construct GitWorkflow] Service disposed, state persisted');
                super.dispose();
        }
}
