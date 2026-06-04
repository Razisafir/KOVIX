/*---------------------------------------------------------------------------------------------
 *  Construct IDE - LLMBridge Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { LLMBridge } from '../../../src/construct/services/LLMBridge';

describe('LLMBridge', () => {
	describe('estimateTokens', () => {
		test('returns Math.ceil(text.length / 4)', () => {
			expect(LLMBridge.estimateTokens('')).toBe(0);
			expect(LLMBridge.estimateTokens('a')).toBe(1);
			expect(LLMBridge.estimateTokens('abcd')).toBe(1);
			expect(LLMBridge.estimateTokens('abcde')).toBe(2);
			expect(LLMBridge.estimateTokens('Hello World!')).toBe(3);
		});

		test('handles long text', () => {
			const longText = 'a'.repeat(1000);
			expect(LLMBridge.estimateTokens(longText)).toBe(250);
		});
	});

	describe('getTokenEstimator', () => {
		test('returns a function that estimates tokens', () => {
			const mockSecrets = { get: async () => 'test-key' };
			const bridge = new LLMBridge(mockSecrets);
			const estimator = bridge.getTokenEstimator();
			expect(typeof estimator).toBe('function');
			expect(estimator('Hello')).toBe(LLMBridge.estimateTokens('Hello'));
		});
	});

	describe('constructor', () => {
		test('creates instance with secrets', () => {
			const mockSecrets = { get: async () => 'key' };
			const bridge = new LLMBridge(mockSecrets);
			expect(bridge).toBeInstanceOf(LLMBridge);
		});

		test('creates instance with explicit API key', () => {
			const mockSecrets = { get: async () => undefined };
			const bridge = new LLMBridge(mockSecrets, 'explicit-key');
			expect(bridge).toBeInstanceOf(LLMBridge);
		});
	});

	describe('MAX_TOKENS_PER_TURN', () => {
		test('is 30000', () => {
			expect(LLMBridge.MAX_TOKENS_PER_TURN).toBe(30_000);
		});
	});
});
