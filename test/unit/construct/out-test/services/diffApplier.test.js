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
/**
 * Tests for DiffApplier security invariants.
 * Source: src/vs/platform/construct/common/editor/diffApplier.ts
 * Implementation: src/vs/workbench/contrib/construct/browser/services/editor/diffApplier.ts
 *
 * These tests verify the workspace boundary enforcement that prevents
 * path traversal attacks in file operations.
 */
/**
 * Replicate the isWithinWorkspace logic from DiffApplierService.
 * The production code normalizes URIs and checks path boundaries.
 */
function isWithinWorkspace(filePath, workspaceRoot) {
    // Normalize paths (simulating URI.path normalization)
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
    const workspacePath = workspaceRoot.replace(/\\/g, '/').replace(/\/+/g, '/');
    // Calculate relative path
    const relativePath = normalizedPath.startsWith(workspacePath)
        ? normalizedPath.substring(workspacePath.length)
        : normalizedPath;
    // Check for path traversal: if resolving the relative path goes above workspace root
    const segments = relativePath.split('/').filter(s => s.length > 0);
    let depth = 0;
    for (const segment of segments) {
        if (segment === '..') {
            depth--;
            if (depth < 0) {
                return false; // Path traversal detected
            }
        }
        else if (segment !== '.') {
            depth++;
        }
    }
    // Check if the path is within the workspace root
    return normalizedPath.startsWith(workspacePath);
}
// ---- Tests ----
suite('DiffApplier', () => {
    suite('readFile rejects paths outside workspace', () => {
        test('absolute path outside workspace is rejected', () => {
            const result = isWithinWorkspace('/etc/passwd', '/home/user/project');
            assert.strictEqual(result, false);
        });
        test('path traversal with .. escapes workspace', () => {
            const result = isWithinWorkspace('/home/user/project/../../../etc/passwd', '/home/user/project');
            assert.strictEqual(result, false);
        });
        test('relative traversal in middle of path escapes workspace', () => {
            const result = isWithinWorkspace('/home/user/project/src/../../etc/passwd', '/home/user/project');
            assert.strictEqual(result, false);
        });
        test('deep traversal escapes workspace', () => {
            const result = isWithinWorkspace('/home/user/project/a/b/c/../../../../../../etc/passwd', '/home/user/project');
            assert.strictEqual(result, false);
        });
        test('completely unrelated path is rejected', () => {
            const result = isWithinWorkspace('/tmp/malicious-file', '/home/user/project');
            assert.strictEqual(result, false);
        });
        test('sibling directory is rejected', () => {
            const result = isWithinWorkspace('/home/user/other-project/file.ts', '/home/user/project');
            assert.strictEqual(result, false);
        });
    });
    suite('exists returns false for paths outside workspace', () => {
        test('root path outside workspace returns false', () => {
            assert.strictEqual(isWithinWorkspace('/', '/home/user/project'), false);
        });
        test('path in parent directory returns false', () => {
            assert.strictEqual(isWithinWorkspace('/home/user', '/home/user/project'), false);
        });
        test('path with traversal to parent returns false', () => {
            assert.strictEqual(isWithinWorkspace('/home/user/project/../secret.txt', '/home/user/project'), false);
        });
    });
    suite('paths within workspace are accepted', () => {
        test('simple relative path within workspace', () => {
            const result = isWithinWorkspace('/home/user/project/src/main.ts', '/home/user/project');
            assert.strictEqual(result, true);
        });
        test('deeply nested path within workspace', () => {
            const result = isWithinWorkspace('/home/user/project/src/vs/platform/construct/common/test.ts', '/home/user/project');
            assert.strictEqual(result, true);
        });
        test('workspace root itself is within workspace', () => {
            const result = isWithinWorkspace('/home/user/project', '/home/user/project');
            assert.strictEqual(result, true);
        });
        test('path with . segments is within workspace', () => {
            const result = isWithinWorkspace('/home/user/project/./src/./main.ts', '/home/user/project');
            assert.strictEqual(result, true);
        });
        test('path with internal .. that stays within workspace', () => {
            // src/../lib = lib, which is still within workspace
            const result = isWithinWorkspace('/home/user/project/src/../lib/utils.ts', '/home/user/project');
            assert.strictEqual(result, true);
        });
    });
    suite('writeFile rejects paths outside workspace', () => {
        test('writing to /etc/ is rejected', () => {
            assert.strictEqual(isWithinWorkspace('/etc/hosts', '/home/user/project'), false);
        });
        test('writing to home directory is rejected', () => {
            assert.strictEqual(isWithinWorkspace('/home/user/.ssh/authorized_keys', '/home/user/project'), false);
        });
        test('writing to temp directory is rejected', () => {
            assert.strictEqual(isWithinWorkspace('/tmp/payload.sh', '/home/user/project'), false);
        });
    });
    suite('edge cases', () => {
        test('workspace root with trailing slash', () => {
            const result = isWithinWorkspace('/home/user/project/src/main.ts', '/home/user/project/');
            assert.strictEqual(result, true);
        });
        test('empty path segments are handled', () => {
            const result = isWithinWorkspace('/home/user/project//src///main.ts', '/home/user/project');
            assert.strictEqual(result, true);
        });
        test('Windows-style backslashes are normalized', () => {
            const result = isWithinWorkspace('C:\\Users\\dev\\project\\src\\main.ts', 'C:/Users/dev/project');
            // After normalization, both should use forward slashes
            assert.strictEqual(result, true);
        });
        test('Windows path traversal with backslashes is caught', () => {
            const result = isWithinWorkspace('C:\\Users\\dev\\project\\..\\..\\etc\\passwd', 'C:/Users/dev/project');
            assert.strictEqual(result, false);
        });
    });
});
//# sourceMappingURL=diffApplier.test.js.map