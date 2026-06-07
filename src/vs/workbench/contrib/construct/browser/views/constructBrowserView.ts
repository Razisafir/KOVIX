/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { IViewPaneOptions } from '../../../../../workbench/browser/parts/views/viewPane.js';
import { ViewPane } from '../../../../../workbench/browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../../workbench/common/views';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IBrowserAutomationService, IBrowserSession, IBrowserScreenshot } from '../../../../../platform/construct/common/mcp/browserAutomation.js';

// --- View Constants --------------------------------------------------------

export class ConstructBrowserView extends ViewPane {
        static readonly ID = 'workbench.view.construct.browser';
        static readonly TITLE = 'Browser Preview';

        private currentSessionId: string | undefined;
        private urlInput: HTMLInputElement | undefined;
        private screenshotContainer: HTMLElement | undefined;
        private toolbarContainer: HTMLElement | undefined;
        private galleryContainer: HTMLElement | undefined;
        private treeContainer: HTMLElement | undefined;
        private statusContainer: HTMLElement | undefined;
        private sessionTabsContainer: HTMLElement | undefined;

        constructor(
                options: IViewPaneOptions,
                @IKeybindingService keybindingService: IKeybindingService,
                @IContextMenuService contextMenuService: IContextMenuService,
                @IConfigurationService configurationService: IConfigurationService,
                @IContextKeyService contextKeyService: IContextKeyService,
                @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
                @IInstantiationService instantiationService: IInstantiationService,
                @IOpenerService openerService: IOpenerService,
                @IThemeService themeService: IThemeService,
                @ITelemetryService telemetryService: ITelemetryService,
                @IHoverService hoverService: IHoverService,
                @ILogService private readonly logService: ILogService,
                @IBrowserAutomationService private readonly browserService: IBrowserAutomationService
        ) {
                super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

                this._register(this.browserService.onDidScreenshot(s => this.onScreenshot(s)));
                this._register(this.browserService.onDidCreateSession(s => this.onSessionCreated(s)));
                this._register(this.browserService.onDidCloseSession(id => this.onSessionClosed(id)));
                this._register(this.browserService.onDidNavigate(e => this.onNavigated(e.sessionId, e.url)));
                this._register(this.browserService.onDidError(e => this.onSessionError(e.sessionId, e.error)));
        }

        protected override renderBody(container: HTMLElement): void {
                super.renderBody(container);
                container.classList.add('construct-browser-view');

                // -- Session Tabs ----------------------------------------------
                this.sessionTabsContainer = dom.$('.construct-browser-sessions');
                container.appendChild(this.sessionTabsContainer);

                // -- Toolbar ---------------------------------------------------
                this.toolbarContainer = dom.$('.construct-browser-toolbar');
                container.appendChild(this.toolbarContainer);
                this.renderToolbar();

                // -- Main Content Area -----------------------------------------
                const contentArea = dom.$('.construct-browser-content');
                container.appendChild(contentArea);

                // Screenshot display
                this.screenshotContainer = dom.$('.construct-browser-screenshot');
                contentArea.appendChild(this.screenshotContainer);

                // Gallery sidebar
                this.galleryContainer = dom.$('.construct-browser-gallery');
                contentArea.appendChild(this.galleryContainer);

                // Accessibility tree panel (hidden by default)
                this.treeContainer = dom.$('.construct-browser-tree');
                this.treeContainer.style.display = 'none';
                contentArea.appendChild(this.treeContainer);

                // -- Status Bar ------------------------------------------------
                this.statusContainer = dom.$('.construct-browser-status');
                container.appendChild(this.statusContainer);

                // -- Empty State -----------------------------------------------
                this.renderEmptyState();
        }

        // =======================================================================
        // Toolbar Rendering
        // =======================================================================

        private renderToolbar(): void {
                if (!this.toolbarContainer) {
                        return;
                }

                // Navigation buttons
                const navButtons = dom.$('.construct-browser-nav-buttons');
                navButtons.appendChild(this.createButton('\u2190', 'Go Back', () => {
                        if (this.currentSessionId) {
                                this.browserService.goBack(this.currentSessionId);
                        }
                }));
                navButtons.appendChild(this.createButton('\u2192', 'Go Forward', () => {
                        if (this.currentSessionId) {
                                this.browserService.goForward(this.currentSessionId);
                        }
                }));
                navButtons.appendChild(this.createButton('\u21BB', 'Reload', () => {
                        if (this.currentSessionId) {
                                this.browserService.reload(this.currentSessionId);
                        }
                }));

                // URL bar
                const urlBar = dom.$('.construct-browser-urlbar');
                this.urlInput = document.createElement('input');
                this.urlInput.type = 'text';
                this.urlInput.placeholder = 'Enter URL...';
                this.urlInput.classList.add('construct-browser-url-input');
                this.urlInput.addEventListener('keydown', async (e) => {
                        if (e.key === 'Enter' && this.currentSessionId && this.urlInput) {
                                await this.browserService.navigate(this.currentSessionId, this.urlInput.value);
                        }
                });
                urlBar.appendChild(this.urlInput);

                // Action buttons
                const actionButtons = dom.$('.construct-browser-action-buttons');
                actionButtons.appendChild(this.createButton('\uD83D\uDCF7', 'Screenshot', () => {
                        if (this.currentSessionId) {
                                this.browserService.screenshot(this.currentSessionId);
                        }
                }));
                actionButtons.appendChild(this.createButton('\uD83C\uDF33', 'Accessibility Tree', () => {
                        this.toggleTreePanel();
                }));
                actionButtons.appendChild(this.createButton('+', 'New Session', () => {
                        this.browserService.createSession();
                }));

                this.toolbarContainer.appendChild(navButtons);
                this.toolbarContainer.appendChild(urlBar);
                this.toolbarContainer.appendChild(actionButtons);
        }

