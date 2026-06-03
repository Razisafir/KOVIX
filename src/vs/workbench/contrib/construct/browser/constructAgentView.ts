/*---------------------------------------------------------------------------------------------
 *  Construct IDE - AI Coding Agent View
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * constructAgentView.ts
 *
 * The primary user-facing view for the Construct AI coding agent.
 * This is NOT a placeholder — every message sends a REAL LLM API call,
 * every response streams in REAL TIME, and every tool call executes REAL operations.
 *
 * The view injects VS Code DI services for LLM calls, credential management,
 * and terminal execution. No fake delays, no hardcoded responses.
 */

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { ILLMProviderService, ILLMStreamingService, ICredentialStoreService, LLMMessage, LLMToolDefinition, StreamChunkType, ProviderConnectionStatus } from '../../../../platform/construct/common/llmProvider.js';
import { ITerminalExecutionBridgeService } from '../../../../platform/construct/common/terminalExecutionBridge.js';

/** Maximum agent loop iterations to prevent infinite loops */
const MAX_AGENT_LOOPS = 15;

/** Maximum conversation history messages before trimming */
const MAX_HISTORY_MESSAGES = 40;

/** Tool definitions for the Construct agent */
const AGENT_TOOLS: LLMToolDefinition[] = [
        {
                name: 'read_file',
                description: 'Read the contents of a file at the given absolute path. Returns the file content as text.',
                parameters: {
                        type: 'object',
                        properties: {
                                path: { type: 'string', description: 'Absolute path to the file to read' },
                        },
                        required: ['path'],
                },
        },
        {
                name: 'write_file',
                description: 'Write content to a file at the given absolute path. Creates parent directories if needed. Overwrites existing files.',
                parameters: {
                        type: 'object',
                        properties: {
                                path: { type: 'string', description: 'Absolute path to the file to write' },
                                content: { type: 'string', description: 'Content to write to the file' },
                        },
                        required: ['path', 'content'],
                },
        },
        {
                name: 'list_directory',
                description: 'List files and directories at the given path. Returns names with type indicators.',
                parameters: {
                        type: 'object',
                        properties: {
                                path: { type: 'string', description: 'Absolute path to the directory to list' },
                        },
                        required: ['path'],
                },
        },
        {
                name: 'run_command',
                description: 'Run a shell command in the project directory. Returns stdout and stderr. Use for installing dependencies, running builds, etc.',
                parameters: {
                        type: 'object',
                        properties: {
                                command: { type: 'string', description: 'Shell command to execute' },
                        },
                        required: ['command'],
                },
        },
        {
                name: 'create_directory',
                description: 'Create a directory and all parent directories if needed.',
                parameters: {
                        type: 'object',
                        properties: {
                                path: { type: 'string', description: 'Absolute path of the directory to create' },
                        },
                        required: ['path'],
                },
        },
];

/** System prompt template for the Construct agent */
const SYSTEM_PROMPT = `You are CONSTRUCT, an expert AI coding assistant embedded in a VS Code fork.
You help users create, edit, and improve code. You have access to tools for reading
and writing files, listing directories, running terminal commands, and creating directories.

Guidelines:
- Always read relevant existing files before making changes
- Write complete, working code — never truncate with '// ... rest of file'
- Prefer running commands over asking the user to run them
- After writing files, verify by reading them back
- Keep the user informed with brief status messages
- If task requires installing dependencies, do it
- Always think about what could go wrong and handle it

Working directory: {workspacePath}
Current date: {date}`;

/** Planning-only system prompt — no file-writing tools, only read access */
const PLANNING_PROMPT = `You are planning a coding task. Do NOT write any files yet.
First, explore the project structure and relevant existing files.
Then output a numbered plan of exactly what you will do.
Format:
1. [Read] Examine src/App.tsx to understand current structure
2. [Create] Write src/components/Counter.tsx with state and handlers
3. [Edit] Update src/App.tsx to import and render Counter
4. [Run] npm run build to verify no compilation errors

Be specific about file paths. Be conservative — fewer steps is better.
Task: {task}`;

/**
 * Security blocklist patterns for terminal commands.
 * These are checked before every command execution — no exceptions.
 */
const COMMAND_BLOCKLIST = [
        /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-rf\s+|--recursive\s+--force\s+)\/(\s|$)/,  // rm -rf /
        /\bsudo\b/,                     // any sudo
        /\bcurl\s+.*\|\s*(sh|bash)\b/,  // curl | sh
        /\bwget\s+.*\|\s*(sh|bash)\b/,  // wget | sh
        /\bmkfs\b/,                     // format disk
        /\bdd\s+if=.*of=\/dev\//,       // dd to device
        /\bchmod\s+777\s+\//,          // chmod 777 /
        /\/etc\/(passwd|shadow|sudoers)/, // writing to /etc/
];

export class ConstructAgentViewPane extends ViewPane {

