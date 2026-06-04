/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Agent Type Definitions
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface PlanStep {
	description: string;
	tool: string;
}

export interface ToolRequest {
	tool: 'read' | 'write' | 'edit' | 'bash' | 'mcp' | 'diff_edit' | 'git_commit' | 'refactor_rename';
	args: Record<string, any>;
}

export interface ToolResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface TurnEnd {
	reason: 'completed' | 'max_rounds' | 'aborted' | 'error';
	summary: string;
}

export const ALLOWED_TOOLS: string[] = ['read', 'write', 'edit', 'bash', 'mcp', 'diff_edit', 'git_commit', 'refactor_rename'];
