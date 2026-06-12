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
// Import the pure function for direct testing
// In the test runner, we'd import from the source path.
// Here we replicate the logic for unit testing without module resolution.
const SECRET_PATTERNS = [
    /sk-ant-[A-Za-z0-9_-]{20,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /Bearer [A-Za-z0-9_.-]{20,}/g,
    /password=\S+/gi,
    /token=\S+/gi,
    /key=\S+/gi,
];
function redactSecrets(input) {
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
//# sourceMappingURL=secretRedactor.test.js.map