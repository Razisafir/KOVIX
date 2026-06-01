import * as vscode from 'vscode';
import { ConstructAPI } from '../api/ConstructAPI';

export class InlineChatProvider implements vscode.InlineCompletionItemProvider {
    private _api: ConstructAPI;

    constructor(api: ConstructAPI) { this._api = api; }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | null> {
        // TODO: Implement when completions backend is ready
        return null;
    }

    showAtCursor(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection.isEmpty ?
            new vscode.Range(selection.start.line, 0, selection.start.line, selection.start.character) :
            selection
        );

        vscode.window.showInputBox({
            prompt: 'Ask Construct to edit this code',
            placeHolder: 'e.g., "Add error handling", "Refactor to async", "Add tests"',
            value: '',
            ignoreFocusOut: true
        }).then(async prompt => {
            if (!prompt) { return; }

            const fullPrompt = `Edit: ${prompt}\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Construct Agent is thinking...',
                    cancellable: true
                }, async (_progress, cancellationToken) => {
                    const session = await this._api.sendMessage(fullPrompt, 'edit');

                    let suggestedCode = '';
                    const cleanup = this._api.connectToStream(
                        session.session_id,
                        (event) => {
                            if (event.type === 'action' && event.content.includes('```')) {
                                const match = event.content.match(/```[\s\S]*?\n([\s\S]*?)```/);
                                if (match) { suggestedCode = match[1]; }
                            }
                        }
                    );

                    // Wait for completion or cancellation
                    await new Promise<void>((resolve) => {
                        const timeout = setTimeout(() => {
                            cleanup();
                            resolve();
                        }, 30000);

                        cancellationToken.onCancellationRequested(() => {
                            cleanup();
                            clearTimeout(timeout);
                            resolve();
                        });
                    });

                    if (suggestedCode) {
                        await this._showDiff(editor, selectedText, suggestedCode);
                    } else {
                        vscode.window.showWarningMessage('No code suggestion received');
                    }
                });
            } catch (err: any) {
                vscode.window.showErrorMessage(`Inline chat failed: ${err.message}`);
            }
        });
    }

    private async _showDiff(editor: vscode.TextEditor, original: string, modified: string): Promise<void> {
        const doc = editor.document;
        const originalUri = doc.uri.with({ scheme: 'construct-original' });
        const modifiedUri = doc.uri.with({ scheme: 'construct-modified' });

        const originalProvider = vscode.workspace.registerTextDocumentContentProvider('construct-original', {
            provideTextDocumentContent: () => original
        });
        const modifiedProvider = vscode.workspace.registerTextDocumentContentProvider('construct-modified', {
            provideTextDocumentContent: () => modified
        });

        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri,
                modifiedUri,
                `Construct: ${doc.fileName}`,
                { preview: false }
            );
        } finally {
            setTimeout(() => {
                originalProvider.dispose();
                modifiedProvider.dispose();
            }, 60000);
        }
    }
}
