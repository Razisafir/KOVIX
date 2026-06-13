"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const DEFAULT_CONFIG = {
    maxRetries: 3,
    autoRetry: true,
    retryDelayMs: 1000,
    injectErrorContext: true,
};
const ERROR_CLASSIFICATION_PATTERNS = [
    [/permission denied|EACCES/i, 'file_permission'],
    [/ENOENT|not found|No such file/i, 'file_not_found'],
    [/SyntaxError|syntax error|unexpected token/i, 'syntax_error'],
    [/ECONNREFUSED|ETIMEDOUT|network/i, 'network_error'],
    [/timed out/i, 'timeout'],
];
// ---- Classification logic ----
function classifyError(errorMessage, exitCode, stderr) {
    // Exit code 124 → timeout
    if (exitCode === 124) {
        return 'timeout';
    }
    const combinedMessage = [errorMessage, stderr].filter(Boolean).join(' ');
    for (const [pattern, errorType] of ERROR_CLASSIFICATION_PATTERNS) {
        if (pattern.test(combinedMessage)) {
            return errorType;
        }
    }
    if (exitCode !== undefined && exitCode !== 0) {
        return 'non_zero_exit';
    }
    return 'unknown';
}
// ---- Recovery strategy logic ----
function determineRecoveryStrategy(errorType, retryCount, maxRetries, config) {
    if (config.autoRetry && retryCount < maxRetries) {
        const nextAttempt = retryCount + 1;
        switch (errorType) {
            case 'timeout':
                return {
                    strategy: 'retry',
                    success: false,
                    retryAttempt: nextAttempt,
                };
            case 'network_error':
                return {
                    strategy: 'retry',
                    success: false,
                    retryAttempt: nextAttempt,
                };
            case 'file_permission':
                return {
                    strategy: 'retry',
                    success: false,
                    retryAttempt: nextAttempt,
                };
            case 'syntax_error':
                return {
                    strategy: 'retry',
                    success: false,
                    retryAttempt: nextAttempt,
                };
            default:
                return {
                    strategy: 'retry',
                    success: false,
                    retryAttempt: nextAttempt,
                };
        }
    }
    return { strategy: 'abort', success: false };
}
// ---- Context window exceeded handling ----
function handleContextWindowExceeded(messages, maxTokens) {
    // Simple truncation: keep system prompt and last N messages
    if (messages.length <= 2) {
        return { truncatedMessages: messages, wasTruncated: false };
    }
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    // Keep system messages and last 2 non-system messages
    const truncated = [
        ...systemMessages,
        ...nonSystemMessages.slice(-2),
    ];
    return {
        truncatedMessages: truncated,
        wasTruncated: truncated.length < messages.length,
    };
}
// ---- Rate limit handling ----
function handleRateLimit(retryCount, baseDelayMs = 1000) {
    const maxRetries = 3;
    const delayMs = baseDelayMs * Math.pow(2, retryCount);
    return {
        delayMs: Math.min(delayMs, 60_000), // Cap at 60 seconds
        shouldRetry: retryCount < maxRetries,
        maxRetries,
    };
}
function handleModelUnavailable(currentProvider, availableProviders) {
    // Find next available provider
    const currentIndex = availableProviders.findIndex(p => p.name === currentProvider);
    const candidates = availableProviders.filter(p => p.available);
    if (candidates.length === 0) {
        return null;
    }
    // Try the next provider after current
    if (currentIndex >= 0) {
        for (let i = currentIndex + 1; i < availableProviders.length; i++) {
            if (availableProviders[i].available) {
                return availableProviders[i];
            }
        }
    }
    // Wrap around to the first available
    return candidates[0];
}
// ---- Tool execution timeout handling ----
function handleToolTimeout(retryCount, previousTimeoutMs, maxRetries = 3) {
    const shouldRetry = retryCount < maxRetries;
    const multiplier = 2; // Double the timeout each retry
    const newTimeoutMs = previousTimeoutMs * multiplier;
    return {
        shouldRetry,
        newTimeoutMs,
        retryAttempt: retryCount + 1,
    };
}
// ---- Error context building ----
function buildErrorContext(error, previousAttempts) {
    const lines = [];
    lines.push(`[ERROR RECOVERY - Step ${error.stepIndex} failed]`);
    lines.push(`Tool: ${error.toolName}`);
    lines.push(`Input: ${JSON.stringify(error.toolInput)}`);
    lines.push(`Error type: ${error.errorType}`);
    lines.push(`Error message: ${error.message}`);
    if (error.exitCode !== undefined) {
        lines.push(`Exit code: ${error.exitCode}`);
    }
    if (error.stderr) {
        lines.push(`stderr output: ${error.stderr}`);
    }
    lines.push(`Retry attempt: ${error.retryCount}/${error.maxRetries}`);
    if (previousAttempts && previousAttempts.length > 0) {
        lines.push(`Previous attempts failed: ${previousAttempts.join('; ')}`);
    }
    lines.push('Please adjust your approach based on this error information.');
    return lines.join('\n');
}
// ---- Tests ----
suite('AgentErrorRecovery', () => {
    suite('Error classification — errors are classified correctly', () => {
        test('permission denied → file_permission', () => {
            assert.strictEqual(classifyError('Permission denied: /root/file'), 'file_permission');
        });
        test('EACCES → file_permission', () => {
            assert.strictEqual(classifyError('EACCES: access denied'), 'file_permission');
        });
        test('ENOENT → file_not_found', () => {
            assert.strictEqual(classifyError('ENOENT: no such file'), 'file_not_found');
        });
        test('not found → file_not_found', () => {
            assert.strictEqual(classifyError('Module not found: express'), 'file_not_found');
        });
        test('SyntaxError → syntax_error', () => {
            assert.strictEqual(classifyError('SyntaxError: Unexpected token'), 'syntax_error');
        });
        test('ECONNREFUSED → network_error', () => {
            assert.strictEqual(classifyError('ECONNREFUSED: Connection refused'), 'network_error');
        });
        test('network error → network_error', () => {
            assert.strictEqual(classifyError('Network error: fetch failed'), 'network_error');
        });
        test('timed out → timeout', () => {
            assert.strictEqual(classifyError('Command timed out after 30s'), 'timeout');
        });
        test('exit code 124 → timeout', () => {
            assert.strictEqual(classifyError('Command failed', 124), 'timeout');
        });
        test('non-zero exit code → non_zero_exit', () => {
            assert.strictEqual(classifyError('Something went wrong', 1), 'non_zero_exit');
        });
        test('no pattern match and no exit code → unknown', () => {
            assert.strictEqual(classifyError('An unexpected thing happened'), 'unknown');
        });
        test('stderr is included in classification', () => {
            assert.strictEqual(classifyError('Command failed', 1, 'permission denied: /etc/hosts'), 'file_permission');
        });
    });
    suite('context_window_exceeded — truncation and retry', () => {
        test('messages are truncated when too long', () => {
            const messages = [
                { role: 'system', content: 'You are helpful.' },
                { role: 'user', content: 'Question 1' },
                { role: 'assistant', content: 'Answer 1' },
                { role: 'user', content: 'Question 2' },
                { role: 'assistant', content: 'Answer 2' },
                { role: 'user', content: 'Question 3' },
            ];
            const { truncatedMessages, wasTruncated } = handleContextWindowExceeded(messages, 1000);
            assert.strictEqual(wasTruncated, true);
            assert.ok(truncatedMessages.length < messages.length, 'Truncated messages should be fewer');
        });
        test('system messages are preserved', () => {
            const messages = [
                { role: 'system', content: 'System instructions' },
                { role: 'user', content: 'Q1' },
                { role: 'user', content: 'Q2' },
            ];
            const { truncatedMessages } = handleContextWindowExceeded(messages, 1000);
            assert.ok(truncatedMessages.some(m => m.role === 'system'), 'System messages should be preserved');
        });
        test('short messages are not truncated', () => {
            const messages = [
                { role: 'user', content: 'Hello' },
            ];
            const { wasTruncated } = handleContextWindowExceeded(messages, 1000);
            assert.strictEqual(wasTruncated, false);
        });
    });
    suite('rate_limit_hit — exponential backoff', () => {
        test('backoff increases exponentially', () => {
            const r0 = handleRateLimit(0);
            const r1 = handleRateLimit(1);
            const r2 = handleRateLimit(2);
            assert.strictEqual(r0.delayMs, 1000);
            assert.strictEqual(r1.delayMs, 2000);
            assert.strictEqual(r2.delayMs, 4000);
        });
        test('shouldRetry is true when under max retries', () => {
            assert.strictEqual(handleRateLimit(0).shouldRetry, true);
            assert.strictEqual(handleRateLimit(1).shouldRetry, true);
            assert.strictEqual(handleRateLimit(2).shouldRetry, true);
        });
        test('shouldRetry is false when at max retries', () => {
            assert.strictEqual(handleRateLimit(3).shouldRetry, false);
        });
        test('delay is capped at 60 seconds', () => {
            const result = handleRateLimit(10);
            assert.ok(result.delayMs <= 60_000, 'Delay should be capped');
        });
        test('maxRetries is 3', () => {
            assert.strictEqual(handleRateLimit(0).maxRetries, 3);
        });
    });
    suite('model_unavailable — fallback', () => {
        test('falls back to next available provider', () => {
            const providers = [
                { name: 'ollama', available: false },
                { name: 'xenova', available: true },
                { name: 'cloud', available: true },
            ];
            const fallback = handleModelUnavailable('ollama', providers);
            assert.strictEqual(fallback?.name, 'xenova');
        });
        test('wraps around when current is last', () => {
            const providers = [
                { name: 'ollama', available: true },
                { name: 'xenova', available: false },
                { name: 'cloud', available: false },
            ];
            const fallback = handleModelUnavailable('cloud', providers);
            assert.strictEqual(fallback?.name, 'ollama');
        });
        test('returns null when all providers are unavailable', () => {
            const providers = [
                { name: 'ollama', available: false },
                { name: 'xenova', available: false },
                { name: 'cloud', available: false },
            ];
            const fallback = handleModelUnavailable('ollama', providers);
            assert.strictEqual(fallback, null);
        });
        test('skips unavailable providers', () => {
            const providers = [
                { name: 'ollama', available: false },
                { name: 'xenova', available: false },
                { name: 'cloud', available: true },
            ];
            const fallback = handleModelUnavailable('ollama', providers);
            assert.strictEqual(fallback?.name, 'cloud');
        });
    });
    suite('tool_execution_timeout — retry with longer timeout', () => {
        test('should retry with doubled timeout', () => {
            const result = handleToolTimeout(0, 30_000);
            assert.strictEqual(result.shouldRetry, true);
            assert.strictEqual(result.newTimeoutMs, 60_000);
            assert.strictEqual(result.retryAttempt, 1);
        });
        test('timeout doubles each retry', () => {
            const r1 = handleToolTimeout(0, 30_000);
            const r2 = handleToolTimeout(1, r1.newTimeoutMs);
            assert.strictEqual(r2.newTimeoutMs, 120_000);
        });
        test('should not retry after max retries', () => {
            const result = handleToolTimeout(3, 30_000);
            assert.strictEqual(result.shouldRetry, false);
        });
        test('retry attempt increments correctly', () => {
            const r0 = handleToolTimeout(0, 30_000);
            assert.strictEqual(r0.retryAttempt, 1);
            const r1 = handleToolTimeout(1, 60_000);
            assert.strictEqual(r1.retryAttempt, 2);
            const r2 = handleToolTimeout(2, 120_000);
            assert.strictEqual(r2.retryAttempt, 3);
        });
    });
    suite('Error context building', () => {
        test('buildErrorContext produces readable context', () => {
            const error = {
                stepIndex: 2,
                toolName: 'run_terminal',
                toolInput: { command: 'npm test' },
                errorType: 'non_zero_exit',
                message: 'Tests failed',
                exitCode: 1,
                retryCount: 1,
                maxRetries: 3,
                timestamp: Date.now(),
            };
            const context = buildErrorContext(error);
            assert.ok(context.includes('Step 2 failed'));
            assert.ok(context.includes('run_terminal'));
            assert.ok(context.includes('non_zero_exit'));
            assert.ok(context.includes('Tests failed'));
            assert.ok(context.includes('Exit code: 1'));
        });
        test('buildErrorContext includes previous attempts', () => {
            const error = {
                stepIndex: 1,
                toolName: 'read_file',
                toolInput: { path: '/etc/hosts' },
                errorType: 'file_permission',
                message: 'Permission denied',
                retryCount: 2,
                maxRetries: 3,
                timestamp: Date.now(),
            };
            const context = buildErrorContext(error, ['Attempt 1: timeout', 'Attempt 2: permission']);
            assert.ok(context.includes('Previous attempts failed'));
            assert.ok(context.includes('Attempt 1: timeout'));
        });
        test('buildErrorContext includes stderr when present', () => {
            const error = {
                stepIndex: 1,
                toolName: 'run_terminal',
                toolInput: {},
                errorType: 'non_zero_exit',
                message: 'Command failed',
                stderr: 'Error: Cannot find module',
                retryCount: 0,
                maxRetries: 3,
                timestamp: Date.now(),
            };
            const context = buildErrorContext(error);
            assert.ok(context.includes('stderr output'));
            assert.ok(context.includes('Cannot find module'));
        });
    });
});
//# sourceMappingURL=agentErrorRecovery.test.js.map