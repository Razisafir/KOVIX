/*---------------------------------------------------------------------------------------------
 *  Construct IDE - AI Coding Agent View
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions } from '../../../../workbench/browser/parts/views/viewPane.js';
import { ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import * as dom from '../../../../base/browser/dom.js';

export class ConstructAgentViewPane extends ViewPane {

        private messageContainer!: HTMLElement;
        private inputBox!: HTMLInputElement;

        constructor(
                options: IViewPaneOptions,
        ) {
                super(options);
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';

                // Messages area
                this.messageContainer = dom.$('.construct-messages');
                this.messageContainer.style.cssText = `
                        flex: 1; overflow-y: auto; padding: 10px;
                `;

                // Welcome message
                const welcome = dom.$('.construct-welcome');
                welcome.style.cssText = `
                        padding: 16px; text-align: center;
                `;

                const logo = dom.$('.construct-logo');
                logo.style.cssText = `
                        font-size: 32px; margin-bottom: 8px; color: #00E5FF;
                `;
                logo.textContent = '⬡';

                const title = dom.$('.construct-title');
                title.style.cssText = `
                        font-size: 14px; font-weight: 600; color: #E0E7FF; margin-bottom: 4px;
                `;
                title.textContent = 'Construct Agent';

                const subtitle = dom.$('.construct-subtitle');
                subtitle.style.cssText = `
                        font-size: 12px; color: #4A5568; margin-bottom: 12px;
                `;
                subtitle.textContent = 'AI-powered coding assistant';

                const hint = dom.$('.construct-hint');
                hint.style.cssText = `
                        font-size: 11px; color: #4A5568; font-family: monospace;
                        background: #0A0E1A; border-radius: 4px; padding: 6px 10px;
                        display: inline-block;
                `;
                hint.textContent = 'Ctrl+Shift+I  Inline edit  •  Ctrl+Shift+C  Focus panel';

                welcome.appendChild(logo);
                welcome.appendChild(title);
                welcome.appendChild(subtitle);
                welcome.appendChild(hint);
                this.messageContainer.appendChild(welcome);

                container.appendChild(this.messageContainer);

                // Input area
                const inputArea = dom.$('.construct-input-area');
                inputArea.style.cssText = `
                        padding: 8px; border-top: 1px solid #1A1F2E;
                        display: flex; gap: 6px; align-items: center;
                `;

                this.inputBox = dom.$('input.construct-chat-input') as HTMLInputElement;
                this.inputBox.type = 'text';
                this.inputBox.placeholder = 'Ask Construct anything...';
                this.inputBox.style.cssText = `
                        flex: 1; background: #0A0E1A; border: 1px solid #1A1F2E;
                        border-radius: 4px; padding: 8px 10px; color: #E0E7FF;
                        font-size: 13px; outline: none;
                `;

                const sendBtn = dom.$('button.construct-send-btn') as HTMLButtonElement;
                sendBtn.textContent = '→';
                sendBtn.style.cssText = `
                        background: #00E5FF; color: #0A0E1A; border: none;
                        border-radius: 4px; padding: 6px 12px; cursor: pointer;
                        font-size: 14px; font-weight: bold;
                `;

                // Handle send
                const sendMessage = () => {
                        const text = this.inputBox.value.trim();
                        if (!text) return;

                        // Add user message
                        const msg = dom.$('.construct-user-msg');
                        msg.style.cssText = `
                                background: #00E5FF20; border-left: 2px solid #00E5FF;
                                padding: 8px 10px; margin: 8px 0; border-radius: 0 4px 4px 0;
                                font-size: 13px; color: #E0E7FF;
                        `;
                        msg.textContent = text;
                        this.messageContainer.appendChild(msg);

                        // Add placeholder response
                        const resp = dom.$('.construct-agent-msg');
                        resp.style.cssText = `
                                background: #141B2D; border-left: 2px solid #4A5568;
                                padding: 8px 10px; margin: 8px 0; border-radius: 0 4px 4px 0;
                                font-size: 13px; color: #4A5568;
                        `;
                        resp.textContent = 'Connect your AI backend to get responses. The Construct agent service is ready to accept a Python sidecar on port 8000.';
                        this.messageContainer.appendChild(resp);

                        this.inputBox.value = '';
                        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
                };

                sendBtn.onclick = sendMessage;
                this.inputBox.onkeydown = (e) => {
                        if (e.key === 'Enter') { sendMessage(); }
                };

                inputArea.appendChild(this.inputBox);
                inputArea.appendChild(sendBtn);
                container.appendChild(inputArea);
        }

        protected override layoutBody(height: number, width: number): void {
                // Layout handled by flexbox
        }
}
