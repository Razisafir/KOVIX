/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IAgentLoop } from '../../../../../../platform/construct/common/agent/agentLoop.js';
import {
        ISkillService, ISkill, ISkillContext, ISkillResult
} from '../../../../../../platform/construct/common/skills/skillService.js';
import { builtInSkills } from '../../../../../../platform/construct/common/skills/builtInSkills.js';

export class SkillServiceImpl extends Disposable implements ISkillService {
        declare readonly _serviceBrand: undefined;

        private skills: Map<string, ISkill> = new Map();

        constructor(
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IAgentLoop private readonly agentLoop: IAgentLoop,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                // Load built-in skills immediately
                for (const skill of builtInSkills) {
                        this.skills.set(skill.name, skill);
                }
        }

        async loadSkills(): Promise<void> {
                // Built-in skills are already loaded in constructor
                // Load custom skills from .kovix/skills/ directory
                const workspace = this.workspaceContextService.getWorkspace();
                if (!workspace.folders.length) { return; }

                try {
                        const skillsDir = URI.joinPath(workspace.folders[0].uri, '.kovix', 'skills');
                        const stat = await this.fileService.resolve(skillsDir);
                        if (stat.children) {
                                for (const child of stat.children) {
                                        if (child.isFile && (child.name.endsWith('.md') || child.name.endsWith('.markdown'))) {
                                                await this.loadSkillFile(child.resource);
                                        }
                                }
                        }
                } catch {
                        // .kovix/skills/ may not exist, that's fine
                }
        }

        private async loadSkillFile(uri: any): Promise<void> {
                try {
                        const content = await this.fileService.readFile(uri);
                        const text = content.value.toString();
                        const skill = this.parseSkillMarkdown(text, uri.path);
                        if (skill) {
                                this.skills.set(skill.name, skill);
                                this.logService.info(`[SkillService] Loaded skill: ${skill.name}`);
                        }
                } catch (error) {
                        this.logService.warn('[SkillService] Failed to load skill file:', uri.toString(), error);
                }
        }

        private parseSkillMarkdown(text: string, filePath: string): ISkill | undefined {
                // Parse frontmatter (YAML between --- delimiters)
                const frontmatterMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
                if (!frontmatterMatch) { return undefined; }

                const frontmatter = frontmatterMatch[1];
                const instructions = frontmatterMatch[2].trim();

                // Simple YAML parsing for frontmatter
                const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
                const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
                const triggersMatch = frontmatter.match(/^triggers:\s*(.+)$/m);
                const toolsMatch = frontmatter.match(/^allowedTools:\s*\[(.+)\]$/m);

                if (!nameMatch) { return undefined; }

                const name = nameMatch[1].trim();
                const description = descMatch ? descMatch[1].trim() : '';
                const triggerStr = triggersMatch ? triggersMatch[1].trim() : name;
                const toolsStr = toolsMatch ? toolsMatch[1].trim() : '';

                return {
                        name,
                        description,
                        triggerPatterns: [new RegExp(`^/${triggerStr}$`, 'i')],
                        instructions,
                        allowedTools: toolsStr ? toolsStr.split(',').map(t => t.trim().replace(/['"]/g, '')) : [],
                };
        }

        getSkill(name: string): ISkill | undefined {
                return this.skills.get(name);
        }

        async executeSkill(name: string, context: ISkillContext): Promise<ISkillResult> {
                const skill = this.skills.get(name);
                if (!skill) {
                        return { success: false, message: `Unknown skill: ${name}` };
                }

                try {
                        // Execute the skill by running the agent loop with the skill's instructions
                        const fullPrompt = `${skill.instructions}\n\nContext: ${context.userInput}\n${context.args.length > 0 ? `Arguments: ${context.args.join(' ')}` : ''}`;

                        // Run the agent loop with the skill instructions
                        let summary = '';
                        for await (const event of this.agentLoop.run(fullPrompt)) {
                                if (event.type === 'complete') {
                                        summary = event.summary;
                                }
                                if (event.type === 'error') {
                                        return { success: false, message: `Skill execution error: ${event.text}` };
                                }
                        }

                        return { success: true, message: summary || `Skill "${name}" completed.` };
                } catch (error) {
                        return { success: false, message: `Skill execution failed: ${error instanceof Error ? error.message : String(error)}` };
                }
        }

        listSkills(): ISkill[] {
                return Array.from(this.skills.values());
        }

        findMatchingSkill(input: string): ISkill | undefined {
                const trimmed = input.trim();
                if (!trimmed.startsWith('/')) { return undefined; }

                for (const skill of this.skills.values()) {
                        for (const pattern of skill.triggerPatterns) {
                                if (pattern.test(trimmed)) {
                                        return skill;
                                }
                        }
                }
                return undefined;
        }
}
