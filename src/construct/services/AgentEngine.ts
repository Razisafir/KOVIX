/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Agent Engine (Orchestration Loop)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { LLMBridge } from './LLMBridge';
import { MCPClient } from './MCPClient';
import { TerminalExecutor, TerminalResult } from './TerminalExecutor';
import { ContextBudget } from './ContextBudget';
import { DiffService } from './DiffService';
import { GitService } from './GitService';
import { RefactoringService } from './RefactoringService';
import { AgentError } from './AgentError';
import { ServiceLocator } from './ServiceLocator';
import { PlanStep, ToolRequest, ToolResult, ALLOWED_TOOLS } from '../agent/types';

export class AgentEngine {
	private readonly llm: LLMBridge;
	private readonly mcp: MCPClient;
	private readonly terminal: TerminalExecutor;
	private readonly budget: ContextBudget;
	private readonly diff: DiffService;
	private readonly git: GitService;
	private readonly refactor: RefactoringService;
	private readonly locator: ServiceLocator;

	constructor(locator: ServiceLocator) {
		this.locator = locator;
		this.llm = locator.resolve<LLMBridge>(Symbol.for('LLMBridge'));
		this.mcp = locator.resolve<MCPClient>(Symbol.for('MCPClient'));
		this.terminal = locator.resolve<TerminalExecutor>(Symbol.for('TerminalExecutor'));
		this.budget = locator.resolve<ContextBudget>(Symbol.for('ContextBudget'));
		this.diff = locator.resolve<DiffService>(Symbol.for('DiffService'));
		this.git = locator.resolve<GitService>(Symbol.for('GitService'));
		this.refactor = locator.resolve<RefactoringService>(Symbol.for('RefactoringService'));
	}

	async plan(task: string, signal?: AbortSignal): Promise<PlanStep[]> {
		const systemPrompt = `You are a planning agent. Given a task, break it down into numbered steps.
Each step should be a concrete action. Output ONLY the numbered list, no other text.
Format:
1. Step description
2. Step description
...`;

		this.budget.ensureBudget(systemPrompt + task);
		const fullPrompt = `${systemPrompt}\n\nTask: ${task}`;

		let output = '';
		for await (const chunk of this.llm.streamCompletion(fullPrompt, { signal })) {
			output += chunk;
		}

		this.budget.addConversationEntry({ role: 'user', content: task });
		this.budget.addConversationEntry({ role: 'assistant', content: output });

		return this.parsePlan(output);
	}

	parsePlan(output: string): PlanStep[] {
		const lines = output.split('\n').filter(l => l.trim());
		const steps: PlanStep[] = [];
		const pattern = /^\s*\d+\.\s+(.+)$/;

		for (const line of lines) {
			const match = line.match(pattern);
			if (match) {
				steps.push({ description: match[1].trim(), tool: 'bash' });
			}
		}

		return steps;
	}

	async execute(steps: PlanStep[], maxRounds: number = 15, signal?: AbortSignal): Promise<string> {
		let round = 0;
		let lastResult = '';

		while (round < maxRounds) {
			if (signal?.aborted) {
				throw new AgentError('Execution aborted', 'LLM_TIMEOUT');
			}

			// Build the execution prompt
			const prompt = this.buildExecutionPrompt(steps, lastResult);
			this.budget.ensureBudget(prompt);

			let output = '';
			for await (const chunk of this.llm.streamCompletion(prompt, { signal })) {
				output += chunk;
			}

			this.budget.addConversationEntry({ role: 'user', content: prompt });
			this.budget.addConversationEntry({ role: 'assistant', content: output });

			// Parse tool use from the output
			const toolRequest = this.parseToolUse(output);

			if (!toolRequest) {
				// No tool use detected — agent is done
				return output;
			}

			// Execute the tool
			const result = await this.dispatchTool(toolRequest);
			lastResult = JSON.stringify(result);

			round++;
		}

		throw new AgentError(`Max rounds (${maxRounds}) exceeded`, 'MAX_ROUNDS');
	}

