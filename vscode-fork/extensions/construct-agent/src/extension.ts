import * as vscode from 'vscode';
import { AgentPanel } from './panels/AgentPanel';
import { InlineChatProvider } from './inline/InlineChatProvider';
import { StatusBarContribution } from './statusbar/StatusBarContribution';
import { AgentCommands } from './commands/AgentCommands';
import { ConstructAPI } from './api/ConstructAPI';

let api: ConstructAPI;
let statusBar: StatusBarContribution;

export function activate(context: vscode.ExtensionContext) {
    console.log('Construct Agent extension activated');

    // Initialize API client (connects to Python backend)
    const config = vscode.workspace.getConfiguration('construct');
    const backendUrl = config.get<string>('backendUrl', 'http://127.0.0.1:8000');
    api = new ConstructAPI(backendUrl);

    // Start backend sidecar (spawns Python process)
    if (config.get<boolean>('autoStartBackend', true)) {
        api.ensureBackendRunning().then(() => {
            console.log('Construct backend connected');
            statusBar.updateStatus('Ready', 'online');
        }).catch(err => {
            console.error('Backend failed:', err);
            vscode.window.showWarningMessage(
                'Construct backend not running. Start manually: cd agent-backend && python -m uvicorn app:app --port 8000'
            );
            statusBar.updateStatus('Offline', 'offline');
        });
    }

    // Register Agent Panel (sidebar webview)
    const agentPanel = new AgentPanel(context.extensionUri, api);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('construct.agentPanel', agentPanel, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register Inline Chat (Cmd+K / Ctrl+Shift+L)
    const inlineProvider = new InlineChatProvider(api);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineProvider
        )
    );

    // Register Status Bar
    statusBar = new StatusBarContribution(api);
    context.subscriptions.push(statusBar);

    // Register Commands
    const commands = new AgentCommands(api, agentPanel, inlineProvider);
    context.subscriptions.push(...commands.register());

    // Handle configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('construct')) {
                api.reloadConfig();
            }
        })
    );
}

export function deactivate() {
    console.log('Construct Agent extension deactivated');
    api?.dispose();
    statusBar?.dispose();
}
