/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ISkillsRegistry } from '../../../../../../platform/construct/common/skills/skillsRegistry.js';
import { ISkill, ISkillExecutionContext, ISkillExecutionResult, ISkillStep, SkillStepType } from '../../../../../../platform/construct/common/skills/skillsTypes.js';
import { SkillsEngine } from './skillsEngine.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';

const CUSTOM_SKILLS_KEY = 'construct.skills.custom';

export class SkillsRegistryService extends Disposable implements ISkillsRegistry {
        readonly _serviceBrand: undefined;

        private skills = new Map<string, ISkill>();
        private engine: SkillsEngine;

        private readonly _onDidRegisterSkill = this._register(new Emitter<ISkill>());
        readonly onDidRegisterSkill = this._onDidRegisterSkill.event;

        private readonly _onDidUnregisterSkill = this._register(new Emitter<string>());
        readonly onDidUnregisterSkill = this._onDidUnregisterSkill.event;

        private readonly _onDidStartExecution = this._register(new Emitter<{ executionId: string; skillId: string }>());
        readonly onDidStartExecution = this._onDidStartExecution.event;

        private readonly _onDidCompleteExecution = this._register(new Emitter<ISkillExecutionResult>());
        readonly onDidCompleteExecution = this._onDidCompleteExecution.event;