        private createButton(label: string, title: string, onClick: () => void): HTMLElement {
                const btn = document.createElement('button');
                btn.textContent = label;
                btn.title = title;
                btn.classList.add('construct-browser-btn');
                btn.addEventListener('click', onClick);
                return btn;
        }

        // =======================================================================
        // Empty State
        // =======================================================================

        private renderEmptyState(): void {
                if (!this.screenshotContainer) {
                        return;
                }

                this.screenshotContainer.innerHTML = '';

                const emptyState = dom.$('.construct-browser-empty');

                const icon = dom.$('.construct-browser-empty-icon');
                icon.textContent = '\uD83C\uDF10';
                emptyState.appendChild(icon);

                const text = dom.$('.construct-browser-empty-text');
                text.textContent = 'No browser session active. Click + to create one, or the agent will auto-launch one when working with frontend code.';
                emptyState.appendChild(text);

                this.screenshotContainer.appendChild(emptyState);
        }

        // =======================================================================
        // Event Handlers
        // =======================================================================

        private onScreenshot(screenshot: IBrowserScreenshot): void {
                if (!this.screenshotContainer) {
                        return;
                }
                if (screenshot.sessionId !== this.currentSessionId) {
                        return;
                }

                // Clear empty state and display screenshot
                this.screenshotContainer.innerHTML = '';
                const img = document.createElement('img');
                img.src = `data:image/png;base64,${screenshot.base64}`;
                img.classList.add('construct-browser-screenshot-img');
                this.screenshotContainer.appendChild(img);

                // Update gallery
                this.updateGallery(screenshot.sessionId);

                // Update status
                this.updateStatus('Screenshot captured');
        }

        private onSessionCreated(session: IBrowserSession): void {
                this.currentSessionId = session.id;
                this.updateSessionTabs();
                this.updateStatus(`Session ${session.id} created`);

                // If about:blank, show empty state with session info
                if (session.url === 'about:blank') {
                        this.renderEmptyState();
                }
        }

        private onSessionClosed(sessionId: string): void {
                if (this.currentSessionId === sessionId) {
                        const remaining = this.browserService.getAllSessions();
                        this.currentSessionId = remaining[0]?.id;

                        if (!this.currentSessionId) {
                                this.renderEmptyState();
                                if (this.galleryContainer) {
                                        this.galleryContainer.innerHTML = '';
                                }
                        }
                }
                this.updateSessionTabs();
                this.updateStatus(`Session closed`);
        }

        private onNavigated(sessionId: string, url: string): void {
                if (sessionId === this.currentSessionId && this.urlInput) {
                        this.urlInput.value = url;
                }
                this.updateStatus(`Navigated to ${url}`);
        }

        private onSessionError(sessionId: string, error: string): void {
                this.updateStatus(`Error: ${error}`);
                this.logService.warn(`[BrowserView] Session ${sessionId} error: ${error}`);
        }

        // =======================================================================
        // Gallery
        // =======================================================================

        private updateGallery(sessionId: string): void {
                if (!this.galleryContainer) {
                        return;
                }

                const screenshots = this.browserService.getLastNScreenshots(sessionId, 10);
                this.galleryContainer.innerHTML = '';

                for (const shot of screenshots.reverse()) {
                        const thumb = document.createElement('div');
                        thumb.classList.add('construct-browser-thumb');

                        const img = document.createElement('img');
                        img.src = `data:image/png;base64,${shot.base64}`;
                        thumb.appendChild(img);

                        const time = document.createElement('div');
                        time.classList.add('construct-browser-thumb-time');
                        time.textContent = new Date(shot.timestamp).toLocaleTimeString();
                        thumb.appendChild(time);

                        // Click to view full size in main area
                        thumb.addEventListener('click', () => {
                                if (!this.screenshotContainer) {
                                        return;
                                }
                                this.screenshotContainer.innerHTML = '';
                                const fullImg = document.createElement('img');
                                fullImg.src = `data:image/png;base64,${shot.base64}`;
                                fullImg.classList.add('construct-browser-screenshot-img');
                                this.screenshotContainer.appendChild(fullImg);
                        });

                        this.galleryContainer.appendChild(thumb);
                }
        }

        // =======================================================================
        // Session Tabs
        // =======================================================================

