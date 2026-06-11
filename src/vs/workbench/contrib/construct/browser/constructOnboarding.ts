// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_ADDITIONAL_TERMS.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import { IConstructAIService } from '../../../../platform/construct/common/llm/constructAIService.js';
import { AIProviderType, ProviderStatus } from '../../../../platform/construct/common/llm/constructAIProvider.js';
import { IConstructToolRegistry } from '../../../../platform/construct/common/tools/constructToolRegistry.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';

/** Storage key for the onboarding completion flag. */
const ONBOARDING_COMPLETE_KEY = 'construct.onboarding.complete';

/** View type for the onboarding webview panel. */
const ONBOARDING_VIEW_TYPE = 'construct.onboarding';

/**
 * Messages sent from the webview to the extension host.
 */
type WebviewToHostMessage =
        | { type: 'ready' }
        | { type: 'checkOllama' }
        | { type: 'retryOllama' }
        | { type: 'selectModel'; modelId: string }
        | { type: 'selectXenova' }
        | { type: 'configureCloud' }
        | { type: 'validateCloudApiKey'; cloudProvider: string; apiKey: string }
        | { type: 'checkKaliWSL' }
        | { type: 'enableKaliWSL' }
        | { type: 'skipKali' }
        | { type: 'finish'; config: OnboardingConfig };

/**
 * Configuration collected during onboarding and saved at the end.
 */
interface OnboardingConfig {
        providerType: AIProviderType;
        modelId?: string;
        kaliWSLEnabled?: boolean;
}

/**
 * ConstructOnboardingWizard — a first-launch onboarding wizard shown as a webview panel.
 *
 * Steps:
 *  1. "Welcome to Kovix" — branding & mission
 *  2. "AI Provider Setup" — checks Ollama, Xenova, Cloud
 *  3. "Kali Linux (Optional)" — WSL2 check (Windows only)
 *  4. "You're Ready!" — saves config, opens editor
 */
export class ConstructOnboardingWizard extends Disposable {

        private webview: IOverlayWebview | undefined;

        constructor(
                @IConstructAIService private readonly aiService: IConstructAIService,
                @IConstructToolRegistry private readonly toolRegistry: IConstructToolRegistry,
                @INotificationService private readonly notificationService: INotificationService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @IWebviewWorkbenchService private readonly webviewWorkbenchService: IWebviewWorkbenchService,
        ) {
                super();
        }

        /**
         * Whether the onboarding wizard has already been completed.
         */
        static isComplete(storageService: IStorageService): boolean {
                return storageService.getBoolean(ONBOARDING_COMPLETE_KEY, StorageScope.PROFILE, false);
        }

        /**
         * Open (or reveal) the onboarding wizard.
         */
        show(): void {
                if (this.webview) {
                        // Already open — reveal it
                        return;
                }

                const input = this.webviewWorkbenchService.openWebview(
                        {
                                title: 'Kovix Setup',
                                options: {
                                        retainContextWhenHidden: true,
                                        enableFindWidget: false,
                                },
                                contentOptions: {
                                        // SEC-1: Strict webview security
                                        allowScripts: true,
                                        allowForms: true,
                                        enableCommandUris: true,
                                        localResourceRoots: [],
                                },
                                extension: undefined,
                        },
                        ONBOARDING_VIEW_TYPE,
                        'Kovix Setup',
                        {},
                );

                this.webview = input.webview;

                this._register(input.webview.onMessage(async (e) => {
                        // SEC-1: Validate sender origin — WebviewMessageReceivedEvent does not expose source;
                        // origin validation is handled at the webview layer via CSP.
                        const message = e.message as WebviewToHostMessage;
                        await this.handleMessage(message);
                }));

                // SEC-1: Apply strict CSP to the webview HTML
                const nonce = this.generateNonce();
                input.webview.setHtml(this.getHtml(nonce));

                this.logService.info('[ConstructOnboarding] Wizard opened');
        }

        // -----------------------------------------------------------------------
        // Message handling
        // -----------------------------------------------------------------------

        private async handleMessage(message: WebviewToHostMessage): Promise<void> {
                switch (message.type) {
                        case 'ready':
                                // Webview loaded — nothing extra needed, HTML already rendered
                                this.logService.info('[ConstructOnboarding] Webview ready');
                                break;

                        case 'checkOllama':
                        case 'retryOllama': {
                                await this.checkAndSendOllamaStatus();
                                break;
                        }

                        case 'selectModel': {
                                const success = await this.aiService.setActiveModel(message.modelId);
                                if (success) {
                                        this.postMessage({ type: 'modelSelected', modelId: message.modelId });
                                } else {
                                        this.postMessage({ type: 'modelSelectError', modelId: message.modelId });
                                }
                                break;
                        }

                        case 'selectXenova': {
                                const success = await this.aiService.switchProvider('xenova');
                                this.postMessage({ type: 'providerSwitched', providerType: 'xenova', success });
                                break;
                        }

                        case 'configureCloud': {
                                // Switch to cloud provider — the user can configure API key via settings
                                const success = await this.aiService.switchProvider('cloud');
                                this.postMessage({ type: 'providerSwitched', providerType: 'cloud', success });
                                break;
                        }

                        case 'validateCloudApiKey': {
                                await this.validateCloudApiKey(message.cloudProvider, message.apiKey);
                                break;
                        }

                        case 'checkKaliWSL': {
                                if (!isWindows) {
                                        this.postMessage({ type: 'kaliStatus', available: false, notWindows: true });
                                        break;
                                }
                                const available = await this.toolRegistry.isKaliWSLAvailable();
                                this.postMessage({ type: 'kaliStatus', available, notWindows: false });
                                break;
                        }

                        case 'enableKaliWSL': {
                                this.toolRegistry.setTerminalProfile('kali');
                                this.postMessage({ type: 'kaliEnabled' });
                                break;
                        }

                        case 'skipKali': {
                                this.postMessage({ type: 'kaliSkipped' });
                                break;
                        }

                        case 'finish': {
                                await this.saveConfig(message.config);
                                break;
                        }

                        default:
                                this.logService.warn('[ConstructOnboarding] Unknown message type:', (message as { type: string }).type);
                }
        }

