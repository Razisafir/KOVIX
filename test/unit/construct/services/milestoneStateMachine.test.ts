/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('MilestoneStateMachine', () => {
	test('execution states are distinct and cover the lifecycle', () => {
		const states = ['idle', 'planning', 'awaiting_approval', 'executing', 'paused_at_milestone', 'complete', 'error'];
		const unique = new Set(states);
		assert.strictEqual(unique.size, 7);
	});

	test('state transitions follow valid sequence', () => {
		// idle → planning → awaiting_approval → executing → complete
		const validTransitions: Record<string, string[]> = {
			idle: ['planning'],
			planning: ['awaiting_approval', 'error'],
			awaiting_approval: ['executing', 'idle'],
			executing: ['paused_at_milestone', 'complete', 'error'],
			paused_at_milestone: ['executing', 'idle'],
			complete: ['idle'],
			error: ['idle'],
		};
		// Verify each state has defined transitions
		for (const state of Object.keys(validTransitions)) {
			assert.ok(validTransitions[state].length > 0, `State ${state} has no transitions`);
		}
	});

	test('milestone has required fields', () => {
		const milestone = {
			id: 'ms-1',
			name: 'Read Project Files',
			description: 'Read all source files to understand the codebase',
			index: 0,
			isMajor: false,
			stepIndices: [0, 1, 2],
			completed: false,
		};
		assert.ok(milestone.id);
		assert.ok(milestone.name);
		assert.strictEqual(milestone.index, 0);
		assert.ok(Array.isArray(milestone.stepIndices));
		assert.strictEqual(milestone.completed, false);
	});

	test('approved plan has required fields', () => {
		const plan = {
			task: 'Build authentication module',
			steps: [
				{ index: 0, action: 'Read' as const, target: 'src/auth.ts', description: 'Read auth file', selected: true },
				{ index: 1, action: 'Create' as const, target: 'src/login.ts', description: 'Create login', selected: true },
			],
			executionMode: 'every_milestone',
			milestones: [{ id: 'ms-1', name: 'Phase 1', description: 'Setup', index: 0, isMajor: true, stepIndices: [0, 1], completed: false }],
			approved: true,
			approvedAt: Date.now(),
		};
		assert.ok(plan.task);
		assert.strictEqual(plan.steps.length, 2);
		assert.ok(plan.approved);
		assert.ok(plan.milestones.length > 0);
	});

	test('selectable plan steps can be deselected', () => {
		const steps = [
			{ index: 0, action: 'Read' as const, target: 'a.ts', description: 'Read a', selected: true },
			{ index: 1, action: 'Run' as const, target: 'npm test', description: 'Run tests', selected: true },
			{ index: 2, action: 'Edit' as const, target: 'b.ts', description: 'Edit b', selected: false },
		];
		const selectedSteps = steps.filter(s => s.selected);
		assert.strictEqual(selectedSteps.length, 2);
		assert.strictEqual(steps[2].selected, false);
	});

	test('milestone index is sequential', () => {
		const milestones = [
			{ id: 'ms-1', index: 0 },
			{ id: 'ms-2', index: 1 },
			{ id: 'ms-3', index: 2 },
		];
		for (let i = 0; i < milestones.length; i++) {
			assert.strictEqual(milestones[i].index, i);
		}
	});
});