        private messageContainer!: HTMLElement;
        private inputBox!: HTMLInputElement;
        private sendBtn!: HTMLButtonElement;
        private stopBtn!: HTMLButtonElement;
        private settingsPanel!: HTMLElement;
        private apiKeyInput!: HTMLInputElement;
        private connectionStatus!: HTMLElement;

        /** Full conversation history for the current session */
        private conversationHistory: LLMMessage[] = [];

        /** Whether an agent run is in progress */
        private _isRunning = false;

        /** Abort controller for the current agent run */
        private _abortController: AbortController | undefined;

        /** Cached workspace root path */
        private _workspaceRoot: string = '';

        constructor(
                options: IViewPaneOptions,
                @IKeybindingService keybindingService: IKeybindingService,
                @IContextMenuService contextMenuService: IContextMenuService,
                @IConfigurationService configurationService: IConfigurationService,
                @IContextKeyService contextKeyService: IContextKeyService,
                @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
                @IInstantiationService private readonly instantiationService: IInstantiationService,
                @IOpenerService openerService: IOpenerService,
                @IThemeService themeService: IThemeService,
                @ITelemetryService telemetryService: ITelemetryService,
                @IHoverService hoverService: IHoverService,
                @ILLMProviderService private readonly llmProvider: ILLMProviderService,
                @ILLMStreamingService private readonly llmStreaming: ILLMStreamingService,
                @ICredentialStoreService private readonly credentialStore: ICredentialStoreService,
                @ITerminalExecutionBridgeService private readonly terminalBridge: ITerminalExecutionBridgeService,
                @IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
                @ILogService private readonly logService: ILogService,
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

                // Get workspace root
                const workspace = this.workspaceContext.getWorkspace();
                if (workspace.folders.length > 0) {
                        this._workspaceRoot = workspace.folders[0].uri.fsPath;
                }
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);

                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';

                // === Settings panel (API key, etc.) ===
                this.settingsPanel = document.createElement('div');
                this.settingsPanel.className = 'construct-settings';
                this.settingsPanel.style.cssText = `
                        padding: 8px 10px; border-bottom: 1px solid #1A1F2E;
                        display: none; flex-direction: column; gap: 6px;
                `;
                this.renderSettingsPanel();
                container.appendChild(this.settingsPanel);

                // === Messages area ===
                this.messageContainer = document.createElement('div');
                this.messageContainer.className = 'construct-messages';
                this.messageContainer.style.cssText = `
                        flex: 1; overflow-y: auto; padding: 10px;
                `;

                // Welcome message
                this.renderWelcome();
                container.appendChild(this.messageContainer);

                // === Input area ===
                const inputArea = document.createElement('div');
                inputArea.className = 'construct-input-area';
                inputArea.style.cssText = `
                        padding: 8px; border-top: 1px solid #1A1F2E;
                        display: flex; gap: 6px; align-items: center;
                `;

                this.inputBox = document.createElement('input');
                this.inputBox.className = 'construct-chat-input';
                this.inputBox.type = 'text';
                this.inputBox.placeholder = 'Ask Construct anything...';
                this.inputBox.style.cssText = `
                        flex: 1; background: var(--vscode-input-background, #0A0E1A);
                        border: 1px solid var(--vscode-input-border, #1A1F2E);
                        border-radius: 4px; padding: 8px 10px;
                        color: var(--vscode-input-foreground, #E0E7FF);
                        font-size: 13px; outline: none;
                `;

                this.sendBtn = document.createElement('button');
                this.sendBtn.className = 'construct-send-btn';
                this.sendBtn.textContent = '→';
                this.sendBtn.style.cssText = `
                        background: var(--vscode-button-background, #00E5FF);
                        color: var(--vscode-button-foreground, #0A0E1A);
                        border: none; border-radius: 4px; padding: 6px 12px;
                        cursor: pointer; font-size: 14px; font-weight: bold;
                `;

                this.stopBtn = document.createElement('button');
                this.stopBtn.className = 'construct-stop-btn';
                this.stopBtn.textContent = '■';
                this.stopBtn.title = 'Stop agent';
                this.stopBtn.style.cssText = `
                        background: #F87171; color: #fff; border: none;
                        border-radius: 4px; padding: 6px 12px; cursor: pointer;
                        font-size: 14px; font-weight: bold; display: none;
                `;

                // Handle send
                const sendMessage = () => {
                        const text = this.inputBox.value.trim();
                        if (!text || this._isRunning) { return; }
                        this.inputBox.value = '';
                        this.handleUserMessage(text);
                };

