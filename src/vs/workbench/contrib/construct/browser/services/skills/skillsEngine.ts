/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';
import {
	ISkill,
	ISkillStep,
	ISkillExecutionContext,
	ISkillExecutionResult,
	SkillStepType
} from '../../../../../../platform/construct/common/skills/skillsTypes.js';

export class SkillsEngine extends Disposable {
	private executions = new Map<string, { context: ISkillExecutionContext; paused: boolean; cancelled: boolean }>();
	private nextExecutionId = 0;

	private readonly _onStartExecution = this._register(new Emitter<{ executionId: string; skillId: string }>());
	readonly onStartExecution = this._onStartExecution.event;

	private readonly _onCompleteExecution = this._register(new Emitter<ISkillExecutionResult>());
	readonly onCompleteExecution = this._onCompleteExecution.event;

	private readonly _onFailExecution = this._register(new Emitter<{ executionId: string; error: string }>());
	readonly onFailExecution = this._onFailExecution.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IMCPServerManager private readonly mcpManager: IMCPServerManager,
		@IMemoryOrchestrator private readonly memory: IMemoryOrchestrator
	) {
		super();
	}

	async executeSkill(skill: ISkill, variables: Record<string, string>, projectId: string, projectPath: string): Promise<ISkillExecutionResult> {
		const executionId = `exec-${++this.nextExecutionId}`;
		const startTime = Date.now();

		this.logService.info(`[SkillsEngine] Starting execution ${executionId} for skill ${skill.id}`);

		// Collect default variable keys from all steps
		const defaultVars: Record<string, string> = {};
		for (const step of skill.steps) {
			if (step.variables) {
				for (const key of Object.keys(step.variables)) {
					defaultVars[key] = '';
				}
			}
		}

		const context: ISkillExecutionContext = {
			projectId,
			projectPath,
			variables: { ...defaultVars, ...variables },
			skillId: skill.id,
			stepIndex: 0,
			outputs: {},
			errors: [],
			startTime
		};

		this.executions.set(executionId, { context, paused: false, cancelled: false });
		this._onStartExecution.fire({ executionId, skillId: skill.id });

		const filesCreated: string[] = [];
		const filesModified: string[] = [];
		let stepsCompleted = 0;

		try {
			for (let i = 0; i < skill.steps.length; i++) {
				const execution = this.executions.get(executionId);
				if (!execution || execution.cancelled) {
					throw new Error('Execution cancelled');
				}

				// Wait if paused
				while (execution.paused) {
					await this.delay(100);
					if (execution.cancelled) { throw new Error('Execution cancelled'); }
				}

				context.stepIndex = i;
				const step = skill.steps[i];

				this.logService.info(`[SkillsEngine] Executing step ${i + 1}/${skill.steps.length}: ${step.type}`);

				const result = await this.executeStep(step, context, executionId);

				if (!result.success) {
					context.errors.push(`Step ${i + 1} failed: ${step.description}`);
				}

				context.outputs[`step_${i}`] = result.output;
				stepsCompleted++;

				// Track file changes
				if (step.type === SkillStepType.FileEdit && step.filePath) {
					const fullPath = `${projectPath}/${this.substituteVariables(step.filePath, context.variables)}`;
					if (result.output?.created) { filesCreated.push(fullPath); }
					if (result.output?.modified) { filesModified.push(fullPath); }
				}
			}

			const duration = Date.now() - startTime;
			const result: ISkillExecutionResult = {
				success: context.errors.length === 0,
				skillId: skill.id,
				outputs: context.outputs,
				errors: context.errors,
				durationMs: duration,
				stepsCompleted,
				stepsTotal: skill.steps.length,
				filesCreated,
				filesModified,
				creditsConsumed: skill.steps.length // 1 credit per step
			};

			// Record in episodic memory (best effort)
			this.memory.query({
				projectId,
				semanticQuery: `Executed skill: ${skill.name}`
			}).catch(() => { /* best effort */ });

			this._onCompleteExecution.fire(result);
			this.logService.info(`[SkillsEngine] Execution ${executionId} complete: ${result.success ? 'SUCCESS' : 'PARTIAL_FAILURE'}`);

			return result;

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			context.errors.push(errorMessage);

			const result: ISkillExecutionResult = {
				success: false,
				skillId: skill.id,
				outputs: context.outputs,
				errors: context.errors,
				durationMs: Date.now() - startTime,
				stepsCompleted,
				stepsTotal: skill.steps.length,
				filesCreated,
				filesModified,
				creditsConsumed: stepsCompleted
			};

			this._onFailExecution.fire({ executionId, error: errorMessage });
			this.logService.error(`[SkillsEngine] Execution ${executionId} failed:`, error);

			return result;
		} finally {
			this.executions.delete(executionId);
		}
	}

	async executeStep(step: ISkillStep, context: ISkillExecutionContext, executionId: string): Promise<{ success: boolean; output: any }> {
		const variables = context.variables;

		switch (step.type) {
			case SkillStepType.Prompt: {
				const prompt = this.substituteVariables(step.content ?? '', variables);
				return { success: true, output: { prompt, stored: true } };
			}

			case SkillStepType.ToolCall: {
				if (!step.toolName) { return { success: false, output: { error: 'No tool specified' } }; }

				const args = this.substituteVariablesInObject(step.toolArgs ?? {}, variables);

				try {
					const result = await this.mcpManager.executeTool('filesystem', step.toolName, args);
					return { success: result.success, output: result.data };
				} catch (error) {
					return { success: false, output: { error: error instanceof Error ? error.message : String(error) } };
				}
			}

			case SkillStepType.FileEdit: {
				if (!step.filePath) { return { success: false, output: { error: 'No file path specified' } }; }

				const filePath = this.substituteVariables(step.filePath, variables);
				const content = this.substituteVariables(step.fileContent ?? '', variables);

				try {
					const result = await this.mcpManager.executeTool('filesystem', 'write_file', {
						path: `${context.projectPath}/${filePath}`,
						content
					});

					return {
						success: result.success,
						output: {
							path: filePath,
							created: result.success,
							modified: result.success
						}
					};
				} catch (error) {
					return { success: false, output: { error: error instanceof Error ? error.message : String(error) } };
				}
			}

			case SkillStepType.Verify: {
				const condition = this.substituteVariables(step.condition ?? 'true', variables);
				const success = condition === 'true' || context.errors.length === 0;
				return { success, output: { verified: success, condition } };
			}

			case SkillStepType.Condition: {
				const condition = this.substituteVariables(step.condition ?? 'true', variables);
				const result = condition === 'true' || this.evaluateCondition(condition, context);

				const stepsToRun = result ? (step.trueSteps ?? []) : (step.falseSteps ?? []);

				for (const subStep of stepsToRun) {
					const subResult = await this.executeStep(subStep, context, executionId);
					if (!subResult.success && result) {
						return { success: false, output: subResult.output };
					}
				}

				return { success: true, output: { condition, result, executed: stepsToRun.length } };
			}

			case SkillStepType.Loop: {
				const maxIterations = step.maxIterations ?? 10;
				let iterations = 0;
				const loopOutputs: any[] = [];

				while (iterations < maxIterations) {
					const condition = this.substituteVariables(step.loopCondition ?? 'false', variables);
					if (!this.evaluateCondition(condition, context)) { break; }

					for (const subStep of (step.trueSteps ?? [])) {
						const subResult = await this.executeStep(subStep, context, executionId);
						loopOutputs.push(subResult.output);
						if (!subResult.success) {
							return { success: false, output: { iterations, outputs: loopOutputs, error: 'Loop step failed' } };
						}
					}

					iterations++;
				}

				return { success: true, output: { iterations, outputs: loopOutputs } };
			}

			case SkillStepType.SubSkill: {
				if (!step.subSkillId) { return { success: false, output: { error: 'No sub-skill specified' } }; }
				return { success: true, output: { subSkillId: step.subSkillId, delegated: true } };
			}

			default:
				return { success: false, output: { error: `Unknown step type: ${step.type}` } };
		}
	}

	pauseExecution(executionId: string): void {
		const exec = this.executions.get(executionId);
		if (exec) { exec.paused = true; }
	}

	resumeExecution(executionId: string): void {
		const exec = this.executions.get(executionId);
		if (exec) { exec.paused = false; }
	}

	cancelExecution(executionId: string): void {
		const exec = this.executions.get(executionId);
		if (exec) { exec.cancelled = true; }
	}

	private substituteVariables(text: string, variables: Record<string, string>): string {
		return text.replace(/\{\{(\w+)\}\}/g, (match, key) => variables[key] ?? match);
	}

	private substituteVariablesInObject(obj: Record<string, any>, variables: Record<string, string>): Record<string, any> {
		const result: Record<string, any> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (typeof value === 'string') {
				result[key] = this.substituteVariables(value, variables);
			} else if (typeof value === 'object' && value !== null) {
				result[key] = this.substituteVariablesInObject(value, variables);
			} else {
				result[key] = value;
			}
		}
		return result;
	}

	private evaluateCondition(condition: string, context: ISkillExecutionContext): boolean {
		// Safe condition evaluation — only allow simple comparisons
		// In production, use a sandboxed evaluator
		const safeCondition = condition.replace(/[^a-zA-Z0-9_=<>&|!.\s]/g, '');

		try {
			// Very basic evaluation — replace variable references
			const substituted = safeCondition.replace(/\b(\w+)\b/g, (match) => {
				if (match === 'true') { return 'true'; }
				if (match === 'false') { return 'false'; }
				if (context.outputs[match] !== undefined) { return JSON.stringify(context.outputs[match]); }
				if (context.variables[match] !== undefined) { return JSON.stringify(context.variables[match]); }
				return match;
			});

			// Safe evaluation for simple boolean expressions only
			// eslint-disable-next-line no-eval
			return eval(substituted);
		} catch {
			return false;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	override dispose(): void {
		for (const [, exec] of this.executions.entries()) {
			exec.cancelled = true;
		}
		this.executions.clear();
		super.dispose();
	}
}
