/*---------------------------------------------------------------------------------------------
 *  Construct IDE - MCP Client (Model Context Protocol Filesystem)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export class MCPClient {
        private process: ChildProcess | null = null;
        private requestId = 0;
        private readonly pendingRequests = new Map<number, {
                resolve: (value: unknown) => void;
                reject: (reason: unknown) => void;
        }>();
        private restartAttempts = 0;
        private readonly maxRestartAttempts = 5;
        private readonly restartBackoffMs = 3000;
        private buffer = '';
        private disposed = false;

        constructor(
                private readonly workspaceRoot: string,
                private readonly serverCommand: string = 'npx',
                private readonly serverArgs: string[] = ['@modelcontextprotocol/server-filesystem']
        ) {}

        async start(): Promise<void> {
                if (this.process) {
                        return; // Already started
                }

                return new Promise<void>((resolve, reject) => {
                        const timeout = setTimeout(() => {
                                reject(new Error('MCP server start timed out'));
                        }, 30_000);

                        try {
                                this.process = spawn(this.serverCommand, [...this.serverArgs, this.workspaceRoot], {
                                        stdio: ['pipe', 'pipe', 'pipe'],
                                });

                                this.process.stdout?.on('data', (data: Buffer) => {
                                        this.handleData(data.toString());
                                });

                                this.process.stderr?.on('data', (data: Buffer) => {
                                        // Log stderr but don't crash
                                        console.error('[MCP stderr]', data.toString());
                                });

                                this.process.on('exit', (code) => {
                                        this.process = null;
                                        if (!this.disposed && code !== 0) {
                                                this.handleExit();
                                        }
                                });

                                this.process.on('error', (err) => {
                                        clearTimeout(timeout);
                                        reject(err);
                                });

                                // Wait a moment for the process to start, then send initialize
                                setTimeout(() => {
                                        clearTimeout(timeout);
                                        resolve();
                                }, 1000);
                        } catch (err) {
                                clearTimeout(timeout);
                                reject(err);
                        }
                });
        }

        async stop(): Promise<void> {
                this.disposed = true;
                if (this.process) {
                        this.process.kill('SIGTERM');
                        this.process = null;
                }
                // Reject all pending requests
                for (const [id, pending] of this.pendingRequests) {
                        pending.reject(new Error('MCP client stopped'));
                }
                this.pendingRequests.clear();
        }

        async readFile(filePath: string): Promise<string> {
                const resolved = this.validatePath(filePath);
                const result = await this.sendRequest('tools/call', {
                        name: 'read_file',
                        arguments: { path: resolved },
                });
                return String(this.extractContent(result));
        }

        async writeFile(filePath: string, content: string): Promise<void> {
                const resolved = this.validatePath(filePath);
                await this.sendRequest('tools/call', {
                        name: 'write_file',
                        arguments: { path: resolved, content },
                });
        }

        async listDirectory(dirPath: string): Promise<string[]> {
                const resolved = this.validatePath(dirPath);
                const result = await this.sendRequest('tools/call', {
                        name: 'list_directory',
                        arguments: { path: resolved },
                });
                const content = this.extractContent(result);
                if (Array.isArray(content)) {
                        return content.map(String);
                }
                // Parse newline-separated entries
                return String(content).split('\n').filter(Boolean);
        }

        async createDirectory(dirPath: string): Promise<void> {
                const resolved = this.validatePath(dirPath);
                await this.sendRequest('tools/call', {
                        name: 'create_directory',
                        arguments: { path: resolved },
                });
        }

        async deleteFile(filePath: string): Promise<void> {
                const resolved = this.validatePath(filePath);
                await this.sendRequest('tools/call', {
                        name: 'delete_file',
                        arguments: { path: resolved },
                });
        }

        private validatePath(inputPath: string): string {
                const resolved = path.resolve(this.workspaceRoot, inputPath);
                if (!resolved.startsWith(this.workspaceRoot)) {
                        throw new Error(`Path traversal detected: ${inputPath} is outside workspace root ${this.workspaceRoot}`);
                }
                return resolved;
        }

        private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
                return new Promise((resolve, reject) => {
                        if (!this.process?.stdin?.writable) {
                                reject(new Error('MCP server not running'));
                                return;
                        }

                        const id = ++this.requestId;
                        const message = JSON.stringify({
                                jsonrpc: '2.0',
                                id,
                                method,
                                params,
                        });

                        this.pendingRequests.set(id, { resolve, reject });
                        this.process.stdin.write(message + '\n');

                        // Timeout for individual requests
                        setTimeout(() => {
                                if (this.pendingRequests.has(id)) {
                                        this.pendingRequests.delete(id);
                                        reject(new Error(`MCP request timed out: ${method}`));
                                }
                        }, 30_000);
                });
        }

        private handleData(data: string): void {
                this.buffer += data;
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() ?? '';

                for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;

                        try {
                                const message = JSON.parse(trimmed);
                                this.handleMessage(message);
                        } catch {
                                // Ignore malformed JSON
                        }
                }
        }

        private handleMessage(message: Record<string, unknown>): void {
                if (message.id !== undefined && typeof message.id === 'number') {
                        const pending = this.pendingRequests.get(message.id);
                        if (pending) {
                                this.pendingRequests.delete(message.id);
                                if (message.error) {
                                        pending.reject(new Error(`MCP error: ${JSON.stringify(message.error)}`));
                                } else {
                                        pending.resolve(message.result);
                                }
                        }
                }
        }

        private extractContent(result: unknown): unknown {
                if (result && typeof result === 'object' && 'content' in (result as any)) {
                        const contents = (result as any).content;
                        if (Array.isArray(contents) && contents.length > 0) {
                                return contents[0].text ?? contents[0];
                        }
                        return contents;
                }
                return result;
        }

        private handleExit(): void {
                if (this.disposed) return;
                if (this.restartAttempts >= this.maxRestartAttempts) {
                        console.error(`[MCP] Max restart attempts (${this.maxRestartAttempts}) reached. Giving up.`);
                        // Reject all pending requests
                        for (const [id, pending] of this.pendingRequests) {
                                pending.reject(new Error('MCP server exited and max restarts reached'));
                        }
                        this.pendingRequests.clear();
                        return;
                }

                this.restartAttempts++;
                const delay = this.restartBackoffMs * Math.pow(2, this.restartAttempts - 1);
                console.log(`[MCP] Server exited. Restarting in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`);

                setTimeout(async () => {
                        try {
                                await this.start();
                                this.restartAttempts = 0; // Reset on successful restart
                        } catch (err) {
                                console.error('[MCP] Restart failed:', err);
                        }
                }, delay);
        }
}
