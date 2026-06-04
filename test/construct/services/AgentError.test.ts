/*---------------------------------------------------------------------------------------------
 *  Construct IDE - AgentError Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { AgentError } from '../../../src/construct/services/AgentError';

describe('AgentError', () => {
	test('creates error with TOOL_FAILURE code', () => {
		const err = new AgentError('Tool failed', 'TOOL_FAILURE');
		expect(err.message).toBe('Tool failed');
		expect(err.code).toBe('TOOL_FAILURE');
		expect(err.name).toBe('AgentError');
	});

	test('creates error with LLM_TIMEOUT code', () => {
		const err = new AgentError('Timeout', 'LLM_TIMEOUT');
		expect(err.code).toBe('LLM_TIMEOUT');
	});

	test('creates error with MAX_ROUNDS code', () => {
		const err = new AgentError('Max rounds', 'MAX_ROUNDS');
		expect(err.code).toBe('MAX_ROUNDS');
	});

	test('toString includes code and message', () => {
		const err = new AgentError('Test error', 'TOOL_FAILURE');
		expect(err.toString()).toBe('AgentError [TOOL_FAILURE]: Test error');
	});

	test('is instance of Error', () => {
		const err = new AgentError('Test', 'TOOL_FAILURE');
		expect(err).toBeInstanceOf(Error);
	});
});
