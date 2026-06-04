/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Service Registration
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ServiceLocator } from './ServiceLocator';
import { LLMBridge, SecretStorageLike } from './LLMBridge';
import { MCPClient } from './MCPClient';
import { TerminalExecutor } from './TerminalExecutor';
import { AgentEngine } from './AgentEngine';
import { ContextBudget } from './ContextBudget';
import { DiffService } from './DiffService';
import { GitService } from './GitService';
import { RefactoringService } from './RefactoringService';
import { Disposable } from './Disposable';

export function registerCoreServices(
	secrets: SecretStorageLike,
	workspaceRoot: string,
	apiKey?: string
): Disposable[] {
	const locator = ServiceLocator.getInstance();
	const disposables: Disposable[] = [];

	// Register ContextBudget
	const budget = new ContextBudget();
	locator.register(Symbol.for('ContextBudget'), budget);

	// Register LLMBridge
	const llm = new LLMBridge(secrets, apiKey);
	locator.register(Symbol.for('LLMBridge'), llm);

	// Register MCPClient
	const mcp = new MCPClient(workspaceRoot);
	locator.register(Symbol.for('MCPClient'), mcp);
	disposables.push(new Disposable(() => mcp.stop()));

	// Register TerminalExecutor
	const terminal = new TerminalExecutor();
	locator.register(Symbol.for('TerminalExecutor'), terminal);

	// Register DiffService
	const diff = new DiffService();
	locator.register(Symbol.for('DiffService'), diff);

	// Register GitService
	const git = new GitService(terminal, workspaceRoot);
	locator.register(Symbol.for('GitService'), git);

	// Register RefactoringService
	const refactor = new RefactoringService(mcp, workspaceRoot);
	locator.register(Symbol.for('RefactoringService'), refactor);

	// Register AgentEngine (depends on all above)
	const engine = new AgentEngine(locator);
	locator.register(Symbol.for('AgentEngine'), engine);

	return disposables;
}
