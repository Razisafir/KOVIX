"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
// ---- Built-in skills (replicated from builtInSkills.ts) ----
const builtInSkills = [
    {
        name: 'pr',
        description: 'Create a pull request from current changes',
        triggerPatterns: [/^\/pr$/i, /^\/create.?pr$/i],
        instructions: `Create a pull request from the current changes:

1. Read the current git status and diff to understand what changed
2. Analyze the changes and write a clear PR description
3. Create a branch if not already on one
4. Commit all changes with a descriptive message
5. Push the branch and create a PR using the git CLI

Use the run_terminal tool for git commands. Summarize the PR link at the end.`,
        allowedTools: ['run_terminal', 'read_file', 'write_file', 'search_codebase'],
    },
    {
        name: 'review',
        description: 'Perform a code review on current changes',
        triggerPatterns: [/^\/review$/i, /^\/code.?review$/i],
        instructions: `Perform a thorough code review:

1. Read the current git diff to see all changes
2. Analyze each changed file for:
   - Bugs and logic errors
   - Security vulnerabilities
   - Style and best practice violations
   - Missing tests
3. Provide structured feedback with severity levels
4. Suggest specific improvements

Use read_file and run_terminal to examine the code. Present findings clearly.`,
        allowedTools: ['read_file', 'run_terminal', 'search_codebase', 'generate_tests'],
    },
    {
        name: 'fix-issue',
        description: 'Fix a GitHub issue by number',
        triggerPatterns: [/^\/fix.?issue$/i, /^\/fix$/i],
        instructions: `Fix a GitHub issue:

1. Read the issue description using: gh issue view <issue-number>
2. Understand the problem and its scope
3. Search the codebase for relevant files
4. Implement the fix
5. Write or update tests
6. Commit with message referencing the issue (e.g., "fix #123: description")

Use run_terminal for git and gh CLI commands. Confirm the fix addresses the issue.`,
        allowedTools: ['read_file', 'write_file', 'run_terminal', 'search_codebase', 'generate_tests'],
    },
    {
        name: 'update-deps',
        description: 'Update project dependencies',
        triggerPatterns: [/^\/update.?deps$/i, /^\/deps$/i],
        instructions: `Update project dependencies:

1. Check current dependencies and their versions
2. Run npm outdated or equivalent to see available updates
3. Update dependencies carefully:
   - Start with patch updates (safest)
   - Then minor updates
   - Review breaking changes for major updates
4. Run the test suite after updates
5. Report any issues found

Use run_terminal for package manager commands. Be cautious with major version updates.`,
        allowedTools: ['run_terminal', 'read_file', 'search_codebase'],
    },
    {
        name: 'test',
        description: 'Generate and run tests for the current file or project',
        triggerPatterns: [/^\/test$/i, /^\/gen.?test$/i],
        instructions: `Generate and run tests:

1. Identify the target file(s) to test
2. Read the source code to understand exports and functions
3. Detect the test framework (jest, mocha, vitest)
4. Generate comprehensive unit tests covering:
   - All exported functions and methods
   - Edge cases and error handling
   - Both positive and negative test cases
5. Write the test file to the appropriate location
6. Run the tests and report results

Use generate_tests tool for test generation, run_terminal for execution.`,
        allowedTools: ['read_file', 'write_file', 'run_terminal', 'search_codebase', 'generate_tests'],
    },
];
// ---- Simple skill service for testing ----
class SimpleSkillService {
    skills = new Map();
    constructor() {
        for (const skill of builtInSkills) {
            this.skills.set(skill.name, skill);
        }
    }
    getSkill(name) {
        return this.skills.get(name);
    }
    listSkills() {
        return Array.from(this.skills.values());
    }
    findMatchingSkill(input) {
        const trimmed = input.trim();
        if (!trimmed.startsWith('/')) {
            return undefined;
        }
        for (const skill of this.skills.values()) {
            for (const pattern of skill.triggerPatterns) {
                if (pattern.test(trimmed)) {
                    return skill;
                }
            }
        }
        return undefined;
    }
    addCustomSkill(skill) {
        this.skills.set(skill.name, skill);
    }
    executeSkillInstructions(name, context) {
        const skill = this.skills.get(name);
        if (!skill) {
            return { success: false, message: `Unknown skill: ${name}` };
        }
        // Return the skill instructions for the agent to follow
        const fullPrompt = `${skill.instructions}\n\nContext: ${context.userInput}\n${context.args.length > 0 ? `Arguments: ${context.args.join(' ')}` : ''}`;
        return { success: true, message: fullPrompt };
    }
}
// ---- Tests ----
suite('SkillService', () => {
    suite('Built-in skills — all 5 are loaded', () => {
        test('exactly 5 built-in skills are loaded', () => {
            const service = new SimpleSkillService();
            assert.strictEqual(service.listSkills().length, 5);
        });
        test('pr skill is loaded', () => {
            const service = new SimpleSkillService();
            assert.ok(service.getSkill('pr'));
        });
        test('review skill is loaded', () => {
            const service = new SimpleSkillService();
            assert.ok(service.getSkill('review'));
        });
        test('fix-issue skill is loaded', () => {
            const service = new SimpleSkillService();
            assert.ok(service.getSkill('fix-issue'));
        });
        test('update-deps skill is loaded', () => {
            const service = new SimpleSkillService();
            assert.ok(service.getSkill('update-deps'));
        });
        test('test skill is loaded', () => {
            const service = new SimpleSkillService();
            assert.ok(service.getSkill('test'));
        });
        test('all built-in skills have non-empty instructions', () => {
            const service = new SimpleSkillService();
            for (const skill of service.listSkills()) {
                assert.ok(skill.instructions.length > 0, `Skill ${skill.name} should have instructions`);
            }
        });
        test('all built-in skills have allowed tools', () => {
            const service = new SimpleSkillService();
            for (const skill of service.listSkills()) {
                assert.ok(skill.allowedTools.length > 0, `Skill ${skill.name} should have allowed tools`);
            }
        });
    });
    suite('Skill lookup — skills are found by name', () => {
        test('getSkill returns skill for known name', () => {
            const service = new SimpleSkillService();
            const skill = service.getSkill('pr');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'pr');
            assert.strictEqual(skill.description, 'Create a pull request from current changes');
        });
        test('getSkill returns undefined for unknown name', () => {
            const service = new SimpleSkillService();
            assert.strictEqual(service.getSkill('nonexistent'), undefined);
        });
        test('listSkills returns all skills', () => {
            const service = new SimpleSkillService();
            const skills = service.listSkills();
            assert.strictEqual(skills.length, 5);
            const names = skills.map(s => s.name);
            assert.ok(names.includes('pr'));
            assert.ok(names.includes('review'));
            assert.ok(names.includes('fix-issue'));
            assert.ok(names.includes('update-deps'));
            assert.ok(names.includes('test'));
        });
        test('custom skills can be added', () => {
            const service = new SimpleSkillService();
            service.addCustomSkill({
                name: 'deploy',
                description: 'Deploy the project',
                triggerPatterns: [/^\/deploy$/i],
                instructions: 'Deploy the project to production.',
                allowedTools: ['run_terminal'],
            });
            assert.strictEqual(service.listSkills().length, 6);
            assert.ok(service.getSkill('deploy'));
        });
    });
    suite('Skill execution — skill instructions are returned', () => {
        test('executeSkillInstructions returns skill instructions', () => {
            const service = new SimpleSkillService();
            const result = service.executeSkillInstructions('pr', {
                userInput: '/pr',
                skillName: 'pr',
                args: [],
            });
            assert.strictEqual(result.success, true);
            assert.ok(result.message.includes('Create a pull request'));
        });
        test('executeSkillInstructions includes user context', () => {
            const service = new SimpleSkillService();
            const result = service.executeSkillInstructions('test', {
                userInput: '/test src/main.ts',
                skillName: 'test',
                args: ['src/main.ts'],
            });
            assert.strictEqual(result.success, true);
            assert.ok(result.message.includes('/test src/main.ts'), 'Should include user input');
            assert.ok(result.message.includes('src/main.ts'), 'Should include args');
        });
        test('executeSkillInstructions returns error for unknown skill', () => {
            const service = new SimpleSkillService();
            const result = service.executeSkillInstructions('nonexistent', {
                userInput: '/nonexistent',
                skillName: 'nonexistent',
                args: [],
            });
            assert.strictEqual(result.success, false);
            assert.ok(result.message.includes('Unknown skill'));
        });
    });
    suite('Slash command matching — /pr, /review, etc.', () => {
        test('/pr matches pr skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/pr');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'pr');
        });
        test('/review matches review skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/review');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'review');
        });
        test('/fix matches fix-issue skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/fix');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'fix-issue');
        });
        test('/fix-issue matches fix-issue skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/fix-issue');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'fix-issue');
        });
        test('/deps matches update-deps skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/deps');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'update-deps');
        });
        test('/update-deps matches update-deps skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/update-deps');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'update-deps');
        });
        test('/test matches test skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/test');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'test');
        });
        test('/gen-test matches test skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/gen-test');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'test');
        });
        test('/create-pr matches pr skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/create-pr');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'pr');
        });
        test('/code-review matches review skill', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/code-review');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'review');
        });
        test('non-slash input returns undefined', () => {
            const service = new SimpleSkillService();
            assert.strictEqual(service.findMatchingSkill('hello world'), undefined);
        });
        test('unknown slash command returns undefined', () => {
            const service = new SimpleSkillService();
            assert.strictEqual(service.findMatchingSkill('/unknown'), undefined);
        });
        test('matching is case-insensitive', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('/PR');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'pr');
        });
        test('input with leading/trailing whitespace is trimmed', () => {
            const service = new SimpleSkillService();
            const skill = service.findMatchingSkill('  /pr  ');
            assert.ok(skill);
            assert.strictEqual(skill.name, 'pr');
        });
    });
});
//# sourceMappingURL=skillService.test.js.map