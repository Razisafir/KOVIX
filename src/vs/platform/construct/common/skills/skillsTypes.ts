/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum SkillCategory {
	Frontend = 'frontend',
	Backend = 'backend',
	DevOps = 'devops',
	Mobile = 'mobile',
	ThreeD = '3d',
	DataScience = 'data-science',
	Security = 'security',
	Testing = 'testing',
	Documentation = 'documentation',
	Other = 'other'
}

export const enum SkillStepType {
	Prompt = 'prompt',
	ToolCall = 'tool_call',
	FileEdit = 'file_edit',
	Verify = 'verify',
	Condition = 'condition',
	Loop = 'loop',
	SubSkill = 'sub_skill'
}

export interface ISkillStep {
	type: SkillStepType;
	description: string;
	content?: string;           // For prompt: the prompt text
	toolName?: string;          // For tool_call: MCP tool name
	toolArgs?: Record<string, any>;
	filePath?: string;         // For file_edit: target file
	fileContent?: string;      // For file_edit: content template
	condition?: string;        // For condition: JS expression
	trueSteps?: ISkillStep[];  // For condition/loop
	falseSteps?: ISkillStep[];
	loopCondition?: string;    // For loop
	maxIterations?: number;
	subSkillId?: string;       // For sub_skill
	variables?: Record<string, string>; // Variable substitutions
}

export interface ISkill {
	id: string;
	name: string;
	description: string;
	author: string;
	version: string;
	category: SkillCategory;
	tags: string[];
	rating: number;
	downloadCount: number;
	price: number;              // 0 = free
	content: string;            // Markdown workflow description
	steps: ISkillStep[];
	requiredTools: string[];    // MCP tool names required
	examples: string[];
	createdAt: number;
	updatedAt: number;
	iconUrl?: string;
	documentationUrl?: string;
	repositoryUrl?: string;
	verified: boolean;          // Security scanned
	featured: boolean;
}

export interface ISkillExecutionContext {
	projectId: string;
	projectPath: string;
	variables: Record<string, string>;
	skillId: string;
	stepIndex: number;
	outputs: Record<string, any>;
	errors: string[];
	startTime: number;
}

export interface ISkillExecutionResult {
	success: boolean;
	skillId: string;
	outputs: Record<string, any>;
	errors: string[];
	durationMs: number;
	stepsCompleted: number;
	stepsTotal: number;
	filesCreated: string[];
	filesModified: string[];
	creditsConsumed: number;
}

export interface ISkillSearchQuery {
	text?: string;
	category?: SkillCategory;
	tags?: string[];
	author?: string;
	minRating?: number;
	maxPrice?: number;
	verifiedOnly?: boolean;
	sortBy: 'relevance' | 'rating' | 'downloads' | 'recent' | 'price';
	limit: number;
	offset: number;
}
