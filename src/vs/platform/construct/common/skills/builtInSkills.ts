// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { ISkill } from './skillService.js';

/**
 * Built-in skills for the Kovix agent.
 * These are defined as TypeScript objects and do not require external files.
 */
export const builtInSkills: ISkill[] = [
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
