"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_TEST_MODEL || 'tinyllama';
const TIMEOUT = 60000;
// System prompt matching the agentLoop.ts format
const SYSTEM_PROMPT = `You are KOVIX Construct, an AI coding assistant. You have access to the following tools:
- readFile(path: string): Read the contents of a file
- writeFile(path: string, content: string): Write content to a file
- executeCommand(command: string): Execute a shell command
- searchFiles(query: string): Search for files matching a query
- listFiles(directory: string): List files in a directory

Respond with tool calls when needed, or provide direct answers.`;
// Minimal Ollama client
class OllamaTestClient {
    host;
    model;
    constructor(host, model) {
        this.host = host;
        this.model = model;
    }
    async chat(messages, options) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 55000);
        try {
            const res = await fetch(`${this.host}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    stream: false,
                    options: options || {},
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new Error(`Chat request failed: ${res.status} ${await res.text()}`);
            }
            const data = await res.json();
            return {
                content: data.message?.content || '',
                done: data.done ?? true,
            };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async streamingChat(messages, onChunk) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 55000);
        try {
            const res = await fetch(`${this.host}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    stream: true,
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new Error(`Streaming request failed: ${res.status}`);
            }
            const body = res.body;
            const reader = body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const text = decoder.decode(value, { stream: true });
                for (const line of text.split('\n')) {
                    if (!line.trim())
                        continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.message?.content) {
                            fullContent += json.message.content;
                            onChunk(json.message.content);
                        }
                    }
                    catch { /* skip */ }
                }
            }
            return fullContent;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async isReady() {
        try {
            const res = await fetch(`${this.host}/api/tags`);
            if (!res.ok)
                return false;
            const data = await res.json();
            const models = (data.models || []).map((m) => m.name || m);
            return models.some((name) => name === this.model || name.startsWith(this.model + ':'));
        }
        catch {
            return false;
        }
    }
}
suite('Agent Loop E2E Tests', function () {
    this.timeout(TIMEOUT);
    let client;
    let available = false;
    suiteSetup(async function () {
        client = new OllamaTestClient(OLLAMA_HOST, OLLAMA_MODEL);
        available = await client.isReady();
        if (!available) {
            console.log(`Ollama model "${OLLAMA_MODEL}" not available at ${OLLAMA_HOST}. Skipping E2E tests.`);
            this.skip();
        }
    });
    test('Agent can connect to Ollama and get a response', async function () {
        if (!available) {
            this.skip();
            return;
        }
        const result = await client.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'What is 2+2? Answer with just the number.' },
        ]);
        assert.ok(result.content.length > 0, 'Should return non-empty content');
        assert.ok(result.content.includes('4'), `Response should contain "4", got: ${result.content.substring(0, 200)}`);
    });
    test('Agent loop completes a simple code generation task', async function () {
        if (!available) {
            this.skip();
            return;
        }
        const result = await client.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Write a TypeScript function that adds two numbers. Keep it short.' },
        ]);
        assert.ok(result.content.length > 50, `Response should be >50 chars, got ${result.content.length}`);
        const lower = result.content.toLowerCase();
        assert.ok(lower.includes('function') || lower.includes('=>') || lower.includes('const'), `Response should contain function/arrow syntax, got: ${result.content.substring(0, 200)}`);
    });
    test('Agent loop handles tool definitions in system prompt', async function () {
        if (!available) {
            this.skip();
            return;
        }
        const result = await client.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'What tools do you have available? List them.' },
        ]);
        assert.ok(result.content.length > 0, 'Should return non-empty content');
        const lower = result.content.toLowerCase();
        const toolNames = ['readfile', 'writefile', 'executecommand', 'searchfiles', 'listfiles'];
        const mentioned = toolNames.some(t => lower.includes(t));
        assert.ok(mentioned || lower.includes('tool') || lower.includes('read') || lower.includes('write'), `Response should mention at least one tool or tool-related term, got: ${result.content.substring(0, 300)}`);
    });
    test('Agent loop preserves conversation context across turns', async function () {
        if (!available) {
            this.skip();
            return;
        }
        // Turn 1
        const r1 = await client.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Remember that my project uses React. Acknowledge this.' },
        ]);
        assert.ok(r1.content.length > 0, 'First turn should produce content');
        // Turn 2 with full context
        const r2 = await client.chat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Remember that my project uses React. Acknowledge this.' },
            { role: 'assistant', content: r1.content },
            { role: 'user', content: 'What framework does my project use?' },
        ]);
        assert.ok(r2.content.length > 0, 'Second turn should produce content');
        const lower = r2.content.toLowerCase();
        assert.ok(lower.includes('react'), `Response should mention "React", got: ${r2.content.substring(0, 200)}`);
    });
    test('Agent loop handles error gracefully when model is overloaded', async function () {
        if (!available) {
            this.skip();
            return;
        }
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Say hello' },
        ];
        let successes = 0;
        let errors = 0;
        const promises = [1, 2, 3].map(async () => {
            try {
                const result = await client.chat(messages);
                if (result.content.length > 0) {
                    successes++;
                }
            }
            catch {
                errors++;
            }
        });
        await Promise.allSettled(promises);
        assert.ok(successes >= 1, `At least one request should succeed (got ${successes} successes, ${errors} errors)`);
        assert.ok(errors < 3, `Not all requests should fail (got ${errors} errors)`);
    });
    test('Agent loop handles streaming tokens', async function () {
        if (!available) {
            this.skip();
            return;
        }
        let chunkCount = 0;
        const fullContent = await client.streamingChat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Count from 1 to 5.' },
        ], (_chunk) => { chunkCount++; });
        assert.ok(chunkCount >= 2, `Should receive at least 2 chunks, got ${chunkCount}`);
        assert.ok(fullContent.length > 0, 'Full content should not be empty');
    });
});
//# sourceMappingURL=agentLoopE2E.test.js.map