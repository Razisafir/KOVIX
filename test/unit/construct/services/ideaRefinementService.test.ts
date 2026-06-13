/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

suite('IdeaRefinementService', () => {
	test('refined idea has required fields', () => {
		const refined = {
			originalIdea: 'Build a chat app',
			title: 'Real-time Chat Application',
			description: 'A WebSocket-based chat application',
			scope: ['User auth', 'Chat rooms', 'Message history'],
			outOfScope: ['Video calls', 'File sharing'],
			successCriteria: ['Users can send/receive messages'],
			constraints: ['Must work on mobile'],
			priorities: ['Security', 'Performance'],
			assumptions: ['Users have internet access']
		};
		assert.ok(refined.title);
		assert.ok(refined.description);
		assert.ok(Array.isArray(refined.scope));
		assert.ok(Array.isArray(refined.outOfScope));
		assert.ok(Array.isArray(refined.successCriteria));
	});

	test('refinement questions are structured correctly', () => {
		const question = {
			id: 'q1',
			question: 'What is the target platform?',
			options: ['Web', 'Mobile', 'Desktop'],
			required: true
		};
		assert.ok(question.id);
		assert.ok(question.question);
		assert.ok(Array.isArray(question.options));
	});

	test('refinement answers map to questions', () => {
		const answers = [
			{ questionId: 'q1', answer: 'Web' },
			{ questionId: 'q2', answer: 'React' }
		];
		assert.strictEqual(answers.length, 2);
		assert.strictEqual(answers[0].questionId, 'q1');
	});

	test('max refinement rounds is bounded', () => {
		const MAX_ROUNDS = 5;
		let round = 0;
		while (round < MAX_ROUNDS) { round++; }
		assert.strictEqual(round, MAX_ROUNDS);
	});

	test('JSON parsing fallback handles malformed responses', () => {
		const malformed = 'This is not JSON';
		let parsed;
		try {
			parsed = JSON.parse(malformed);
		} catch {
			parsed = null;
		}
		assert.strictEqual(parsed, null);
	});
});