        private updateSessionTabs(): void {
                if (!this.sessionTabsContainer) {
                        return;
                }

                this.sessionTabsContainer.innerHTML = '';
                const sessions = this.browserService.getAllSessions();

                for (const session of sessions) {
                        const tab = document.createElement('div');
                        tab.classList.add('construct-browser-session-tab');
                        if (session.id === this.currentSessionId) {
                                tab.classList.add('active');
                        }

                        const title = document.createElement('span');
                        title.textContent = session.url === 'about:blank' ? 'New Tab' : new URL(session.url).hostname;
                        tab.appendChild(title);

                        // Close button
                        const closeBtn = document.createElement('span');
                        closeBtn.classList.add('close');
                        closeBtn.textContent = '\u00D7';
                        closeBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                this.browserService.closeSession(session.id);
                        });
                        tab.appendChild(closeBtn);

                        // Click to switch session
                        tab.addEventListener('click', () => {
                                this.currentSessionId = session.id;
                                this.updateSessionTabs();
                                this.updateGallery(session.id);
                                if (this.urlInput) {
                                        this.urlInput.value = session.url;
                                }
                        });

                        this.sessionTabsContainer.appendChild(tab);
                }
        }

        // =======================================================================
        // Status Bar
        // =======================================================================

        private updateStatus(message: string): void {
                if (!this.statusContainer) {
                        return;
                }

                const session = this.currentSessionId
                        ? this.browserService.getSession(this.currentSessionId)
                        : undefined;

                const statusClass = session
                        ? `construct-browser-status-${session.status}`
                        : 'construct-browser-status-idle';

                this.statusContainer.className = `construct-browser-status ${statusClass}`;
                this.statusContainer.textContent = message;
        }

        // =======================================================================
        // Tree Panel Toggle
        // =======================================================================

        private toggleTreePanel(): void {
                if (!this.treeContainer || !this.screenshotContainer) {
                        return;
                }

                const isVisible = this.treeContainer.style.display !== 'none';

                if (isVisible) {
                        // Hide tree
                        this.treeContainer.style.display = 'none';
                        this.screenshotContainer.style.flex = '1';
                } else {
                        // Show tree -- fetch accessibility tree
                        this.treeContainer.style.display = 'block';
                        this.screenshotContainer.style.flex = '0.6';

                        if (this.currentSessionId) {
                                this.browserService.getAccessibilityTree(this.currentSessionId).then(tree => {
                                        if (this.treeContainer) {
                                                this.treeContainer.textContent = tree || '(No accessibility tree available)';
                                        }
                                }).catch(err => {
                                        if (this.treeContainer) {
                                                this.treeContainer.textContent = `Error fetching tree: ${err}`;
                                        }
                                });
                        }
                }
        }

        // =======================================================================
        // Webview postMessage Handlers
        // =======================================================================

        // SEC-1: All webview communication goes through postMessage (contextBridge pattern).
        // Never expose Node.js objects across the IPC bridge. Messages are validated by type.
        handleMessage(message: { type: string; data?: any }): void {
                // SEC-1: Validate message structure — reject unexpected shapes
                if (!message || typeof message.type !== 'string') {
                        this.logService.warn('[BrowserView] Rejected malformed webview message');
                        return;
                }
                switch (message.type) {
                        case 'browser:createSession':
                                this.browserService.createSession(message.data?.url, message.data?.viewport);
                                break;

                        case 'browser:navigate':
                                if (this.currentSessionId) {
                                        this.browserService.navigate(this.currentSessionId, message.data.url);
                                }
                                break;

                        case 'browser:screenshot':
                                if (this.currentSessionId) {
                                        this.browserService.screenshot(this.currentSessionId, message.data?.fullPage);
                                }
                                break;

                        case 'browser:getTree':
                                if (this.currentSessionId) {
                                        this.browserService.getAccessibilityTree(this.currentSessionId).then(tree => {
                                                if (this.treeContainer) {
                                                        this.treeContainer.textContent = tree;
                                                        this.treeContainer.style.display = 'block';
                                                }
                                        });
                                }
                                break;

                        case 'browser:getSessions': {
                                const sessions = this.browserService.getAllSessions();
                                // Could post back to webview if needed
                                this.logService.info(`[BrowserView] Active sessions: ${sessions.length}`);
                                break;
                        }

                        case 'browser:closeSession':
                                this.browserService.closeSession(message.data.sessionId);
                                break;

                        case 'browser:click':
                                if (this.currentSessionId) {
                                        this.browserService.click(this.currentSessionId, message.data.selector);
                                }
                                break;

                        case 'browser:fill':
                                if (this.currentSessionId) {
                                        this.browserService.fill(this.currentSessionId, message.data.selector, message.data.value);
                                }
                                break;

                        case 'browser:evaluate':
                                if (this.currentSessionId) {
                                        this.browserService.evaluate(this.currentSessionId, message.data.script);
                                }
                                break;
                }
        }

        protected override layoutBody(height: number, width: number): void {
                // Layout is handled by flexbox CSS
        }
}
