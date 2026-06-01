import * as vscode from 'vscode';
import { ConstructAPI } from '../api/ConstructAPI';
import { AgentPanel } from '../panels/AgentPanel';
import { InlineChatProvider } from '../inline/InlineChatProvider';

export class AgentCommands {
    private _api: ConstructAPI;
    private _panel: AgentPanel;
    private _inline: InlineChatProvider;

    constructor(api: ConstructAPI, panel: AgentPanel, inline: InlineChatProvider) {
        this._api = api;
        this._panel = panel;
        this._inline = inline;
    }

    register(): vscode.Disposable[] {
        return [
            vscode.commands.registerCommand('construct.newChat', () => {
                this._panel.show();
            }),

            vscode.commands.registerCommand('construct.acceptAllChanges', async () => {
                try {
                    await this._api.acceptAllChanges();
                    vscode.window.showInformationMessage('All changes accepted');
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to accept: ${err.message}`);
                }
            }),

            vscode.commands.registerCommand('construct.rejectAllChanges', async () => {
                try {
                    await this._api.rejectAllChanges();
                    vscode.window.showInformationMessage('All changes rejected');
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to reject: ${err.message}`);
                }
            }),

            vscode.commands.registerCommand('construct.inlineChat', () => {
                this._inline.showAtCursor();
            }),

            vscode.commands.registerCommand('construct.openMemory', () => {
                vscode.window.showInformationMessage('Memory browser coming in v0.3');
            }),

            vscode.commands.registerCommand('construct.openChanges', () => {
                vscode.commands.executeCommand('workbench.view.scm');
            }),

            vscode.commands.registerCommand('construct.configure', () => {
                vscode.commands.executeCommand('workbench.action.openSettings', 'construct');
            })
        ];
    }
}
