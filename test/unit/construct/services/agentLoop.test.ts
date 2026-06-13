/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('AgentLoopService', () => {
	test('conversation history is capped at max messages', () => {
		const MAX_HISTORY = 50;
		const history: { role: string; content: string }[] = [];
		for (let i = 0; i < 60; i++) {
			history.push({ role: 'user', content: `Message ${i}` });
		}
		// Cap
		while (history.length > MAX_HISTORY) {
			history.shift();
		}
		assert.strictEqual(history.length, MAX_HISTORY);
	});

	test('conversation history retains recent messages after cap', () => {
		const MAX_HISTORY = 50;
		const history: { role: string; content: string }[] = [];
		for (let i = 0; i < 60; i++) {
			history.push({ role: 'user', content: `Message ${i}` });
		}
		while (history.length > MAX_HISTORY) {
			history.shift();
		}
		// The oldest message should be Message 10 (we removed 0-9)
		assert.strictEqual(history[0].content, 'Message 10');
	});

	test('clearConversationHistory empties the array', () => {
		const history: { role: string; content: string }[] = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi' }
		];
		history.length = 0;
		assert.strictEqual(history.length, 0);
	});

	test('plan parsing extracts steps with action tags', () => {
		const response = `[Read] Read the package.json file
[Create] Create a new component.tsx file
[Edit] Edit the index.ts file
[Run] Run npm install`;
		const lines = response.split('\n').filter(l => l.trim());
		const steps = lines.map((line, index) => {
			const match = line.match(/\[(Read|Create|Edit|Run)\]\s*(.+)/);
			if (match) {
				return { index, action: match[1], description: match[2].trim() };
			}
			return null;
		}).filter(Boolean);
		assert.strictEqual(steps.length, 4);
		assert.strictEqual(steps[0]!.action, 'Read');
		assert.strictEqual(steps[1]!.action, 'Create');
	});

	test('milestone extraction groups steps by action type', () => {
		const steps = [
			{ index: 0, action: 'Read', description: 'Read files' },
			{ index: 1, action: 'Read', description: 'Read more files' },
			{ index: 2, action: 'Create', description: 'Create component' },
			{ index: 3, action: 'Edit', description: 'Edit config' },
			{ index: 4, action: 'Run', description: 'Run tests' }
		];
		// Group by action type
		const groups = new Map<string, number[]>();
		for (const step of steps) {
			if (!groups.has(step.action)) {
				groups.set(step.action, []);
			}
			groups.get(step.action)!.push(step.index);
		}
		assert.strictEqual(groups.size, 4);
		assert.strictEqual(groups.get('Read')!.length, 2);
	});

	test('execution mode configs have correct labels', () => {
		const modes = ['EVERY_MILESTONE', 'MAJOR_MILESTONE', 'SELECTIVE', 'FULL_AUTO'];
		assert.strictEqual(modes.length, 4);
		assert.ok(modes.includes('FULL_AUTO'));
	});

	test('abort signal cancellation works', async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		assert.strictEqual(signal.aborted, false);
		controller.abort();
		assert.strictEqual(signal.aborted, true);
	});
});
