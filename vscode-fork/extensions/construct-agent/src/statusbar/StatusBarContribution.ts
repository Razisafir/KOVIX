import * as vscode from 'vscode';
import { ConstructAPI } from '../api/ConstructAPI';

export class StatusBarContribution implements vscode.Disposable {
    private _agentStatus: vscode.StatusBarItem;
    private _modelStatus: vscode.StatusBarItem;
    private _changesStatus: vscode.StatusBarItem;
    private _disposables: vscode.Disposable[] = [];

    constructor(api: ConstructAPI) {
        this._agentStatus = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this._agentStatus.command = 'construct.newChat';
        this._updateAgentStatus('Offline', 'offline');
        this._agentStatus.show();

        this._modelStatus = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            101
        );
        this._modelStatus.text = '$(zap) Local';
        this._modelStatus.tooltip = 'Active LLM: Local (via Construct backend)';
        this._modelStatus.show();

        this._changesStatus = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._changesStatus.command = 'construct.openChanges';
        this._updateChangesStatus(0);
        this._changesStatus.show();

        this._disposables.push(
            api.onStatusChange(status => {
                this._updateAgentStatus(status, status === 'Ready' ? 'online' : 'offline');
            })
        );
    }

    updateStatus(status: string, type: 'online' | 'offline' | 'thinking' | 'error'): void {
        this._updateAgentStatus(status, type);
    }

    updateModel(model: string): void {
        this._modelStatus.text = `$(zap) ${model}`;
        this._modelStatus.tooltip = `Active LLM: ${model}`;
    }

    updatePendingChanges(count: number): void {
        this._updateChangesStatus(count);
    }

    private _updateAgentStatus(status: string, type: string): void {
        const icons: Record<string, string> = {
            online: '$(robot)',
            offline: '$(debug-disconnect)',
            thinking: '$(loading~spin)',
            error: '$(error)'
        };
        const colors: Record<string, string | undefined> = {
            online: '#00E5FF',
            offline: '#4A5568',
            thinking: '#FFD700',
            error: '#FF4444'
        };

        this._agentStatus.text = `${icons[type] || '$(robot)'} ${status}`;
        this._agentStatus.color = colors[type];
        this._agentStatus.tooltip = `Construct Agent: ${status}`;
    }

    private _updateChangesStatus(count: number): void {
        if (count > 0) {
            this._changesStatus.text = `$(diff-added) ${count} pending`;
            this._changesStatus.color = '#00E5FF';
            this._changesStatus.tooltip = `${count} changes awaiting approval`;
        } else {
            this._changesStatus.text = '$(diff) 0 pending';
            this._changesStatus.color = undefined;
            this._changesStatus.tooltip = 'No pending changes';
        }
    }

    dispose(): void {
        this._agentStatus.dispose();
        this._modelStatus.dispose();
        this._changesStatus.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}
