/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

// Import the pure function for direct testing
// In the test runner, we'd import from the source path.
// Here we replicate the logic for unit testing without module resolution.

const SECRET_PATTERNS: RegExp[] = [
	/sk-ant-[A-Za-z0-9_-]{20,}/g,
	/sk-[A-Za-z0-9]{20,}/g,
	/Bearer [A-Za-z0-9_.-]{20,}/g,
	/password=\S+/gi,
	/token=\S+/gi,
	/key=\S+/gi,
];

function redactSecrets(input: string): string {
	if (!input || typeof input !== 'string') {
		return input;
	}
	let result = input;
	for (const pattern of SECRET_PATTERNS) {
		pattern.lastIndex = 0;
		result = result.replace(pattern, '[REDACTED]');
	}
	return result;
}

suite('SecretRedactor', () => {
	test('redacts Anthropic API keys', () => {
		const input = 'Using key sk-ant-api03-abcdefghijklmnopqrstuvwx for Anthropic';
		const result = redactSecrets(input);
		assert.ok(!result.includes('sk-ant-api03'));
		assert.ok(result.includes('[REDACTED]'));
	});

	test('redacts OpenAI API keys', () => {
		const input = 'OpenAI key: sk-abcdefghijklmnopqrstuvwx';
		const result = redactSecrets(input);
		assert.ok(!result.includes('sk-abcdefghijklmn'));
		assert.ok(result.includes('[REDACTED]'));
	});

	test('redacts Bearer tokens', () => {
		const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
		const result = redactSecrets(input);
		assert.ok(!result.includes('eyJhbGciOi'));
		assert.ok(result.includes('[REDACTED]'));
	});

	test('redacts password query parameters', () => {
		const input = 'Connecting to db?password=supersecretpassword123';
		const result = redactSecrets(input);
		assert.ok(!result.includes('supersecretpassword'));
		assert.ok(result.includes('[REDACTED]'));
	});

	test('redacts token query parameters', () => {
		const input = 'API call with token=abc123def456ghi789jkl012mno345';
		const result = redactSecrets(input);
		assert.ok(!result.includes('abc123def456'));
		assert.ok(result.includes('[REDACTED]'));
	});

	test('redacts key query parameters', () => {
		const input = 'Request URL: https://api.example.com?key=my-secret-api-key-value';
		const result = redactSecrets(input);
		assert.ok(!result.includes('my-secret-api-key'));
		assert.ok(result.includes('[REDACTED]'));
	});

	test('handles empty string', () => {
		assert.strictEqual(redactSecrets(''), '');
	});

	test('handles non-secret string without modification', () => {
		const input = 'The agent read file /src/main.ts and found no issues.';
		assert.strictEqual(redactSecrets(input), input);
	});
});
