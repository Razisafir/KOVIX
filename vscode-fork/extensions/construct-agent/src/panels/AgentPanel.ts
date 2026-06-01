import * as vscode from 'vscode';
import { ConstructAPI, AgentEvent } from '../api/ConstructAPI';

export class AgentPanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _api: ConstructAPI;
    private _extensionUri: vscode.Uri;
    private _currentSessionId?: string;
    private _messageHistory: any[] = [];
    private _cleanupStream?: () => void;

    constructor(extensionUri: vscode.Uri, api: ConstructAPI) {
        this._extensionUri = extensionUri;
        this._api = api;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'media-src', 'dist')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.type) {
                case 'sendMessage':
                    await this._handleSendMessage(message.text, webviewView.webview);
                    break;
                case 'acceptChanges':
                    await this._handleAcceptChanges(webviewView.webview);
                    break;
                case 'rejectChanges':
                    await this._handleRejectChanges(webviewView.webview);
                    break;
                case 'clearHistory':
                    this._messageHistory = [];
                    webviewView.webview.postMessage({ type: 'historyCleared' });
                    break;
                case 'getHistory':
                    webviewView.webview.postMessage({
                        type: 'historyLoaded',
                        messages: this._messageHistory
                    });
                    break;
            }
        });

        // Send initial state
        webviewView.webview.postMessage({
            type: 'init',
            backendUrl: this._api.baseUrl,
            workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        });
    }

    private async _handleSendMessage(text: string, webview: vscode.Webview): Promise<void> {
        const userMessage = { role: 'user', content: text, timestamp: Date.now() };
        this._messageHistory.push(userMessage);

        webview.postMessage({ type: 'userMessage', message: userMessage });
        webview.postMessage({ type: 'status', status: 'thinking' });

        try {
            const session = await this._api.sendMessage(text);
            this._currentSessionId = session.session_id;

            webview.postMessage({
                type: 'sessionStarted',
                sessionId: session.session_id
            });

            this._cleanupStream = this._api.connectToStream(
                session.session_id,
                (event: AgentEvent) => {
                    webview.postMessage({ type: 'agentEvent', event });

                    if (event.type === 'thought' || event.type === 'action') {
                        this._messageHistory.push({
                            role: 'assistant',
                            content: event.content,
                            type: event.type,
                            timestamp: Date.now()
                        });
                    }
                },
                (error: Error) => {
                    webview.postMessage({ type: 'error', message: error.message });
                    webview.postMessage({ type: 'status', status: 'error' });
                }
            );

        } catch (err: any) {
            webview.postMessage({ type: 'error', message: `Failed to start agent: ${err.message}` });
            webview.postMessage({ type: 'status', status: 'error' });
        }
    }

    private async _handleAcceptChanges(webview: vscode.Webview): Promise<void> {
        try {
            await this._api.acceptAllChanges();
            webview.postMessage({ type: 'changesAccepted' });
            vscode.window.showInformationMessage('All changes accepted');
        } catch (err: any) {
            webview.postMessage({ type: 'error', message: `Failed to accept changes: ${err.message}` });
        }
    }

    private async _handleRejectChanges(webview: vscode.Webview): Promise<void> {
        try {
            await this._api.rejectAllChanges();
            webview.postMessage({ type: 'changesRejected' });
            vscode.window.showInformationMessage('All changes rejected');
        } catch (err: any) {
            webview.postMessage({ type: 'error', message: `Failed to reject changes: ${err.message}` });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    background: var(--vscode-editor-background, #0A0E1A);
                    color: var(--vscode-editor-foreground, #E0E7FF);
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                .header {
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border, #1A1F2E);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .header h3 { color: #00E5FF; font-size: 13px; font-weight: 600; }
                .status { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #1A1F2E; }
                .status.online { color: #00E5FF; }
                .status.thinking { color: #FFD700; animation: pulse 1s infinite; }
                .status.error { color: #FF4444; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                .messages { flex: 1; overflow-y: auto; padding: 12px; }
                .message { margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; }
                .message.user { background: #141B2D; border-left: 2px solid #00E5FF; }
                .message.assistant { background: #1A1F2E; border-left: 2px solid #4EC9B0; }
                .message.error { background: #FF444418; border-left: 2px solid #FF4444; color: #FF6B6B; }
                .message code { background: #0A0E1A; padding: 2px 4px; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
                .input-area { padding: 12px; border-top: 1px solid var(--vscode-panel-border, #1A1F2E); display: flex; gap: 8px; }
                .input-area textarea {
                    flex: 1; background: var(--vscode-input-background, #141B2D); border: 1px solid var(--vscode-input-border, #1A1F2E); border-radius: 6px;
                    color: var(--vscode-input-foreground, #E0E7FF); padding: 8px 12px; font-size: 12px; resize: none; height: 60px; font-family: inherit;
                }
                .input-area textarea:focus { outline: none; border-color: #00E5FF; }
                .input-area button {
                    background: #00E5FF; color: #0A0E1A; border: none; border-radius: 6px;
                    padding: 0 16px; font-size: 12px; font-weight: 600; cursor: pointer;
                }
                .input-area button:hover { background: #00FFFF; }
                .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
                .actions { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border, #1A1F2E); display: flex; gap: 8px; display: none; }
                .actions button { flex: 1; background: #141B2D; border: 1px solid #1A1F2E; color: #E0E7FF; padding: 6px; border-radius: 4px; font-size: 11px; cursor: pointer; }
                .actions button.accept { border-color: #00E5FF; color: #00E5FF; }
                .actions button.reject { border-color: #FF4444; color: #FF4444; }
            </style>
        </head>
        <body>
            <div class="header">
                <h3>Construct Agent</h3>
                <span class="status online" id="status">Ready</span>
            </div>
            <div class="messages" id="messages"></div>
            <div class="actions" id="actions">
                <button class="accept" onclick="acceptChanges()">Accept All</button>
                <button class="reject" onclick="rejectChanges()">Reject All</button>
            </div>
            <div class="input-area">
                <textarea id="input" placeholder="Ask the agent to code something... (Cmd+Enter to send)"></textarea>
                <button id="sendBtn" onclick="sendMessage()">Send</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                let isStreaming = false;

                function sendMessage() {
                    const input = document.getElementById('input');
                    const text = input.value.trim();
                    if (!text || isStreaming) return;

                    addMessage('user', text);
                    input.value = '';
                    isStreaming = true;
                    updateStatus('thinking');
                    document.getElementById('sendBtn').disabled = true;

                    vscode.postMessage({ type: 'sendMessage', text });
                }

                function addMessage(role, content, type) {
                    const messagesDiv = document.getElementById('messages');
                    const div = document.createElement('div');
                    div.className = 'message ' + role;
                    div.textContent = content;
                    messagesDiv.appendChild(div);
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                }

                function updateStatus(status) {
                    const el = document.getElementById('status');
                    el.className = 'status ' + status;
                    el.textContent = status === 'thinking' ? 'Thinking...' :
                                    status === 'error' ? 'Error' : 'Ready';
                }

                function acceptChanges() {
                    vscode.postMessage({ type: 'acceptChanges' });
                }

                function rejectChanges() {
                    vscode.postMessage({ type: 'rejectChanges' });
                }

                document.getElementById('input').addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        sendMessage();
                    }
                });

                window.addEventListener('message', event => {
                    const msg = event.data;
                    switch (msg.type) {
                        case 'sessionStarted':
                            updateStatus('thinking');
                            break;
                        case 'agentEvent':
                            if (msg.event.type === 'thought') {
                                addMessage('assistant', '[Thought] ' + msg.event.content);
                            } else if (msg.event.type === 'action') {
                                addMessage('assistant', '[Action] ' + msg.event.content);
                            } else if (msg.event.type === 'observation') {
                                addMessage('assistant', '[Result] ' + msg.event.content);
                            } else if (msg.event.type === 'complete') {
                                isStreaming = false;
                                updateStatus('online');
                                document.getElementById('sendBtn').disabled = false;
                                document.getElementById('actions').style.display = 'flex';
                            }
                            break;
                        case 'error':
                            addMessage('error', msg.message);
                            isStreaming = false;
                            updateStatus('error');
                            document.getElementById('sendBtn').disabled = false;
                            break;
                        case 'changesAccepted':
                            addMessage('assistant', 'All changes accepted');
                            document.getElementById('actions').style.display = 'none';
                            break;
                        case 'changesRejected':
                            addMessage('assistant', 'All changes rejected');
                            document.getElementById('actions').style.display = 'none';
                            break;
                        case 'historyLoaded':
                            msg.messages.forEach(m => addMessage(m.role, m.content));
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }

    show(): void {
        this._view?.show(true);
    }

    dispose(): void {
        this._cleanupStream?.();
    }
}