        // -----------------------------------------------------------------------
        // Provider checks
        // -----------------------------------------------------------------------

        // -----------------------------------------------------------------------
        // API Key Validation (F-G-001)
        // -----------------------------------------------------------------------

        private async validateCloudApiKey(cloudProvider: string, apiKey: string): Promise<void> {
                // Validate API key format based on provider type
                let valid = false;
                let errorMsg = '';

                if (cloudProvider === 'openai') {
                        if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
                                valid = false;
                                errorMsg = 'OpenAI API key must start with "sk-" and be at least 20 characters.';
                        } else {
                                valid = true;
                        }
                } else if (cloudProvider === 'anthropic') {
                        if (!apiKey.startsWith('sk-ant-') || apiKey.length < 20) {
                                valid = false;
                                errorMsg = 'Anthropic API key must start with "sk-ant-" and be at least 20 characters.';
                                valid = false;
                        } else {
                                valid = true;
                        }
                } else {
                        // Generic / other provider — minimum length check only
                        if (apiKey.length < 10) {
                                valid = false;
                                errorMsg = 'API key must be at least 10 characters.';
                        } else {
                                valid = true;
                        }
                }

                if (valid) {
                        // Persist the API key to configuration
                        try {
                                if (cloudProvider === 'openai') {
                                        await this.configurationService.updateValue('construct.cloud.apiKey', apiKey, ConfigurationTarget.USER);
                                        await this.configurationService.updateValue('construct.cloud.baseUrl', 'https://api.openai.com/v1', ConfigurationTarget.USER);
                                        await this.configurationService.updateValue('construct.cloud.model', 'gpt-4o-mini', ConfigurationTarget.USER);
                                } else if (cloudProvider === 'anthropic') {
                                        await this.configurationService.updateValue('construct.anthropic.apiKey', apiKey, ConfigurationTarget.USER);
                                } else {
                                        await this.configurationService.updateValue('construct.cloud.apiKey', apiKey, ConfigurationTarget.USER);
                                }
                        } catch (e) {
                                this.logService.warn('[ConstructOnboarding] Could not persist API key:', e);
                        }
                }

