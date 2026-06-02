/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMemoryOrchestrator } from '../../../../../../platform/construct/common/memory/memoryOrchestrator.js';
import { AgentType, IAgentInstance, AgentStatus } from '../../../../../../platform/construct/common/orchestration/agentTypes.js';

/* eslint-disable @typescript-eslint/no-unused-vars */

interface IAgentConfig {
        systemPrompt: string;
        model: string;
        availableTools: string[];
        memoryAccess: 'read' | 'read_write' | 'none';
        maxTokens: number;
        temperature: number;
        creditMultiplier: number;
}

export class AgentFactory {
        private configs: Map<AgentType, IAgentConfig> = new Map();

        constructor(
                @ILogService private readonly _logService: ILogService,
                @IMCPServerManager private readonly _mcpManager: IMCPServerManager,
                @IMemoryOrchestrator private readonly _memory: IMemoryOrchestrator
        ) {
                this.initializeConfigs();
        }

        private initializeConfigs(): void {
                this.configs.set(AgentType.Planner, {
                        systemPrompt: `You are the Master Planner for CONSTRUCT IDE. Your role is to decompose high-level goals into precise, executable tasks with clear dependencies. You understand software architecture, can identify parallelizable work, and create milestone-based execution plans. Always return structured output with task IDs, dependencies, estimated complexity, and file targets.`,
                        model: 'claude-opus',
                        availableTools: ['memory_query', 'codebase_search', 'file_read'],
                        memoryAccess: 'read',
                        maxTokens: 8000,
                        temperature: 0.2,
                        creditMultiplier: 3
                });

                this.configs.set(AgentType.Coder, {
                        systemPrompt: `You are an expert software engineer working in CONSTRUCT IDE. You write clean, well-documented code following best practices. You have access to the full codebase context and can make multi-file edits atomically. Always verify your changes compile and tests pass. Prefer TypeScript, Rust, or Python depending on the project context.`,
                        model: 'claude-sonnet',
                        availableTools: ['file_read', 'file_write', 'terminal_execute', 'git_commit', 'memory_read'],
                        memoryAccess: 'read_write',
                        maxTokens: 4000,
                        temperature: 0.1,
                        creditMultiplier: 1
                });

                this.configs.set(AgentType.Tester, {
                        systemPrompt: `You are a Test Engineer in CONSTRUCT IDE. You write comprehensive tests (unit, integration, e2e) that cover edge cases, error paths, and boundary conditions. You use the testing framework already established in the project. Aim for >80% coverage. Report coverage metrics and failing tests clearly.`,
                        model: 'gpt-4o-mini',
                        availableTools: ['file_read', 'file_write', 'terminal_execute', 'test_runner'],
                        memoryAccess: 'read',
                        maxTokens: 4000,
                        temperature: 0.1,
                        creditMultiplier: 1
                });

                this.configs.set(AgentType.Reviewer, {
                        systemPrompt: `You are a Senior Code Reviewer in CONSTRUCT IDE. You catch bugs, security vulnerabilities, performance issues, and style violations. You review diffs against best practices (OWASP, performance, maintainability). Be thorough but constructive. Block commits on critical issues.`,
                        model: 'claude-opus',
                        availableTools: ['file_read', 'diff_view', 'security_scan', 'lint_runner'],
                        memoryAccess: 'read',
                        maxTokens: 6000,
                        temperature: 0.1,
                        creditMultiplier: 2
                });

                this.configs.set(AgentType.Browser, {
                        systemPrompt: `You are a Frontend Validation Agent in CONSTRUCT IDE. You use Playwright to test UI functionality, take screenshots, validate visual output, and report accessibility issues. You understand DOM structure, CSS, and responsive design. Compare screenshots to detect visual regressions.`,
                        model: 'claude-sonnet',
                        availableTools: ['browser_navigate', 'browser_screenshot', 'browser_click', 'browser_fill', 'browser_evaluate'],
                        memoryAccess: 'read',
                        maxTokens: 3000,
                        temperature: 0.1,
                        creditMultiplier: 2
                });

                this.configs.set(AgentType.DevOps, {
                        systemPrompt: `You are a DevOps Engineer in CONSTRUCT IDE. You manage CI/CD pipelines, Docker containers, cloud deployments, and infrastructure as code. You use the project's existing deployment configuration. Always verify deployments with health checks and rollback on failure.`,
                        model: 'gpt-4o',
                        availableTools: ['terminal_execute', 'file_read', 'file_write', 'docker_ps', 'deploy_trigger'],
                        memoryAccess: 'read_write',
                        maxTokens: 4000,
                        temperature: 0.1,
                        creditMultiplier: 1
                });

                this.configs.set(AgentType.Researcher, {
                        systemPrompt: `You are a Research Agent in CONSTRUCT IDE. You search documentation, GitHub issues, Stack Overflow, and API references to find solutions to technical problems. You summarize findings and provide actionable recommendations with code examples.`,
                        model: 'gpt-4o',
                        availableTools: ['web_search', 'doc_read', 'github_search', 'memory_query'],
                        memoryAccess: 'read',
                        maxTokens: 4000,
                        temperature: 0.3,
                        creditMultiplier: 1
                });

                this.configs.set(AgentType.DocWriter, {
                        systemPrompt: `You are a Technical Writer in CONSTRUCT IDE. You write clear documentation, README files, API docs, and inline comments. You follow the project's documentation style. Update docs when code changes. Generate changelogs from git history.`,
                        model: 'gpt-4o-mini',
                        availableTools: ['file_read', 'file_write', 'git_log', 'memory_read'],
                        memoryAccess: 'read',
                        maxTokens: 3000,
                        temperature: 0.2,
                        creditMultiplier: 1
                });
        }

        createAgent(type: AgentType, task: string, planId: string, dependencies: string[] = []): IAgentInstance {
                const config = this.configs.get(type)!;
                const id = `${planId}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

                return {
                        id,
                        type,
                        status: AgentStatus.Idle,
                        task,
                        dependencies,
                        dependents: [],
                        output: '',
                        filesTouched: [],
                        creditsConsumed: 0,
                        model: config.model,
                        systemPrompt: config.systemPrompt
                };
        }

        getConfig(type: AgentType): IAgentConfig {
                return this.configs.get(type)!;
        }

        getAvailableTools(type: AgentType): string[] {
                return this.configs.get(type)?.availableTools ?? [];
        }

        estimateCredits(type: AgentType, estimatedActions: number): number {
                const config = this.configs.get(type);
                if (!config) { return estimatedActions; }
                return estimatedActions * config.creditMultiplier;
        }
}