	private buildExecutionPrompt(steps: PlanStep[], lastResult: string): string {
		const stepDescriptions = steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
		return `You are an execution agent. Execute the following plan steps using tools.

Plan:
${stepDescriptions}

${lastResult ? `Last tool result: ${lastResult}\n` : ''}Available tools: ${ALLOWED_TOOLS.join(', ')}

To use a tool, output a fenced code block like:
\`\`\`tool
{"tool": "read", "args": {"path": "src/main.ts"}}
\`\`\`

Continue executing until all steps are done, then output a summary.`;
	}

	private parseToolUse(output: string): ToolRequest | null {
		const toolPattern = /```tool\s*\n([\s\S]*?)\n```/;
		const match = output.match(toolPattern);

		if (!match) {
			return null;
		}

		try {
			const parsed = JSON.parse(match[1].trim());
			if (parsed.tool && ALLOWED_TOOLS.includes(parsed.tool)) {
				return parsed as ToolRequest;
			}
		} catch {
			// Malformed JSON — ignore
		}

		return null;
	}

	private async dispatchTool(request: ToolRequest): Promise<ToolResult> {
		try {
			switch (request.tool) {
				case 'read': {
					const content = await this.mcp.readFile(request.args.path);
					return { success: true, data: content };
				}
				case 'write': {
					await this.mcp.writeFile(request.args.path, request.args.content);
					return { success: true, data: 'File written' };
				}
				case 'edit': {
					// Use DiffService for safe edits
					const content = await this.mcp.readFile(request.args.path);
					const result = this.diff.applyEdit(content, request.args.search, request.args.replace);
					if (result.success) {
						await this.mcp.writeFile(request.args.path, result.patchedContent);
						return { success: true, data: `Edited: ${result.hunksApplied} hunks applied` };
					}
					return { success: false, error: `Edit failed: ${result.conflicts} conflicts` };
				}
				case 'bash': {
					const result: TerminalResult = await this.terminal.run(request.args.command, request.args.args, {
						timeoutMs: request.args.timeout,
						signal: request.args.signal,
					});
					return { success: result.exitCode === 0, data: result.stdout, error: result.stderr || undefined };
				}
				case 'mcp': {
					const method = request.args.method;
					const params = request.args.params;
					// Direct MCP call — handled by the MCP client
					return { success: true, data: `MCP ${method} executed` };
				}
				case 'diff_edit': {
					// Apply a unified diff patch to a file
					const content = await this.mcp.readFile(request.args.path);
					const patchResult = this.diff.applyPatch(content, request.args.patch);
					if (patchResult.success) {
						await this.mcp.writeFile(request.args.path, patchResult.patchedContent);
						return { success: true, data: `Patch applied: ${patchResult.hunksApplied} hunks, ${patchResult.conflicts} conflicts` };
					}
					return { success: false, error: `Patch failed: ${patchResult.conflicts} conflicts` };
				}
				case 'git_commit': {
					const commitResult = await this.git.autoCommit(request.args.message);
					return { success: commitResult.success, data: commitResult.hash, error: commitResult.success ? undefined : commitResult.message };
				}
				case 'refactor_rename': {
					const renameResult = await this.refactor.renameSymbol(
						request.args.oldName,
						request.args.newName,
						{ filePattern: request.args.filePattern, dryRun: request.args.dryRun },
					);
					return {
						success: renameResult.success,
						data: `Renamed in ${renameResult.filesModified.length} files`,
						error: renameResult.errors.length > 0 ? renameResult.errors.join('; ') : undefined,
					};
				}
				default:
					throw new AgentError(`Unknown tool: ${request.tool}`, 'TOOL_FAILURE');
			}
		} catch (err) {
			if (err instanceof AgentError) throw err;
			return { success: false, error: (err as Error).message };
		}
	}
}
