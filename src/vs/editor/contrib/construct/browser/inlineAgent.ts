/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Inline Agent Controller
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { EditorContributionInstantiation, registerEditorContribution } from '../../../browser/editorExtensions';
import { ICodeEditor, IContentWidget, IContentWidgetPosition, ContentWidgetPositionPreference } from '../../../browser/editorBrowser.js';
import { IEditorContribution } from '../../../common/editorCommon.js';
import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../../common/core/position.js';
import { localize } from '../../../../nls';

class InlineAgentWidget implements IContentWidget {
        private readonly _domNode: HTMLElement;
        readonly allowEditorOverflow = true;

        getId(): string { return 'construct.inlineAgent'; }

        constructor(
                _position: Position
        ) {
                this._domNode = dom.$('.construct-inline-agent');
                this._domNode.style.cssText = `
                        background: #141B2D;
                        border: 1px solid #00E5FF;
                        border-radius: 6px;
                        padding: 8px 12px;
                        min-width: 300px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                `;

                const header = dom.$('.construct-inline-header');
                header.style.cssText = `
                        display: flex; align-items: center; gap: 6px;
                        margin-bottom: 6px; color: #00E5FF; font-size: 12px; font-weight: 600;
                `;
                header.textContent = '⬡ Construct Agent';

                const input = dom.$('input.construct-inline-input') as HTMLInputElement;
                input.type = 'text';
                input.placeholder = localize('constructAgentPlaceholder', "Ask Construct to edit code...");
                input.style.cssText = `
                        width: 100%; background: #0A0E1A; border: 1px solid #1A1F2E;
                        border-radius: 4px; padding: 6px 8px; color: #E0E7FF;
                        font-size: 13px; outline: none;
                `;

                this._domNode.appendChild(header);
                this._domNode.appendChild(input);

                // Focus the input when shown
                setTimeout(() => input.focus(), 50);
        }

        getPosition(): IContentWidgetPosition | null {
                return {
                        position: null,
                        preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW]
                };
        }

        getDomNode(): HTMLElement {
                return this._domNode;
        }
}

export class InlineAgentController extends Disposable implements IEditorContribution {
        public static readonly ID = 'editor.contrib.construct.inlineAgent';

        private _currentWidget: InlineAgentWidget | undefined;

        constructor(
                private readonly _editor: ICodeEditor
        ) {
                super();
        }

        showInlineWidget(): void {
                // Remove existing widget if any
                if (this._currentWidget) {
                        this._editor.removeContentWidget(this._currentWidget);
                }

                const position = this._editor.getPosition();
                if (!position) {
                        return;
                }

                this._currentWidget = new InlineAgentWidget(position);
                this._editor.addContentWidget(this._currentWidget);
        }

        override dispose(): void {
                if (this._currentWidget) {
                        this._editor.removeContentWidget(this._currentWidget);
                }
                super.dispose();
        }
}

// Register the editor contribution only (no workbench-dependent actions)
registerEditorContribution(InlineAgentController.ID, InlineAgentController, EditorContributionInstantiation.AfterFirstRender);