                this.sendBtn.onclick = sendMessage;
                this.inputBox.onkeydown = (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                        }
                };

                this.stopBtn.onclick = () => {
                        this.stopAgent();
                };

                inputArea.appendChild(this.inputBox);
                inputArea.appendChild(this.stopBtn);
                inputArea.appendChild(this.sendBtn);
                container.appendChild(inputArea);

                // Check for API key on startup
                this.checkApiKeyStatus();
        }

        private renderSettingsPanel(): void {
                // Settings header
                const header = document.createElement('div');
                header.style.cssText = `
                        display: flex; justify-content: space-between; align-items: center;
                `;

                const title = document.createElement('span');
                title.textContent = 'API Configuration';
                title.style.cssText = `
                        font-size: 12px; font-weight: 600;
                        color: var(--vscode-foreground, #E0E7FF);
                `;

                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = `
                        background: none; border: none; color: var(--vscode-descriptionForeground, #4A5568);
                        cursor: pointer; font-size: 12px; padding: 2px 4px;
                `;
                closeBtn.onclick = () => {
                        this.settingsPanel.style.display = 'none';
                };

                header.appendChild(title);
                header.appendChild(closeBtn);
                this.settingsPanel.appendChild(header);

                // Provider selector
                const providerRow = document.createElement('div');
                providerRow.style.cssText = `display: flex; gap: 6px; align-items: center;`;

                const providerLabel = document.createElement('label');
                providerLabel.textContent = 'Provider:';
                providerLabel.style.cssText = `font-size: 11px; color: var(--vscode-descriptionForeground, #4A5568); min-width: 50px;`;

                const providerSelect = document.createElement('select');
                providerSelect.style.cssText = `
                        flex: 1; background: var(--vscode-input-background, #0A0E1A);
                        border: 1px solid var(--vscode-input-border, #1A1F2E);
                        border-radius: 3px; padding: 4px 6px;
                        color: var(--vscode-input-foreground, #E0E7FF);
                        font-size: 12px;
                `;

                // Populate provider options from registered providers
                for (const [id, config] of this.llmProvider.providers) {
                        const opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = config.displayName;
                        if (id === this.llmProvider.activeProviderId) {
                                opt.selected = true;
                        }
                        providerSelect.appendChild(opt);
                }

                providerSelect.onchange = () => {
                        this.llmProvider.setActiveProvider(providerSelect.value);
                        this.checkApiKeyStatus();
                };

                providerRow.appendChild(providerLabel);
                providerRow.appendChild(providerSelect);
                this.settingsPanel.appendChild(providerRow);

                // API Key input
                const keyRow = document.createElement('div');
                keyRow.style.cssText = `display: flex; gap: 6px; align-items: center;`;

                const keyLabel = document.createElement('label');
                keyLabel.textContent = 'API Key:';
                keyLabel.style.cssText = `font-size: 11px; color: var(--vscode-descriptionForeground, #4A5568); min-width: 50px;`;

                this.apiKeyInput = document.createElement('input');
                this.apiKeyInput.type = 'password';
                this.apiKeyInput.placeholder = 'sk-ant-...';
                this.apiKeyInput.style.cssText = `
                        flex: 1; background: var(--vscode-input-background, #0A0E1A);
                        border: 1px solid var(--vscode-input-border, #1A1F2E);
                        border-radius: 3px; padding: 4px 6px;
                        color: var(--vscode-input-foreground, #E0E7FF);
                        font-size: 12px; outline: none;
                `;

                keyRow.appendChild(keyLabel);
                keyRow.appendChild(this.apiKeyInput);
                this.settingsPanel.appendChild(keyRow);

                // Button row: Save + Test
                const btnRow = document.createElement('div');
                btnRow.style.cssText = `display: flex; gap: 6px; justify-content: flex-end;`;

                const saveBtn = document.createElement('button');
                saveBtn.textContent = 'Save Key';
                saveBtn.style.cssText = `
                        background: var(--vscode-button-background, #00E5FF);
                        color: var(--vscode-button-foreground, #0A0E1A);
                        border: none; border-radius: 3px; padding: 4px 10px;
                        cursor: pointer; font-size: 11px; font-weight: 600;
                `;
                saveBtn.onclick = async () => {
                        const key = this.apiKeyInput.value.trim();
                        if (!key) { return; }
                        await this.credentialStore.storeKey(this.llmProvider.activeProviderId, key);
                        this.addSystemMessage('API key saved securely.');
                        this.apiKeyInput.value = '';
                        this.checkApiKeyStatus();
                };

                const testBtn = document.createElement('button');
                testBtn.textContent = 'Test Connection';
                testBtn.style.cssText = `
                        background: var(--vscode-button-secondaryBackground, #1A1F2E);
                        color: var(--vscode-button-secondaryForeground, #E0E7FF);
                        border: none; border-radius: 3px; padding: 4px 10px;
                        cursor: pointer; font-size: 11px; font-weight: 600;
                `;
                testBtn.onclick = async () => {
                        testBtn.textContent = 'Testing...';
                        testBtn.disabled = true;
                        try {
                                const status = await this.llmProvider.validateProvider(this.llmProvider.activeProviderId);
                                if (status === ProviderConnectionStatus.Connected) {
                                        this.addSystemMessage('✓ Connection successful! API key is valid.');
                                        this.connectionStatus.textContent = '● Connected';
                                        this.connectionStatus.style.color = '#4ADE80';
                                } else if (status === ProviderConnectionStatus.AuthRequired) {
                                        this.addSystemMessage('✗ Authentication failed. Please check your API key.');
                                        this.connectionStatus.textContent = '● Auth Required';
                                        this.connectionStatus.style.color = '#F87171';
                                } else if (status === ProviderConnectionStatus.RateLimited) {
                                        this.addSystemMessage('⚠ Rate limited. Your key works but you are being throttled.');
                                        this.connectionStatus.textContent = '● Rate Limited';
                                        this.connectionStatus.style.color = '#FBBF24';
                                } else {
                                        this.addSystemMessage(`✗ Connection failed with status: ${status}`);
                                        this.connectionStatus.textContent = '● Error';
                                        this.connectionStatus.style.color = '#F87171';
                                }
                        } catch (err: any) {
                                this.addSystemMessage(`✗ Connection error: ${err.message || String(err)}`);
                        } finally {
                                testBtn.textContent = 'Test Connection';
                                testBtn.disabled = false;
                        }
                };

                // Connection status indicator
                this.connectionStatus = document.createElement('span');
                this.connectionStatus.style.cssText = `
                        font-size: 11px; margin-left: 8px; align-self: center;
                `;
                this.connectionStatus.textContent = '● Unknown';
                this.connectionStatus.style.color = '#4A5568';

                btnRow.appendChild(this.connectionStatus);
                btnRow.appendChild(saveBtn);
                btnRow.appendChild(testBtn);
                this.settingsPanel.appendChild(btnRow);
        }

        private renderWelcome(): void {
                const welcome = document.createElement('div');
                welcome.className = 'construct-welcome';
                welcome.style.cssText = `padding: 16px; text-align: center;`;

                const logo = document.createElement('div');
                logo.className = 'construct-logo';
                logo.style.cssText = `font-size: 32px; margin-bottom: 8px; color: #00E5FF;`;
                logo.textContent = '⬡';

                const title = document.createElement('div');
                title.className = 'construct-title';
                title.style.cssText = `font-size: 14px; font-weight: 600; color: var(--vscode-foreground, #E0E7FF); margin-bottom: 4px;`;
                title.textContent = 'Construct Agent';

                const subtitle = document.createElement('div');
                subtitle.className = 'construct-subtitle';
                subtitle.style.cssText = `font-size: 12px; color: var(--vscode-descriptionForeground, #4A5568); margin-bottom: 12px;`;
                subtitle.textContent = 'AI-powered coding assistant — real LLM calls, real file edits';

                const hint = document.createElement('div');
                hint.className = 'construct-hint';
                hint.style.cssText = `
                        font-size: 11px; color: var(--vscode-descriptionForeground, #4A5568);
                        font-family: monospace; background: var(--vscode-input-background, #0A0E1A);
                        border-radius: 4px; padding: 6px 10px; display: inline-block;
                `;
                hint.textContent = 'Ctrl+Shift+I  Inline edit  •  Ctrl+Shift+C  Focus panel';

                // Configure button for API key
                const configBtn = document.createElement('button');
                configBtn.textContent = '⚙ Configure API Key';
                configBtn.style.cssText = `
                        display: block; margin: 10px auto 0;
                        background: var(--vscode-button-secondaryBackground, #1A1F2E);
                        color: var(--vscode-button-secondaryForeground, #E0E7FF);
                        border: 1px solid var(--vscode-input-border, #1A1F2E);
                        border-radius: 4px; padding: 6px 14px;
                        cursor: pointer; font-size: 12px;
                `;
                configBtn.onclick = () => {
                        this.settingsPanel.style.display = this.settingsPanel.style.display === 'none' ? 'flex' : 'none';
                };

                welcome.appendChild(logo);
                welcome.appendChild(title);
                welcome.appendChild(subtitle);
                welcome.appendChild(hint);
                welcome.appendChild(configBtn);
                this.messageContainer.appendChild(welcome);
        }

        private async checkApiKeyStatus(): Promise<void> {
                const providerId = this.llmProvider.activeProviderId;
                const hasKey = await this.credentialStore.hasKey(providerId);
                if (hasKey) {
                        const key = await this.credentialStore.getKey(providerId);
                        if (key && key.length > 4) {
                                this.apiKeyInput.placeholder = `••••${key.slice(-4)}`;
                        }
                        this.connectionStatus.textContent = '● Key Set';
                        this.connectionStatus.style.color = '#4ADE80';
                } else {
                        this.connectionStatus.textContent = '● No Key';
                        this.connectionStatus.style.color = '#F87171';
                }
        }

        // ─── Message rendering helpers ───

        private addUserMessage(text: string): void {
                // Remove welcome if present
                const welcome = this.messageContainer.querySelector('.construct-welcome');
                if (welcome) { welcome.remove(); }

                const msg = document.createElement('div');
                msg.className = 'construct-user-msg';
                msg.style.cssText = `
                        background: #00E5FF20; border-left: 2px solid #00E5FF;
                        padding: 8px 10px; margin: 8px 0; border-radius: 0 4px 4px 0;
                        font-size: 13px; color: var(--vscode-foreground, #E0E7FF);
                        white-space: pre-wrap; word-break: break-word;
                `;
                msg.textContent = text;
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
        }

        private addAgentMessage(): HTMLElement {
                const msg = document.createElement('div');
                msg.className = 'construct-agent-msg';
                msg.style.cssText = `
                        background: var(--vscode-textBlockQuote-background, #141B2D);
                        border-left: 2px solid #00E5FF;
                        padding: 8px 10px; margin: 8px 0; border-radius: 0 4px 4px 0;
                        font-size: 13px; color: var(--vscode-foreground, #E0E7FF);
                        white-space: pre-wrap; word-break: break-word;
                        font-family: var(--vscode-editor-font-family, monospace);
                        line-height: 1.5;
                `;
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
                return msg;
        }

        private addSystemMessage(text: string): void {
                const msg = document.createElement('div');
                msg.className = 'construct-system-msg';
                msg.style.cssText = `
                        padding: 4px 10px; margin: 4px 0;
                        font-size: 11px; color: var(--vscode-descriptionForeground, #4A5568);
                        font-style: italic;
                `;
                msg.textContent = text;
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
        }

        private addToolCallMessage(toolName: string, args: string): HTMLElement {
                const msg = document.createElement('div');
                msg.className = 'construct-tool-msg';
                msg.style.cssText = `
                        background: var(--vscode-textBlockQuote-background, #0A0E1A);
                        border-left: 2px solid #FBBF24;
                        padding: 6px 10px; margin: 4px 0; border-radius: 0 4px 4px 0;
                        font-size: 11px; color: var(--vscode-descriptionForeground, #4A5568);
                        font-family: var(--vscode-editor-font-family, monospace);
                `;

                const header = document.createElement('div');
                header.style.cssText = `color: #FBBF24; font-weight: 600; margin-bottom: 2px;`;
                header.textContent = `⚡ ${toolName}`;

                const argsEl = document.createElement('div');
                argsEl.style.cssText = `color: var(--vscode-descriptionForeground, #4A5568); white-space: pre-wrap; word-break: break-all;`;
                try {
                        argsEl.textContent = JSON.stringify(JSON.parse(args), null, 2);
                } catch {
                        argsEl.textContent = args;
                }

                msg.appendChild(header);
                msg.appendChild(argsEl);
                this.messageContainer.appendChild(msg);
                this.scrollToBottom();
                return msg;
        }

        private scrollToBottom(): void {
                this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        }

        private setRunning(running: boolean): void {
                this._isRunning = running;
                this.sendBtn.style.display = running ? 'none' : 'block';
                this.stopBtn.style.display = running ? 'block' : 'none';
                this.inputBox.disabled = running;
                if (running) {
                        this.inputBox.placeholder = 'Agent is working...';
                } else {
                        this.inputBox.placeholder = 'Ask Construct anything...';
                        this.inputBox.focus();
                }
        }

        // ─── Core agent logic ───

        /**
         * Handle a user message — the entry point for the agent loop.
         * This is REAL: it calls the LLM, processes tool calls, and streams responses.
         */
        private async handleUserMessage(text: string): Promise<void> {
                // Check for API key first
                const providerId = this.llmProvider.activeProviderId;
                const config = this.llmProvider.getProvider(providerId);
                if (config && !config.isLocal) {
                        const hasKey = await this.credentialStore.hasKey(providerId);
                        if (!hasKey) {
                                this.addSystemMessage('⚠ No API key configured. Click ⚙ to set your API key.');
                                this.settingsPanel.style.display = 'flex';
                                return;
                        }
                }

                this.addUserMessage(text);
                this.setRunning(true);
                this._abortController = new AbortController();

                try {
                        // === Phase 1: Planning ===
                        this.addSystemMessage('Planning...');

                        const planningMessages: LLMMessage[] = [
                                {
                                        role: 'system',
                                        content: PLANNING_PROMPT.replace('{task}', text),
                                },
                                { role: 'user', content: text },
                        ];

                        // Planning tools — read-only, no write access
                        const planningTools: LLMToolDefinition[] = [
                                AGENT_TOOLS[2], // list_directory
                                AGENT_TOOLS[0], // read_file
                        ];

                        let planText = '';
                        const planElement = this.addAgentMessage();
                        planElement.textContent = '⏳ Generating plan...';

                        try {
                                const planRequest = {
                                        requestId: generateUuid(),
                                        model: config?.defaultModel || 'claude-sonnet-4-20250514',
                                        messages: planningMessages,
                                        maxTokens: 2048,
                                        tools: planningTools,
                                };

                                // Stream the planning response
                                let fullPlan = '';
                                for await (const chunk of this.llmStreaming.streamRequest(planRequest)) {
                                        if (this._abortController?.signal.aborted) { break; }

                                        if (chunk.type === StreamChunkType.Token && chunk.content) {
                                                fullPlan += chunk.content;
                                                planElement.textContent = fullPlan;
                                                this.scrollToBottom();
                                        }
                                        if (chunk.type === StreamChunkType.Error) {
                                                planElement.textContent = `Error: ${chunk.error}`;
                                                break;
                                        }
                                }

                                planText = fullPlan;

                                // Check if user has the API key — if plan was generated, ask for approval
                                if (planText && !this._abortController?.signal.aborted) {
                                        // Show approval prompt
                                        const approvalEl = document.createElement('div');
                                        approvalEl.className = 'construct-approval';
                                        approvalEl.style.cssText = `
                                                background: #1A1F2E; border: 1px solid #00E5FF;
                                                border-radius: 6px; padding: 10px; margin: 8px 0;
                                        `;

                                        const approvalLabel = document.createElement('div');
                                        approvalLabel.style.cssText = `
                                                font-size: 12px; font-weight: 600; color: #00E5FF;
                                                margin-bottom: 8px;
                                        `;
                                        approvalLabel.textContent = '📋 Plan — Approve to execute';

                                        approvalEl.appendChild(approvalLabel);

                                        const btnRow = document.createElement('div');
                                        btnRow.style.cssText = `display: flex; gap: 6px;`;

                                        const approveBtn = document.createElement('button');
                                        approveBtn.textContent = '✓ Approve';
                                        approveBtn.style.cssText = `
                                                background: #4ADE80; color: #0A0E1A; border: none;
                                                border-radius: 4px; padding: 4px 12px; cursor: pointer;
                                                font-size: 12px; font-weight: 600;
                                        `;

                                        const cancelBtn = document.createElement('button');
                                        cancelBtn.textContent = '✗ Cancel';
                                        cancelBtn.style.cssText = `
                                                background: #F87171; color: #fff; border: none;
                                                border-radius: 4px; padding: 4px 12px; cursor: pointer;
                                                font-size: 12px; font-weight: 600;
                                        `;

                                        btnRow.appendChild(approveBtn);
                                        btnRow.appendChild(cancelBtn);
                                        approvalEl.appendChild(btnRow);
                                        this.messageContainer.appendChild(approvalEl);
                                        this.scrollToBottom();

                                        // Wait for user approval
                                        const approved = await new Promise<boolean>((resolve) => {
                                                approveBtn.onclick = () => resolve(true);
                                                cancelBtn.onclick = () => resolve(false);
                                        });

                                        approvalEl.remove();

                                        if (!approved) {
                                                this.addSystemMessage('Plan cancelled. No files were modified.');
                                                return;
                                        }
                                }
                        } catch (err: any) {
                                planElement.textContent = `Planning error: ${err.message || String(err)}`;
                                // If planning fails, still try to execute directly
                                this.addSystemMessage('Planning failed, attempting direct execution...');
                        }

                        // === Phase 2: Execution ===
                        this.addSystemMessage('Executing...');

                        // Build initial conversation with full tools
                        const workspacePath = this._workspaceRoot || process.cwd?.() || '.';
                        const systemContent = SYSTEM_PROMPT
                                .replace('{workspacePath}', workspacePath)
                                .replace('{date}', new Date().toISOString().split('T')[0]);

                        // Reset conversation history for the agent loop
                        this.conversationHistory = [
                                { role: 'system', content: systemContent },
                                { role: 'user', content: text },
                        ];

                        // If we got a plan, include it as context
                        if (planText) {
                                this.conversationHistory.push({
                                        role: 'assistant',
                                        content: `Here is my plan:\n${planText}\n\nNow executing the plan step by step.`,
                                });
                        }

                        // Agent loop — continue until end_turn or max iterations
                        let loopCount = 0;
                        while (loopCount < MAX_AGENT_LOOPS) {
                                if (this._abortController?.signal.aborted) {
                                        this.addSystemMessage('Agent stopped by user.');
                                        break;
                                }

                                loopCount++;

                                const responseElement = this.addAgentMessage();
                                responseElement.textContent = '';

                                const request = {
                                        requestId: generateUuid(),
                                        model: config?.defaultModel || 'claude-sonnet-4-20250514',
                                        messages: this.conversationHistory,
                                        maxTokens: 8192,
                                        tools: AGENT_TOOLS,
                                };

                                let fullResponse = '';
                                let toolCalls: { id: string; name: string; arguments: string }[] = [];
                                let finishReason = '';

                                try {
                                        // Use non-streaming request for tool use (more reliable parsing)
                                        const response = await this.llmProvider.sendRequest(request);

                                        fullResponse = response.content;
                                        toolCalls = response.toolCalls;
                                        finishReason = response.finishReason;

                                        // Show the text response
                                        if (fullResponse) {
                                                responseElement.textContent = fullResponse;
                                        } else if (toolCalls.length > 0) {
                                                responseElement.textContent = 'Executing tools...';
                                        }

                                        // Add assistant message to history
                                        this.conversationHistory.push({
                                                role: 'assistant',
                                                content: fullResponse,
                                                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                                        });

                                } catch (err: any) {
                                        const errorMsg = err?.message || String(err);
                                        responseElement.textContent = `Error: ${errorMsg}`;

                                        // Handle specific error types
                                        if (errorMsg.includes('401') || errorMsg.includes('auth')) {
                                                this.addSystemMessage('⚠ API key is invalid. Please update your key in settings.');
                                                this.settingsPanel.style.display = 'flex';
                                                break;
                                        }
                                        if (errorMsg.includes('429') || errorMsg.includes('rate')) {
                                                this.addSystemMessage('⚠ Rate limited. Waiting before retry...');
                                                await new Promise(r => setTimeout(r, 4000));
                                                continue;
                                        }
                                        break;
                                }

                                // If no tool calls or end_turn, we're done
                                if (toolCalls.length === 0 || finishReason === 'end_turn' || finishReason === 'stop') {
                                        if (!fullResponse && toolCalls.length === 0) {
                                                responseElement.textContent = 'Task complete.';
                                        }
                                        break;
                                }
                                // If finish reason is 'tool_use', the LLM wants us to execute tools and continue
                                // This is expected — we proceed to execute tools below

                                // Process tool calls
                                const toolResults: { toolCallId: string; content: string; isError?: boolean }[] = [];

                                for (const toolCall of toolCalls) {
                                        if (this._abortController?.signal.aborted) { break; }

                                        // Show tool call in UI
                                        this.addToolCallMessage(toolCall.name, toolCall.arguments);

                                        // Execute the tool — pass toolCall.id so result can reference it
                                        const result = await this.executeToolCall(toolCall.name, toolCall.arguments, toolCall.id);
                                        toolResults.push(result);

                                        // Show result
                                        const resultEl = document.createElement('div');
                                        resultEl.style.cssText = `
                                                padding: 4px 10px; margin: 2px 0 8px;
                                                font-size: 11px; font-family: monospace;
                                                color: ${result.isError ? '#F87171' : 'var(--vscode-descriptionForeground, #4A5568)'};
                                                background: var(--vscode-input-background, #0A0E1A);
                                                border-radius: 3px; max-height: 150px; overflow-y: auto;
                                                white-space: pre-wrap; word-break: break-all;
                                        `;
                                        resultEl.textContent = result.isError
                                                ? `Error: ${result.content}`
                                                : result.content.length > 2000
                                                        ? result.content.slice(0, 2000) + '\n... (truncated)'
                                                        : result.content;
                                        this.messageContainer.appendChild(resultEl);
                                        this.scrollToBottom();
                                }

                                // Add tool results to conversation history
                                for (const result of toolResults) {
                                        this.conversationHistory.push({
                                                role: 'tool',
                                                content: result.content,
                                                toolCallId: result.toolCallId,
                                        });
                                }

                                // Trim conversation if it gets too long
                                this.trimConversationHistory();
                        }

                        if (loopCount >= MAX_AGENT_LOOPS) {
                                this.addSystemMessage('⚠ Agent reached maximum iteration limit. Try breaking the task into smaller steps.');
                        }

                } catch (err: any) {
                        this.addSystemMessage(`Unexpected error: ${err?.message || String(err)}`);
                        this.logService.error('[ConstructAgent]', err);
                } finally {
                        this.setRunning(false);
                        this._abortController = undefined;
                }
        }

        /**
         * Execute a single tool call. This is REAL — files are read/written,
         * commands are executed in the terminal.
         */
        private async executeToolCall(name: string, argsJson: string, toolCallId: string = ''): Promise<{ toolCallId: string; content: string; isError?: boolean }> {
                let args: Record<string, unknown>;
                try {
                        args = JSON.parse(argsJson);
                } catch {
                        return { toolCallId, content: `Invalid JSON arguments: ${argsJson}`, isError: true };
                }

                const workspaceRoot = this._workspaceRoot;

                try {
                        switch (name) {
                                case 'read_file': {
                                        const filePath = String(args.path || '');
                                        if (!filePath) { return { toolCallId, content: 'Missing path argument', isError: true }; }

                                        // Security: validate path is within workspace
                                        if (workspaceRoot && !filePath.startsWith(workspaceRoot) && !filePath.startsWith('/tmp')) {
                                                return { toolCallId, content: `Access denied: path outside workspace root`, isError: true };
                                        }

                                        try {
                                                const uri = URI.file(filePath);
                                                const content = await this.instantiationService.invokeFunction(async (accessor) => {
                                                        const fileService = accessor.get(IFileService);
                                                        const stat = await fileService.readFile(uri);
                                                        return stat.value.toString();
                                                });
                                                return { toolCallId, content: content || '(empty file)' };
                                        } catch (err: any) {
                                                return { toolCallId, content: `Failed to read file: ${err?.message || String(err)}`, isError: true };
                                        }
                                }

                                case 'write_file': {
                                        const filePath = String(args.path || '');
                                        const content = String(args.content || '');
                                        if (!filePath) { return { toolCallId, content: 'Missing path argument', isError: true }; }

                                        // Security: validate path is within workspace
                                        if (workspaceRoot && !filePath.startsWith(workspaceRoot) && !filePath.startsWith('/tmp')) {
                                                return { toolCallId, content: `Access denied: path outside workspace root`, isError: true };
                                        }

                                        try {
                                                const uri = URI.file(filePath);
                                                await this.instantiationService.invokeFunction(async (accessor) => {
                                                        const fileService = accessor.get(IFileService);
                                                        // Create parent directories if needed
                                                        await fileService.createFolder(URI.file(dirname(filePath)));
                                                        await fileService.writeFile(uri, VSBuffer.fromString(content));
                                                });

                                                // Refresh file explorer
                                                try {
                                                        await this.instantiationService.invokeFunction(async (accessor) => {
                                                                const commandService = accessor.get(ICommandService);
                                                                commandService.executeCommand('workbench.files.action.refreshFilesExplorer');
                                                        });
                                                } catch {
                                                        // Non-critical — file was written successfully
                                                }

                                                return { toolCallId, content: `File written: ${filePath} (${content.length} bytes)` };
                                        } catch (err: any) {
                                                return { toolCallId, content: `Failed to write file: ${err?.message || String(err)}`, isError: true };
                                        }
                                }

                                case 'list_directory': {
                                        const dirPath = String(args.path || '');
                                        if (!dirPath) { return { toolCallId, content: 'Missing path argument', isError: true }; }

                                        try {
                                                const uri = URI.file(dirPath);
                                                const entries = await this.instantiationService.invokeFunction(async (accessor) => {
                                                        const fileService = accessor.get(IFileService);
                                                        const result = await fileService.resolve(uri);
                                                        return result.children?.map(child =>
                                                                `${child.isDirectory ? '📁' : '📄'} ${child.name}`
                                                        ).join('\n') || '(empty directory)';
                                                });
                                                return { toolCallId, content: entries };
                                        } catch (err: any) {
                                                return { toolCallId, content: `Failed to list directory: ${err?.message || String(err)}`, isError: true };
                                        }
                                }

                                case 'run_command': {
                                        const command = String(args.command || '');
                                        if (!command) { return { toolCallId, content: 'Missing command argument', isError: true }; }

                                        // Security: check against blocklist
                                        for (const pattern of COMMAND_BLOCKLIST) {
                                                if (pattern.test(command)) {
                                                        return { toolCallId, content: `Command blocked by security policy: ${command}`, isError: true };
                                                }
                                        }

                                        try {
                                                // Use the terminal execution bridge with CommandSpec interface
                                                const result = await this.terminalBridge.executeCommand({
                                                        command,
                                                        cwd: workspaceRoot || '.',
                                                        timeout: 60000,
                                                });
                                                const output = result.stdout || result.stderr || '(no output)';
                                                return {
                                                        toolCallId,
                                                        content: result.success
                                                                ? output
                                                                : `Exit code ${result.exitCode}\n${output}`,
                                                        isError: !result.success,
                                                };
                                        } catch (err: any) {
                                                return { toolCallId, content: `Command failed: ${err?.message || String(err)}`, isError: true };
                                        }
                                }

                                case 'create_directory': {
                                        const dirPath = String(args.path || '');
                                        if (!dirPath) { return { toolCallId, content: 'Missing path argument', isError: true }; }

                                        // Security: validate path is within workspace
                                        if (workspaceRoot && !dirPath.startsWith(workspaceRoot) && !dirPath.startsWith('/tmp')) {
                                                return { toolCallId, content: `Access denied: path outside workspace root`, isError: true };
                                        }

                                        try {
                                                const uri = URI.file(dirPath);
                                                await this.instantiationService.invokeFunction(async (accessor) => {
                                                        const fileService = accessor.get(IFileService);
                                                        await fileService.createFolder(uri);
                                                });
                                                return { toolCallId, content: `Directory created: ${dirPath}` };
                                        } catch (err: any) {
                                                return { toolCallId, content: `Failed to create directory: ${err?.message || String(err)}`, isError: true };
                                        }
                                }

                                default:
                                        return { toolCallId, content: `Unknown tool: ${name}`, isError: true };
                        }
                } catch (err: any) {
                        return { toolCallId, content: `Tool execution error: ${err?.message || String(err)}`, isError: true };
                }
        }

        /**
         * Trim conversation history to keep within token budget.
         * Keeps the system message (first) and most recent messages.
         */
        private trimConversationHistory(): void {
                if (this.conversationHistory.length > MAX_HISTORY_MESSAGES) {
                        const systemMsg = this.conversationHistory[0]; // Always keep system prompt
                        const recent = this.conversationHistory.slice(-(MAX_HISTORY_MESSAGES - 1));
                        this.conversationHistory = [systemMsg, ...recent];
                }
        }

        /**
         * Stop the currently running agent loop.
         */
        private stopAgent(): void {
                if (this._abortController) {
                        this._abortController.abort();
                }
                // Cancel any active LLM streams
                for (const streamId of this.llmStreaming.activeStreams) {
                        this.llmStreaming.cancelStream(streamId);
                }
                this.addSystemMessage('Stopping agent...');
        }

        protected override layoutBody(height: number, width: number): void {
                // Layout handled by flexbox
        }
}

// Import needed for file operations — these are resolved through DI at runtime
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { dirname } from '../../../../base/common/resources.js';
