/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Services Barrel Export
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export { ServiceLocator } from './ServiceLocator';
export { LLMBridge } from './LLMBridge';
export type { SecretStorageLike, StreamOptions } from './LLMBridge';
export { MCPClient } from './MCPClient';
export { TerminalExecutor } from './TerminalExecutor';
export type { TerminalResult } from './TerminalExecutor';
export { AgentEngine } from './AgentEngine';
export { AgentError } from './AgentError';
export type { AgentErrorCode } from './AgentError';
export { ContextBudget } from './ContextBudget';
export type { ConversationEntry } from './ContextBudget';
export { Disposable } from './Disposable';
export { DiffService } from './DiffService';
export type { DiffResult } from './DiffService';
export { DiffError } from './DiffService';
export { GitService } from './GitService';
export type { GitStatus, GitCommitResult } from './GitService';
export { GitError } from './GitService';
export { RefactoringService } from './RefactoringService';
export type { RenameResult } from './RefactoringService';
export { RefactoringError } from './RefactoringService';
export { registerCoreServices } from './registerServices';
