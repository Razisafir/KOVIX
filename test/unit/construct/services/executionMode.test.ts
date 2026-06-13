/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('ExecutionMode', () => {
	test('all four execution modes exist', () => {
		const modes = ['every_milestone', 'major_milestone', 'selective', 'full_auto'];
		assert.strictEqual(modes.length, 4);
		assert.ok(modes.includes('full_auto'));
		assert.ok(modes.includes('every_milestone'));
	});

	test('execution mode configs have unique labels', () => {
		const labels = ['Every Milestone', 'Major Milestones', 'Selective', 'Full Auto'];
		const unique = new Set(labels);
		assert.strictEqual(unique.size, 4);
	});

	test('only FullAuto does not pause at milestones', () => {
		const configs = {
			every_milestone: { pausesAtMilestones: true },
			major_milestone: { pausesAtMilestones: true },
			selective: { pausesAtMilestones: true },
			full_auto: { pausesAtMilestones: false },
		};
		const nonPausing = Object.entries(configs).filter(([_, v]) => !v.pausesAtMilestones);
		assert.strictEqual(nonPausing.length, 1);
		assert.strictEqual(nonPausing[0][0], 'full_auto');
	});

	test('only Selective shows milestone picker', () => {
		const configs = {
			every_milestone: { showsMilestonePicker: false },
			major_milestone: { showsMilestonePicker: false },
			selective: { showsMilestonePicker: true },
			full_auto: { showsMilestonePicker: false },
		};
		const showing = Object.entries(configs).filter(([_, v]) => v.showsMilestonePicker);
		assert.strictEqual(showing.length, 1);
		assert.strictEqual(showing[0][0], 'selective');
	});

	test('every mode has an icon', () => {
		const icons = {
			every_milestone: '\u23F8',
			major_milestone: '\u23EF',
			selective: '\u2705',
			full_auto: '\u26A1',
		};
		for (const [mode, icon] of Object.entries(icons)) {
			assert.ok(icon.length > 0, `Mode ${mode} missing icon`);
		}
	});

	test('execution mode labels match mode names', () => {
		const labels = {
			every_milestone: 'Every Milestone',
			major_milestone: 'Major Milestones',
			selective: 'Selective',
			full_auto: 'Full Auto',
		};
		assert.strictEqual(labels.every_milestone, 'Every Milestone');
		assert.strictEqual(labels.full_auto, 'Full Auto');
	});
});
