/*---------------------------------------------------------------------------------------------
 *  Construct IDE - ContextBudget Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ContextBudget } from '../../../src/construct/services/ContextBudget';

describe('ContextBudget', () => {
	let budget: ContextBudget;

	beforeEach(() => {
		budget = new ContextBudget();
	});

	describe('estimateTokens', () => {
		test('returns Math.ceil(text.length / 4)', () => {
			expect(ContextBudget.estimateTokens('')).toBe(0);
			expect(ContextBudget.estimateTokens('a')).toBe(1);
			expect(ContextBudget.estimateTokens('abcd')).toBe(1);
			expect(ContextBudget.estimateTokens('abcde')).toBe(2);
		});
	});

	describe('addConversationEntry', () => {
		test('adds entries and tracks usage', () => {
			budget.addConversationEntry({ role: 'user', content: 'Hello World!' });
			expect(budget.getCurrentUsage()).toBe(ContextBudget.estimateTokens('Hello World!'));
		});

		test('trims oldest non-system messages when max entries exceeded', () => {
			// Add 25 entries (max is 20)
			for (let i = 0; i < 25; i++) {
				budget.addConversationEntry({ role: 'user', content: `Message ${i}` });
			}
			// Should have trimmed to max 20
			expect(budget.getEntries().length).toBeLessThanOrEqual(20);
		});

		test('never trims system messages', () => {
			budget.addConversationEntry({ role: 'system', content: 'You are a helpful assistant.' });
			for (let i = 0; i < 25; i++) {
				budget.addConversationEntry({ role: 'user', content: `Message ${i}` });
			}
			const entries = budget.getEntries();
			const systemEntries = entries.filter(e => e.role === 'system');
			expect(systemEntries.length).toBe(1);
			expect(systemEntries[0].content).toBe('You are a helpful assistant.');
		});
	});

	describe('canAddPrompt', () => {
		test('returns true when budget allows', () => {
			budget.addConversationEntry({ role: 'user', content: 'short' });
			expect(budget.canAddPrompt('another short prompt')).toBe(true);
		});

		test('returns false when over hard limit', () => {
			// Fill up to near the hard limit
			const longContent = 'a'.repeat(ContextBudget.HARD_LIMIT * 4);
			budget.addConversationEntry({ role: 'user', content: longContent });
			expect(budget.canAddPrompt('any prompt')).toBe(false);
		});
	});

	describe('ensureBudget', () => {
		test('trims entries to make room', () => {
			// Add many entries
			for (let i = 0; i < 15; i++) {
				budget.addConversationEntry({ role: 'user', content: `Message ${i} with some content` });
			}
			const shortPrompt = 'Hello';
			budget.ensureBudget(shortPrompt);
			expect(budget.canAddPrompt(shortPrompt)).toBe(true);
		});

		test('preserves system messages when trimming', () => {
			budget.addConversationEntry({ role: 'system', content: 'System prompt' });
			for (let i = 0; i < 15; i++) {
				budget.addConversationEntry({ role: 'user', content: `Message ${i} with some content` });
			}
			budget.ensureBudget('test');
			const entries = budget.getEntries();
			expect(entries.some(e => e.role === 'system')).toBe(true);
		});

		test('throws when prompt itself exceeds hard limit', () => {
			const hugePrompt = 'a'.repeat((ContextBudget.HARD_LIMIT + 1000) * 4);
			expect(() => budget.ensureBudget(hugePrompt)).toThrow('Cannot fit prompt');
		});
	});

	describe('getCurrentUsage', () => {
		test('returns 0 for empty budget', () => {
			expect(budget.getCurrentUsage()).toBe(0);
		});

		test('sums token estimates of all entries', () => {
			budget.addConversationEntry({ role: 'user', content: 'Hello' });
			budget.addConversationEntry({ role: 'assistant', content: 'World' });
			const expected = ContextBudget.estimateTokens('Hello') + ContextBudget.estimateTokens('World');
			expect(budget.getCurrentUsage()).toBe(expected);
		});
	});

	describe('reset', () => {
		test('clears all entries', () => {
			budget.addConversationEntry({ role: 'user', content: 'Hello' });
			budget.reset();
			expect(budget.getCurrentUsage()).toBe(0);
			expect(budget.getEntries().length).toBe(0);
		});
	});
});
