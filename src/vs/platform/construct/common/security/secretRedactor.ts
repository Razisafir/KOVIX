/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


/**
 * SEC-5: Secret redaction utility.
 *
 * API keys must never appear in any log file, IPC message, or audit trail.
 * This module provides a redactSecrets() function that scrubs known secret
 * patterns from any string before logging.
 *
 * Patterns covered:
 * - Anthropic keys: sk-ant-...
 * - OpenAI keys: sk-...
 * - Bearer tokens: Bearer ...
 * - Password/token/key query parameters
 */

/**
 * Secret patterns to redact from any string before logging.
 * Each pattern is applied globally (all occurrences replaced).
 */
export const SECRET_PATTERNS: RegExp[] = [
	/sk-ant-[A-Za-z0-9_-]{20,}/g,
	/sk-[A-Za-z0-9]{20,}/g,
	/Bearer [A-Za-z0-9_.-]{20,}/g,
	/password=\S+/gi,
	/token=\S+/gi,
	/key=\S+/gi,
];

/**
 * SEC-5: Redact known secret patterns from a string.
 * Replace all occurrences of known secret patterns with [REDACTED].
 *
 * This MUST be applied to ALL logger calls in construct code.
 * Usage:
 *   this.logService.info(redactSecrets(`Processing: ${someData}`));
 *   console.log(redactSecrets(output));
 *
 * @param input The string to redact.
 * @returns The redacted string with secrets replaced by [REDACTED].
 */
export function redactSecrets(input: string): string {
	if (!input || typeof input !== 'string') {
		return input;
	}

	let result = input;
	for (const pattern of SECRET_PATTERNS) {
		// Reset lastIndex for global regex reuse
		pattern.lastIndex = 0;
		result = result.replace(pattern, '[REDACTED]');
	}
	return result;
}