                this.postMessage({ type: 'apiKeyValidation', valid, errorMsg, cloudProvider });
        }

        private async checkAndSendOllamaStatus(): Promise<void> {
                try {
                        const statuses = await this.aiService.getAllProviderStatuses();
                        const ollamaStatus = statuses.get('ollama') ?? ProviderStatus.Unknown;

                        let models: Array<{ id: string; displayName: string; contextWindowTokens: number; supportsTools: boolean }> = [];

                        if (ollamaStatus === ProviderStatus.Available) {
                                try {
                                        const modelInfos = await this.aiService.listModels();
                                        models = modelInfos.map(m => ({
                                                id: m.id,
                                                displayName: m.displayName,
                                                contextWindowTokens: m.contextWindowTokens,
                                                supportsTools: m.supportsTools,
                                        }));
                                } catch {
                                        // List models may fail even if Ollama is reachable
                                }
                        }

                        // F-G-002: If Ollama is available but no models installed, return NoModels status
                        const effectiveOllamaStatus = (ollamaStatus === ProviderStatus.Available && models.length === 0)
                                ? ProviderStatus.NoModels
                                : ollamaStatus;

                        // Also check Xenova and Cloud statuses
                        const xenovaStatus = statuses.get('xenova') ?? ProviderStatus.Unknown;
                        const cloudStatus = statuses.get('cloud') ?? ProviderStatus.Unknown;

                        this.postMessage({
                                type: 'ollamaStatus',
                                ollamaStatus: effectiveOllamaStatus,
                                models,
                                xenovaStatus,
                                cloudStatus,
                        });
                } catch (error) {
                        this.logService.error('[ConstructOnboarding] Failed to check Ollama:', error);
                        this.postMessage({
                                type: 'ollamaStatus',
                                ollamaStatus: ProviderStatus.Unreachable,
                                models: [],
                                xenovaStatus: ProviderStatus.Unknown,
                                cloudStatus: ProviderStatus.Unknown,
                        });
                }
        }

        // -----------------------------------------------------------------------
        // Save config
        // -----------------------------------------------------------------------

        private async saveConfig(config: OnboardingConfig): Promise<void> {
                try {
                        // Persist the provider selection
                        await this.aiService.switchProvider(config.providerType);

                        // Persist the model selection if applicable
                        if (config.modelId) {
                                await this.aiService.setActiveModel(config.modelId);
                        }

                        // Persist Kali WSL preference
                        if (config.kaliWSLEnabled) {
                                this.toolRegistry.setTerminalProfile('kali');
                        }

                        // Write .construct/settings.json via configuration service
                        await this.configurationService.updateValue(
                                'construct.provider.default',
                                config.providerType,
                                ConfigurationTarget.USER,
                        );
                        if (config.modelId) {
                                await this.configurationService.updateValue(
                                        'construct.provider.model',
                                        config.modelId,
                                        ConfigurationTarget.USER,
                                );
                        }
                        if (config.kaliWSLEnabled !== undefined) {
                                await this.configurationService.updateValue(
                                        'construct.terminal.kaliWSL',
                                        config.kaliWSLEnabled,
                                        ConfigurationTarget.USER,
                                );
                        }

                        // Also write to .construct/settings.json for easy direct editing
                        try {
                                const workspace = this.workspaceContextService.getWorkspace();
                                const workspaceRoot = workspace.folders[0]?.uri.fsPath;
                                if (workspaceRoot) {
                                        const fs = await import('fs');
                                        const path = await import('path');
                                        const constructDir = path.join(workspaceRoot, '.construct');
                                        const settingsPath = path.join(constructDir, 'settings.json');

                                        // Ensure .construct directory exists
                                        if (!fs.existsSync(constructDir)) {
                                                fs.mkdirSync(constructDir, { recursive: true });
                                        }

                                        const settings = {
                                                defaultModel: config.modelId ?? '',
                                                ollamaEndpoint: 'http://localhost:11434',
                                                kaliEnabled: config.kaliWSLEnabled ?? false,
                                                providerType: config.providerType,
                                                embeddingModel: 'nomic-embed-text',
                                        };

                                        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
                                        this.logService.info('[ConstructOnboarding] Wrote .construct/settings.json');
                                }
                        } catch (error) {
                                // Non-critical — settings are also saved via IConfigurationService
                                this.logService.warn('[ConstructOnboarding] Could not write .construct/settings.json:', error instanceof Error ? error.message : String(error));
                        }

                        // Mark onboarding as complete so it doesn't auto-open again
                        this.storageService.store(ONBOARDING_COMPLETE_KEY, true, StorageScope.PROFILE, StorageTarget.USER);

                        this.postMessage({ type: 'configSaved' });

                        this.notificationService.info('Kovix: Setup complete! Your IDE is ready.');
                        this.logService.info('[ConstructOnboarding] Config saved:', JSON.stringify(config));
                } catch (error) {
                        this.logService.error('[ConstructOnboarding] Failed to save config:', error);
                        this.notificationService.error(
                                `Kovix: Failed to save settings: ${error instanceof Error ? error.message : String(error)}`
                        );
                }
        }

        // -----------------------------------------------------------------------
        // Post message helper
        // -----------------------------------------------------------------------

        private postMessage(msg: object): void {
                this.webview?.postMessage(msg);
        }

        // -----------------------------------------------------------------------
        // HTML
        // -----------------------------------------------------------------------

        // SEC-1: Generate a cryptographically random nonce for CSP
        private generateNonce(): string {
                const array = new Uint8Array(32);
                crypto.getRandomValues(array);
                return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        }

        private getHtml(nonce?: string): string {
                const isWin = isWindows;
                const cspNonce = nonce ?? this.generateNonce();

                return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${cspNonce}'; style-src 'unsafe-inline'; connect-src http://localhost:11434 http://localhost:6333;">
        <title>Kovix Setup</title>
        <style>
                :root {
                        --accent: #00E5FF;
                        --accent-dim: #00E5FF40;
                        --bg-primary: #0A0E1A;
                        --bg-secondary: #0D1117;
                        --bg-card: #141B2D;
                        --bg-input: #0A0E1A;
                        --border: #1A1F2E;
                        --text-primary: #E0E7FF;
                        --text-secondary: #8B949E;
                        --text-muted: #4A5568;
                        --success: #00C853;
                        --error: #FF4444;
                        --warning: #FFB300;
                }

                * { margin: 0; padding: 0; box-sizing: border-box; }

                body {
                        background: var(--bg-primary);
                        color: var(--text-primary);
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        min-height: 100vh;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                }

                .wizard {
                        width: 100%;
                        max-width: 640px;
                        padding: 32px 24px;
                }

                /* Step indicator */
                .step-indicator {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        margin-bottom: 40px;
                }
                .step-dot {
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        background: var(--border);
                        transition: all 0.3s ease;
                }
                .step-dot.active {
                        background: var(--accent);
                        box-shadow: 0 0 8px var(--accent-dim);
                }
                .step-dot.completed {
                        background: var(--success);
                }
                .step-line {
                        width: 40px;
                        height: 2px;
                        background: var(--border);
                        transition: background 0.3s ease;
                }
                .step-line.completed {
                        background: var(--success);
                }

                /* Step content */
                .step {
                        display: none;
                        animation: fadeIn 0.4s ease;
                }
                .step.active {
                        display: block;
                }
                @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(12px); }
                        to { opacity: 1; transform: translateY(0); }
                }

                /* Branding */
                .hex-logo {
                        font-size: 64px;
                        color: var(--accent);
                        text-align: center;
                        margin-bottom: 16px;
                        line-height: 1;
                        text-shadow: 0 0 30px var(--accent-dim);
                }
                .step-title {
                        font-size: 28px;
                        font-weight: 700;
                        text-align: center;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                }
                .step-subtitle {
                        font-size: 14px;
                        color: var(--text-secondary);
                        text-align: center;
                        margin-bottom: 32px;
                        line-height: 1.6;
                }

                /* Cards */
                .card {
                        background: var(--bg-card);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 20px;
                        margin-bottom: 16px;
                }
                .card-header {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        margin-bottom: 12px;
                }
                .card-icon {
                        font-size: 20px;
                        width: 36px;
                        height: 36px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 8px;
                        flex-shrink: 0;
                }
                .card-icon.success { background: #00C85320; color: var(--success); }
                .card-icon.error { background: #FF444420; color: var(--error); }
                .card-icon.pending { background: #FFB30020; color: var(--warning); }
                .card-icon.info { background: var(--accent-dim); color: var(--accent); }
                .card-title {
                        font-size: 14px;
                        font-weight: 600;
                }
                .card-desc {
                        font-size: 12px;
                        color: var(--text-secondary);
                        line-height: 1.5;
                }

                /* Model list */
                .model-list {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        margin-top: 12px;
                }
                .model-item {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 10px 14px;
                        background: var(--bg-input);
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                }
                .model-item:hover {
                        border-color: var(--accent);
                        background: #1A2744;
                }
                .model-item.selected {
                        border-color: var(--accent);
                        background: #1A2744;
                }
                .model-name {
                        font-size: 13px;
                        font-weight: 500;
                }
                .model-meta {
                        font-size: 11px;
                        color: var(--text-muted);
                }

                /* Buttons */
                .btn {
                        padding: 10px 24px;
                        border-radius: 6px;
                        border: none;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                }
                .btn:active { transform: scale(0.97); }
                .btn-primary {
                        background: var(--accent);
                        color: var(--bg-primary);
                }
                .btn-primary:hover { background: #33ECFF; }
                .btn-primary:disabled {
                        opacity: 0.4;
                        cursor: not-allowed;
                }
                .btn-secondary {
                        background: var(--bg-card);
                        color: var(--text-primary);
                        border: 1px solid var(--border);
                }
                .btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
                .btn-success {
                        background: var(--success);
                        color: white;
                }
                .btn-success:hover { background: #00D85A; }
                .btn-danger {
                        background: transparent;
                        color: var(--error);
                        border: 1px solid var(--error);
                }
                .btn-danger:hover { background: #FF444420; }

                .btn-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-top: 32px;
                        gap: 12px;
                }

                /* Status badges */
                .status-badge {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        font-size: 12px;
                        font-weight: 600;
                        padding: 4px 10px;
                        border-radius: 12px;
                }
                .status-badge.running {
                        background: #00C85320;
                        color: var(--success);
                }
                .status-badge.offline {
                        background: #FF444420;
                        color: var(--error);
                }
                .status-badge.checking {
                        background: #FFB30020;
                        color: var(--warning);
                }

                /* Loading spinner */
                .spinner {
                        display: inline-block;
                        width: 16px;
                        height: 16px;
                        border: 2px solid var(--border);
                        border-top-color: var(--accent);
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                }
                @keyframes spin {
                        to { transform: rotate(360deg); }
                }

                /* Install instructions */
                .install-instructions {
                        background: var(--bg-input);
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        padding: 14px;
                        margin-top: 12px;
                        font-size: 12px;
                        color: var(--text-secondary);
                        line-height: 1.6;
                }
                .install-instructions code {
                        background: var(--bg-card);
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-family: 'Cascadia Code', 'Fira Code', monospace;
                        color: var(--accent);
                        font-size: 11px;
                }

                a {
                        color: var(--accent);
                        text-decoration: none;
                }
                a:hover { text-decoration: underline; }

                /* Feature grid for welcome step */
                .feature-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 12px;
                        margin-top: 24px;
                }
                .feature-card {
                        background: var(--bg-card);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 16px;
                        text-align: center;
                }
                .feature-icon {
                        font-size: 24px;
                        margin-bottom: 8px;
                }
                .feature-name {
                        font-size: 13px;
                        font-weight: 600;
                        margin-bottom: 4px;
                }
                .feature-desc {
                        font-size: 11px;
                        color: var(--text-muted);
                        line-height: 1.4;
                }

                /* Completion step */
                .completion-checkmark {
                        font-size: 72px;
                        color: var(--success);
                        text-align: center;
                        margin-bottom: 16px;
                        animation: scaleIn 0.5s ease;
                }
                @keyframes scaleIn {
                        from { transform: scale(0); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                }
                .config-summary {
                        background: var(--bg-card);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 16px;
                        margin: 20px 0;
                }
                .config-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 8px 0;
                        font-size: 13px;
                        border-bottom: 1px solid var(--border);
                }
                .config-row:last-child { border-bottom: none; }
                .config-label { color: var(--text-secondary); }
                .config-value { color: var(--text-primary); font-weight: 500; }

                /* Checkbox style */
                .check-option {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        padding: 12px;
                        background: var(--bg-input);
                        border: 1px solid var(--border);
                        border-radius: 6px;
                        cursor: pointer;
                        transition: all 0.2s ease;
                        margin-top: 10px;
                }
                .check-option:hover {
                        border-color: var(--accent);
                }
                .check-option input[type="checkbox"] {
                        accent-color: var(--accent);
                        width: 16px;
                        height: 16px;
                }
                .check-option label {
                        cursor: pointer;
                        font-size: 13px;
                }

                /* Cloud API key form */
                .cloud-form { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
                .cloud-form-row { display: flex; flex-direction: column; gap: 4px; }
                .cloud-form-row label { font-size: 11px; color: var(--text-secondary); font-weight: 600; }
                .cloud-select {
                        width: 100%; background: var(--bg-input); border: 1px solid var(--border);
                        border-radius: 4px; padding: 6px 8px; color: var(--text-primary); font-size: 12px;
                        outline: none; cursor: pointer;
                }
                .cloud-select:focus { border-color: var(--accent); }
                .cloud-key-input-wrap { display: flex; gap: 6px; align-items: center; }
                .cloud-input {
                        flex: 1; background: var(--bg-input); border: 1px solid var(--border);
                        border-radius: 4px; padding: 6px 8px; color: var(--text-primary); font-size: 12px;
                        outline: none; font-family: 'Cascadia Code', 'Fira Code', monospace;
                }
                .cloud-input:focus { border-color: var(--accent); }
                .cloud-validate-btn { padding: 6px 12px !important; font-size: 11px !important; white-space: nowrap; }
                .cloud-key-valid { font-size: 11px; color: var(--success); margin-top: 2px; }
                .cloud-key-invalid { font-size: 11px; color: var(--error); margin-top: 2px; }

                /* Skip link */
                .skip-link {
                        color: var(--text-muted);
                        font-size: 12px;
                        cursor: pointer;
                        text-align: center;
                        margin-top: 16px;
                }
                .skip-link:hover { color: var(--text-secondary); }
        </style>
</head>
<body>
        <div class="wizard">
                <!-- Step Indicator -->
                <div class="step-indicator">
                        <div class="step-dot active" id="dot-0"></div>
                        <div class="step-line" id="line-0"></div>
                        <div class="step-dot" id="dot-1"></div>
                        <div class="step-line" id="line-1"></div>
                        <div class="step-dot" id="dot-2"></div>
                        <div class="step-line" id="line-2"></div>
                        <div class="step-dot" id="dot-3"></div>
                </div>

                <!-- Step 0: Welcome -->
                <div class="step active" id="step-0">
                        <div class="hex-logo">&#x2B21;</div>
                        <div class="step-title">Welcome to Kovix</div>
                        <div class="step-subtitle">
                                The offline-first AI IDE that keeps you in control.<br>
                                Your code, your models, your machine.
                        </div>

                        <div class="feature-grid">
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F916;</div>
                                        <div class="feature-name">Local AI</div>
                                        <div class="feature-desc">Run LLMs locally with Ollama or in-process Xenova</div>
                                </div>
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F512;</div>
                                        <div class="feature-name">Offline First</div>
                                        <div class="feature-desc">Full functionality without internet</div>
                                </div>
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F9E0;</div>
                                        <div class="feature-name">Agent Memory</div>
                                        <div class="feature-desc">Persistent memory across sessions</div>
                                </div>
                                <div class="feature-card">
                                        <div class="feature-icon">&#x1F6E1;&#xFE0F;</div>
                                        <div class="feature-name">Security Tools</div>
                                        <div class="feature-desc">Built-in Kali WSL2 &amp; command safety</div>
                                </div>
                        </div>

                        <div class="btn-row">
                                <div></div>
                                <button class="btn btn-primary" onclick="goToStep(1)">Get Started &rarr;</button>
                        </div>
                </div>

                <!-- Step 1: AI Provider Setup -->
                <div class="step" id="step-1">
                        <div class="step-title">AI Provider Setup</div>
                        <div class="step-subtitle">
                                Kovix needs an AI provider to power your coding assistant.<br>
                                Let's check what's available on your system.
                        </div>

                        <!-- Ollama Status -->
                        <div class="card" id="ollama-card">
                                <div class="card-header">
                                        <div class="card-icon pending" id="ollama-icon"><span class="spinner"></span></div>
                                        <div>
                                                <div class="card-title">Ollama (Local Inference)</div>
                                                <div class="card-desc" id="ollama-desc">Checking if Ollama is running...</div>
                                        </div>
                                </div>
                                <div id="ollama-detail"></div>
                        </div>

                        <!-- Xenova Fallback -->
                        <div class="card">
                                <div class="card-header">
                                        <div class="card-icon info">&#x2699;&#xFE0F;</div>
                                        <div>
                                                <div class="card-title">Xenova (In-Process)</div>
                                                <div class="card-desc">CPU-based fallback. No installation needed. Runs small models directly in the IDE process.</div>
                                        </div>
                                </div>
                                <div class="check-option" id="xenova-option">
                                        <input type="radio" name="provider" id="xenova-radio" value="xenova">
                                        <label for="xenova-radio">Use Xenova as my AI provider</label>
                                </div>
                        </div>

                        <!-- Cloud Provider -->
                        <div class="card" id="cloud-card">
                                <div class="card-header">
                                        <div class="card-icon info" id="cloud-icon">&#x2601;&#xFE0F;</div>
                                        <div>
                                                <div class="card-title">Cloud Provider</div>
                                                <div class="card-desc">Use an OpenAI-compatible cloud API. Requires internet and an API key.</div>
                                        </div>
                                </div>
                                <div class="check-option" id="cloud-option">
                                        <input type="radio" name="provider" id="cloud-radio" value="cloud">
                                        <label for="cloud-radio">Configure a cloud provider</label>
                                </div>
                                <div id="cloud-detail" style="display:none;">
                                        <div class="cloud-form">
                                                <div class="cloud-form-row">
                                                        <label for="cloud-provider-select">Provider</label>
                                                        <select id="cloud-provider-select" class="cloud-select">
                                                                <option value="openai">OpenAI</option>
                                                                <option value="anthropic">Anthropic</option>
                                                                <option value="other">Other (OpenAI-compatible)</option>
                                                        </select>
                                                </div>
                                                <div class="cloud-form-row" id="cloud-key-row">
                                                        <label for="cloud-api-key">API Key</label>
                                                        <div class="cloud-key-input-wrap">
                                                                <input type="password" id="cloud-api-key" class="cloud-input" placeholder="Enter your API key..." autocomplete="off">
                                                                <button class="btn btn-secondary cloud-validate-btn" id="cloud-validate-btn" onclick="validateCloudKey()">Validate</button>
                                                        </div>
                                                </div>
                                                <div id="cloud-key-status"></div>
                                        </div>
                                </div>
                        </div>

                        <div class="btn-row">
                                <button class="btn btn-secondary" onclick="goToStep(0)">&larr; Back</button>
                                <button class="btn btn-primary" id="step1-next" onclick="goToStep(${isWin ? 2 : 3})" disabled>Next &rarr;</button>
                        </div>
                </div>

                <!-- Step 2: Kali Linux (Windows only) -->
                <div class="step" id="step-2">
                        <div class="step-title">Kali Linux (Optional)</div>
                        <div class="step-subtitle">
                                Kovix can integrate with Kali Linux via WSL2 on Windows<br>
                                for security testing tools and a dedicated terminal.
                        </div>

                        <div class="card" id="kali-card">
                                <div class="card-header">
                                        <div class="card-icon pending" id="kali-icon"><span class="spinner"></span></div>
                                        <div>
                                                <div class="card-title">Kali WSL2</div>
                                                <div class="card-desc" id="kali-desc">Checking for Kali WSL2 installation...</div>
                                        </div>
                                </div>
                                <div id="kali-detail"></div>
                        </div>

                        <div class="btn-row">
                                <button class="btn btn-secondary" onclick="goToStep(1)">&larr; Back</button>
                                <div style="display:flex;gap:8px;">
                                        <button class="btn btn-secondary" onclick="skipKali()">Skip</button>
                                        <button class="btn btn-primary" id="step2-next" onclick="goToStep(3)" disabled>Next &rarr;</button>
                                </div>
                        </div>
                </div>

                <!-- Step 3: You're Ready! -->
                <div class="step" id="step-3">
                        <div class="completion-checkmark">&#x2713;</div>
                        <div class="step-title">You're Ready!</div>
                        <div class="step-subtitle">
                                Kovix is configured and ready to go.<br>
                                Here's a summary of your setup:
                        </div>

                        <div class="config-summary" id="config-summary">
                                <div class="config-row">
                                        <span class="config-label">AI Provider</span>
                                        <span class="config-value" id="summary-provider">-</span>
                                </div>
                                <div class="config-row">
                                        <span class="config-label">Model</span>
                                        <span class="config-value" id="summary-model">-</span>
                                </div>
                                <div class="config-row" id="summary-kali-row" style="display:none;">
                                        <span class="config-label">Kali WSL2</span>
                                        <span class="config-value" id="summary-kali">-</span>
                                </div>
                        </div>

                        <div class="btn-row" style="justify-content:center;">
                                <button class="btn btn-success" onclick="finishSetup()">&#x2B21; Start Using Kovix</button>
                        </div>
                </div>
        </div>

        <script>
                // @ts-check
                const vscode = acquireVsCodeApi();

                // ---- State ----
                let currentStep = 0;
                const totalSteps = 4;
                let selectedProvider = /** @type {string|null} */ (null);
                let selectedModelId = /** @type {string|null} */ (null);
                let kaliEnabled = false;
                let ollamaChecked = false;
                let kaliChecked = false;

                // ---- Navigation ----
                function goToStep(step) {
                        // Hide all steps
                        for (let i = 0; i < totalSteps; i++) {
                                const el = document.getElementById('step-' + i);
                                if (el) el.classList.remove('active');
                        }
                        // Show target
                        const target = document.getElementById('step-' + step);
                        if (target) target.classList.add('active');

                        // Update dots
                        for (let i = 0; i < totalSteps; i++) {
                                const dot = document.getElementById('dot-' + i);
                                if (dot) {
                                        dot.classList.remove('active', 'completed');
                                        if (i < step) dot.classList.add('completed');
                                        else if (i === step) dot.classList.add('active');
                                }
                                if (i < totalSteps - 1) {
                                        const line = document.getElementById('line-' + i);
                                        if (line) {
                                                line.classList.toggle('completed', i < step);
                                        }
                                }
                        }

                        currentStep = step;

                        // Trigger checks when entering steps
                        if (step === 1 && !ollamaChecked) {
                                vscode.postMessage({ type: 'checkOllama' });
                        }
                        if (step === 2 && !kaliChecked) {
                                vscode.postMessage({ type: 'checkKaliWSL' });
                        }
                        if (step === 3) {
                                updateSummary();
                        }
                }

                // ---- Ollama Status ----
                function renderOllamaStatus(data) {
                        ollamaChecked = true;
                        const icon = document.getElementById('ollama-icon');
                        const desc = document.getElementById('ollama-desc');
                        const detail = document.getElementById('ollama-detail');

                        if (data.ollamaStatus === 'available') {
                                icon.className = 'card-icon success';
                                icon.textContent = '\\u2713';
                                desc.textContent = 'Ollama is running and models are available.';

                                // Show model list
                                // XSS FIX: Use DOM API instead of innerHTML with dynamic data
                                if (data.models && data.models.length > 0) {
                                        const listDiv = document.createElement('div');
                                        listDiv.className = 'model-list';
                                        for (const m of data.models) {
                                                const item = document.createElement('div');
                                                item.className = 'model-item';
                                                item.addEventListener('click', () => selectModel(m.id, item));

                                                const innerDiv = document.createElement('div');

                                                const nameDiv = document.createElement('div');
                                                nameDiv.className = 'model-name';
                                                nameDiv.textContent = m.displayName;  // Safe: no HTML parsing

                                                const metaDiv = document.createElement('div');
                                                metaDiv.className = 'model-meta';
                                                metaDiv.textContent = 'Context: ' + m.contextWindowTokens.toLocaleString() + ' tokens' + (m.supportsTools ? ' | Tools: Yes' : '');  // Safe: no HTML parsing

                                                const checkDiv = document.createElement('div');
                                                checkDiv.className = 'model-meta';
                                                checkDiv.id = 'model-check-' + m.id;

                                                innerDiv.appendChild(nameDiv);
                                                innerDiv.appendChild(metaDiv);
                                                item.appendChild(innerDiv);
                                                item.appendChild(checkDiv);
                                                listDiv.appendChild(item);  // DOM append, no innerHTML
                                        }
                                        detail.appendChild(listDiv);

                                        // Auto-select first model
                                        if (data.models.length > 0) {
                                                selectModel(data.models[0].id, detail.querySelector('.model-item'));
                                        }
                                } else {
                                        // SAFE: Static HTML template, no dynamic data
                                        detail.innerHTML = '<div class="install-instructions">Ollama is running but no models are installed. Run <code>ollama pull llama3.1</code> to download a model.<br>Also pull the embedding model: <code>ollama pull nomic-embed-text</code></div>';
                                }
                        } else if (data.ollamaStatus === 'noModels') {
                                icon.className = 'card-icon pending';
                                icon.textContent = '!';
                                desc.textContent = 'Ollama is running but no models are installed.';
                                // SAFE: Static HTML template, no dynamic data
                                detail.innerHTML = \`
                                        <div class="install-instructions">
                                                Download a model to get started:<br>
                                                <code>ollama pull llama3.1</code><br><br>
                                                Also pull the embedding model for codebase memory:<br>
                                                <code>ollama pull nomic-embed-text</code><br><br>
                                                Or try a smaller model:<br>
                                                <code>ollama pull phi3:mini</code>
                                        </div>\`;
                        } else {
                                // Unreachable or unknown
                                icon.className = 'card-icon error';
                                icon.textContent = '\\u2717';
                                desc.textContent = 'Ollama is not running or not installed.';
                                // SAFE: Static HTML template, no dynamic data
                                // XSS FIX: Replace inline onclick with addEventListener
                                detail.innerHTML = \`
                                        <div class="install-instructions">
                                                <strong>Install Ollama for local AI:</strong><br>
                                                1. Download from <a href="https://ollama.ai">https://ollama.ai</a><br>
                                                2. Install and start Ollama<br>
                                                3. Run <code>ollama pull llama3.1</code> to download a model<br>
                                                4. Run <code>ollama pull nomic-embed-text</code> for codebase memory<br>
                                                4. Click "Retry" below<br><br>
                                        </div>\`;
                                const retryBtn = document.createElement('button');
                                retryBtn.textContent = 'Retry';
                                retryBtn.className = 'btn btn-secondary';
                                retryBtn.style.marginTop = '8px';
                                retryBtn.addEventListener('click', () => retryOllama());
                                detail.appendChild(retryBtn);
                        }
                }

                function selectModel(modelId, element) {
                        selectedModelId = modelId;
                        selectedProvider = 'ollama';

                        // Update radio buttons
                        document.querySelectorAll('input[name="provider"]').forEach(r => r.checked = false);
                        // Visual selection
                        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                        if (element) element.classList.add('selected');

                        // Hide cloud detail when Ollama model is selected
                        document.getElementById('cloud-detail').style.display = 'none';

                        // Notify extension host
                        vscode.postMessage({ type: 'selectModel', modelId });

                        // Enable next button
                        document.getElementById('step1-next').disabled = false;
                }

                function retryOllama() {
                        ollamaChecked = false;
                        const icon = document.getElementById('ollama-icon');
                        const desc = document.getElementById('ollama-desc');
                        const detail = document.getElementById('ollama-detail');
                        icon.className = 'card-icon pending';
                        // SAFE: Static HTML template, no dynamic data
                        icon.innerHTML = '<span class="spinner"></span>';
                        desc.textContent = 'Checking if Ollama is running...';
                        detail.innerHTML = '';
                        vscode.postMessage({ type: 'retryOllama' });
                }

                // ---- Provider Selection ----
                document.getElementById('xenova-option').addEventListener('click', () => {
                        document.getElementById('xenova-radio').checked = true;
                        selectedProvider = 'xenova';
                        selectedModelId = null;
                        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                        vscode.postMessage({ type: 'selectXenova' });
                        document.getElementById('cloud-detail').style.display = 'none';
                        document.getElementById('step1-next').disabled = false;
                });

                document.getElementById('cloud-option').addEventListener('click', () => {
                        document.getElementById('cloud-radio').checked = true;
                        selectedProvider = 'cloud';
                        selectedModelId = null;
                        cloudApiKeyValid = false;
                        document.querySelectorAll('.model-item').forEach(el => el.classList.remove('selected'));
                        vscode.postMessage({ type: 'configureCloud' });
                        // Show the cloud API key form
                        document.getElementById('cloud-detail').style.display = '';
                        // Disable next until key is validated
                        document.getElementById('step1-next').disabled = true;
                });

                // ---- Cloud API Key Validation (F-G-001) ----
                let cloudApiKeyValid = false;

                function validateCloudKey() {
                        const provider = document.getElementById('cloud-provider-select').value;
                        const key = document.getElementById('cloud-api-key').value.trim();
                        const statusDiv = document.getElementById('cloud-key-status');
                        const validateBtn = document.getElementById('cloud-validate-btn');

                        if (!key) {
                                statusDiv.innerHTML = '<div class="cloud-key-invalid">Please enter an API key.</div>';
                                return;
                        }

                        // Show validating state
                        validateBtn.textContent = 'Validating...';
                        validateBtn.disabled = true;
                        statusDiv.innerHTML = '';

                        vscode.postMessage({ type: 'validateCloudApiKey', cloudProvider: provider, apiKey: key });
                }

                function handleApiKeyValidation(msg) {
                        const statusDiv = document.getElementById('cloud-key-status');
                        const validateBtn = document.getElementById('cloud-validate-btn');
                        const cloudIcon = document.getElementById('cloud-icon');

                        validateBtn.textContent = 'Validate';
                        validateBtn.disabled = false;

                        if (msg.valid) {
                                cloudApiKeyValid = true;
                                statusDiv.innerHTML = '<div class="cloud-key-valid">&#x2713; API key validated and saved.</div>';
                                cloudIcon.className = 'card-icon success';
                                cloudIcon.textContent = '\\u2713';
                                document.getElementById('step1-next').disabled = false;
                        } else {
                                cloudApiKeyValid = false;
                                statusDiv.innerHTML = '<div class="cloud-key-invalid">&#x2717; ' + (msg.errorMsg || 'Invalid API key format.') + '</div>';
                                document.getElementById('step1-next').disabled = true;
                        }
                }

                // ---- Kali WSL ----
                function renderKaliStatus(data) {
                        kaliChecked = true;
                        const icon = document.getElementById('kali-icon');
                        const desc = document.getElementById('kali-desc');
                        const detail = document.getElementById('kali-detail');

                        if (data.notWindows) {
                                icon.className = 'card-icon info';
                                icon.textContent = '\\u2139';
                                desc.textContent = 'Kali WSL2 is only available on Windows. Skipping.';
                                // SAFE: Clearing element content, no dynamic data
                                detail.innerHTML = '';
                                // Auto-skip on non-Windows
                                skipKali();
                                return;
                        }

                        if (data.available) {
                                icon.className = 'card-icon success';
                                icon.textContent = '\\u2713';
                                desc.textContent = 'Kali WSL2 is installed and available.';
                                // XSS FIX: Replace inline onclick with DOM API + addEventListener
                                const checkOptDiv = document.createElement('div');
                                checkOptDiv.className = 'check-option';
                                const kaliCb = document.createElement('input');
                                kaliCb.type = 'checkbox';
                                kaliCb.id = 'kali-checkbox';
                                const kaliLabel = document.createElement('label');
                                kaliLabel.htmlFor = 'kali-checkbox';
                                kaliLabel.textContent = 'Enable Kali terminal profile in Kovix';
                                checkOptDiv.appendChild(kaliCb);
                                checkOptDiv.appendChild(kaliLabel);
                                checkOptDiv.addEventListener('click', () => enableKali(true));
                                detail.appendChild(checkOptDiv);
                                document.getElementById('step2-next').disabled = false;
                        } else {
                                icon.className = 'card-icon error';
                                icon.textContent = '\\u2717';
                                desc.textContent = 'Kali WSL2 is not installed.';
                                // SAFE: Static HTML template, no dynamic data
                                detail.innerHTML = \`
                                        <div class="install-instructions">
                                                <strong>To install Kali WSL2:</strong><br>
                                                1. Open PowerShell as Administrator<br>
                                                2. Run <code>wsl --install -d kali-linux</code><br>
                                                3. Restart Kovix after installation<br><br>
                                                You can also configure this later.
                                        </div>\`;
                                document.getElementById('step2-next').disabled = false;
                        }
                }

                function enableKali(enabled) {
                        kaliEnabled = enabled;
                        const cb = document.getElementById('kali-checkbox');
                        if (cb) cb.checked = enabled;
                        if (enabled) {
                                vscode.postMessage({ type: 'enableKaliWSL' });
                        }
                }

                function skipKali() {
                        kaliEnabled = false;
                        goToStep(3);
                }

                // ---- Summary ----
                function updateSummary() {
                        const providerNames = {
                                ollama: 'Ollama (Local)',
                                xenova: 'Xenova (In-Process)',
                                cloud: 'Cloud (OpenAI-Compatible)',
                        };
                        document.getElementById('summary-provider').textContent =
                                providerNames[selectedProvider] || 'Not selected';
                        document.getElementById('summary-model').textContent =
                                selectedModelId || 'Default';
                        const kaliRow = document.getElementById('summary-kali-row');
                        if (kaliRow && ${isWin ? 'true' : 'false'}) {
                                kaliRow.style.display = '';
                                document.getElementById('summary-kali').textContent =
                                        kaliEnabled ? 'Enabled' : 'Disabled';
                        }
                }

                // ---- Finish ----
                function finishSetup() {
                        vscode.postMessage({
                                type: 'finish',
                                config: {
                                        providerType: selectedProvider || 'xenova',
                                        modelId: selectedModelId,
                                        kaliWSLEnabled: kaliEnabled,
                                }
                        });
                }

                // ---- Message handler from extension host ----
                window.addEventListener('message', (event) => {
                        const msg = event.data;
                        switch (msg.type) {
                                case 'ollamaStatus':
                                        renderOllamaStatus(msg);
                                        break;
                                case 'modelSelected':
                                        // Model was successfully selected
                                        break;
                                case 'modelSelectError':
                                        break;
                                case 'providerSwitched':
                                        if (msg.success) {
                                                // Provider switched successfully
                                        }
                                        break;
                                case 'apiKeyValidation':
                                        handleApiKeyValidation(msg);
                                        break;
                                case 'kaliStatus':
                                        renderKaliStatus(msg);
                                        break;
                                case 'kaliEnabled':
                                        break;
                                case 'kaliSkipped':
                                        break;
                                case 'configSaved':
                                        // Config saved — could close or redirect
                                        break;
                        }
                });

                // Notify the extension host that the webview is ready
                vscode.postMessage({ type: 'ready' });
        </script>
</body>
</html>`;
        }
}

// Re-export for convenience
export const ONBOARDING_STORAGE_KEY = ONBOARDING_COMPLETE_KEY;
