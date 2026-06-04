/*---------------------------------------------------------------------------------------------
 *  Construct IDE - DiffService Tests
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { DiffService } from '../../../src/construct/services/DiffService';

describe('DiffService', () => {
        let service: DiffService;

        beforeEach(() => {
                service = new DiffService();
        });

        describe('applyPatch', () => {
                test('applies a simple unified diff patch', () => {
                        const original = 'Hello World\nSecond line\nThird line\n';
                        const patch = '--- a/file\n+++ b/file\n@@ -1,3 +1,3 @@\n Hello World\n-Second line\n+Modified second line\n Third line\n';

                        const result = service.applyPatch(original, patch);
                        expect(result.success).toBe(true);
                        expect(result.patchedContent).toContain('Modified second line');
                        expect(result.patchedContent).not.toContain('Second line');
                        expect(result.conflicts).toBe(0);
                });

                test('reports conflict when patch cannot apply', () => {
                        const original = 'Hello World\n';
                        const patch = '--- a/file\n+++ b/file\n@@ -1,1 +1,1 @@\n-Goodbye World\n+Hello Modified\n';

                        const result = service.applyPatch(original, patch);
                        expect(result.conflicts).toBeGreaterThan(0);
                });

                test('returns empty result for empty patch', () => {
                        const result = service.applyPatch('content', '');
                        expect(result.hunksApplied).toBe(0);
                });
        });

        describe('applyEdit', () => {
                test('applies exact search/replace', () => {
                        const original = 'const foo = 1;\nconst bar = 2;\n';
                        const result = service.applyEdit(original, 'const foo = 1;', 'const foo = 42;');
                        expect(result.success).toBe(true);
                        expect(result.patchedContent).toContain('const foo = 42;');
                        expect(result.patchedContent).toContain('const bar = 2;');
                });

                test('returns conflict when search not found', () => {
                        const original = 'Hello World';
                        const result = service.applyEdit(original, 'not found', 'replacement');
                        expect(result.success).toBe(false);
                        expect(result.conflicts).toBe(1);
                });

                test('handles fuzzy matching with whitespace differences', () => {
                        const original = 'function hello()  {\n  return "hi";\n}';
                        const search = 'function hello() {\n  return "hi";\n}';
                        const replace = 'function hello() {\n  return "hello";\n}';
                        const result = service.applyEdit(original, search, replace);
                        // Fuzzy matching normalizes whitespace and matches on trimmed lines
                        expect(result.success).toBe(true);
                        expect(result.patchedContent).toContain('hello');
                });
        });

        describe('createPatch', () => {
                test('creates a unified diff between two strings', () => {
                        const oldContent = 'line 1\nline 2\nline 3\n';
                        const newContent = 'line 1\nmodified line 2\nline 3\n';
                        const patch = service.createPatch(oldContent, newContent, 'test.txt');
                        expect(patch).toContain('modified line 2');
                        expect(patch).toContain('@@');
                });
        });

        describe('getChangeSummary', () => {
                test('summarizes line changes', () => {
                        const oldContent = 'line 1\nline 2\nline 3\n';
                        const newContent = 'line 1\nmodified\nline 3\nadded\n';
                        const summary = service.getChangeSummary(oldContent, newContent);
                        expect(summary.added).toBeGreaterThan(0);
                        expect(summary.removed).toBeGreaterThan(0);
                        expect(summary.unchanged).toBeGreaterThan(0);
                });

                test('reports no changes for identical content', () => {
                        const content = 'same content\n';
                        const summary = service.getChangeSummary(content, content);
                        expect(summary.added).toBe(0);
                        expect(summary.removed).toBe(0);
                });
        });
});
