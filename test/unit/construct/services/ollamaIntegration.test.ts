/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert = require('assert');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_TEST_MODEL || 'tinyllama';
const TIMEOUT = 30000;

suite('Ollama Integration Tests', function () {
        this.timeout(TIMEOUT);

        let ollamaAvailable = false;

        suiteSetup(async function () {
                try {
                        const res = await fetch(`${OLLAMA_HOST}/api/tags`);
                        if (res.ok) {
                                const data = await res.json();
                                const models: string[] = (data.models || []).map((m: any) => m.name || m);
                                ollamaAvailable = models.some((name: string) =>
                                        name === OLLAMA_MODEL || name.startsWith(OLLAMA_MODEL + ':')
                                );
                                if (!ollamaAvailable) {
                                        console.log(`Available models: ${models.join(', ')}`);
                                        console.log(`Requested model "${OLLAMA_MODEL}" not found. Skipping.`);
                                }
                        }
                } catch (e) {
                        console.log(`Ollama not reachable at ${OLLAMA_HOST}: ${e}`);
                }
                if (!ollamaAvailable) {
                        this.skip();
                }
        });

        test('Ollama server is reachable', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                const res = await fetch(`${OLLAMA_HOST}/api/tags`);
                assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
                const data = await res.json();
                assert.ok(Array.isArray(data.models), 'Response models should be an array');
        });

        test('Ollama provider can list models', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                const res = await fetch(`${OLLAMA_HOST}/api/tags`);
                assert.ok(res.ok, `GET /api/tags failed: ${res.status}`);
                const data = await res.json();
                const models: string[] = (data.models || []).map((m: any) => m.name || m);
                const match = models.some((name: string) =>
                        name === OLLAMA_MODEL || name.startsWith(OLLAMA_MODEL + ':')
                );
                assert.ok(match, `Model "${OLLAMA_MODEL}" should be in available models`);
        });

        test('Ollama provider can complete a chat request', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [{ role: 'user', content: 'Say hello in one word.' }],
                                stream: false,
                        }),
                });
                assert.ok(res.ok, `POST /api/chat failed: ${res.status}`);
                const data = await res.json();
                assert.ok(data.message, 'Response should have message field');
                assert.ok(data.message.content, 'Message should have content');
                assert.ok(typeof data.message.content === 'string', 'Content should be string');
                assert.ok(data.message.content.length > 0, 'Content should not be empty');
                assert.strictEqual(data.model, OLLAMA_MODEL, 'Model should match request');
        });

        test('Ollama provider handles streaming chat', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [{ role: 'user', content: 'Count to 3.' }],
                                stream: true,
                        }),
                });
                assert.ok(res.ok, `POST /api/chat (stream) failed: ${res.status}`);

                const body = res.body!;
                const reader = body.getReader();
                const decoder = new TextDecoder();
                let chunks = 0;
                let fullContent = '';

                while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const text = decoder.decode(value, { stream: true });
                        for (const line of text.split('\n')) {
                                if (!line.trim()) continue;
                                try {
                                        const json = JSON.parse(line);
                                        if (json.message?.content) {
                                                fullContent += json.message.content;
                                                chunks++;
                                        }
                                } catch { /* skip non-JSON lines */ }
                        }
                }
                assert.ok(chunks >= 2, `Expected at least 2 chunks, got ${chunks}`);
                assert.ok(fullContent.length > 0, 'Streamed content should not be empty');
        });

        test('Ollama provider handles multi-turn conversation', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                // Turn 1: introduce name
                const res1 = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [{ role: 'user', content: 'My name is TestAgent. Remember it.' }],
                                stream: false,
                        }),
                });
                assert.ok(res1.ok, 'First turn should succeed');
                const data1 = await res1.json();
                assert.ok(data1.message?.content, 'First turn should have content');

                // Turn 2: ask for name
                const res2 = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [
                                        { role: 'user', content: 'My name is TestAgent. Remember it.' },
                                        { role: 'assistant', content: data1.message.content },
                                        { role: 'user', content: 'What is my name?' },
                                ],
                                stream: false,
                        }),
                });
                assert.ok(res2.ok, 'Second turn should succeed');
                const data2 = await res2.json();
                const content = (data2.message?.content || '').toLowerCase();
                assert.ok(
                        content.includes('testagent') || content.includes('test agent'),
                        `Response should mention "TestAgent", got: ${data2.message?.content?.substring(0, 200)}`
                );
        });

        test('Ollama provider handles tool call format', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [
                                        {
                                                role: 'system',
                                                content: 'You are a coding assistant with access to tools: readFile, writeFile, executeCommand.',
                                        },
                                        { role: 'user', content: 'List the files in my project.' },
                                ],
                                stream: false,
                        }),
                });
                assert.ok(res.ok, `Tool call request failed: ${res.status}`);
                const data = await res.json();
                assert.ok(data.message, 'Response should have message field');
                assert.ok(typeof data.message.content === 'string', 'Message content should be string');
        });

        test('Ollama provider handles invalid model gracefully', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: 'nonexistent-model-xyz',
                                messages: [{ role: 'user', content: 'Hello' }],
                                stream: false,
                        }),
                });
                assert.ok(!res.ok, 'Request with invalid model should fail');
                const text = await res.text();
                assert.ok(
                        text.toLowerCase().includes('not found') ||
                        text.toLowerCase().includes('error') ||
                        res.status === 404,
                        `Error should mention "not found" or be 404, got status ${res.status}: ${text.substring(0, 200)}`
                );
        });

        test('Ollama provider respects max_tokens parameter', async function () {
                if (!ollamaAvailable) { this.skip(); return; }
                // Constrained
                const res1 = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [{ role: 'user', content: 'Write a long paragraph about the history of computing.' }],
                                stream: false,
                                options: { num_predict: 5 },
                        }),
                });
                assert.ok(res1.ok, 'Constrained request should succeed');
                const data1 = await res1.json();
                const shortContent: string = data1.message?.content || '';

                // Unconstrained
                const res2 = await fetch(`${OLLAMA_HOST}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                model: OLLAMA_MODEL,
                                messages: [{ role: 'user', content: 'Write a long paragraph about the history of computing.' }],
                                stream: false,
                        }),
                });
                assert.ok(res2.ok, 'Unconstrained request should succeed');
                const data2 = await res2.json();
                const longContent: string = data2.message?.content || '';

                assert.ok(
                        shortContent.length <= longContent.length + 50,
                        `Constrained (${shortContent.length} chars) should be shorter than or similar to unconstrained (${longContent.length} chars)`
                );
        });
});
