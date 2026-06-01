import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import * as vscode from 'vscode';

export interface AgentSession {
    session_id: string;
    status: 'running' | 'completed' | 'error';
    goal: string;
}

export interface AgentEvent {
    type: 'thought' | 'action' | 'observation' | 'error' | 'complete';
    content: string;
    timestamp: string;
}

export interface FileChange {
    path: string;
    status: 'created' | 'modified' | 'deleted';
    diff?: string;
}

export class ConstructAPI {
    baseUrl: string;
    private backendProcess: ChildProcess | undefined;
    private eventSource: EventSource | undefined;
    private _onStatusChange = new vscode.EventEmitter<string>();
    public onStatusChange = this._onStatusChange.event;

    constructor(baseUrl: string = 'http://127.0.0.1:8000') {
        this.baseUrl = baseUrl;
    }

    async ensureBackendRunning(): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'ok') { return; }
            }
        } catch {
            // Not running, try to start
        }
        await this.startBackend();
    }

    private async startBackend(): Promise<void> {
        // Try bundled executable first (production)
        const extensionPath = vscode.extensions.getExtension('construct.construct-agent')?.extensionPath;
        if (extensionPath) {
            const bundledPath = join(extensionPath, 'resources', 'agent-backend');
            const exeName = process.platform === 'win32'
                ? 'construct-agent-backend.exe'
                : 'construct-agent-backend';
            const bundledExe = join(bundledPath, exeName);

            try {
                this.backendProcess = spawn(bundledExe, ['--port', '8000'], {
                    cwd: dirname(bundledExe),
                    env: { ...process.env }
                });
                await this._waitForHealth();
                return;
            } catch {
                // Bundled not available, fallback to python
            }
        }

        // Development: spawn from agent-backend/ directory
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            || process.cwd();
        const backendPath = join(workspaceRoot, '..', 'agent-backend');

        this.backendProcess = spawn('python', [
            '-m', 'uvicorn', 'app:app',
            '--host', '127.0.0.1',
            '--port', '8000'
        ], {
            cwd: backendPath,
            env: { ...process.env, PYTHONPATH: backendPath }
        });

        // Log backend output for debugging
        this.backendProcess.stdout?.on('data', (data) => {
            console.log('[Construct Backend]', data.toString());
        });
        this.backendProcess.stderr?.on('data', (data) => {
            console.error('[Construct Backend]', data.toString());
        });

        await this._waitForHealth();
    }

    private async _waitForHealth(): Promise<void> {
        for (let i = 0; i < 30; i++) {
            try {
                const response = await fetch(`${this.baseUrl}/health`);
                if (response.ok) { return; }
            } catch { /* not ready yet */ }
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error('Backend failed to start within 30 seconds');
    }

    async sendMessage(goal: string, mode: string = 'code'): Promise<AgentSession> {
        const response = await fetch(`${this.baseUrl}/agent/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                goal,
                mode,
                project_path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            })
        });

        if (!response.ok) {
            throw new Error(`Backend error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    connectToStream(sessionId: string, onEvent: (event: AgentEvent) => void, onError?: (error: Error) => void): () => void {
        const eventSource = new EventSource(`${this.baseUrl}/agent/${sessionId}/stream`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onEvent(data);
            } catch (err) {
                console.error('Failed to parse SSE event:', err);
            }
        };

        eventSource.onerror = () => {
            onError?.(new Error('Stream connection failed'));
        };

        this.eventSource = eventSource;

        // Return cleanup function
        return () => {
            eventSource.close();
            this.eventSource = undefined;
        };
    }

    async getPendingChanges(): Promise<FileChange[]> {
        try {
            const response = await fetch(`${this.baseUrl}/shadow/changes`);
            if (response.ok) {
                return response.json();
            }
        } catch { /* shadow fs not available */ }
        return [];
    }

    async acceptAllChanges(): Promise<void> {
        const response = await fetch(`${this.baseUrl}/shadow/merge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: null })
        });

        if (!response.ok) {
            throw new Error(`Failed to accept changes: ${response.statusText}`);
        }
    }

    async rejectAllChanges(): Promise<void> {
        const response = await fetch(`${this.baseUrl}/shadow/discard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: null })
        });

        if (!response.ok) {
            throw new Error(`Failed to reject changes: ${response.statusText}`);
        }
    }

    async getMemory(query: string): Promise<any[]> {
        const response = await fetch(`${this.baseUrl}/memory/recall?q=${encodeURIComponent(query)}`);
        return response.json();
    }

    reloadConfig(): void {
        const config = vscode.workspace.getConfiguration('construct');
        const newUrl = config.get<string>('backendUrl', 'http://127.0.0.1:8000');
        if (newUrl !== this.baseUrl) {
            this.baseUrl = newUrl;
        }
    }

    dispose(): void {
        this.eventSource?.close();
        this.backendProcess?.kill();
        this._onStatusChange.dispose();
    }
}