        private readonly _onDidFailExecution = this._register(new Emitter<{ executionId: string; error: string }>());
        readonly onDidFailExecution = this._onDidFailExecution.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IMCPServerManager private readonly mcpManager: IMCPServerManager,
                @IMemoryOrchestrator private readonly _memory: IMemoryOrchestrator
        ) {
                super();
                this.engine = new SkillsEngine(logService, mcpManager, _memory);
                this.loadCustomSkills();
        }

        registerSkill(skill: ISkill): void {
                const validation = this.validateSkill(skill);
                if (!validation.valid) {
                        this.logService.warn(`[SkillsRegistry] Invalid skill ${skill.id}:`, validation.errors);
                        return;
                }

                this.skills.set(skill.id, skill);
                this.persistCustomSkills();
                this._onDidRegisterSkill.fire(skill);
                this.logService.info(`[SkillsRegistry] Registered skill: ${skill.name}`);
        }

        unregisterSkill(skillId: string): void {
                this.skills.delete(skillId);
                this.persistCustomSkills();
                this._onDidUnregisterSkill.fire(skillId);
        }

        getSkill(skillId: string): ISkill | undefined {
                return this.skills.get(skillId);
        }

        getAllSkills(): ISkill[] {
                return Array.from(this.skills.values());
        }

        async executeSkill(skillId: string, context: ISkillExecutionContext): Promise<ISkillExecutionResult> {
                const skill = this.skills.get(skillId);
                if (!skill) {
                        const error = `Skill ${skillId} not found`;
                        this._onDidFailExecution.fire({ executionId: 'unknown', error });
                        throw new Error(error);
                }

                // Check tool dependencies
                const deps = this.checkToolDependencies(skill);
                if (!deps.available) {
                        const error = `Missing required tools: ${deps.missing.join(', ')}`;
                        this._onDidFailExecution.fire({ executionId: 'unknown', error });
                        throw new Error(error);
                }

                this._onDidStartExecution.fire({ executionId: `exec-${Date.now()}`, skillId });

                const result = await this.engine.executeSkill(skill, context.variables, context.projectId, context.projectPath);

                if (result.success) {
                        this._onDidCompleteExecution.fire(result);
                } else {
                        this._onDidFailExecution.fire({ executionId: `exec-${Date.now()}`, error: result.errors.join('; ') });
                }

                return result;
        }

        executeStep(step: ISkillStep, context: ISkillExecutionContext): Promise<{ success: boolean; output: any }> {
                return this.engine.executeStep(step, context, `exec-${Date.now()}`);
        }

        pauseExecution(executionId: string): void {
                this.engine.pauseExecution(executionId);
        }

        resumeExecution(executionId: string): void {
                this.engine.resumeExecution(executionId);
        }

        cancelExecution(executionId: string): void {
                this.engine.cancelExecution(executionId);
        }

        validateSkill(skill: ISkill): { valid: boolean; errors: string[] } {
                const errors: string[] = [];

                if (!skill.id) { errors.push('Missing skill ID'); }
                if (!skill.name) { errors.push('Missing skill name'); }
                if (!skill.description) { errors.push('Missing skill description'); }
                if (!skill.steps || skill.steps.length === 0) { errors.push('Skill must have at least one step'); }

                for (let i = 0; i < (skill.steps?.length ?? 0); i++) {
                        const step = skill.steps[i];
                        if (!step.type) { errors.push(`Step ${i + 1} missing type`); }
                        if (!step.description) { errors.push(`Step ${i + 1} missing description`); }

                        if (step.type === SkillStepType.ToolCall && !step.toolName) {
                                errors.push(`Step ${i + 1} tool_call missing toolName`);
                        }
                        if (step.type === SkillStepType.FileEdit && !step.filePath) {
                                errors.push(`Step ${i + 1} file_edit missing filePath`);
                        }
                }

                return { valid: errors.length === 0, errors };
        }

        checkToolDependencies(skill: ISkill): { available: boolean; missing: string[] } {
                const installed = this.mcpManager.listInstalledServers().map(s => s.name);
                const missing = skill.requiredTools.filter(tool => !installed.includes(tool));
                return { available: missing.length === 0, missing };
        }

        async suggestSkillsForProject(projectPath: string): Promise<ISkill[]> {
                const allSkills = this.getAllSkills();
                const suggestions: ISkill[] = [];

                // Check for package.json
                try {
                        const result = await this.mcpManager.executeTool('filesystem', 'read_file', {
                                path: `${projectPath}/package.json`
                        });

                        if (result.success) {
                                const pkg = JSON.parse(result.data?.content ?? result.data ?? '{}');
                                const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

                                if (deps['react'] || deps['react-dom']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('react')));
                                }
                                if (deps['next']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('nextjs')));
                                }
                                if (deps['express'] || deps['fastify']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('express') || s.tags.includes('api')));
                                }
                                if (deps['prisma'] || deps['@prisma/client']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('prisma')));
                                }
                                if (deps['three'] || deps['three.js']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('threejs')));
                                }
                                if (deps['react-native']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('react-native')));
                                }
                                if (deps['stripe']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('stripe')));
                                }
                                if (deps['socket.io'] || deps['ws']) {
                                        suggestions.push(...allSkills.filter(s => s.tags.includes('websocket') || s.tags.includes('socket.io')));
                                }
                        }
                } catch {
                        // No package.json or can't read
                }

                // Check for Dockerfile — suggest docker skill if no Dockerfile found
                try {
                        const result = await this.mcpManager.executeTool('filesystem', 'read_file', {
                                path: `${projectPath}/Dockerfile`
                        });
                        if (!result.success) {
                                suggestions.push(...allSkills.filter(s => s.tags.includes('docker')));
                        }
                } catch {
                        suggestions.push(...allSkills.filter(s => s.tags.includes('docker')));
                }

                // Deduplicate and sort by rating
                const seen = new Set<string>();
                const unique = suggestions.filter(s => {
                        if (seen.has(s.id)) { return false; }
                        seen.add(s.id);
                        return true;
                });

                return unique.sort((a, b) => b.rating - a.rating).slice(0, 10);
        }

        private loadCustomSkills(): void {
                try {
                        const custom = this.storageService.getObject<ISkill[]>(CUSTOM_SKILLS_KEY, StorageScope.PROFILE, []);
                        for (const skill of custom) {
                                this.skills.set(skill.id, skill);
                        }
                        this.logService.info(`[SkillsRegistry] Loaded ${custom.length} custom skills`);
                } catch (error) {
                        this.logService.warn('[SkillsRegistry] Failed to load custom skills:', error);
                }
        }

        private persistCustomSkills(): void {
                const custom = Array.from(this.skills.values()).filter(s => !s.verified); // Only persist custom skills
                this.storageService.store(CUSTOM_SKILLS_KEY, custom, StorageScope.PROFILE, StorageTarget.USER);
        }

        override dispose(): void {
                this.engine.dispose();
                super.dispose();
        }
}
