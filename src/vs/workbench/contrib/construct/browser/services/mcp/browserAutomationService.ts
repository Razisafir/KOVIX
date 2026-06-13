// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPServerDefinition, MCPTransportType } from '../../../../../../platform/construct/common/mcp/mcpTypes';
import {
        IBrowserAutomationService,
        IBrowserSession,
        BrowserSessionStatus,
        IBrowserScreenshot,
        IBrowserDiff,
        IBrowserConsoleEntry,
        IBrowserActionRecord
} from '../../../../../../platform/construct/common/mcp/browserAutomation.js';

// --- Constants -------------------------------------------------------------

const PLAYWRIGHT_MCP_NAME = 'playwright';
const MAX_SCREENSHOT_HISTORY = 10;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const ACCESSIBILITY_TREE_TOKEN_LIMIT = 8000;
const MAX_RECENT_ACTIONS_FOR_CONTEXT = 5;
const MAX_CONSOLE_ERRORS_FOR_CONTEXT = 5;

// --- Internal Session State ------------------------------------------------

// Extend ISessionInternal to include mutable fields that are managed internally
type SessionInternal = IBrowserSession & {
        screenshots: IBrowserScreenshot[];
        actions: IBrowserActionRecord[];
        consoleLogs: IBrowserConsoleEntry[];
        status: BrowserSessionStatus;
        url: string;
        title: string;
        lastActivity: number;
        viewport: { width: number; height: number };
        screenshot?: string;
        accessibilityTree?: string;
};

// --- Service Implementation ------------------------------------------------

export class BrowserAutomationService extends Disposable implements IBrowserAutomationService {
        readonly _serviceBrand: undefined;

        private readonly sessions = new Map<string, SessionInternal>();
        private playwrightInstalled = false;
        private nextId = 0;

        // --- Events ---------------------------------------------------------

        private readonly _onDidCreateSession = this._register(new Emitter<IBrowserSession>());
        readonly onDidCreateSession = this._onDidCreateSession.event;

        private readonly _onDidCloseSession = this._register(new Emitter<string>());
        readonly onDidCloseSession = this._onDidCloseSession.event;

        private readonly _onDidNavigate = this._register(new Emitter<{ sessionId: string; url: string }>());
        readonly onDidNavigate = this._onDidNavigate.event;

        private readonly _onDidScreenshot = this._register(new Emitter<IBrowserScreenshot>());
        readonly onDidScreenshot = this._onDidScreenshot.event;

        private readonly _onDidError = this._register(new Emitter<{ sessionId: string; error: string }>());
        readonly onDidError = this._onDidError.event;

        // --- Constructor ----------------------------------------------------

        constructor(
                @IInstantiationService _instantiationService: IInstantiationService,
                @ILogService private readonly logService: ILogService,
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager
        ) {
                super();
        }

        // =======================================================================
        // Session Management
        // =======================================================================

        async createSession(url?: string, viewport?: { width: number; height: number }): Promise<IBrowserSession> {
                await this.ensurePlaywright();

                const id = `browser-${++this.nextId}`;
                const vp = viewport ?? DEFAULT_VIEWPORT;

                const session: SessionInternal = {
                        id,
                        url: url ?? 'about:blank',
                        title: 'New Tab',
                        status: BrowserSessionStatus.Idle,
                        lastActivity: Date.now(),
                        viewport: vp,
                        screenshots: [],
                        actions: [],
                        consoleLogs: []
                };

                this.sessions.set(id, session);

                // Initialize browser context via Playwright MCP
                try {
                        await this.mcpServerManager.executeTool(PLAYWRIGHT_MCP_NAME, 'browser_navigate', {
                                url: url ?? 'about:blank',
                                width: vp.width,
                                height: vp.height
                        });

                        session.status = BrowserSessionStatus.Idle;
                        this._onDidCreateSession.fire(this.toPublicSession(session));

                        if (url) {
                                await this.captureScreenshot(id);
                        }

                        this.logService.info(`[Browser] Created session ${id} at ${url ?? 'about:blank'}`);
                } catch (error) {
                        session.status = BrowserSessionStatus.Error;
                        this._onDidError.fire({
                                sessionId: id,
                                error: error instanceof Error ? error.message : String(error)
                        });
                        this.logService.error(`[Browser] Failed to create session ${id}: ${error}`);
                }

                return this.toPublicSession(session);
        }

        async closeSession(sessionId: string): Promise<void> {
                const session = this.sessions.get(sessionId);
                if (!session) {
                        this.logService.warn(`[Browser] Attempted to close non-existent session ${sessionId}`);
                        return;
                }

                session.status = BrowserSessionStatus.Closed;
                this.sessions.delete(sessionId);
                this._onDidCloseSession.fire(sessionId);
                this.logService.info(`[Browser] Closed session ${sessionId}`);
        }

        async closeAllSessions(): Promise<void> {
                const ids = Array.from(this.sessions.keys());
                this.logService.info(`[Browser] Closing all ${ids.length} sessions`);
                for (const id of ids) {
                        await this.closeSession(id);
                }
        }

        getSession(sessionId: string): IBrowserSession | undefined {
                const s = this.sessions.get(sessionId);
                return s ? this.toPublicSession(s) : undefined;
        }

        getAllSessions(): IBrowserSession[] {
                return Array.from(this.sessions.values()).map(s => this.toPublicSession(s));
        }

        // =======================================================================
        // Navigation
        // =======================================================================

        async navigate(sessionId: string, url: string): Promise<void> {
                const session = this.getActiveSession(sessionId);
                session.status = BrowserSessionStatus.Navigating;
                session.url = url;

                try {
                        await this.mcpServerManager.executeTool(PLAYWRIGHT_MCP_NAME, 'browser_navigate', { url });
                        session.status = BrowserSessionStatus.Idle;
                        session.lastActivity = Date.now();

                        this._onDidNavigate.fire({ sessionId, url });
                        await this.captureScreenshot(sessionId);

                        this.logService.info(`[Browser] Navigated ${sessionId} to ${url}`);
                } catch (error) {
                        session.status = BrowserSessionStatus.Error;
                        this._onDidError.fire({
                                sessionId,
                                error: error instanceof Error ? error.message : String(error)
                        });
                        this.logService.error(`[Browser] Navigation failed for ${sessionId}: ${error}`);
                        throw error;
                }
        }

        async goBack(sessionId: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_go_back', {});
        }

        async goForward(sessionId: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_go_forward', {});
        }

        async reload(sessionId: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_reload', {});
        }

        async getCurrentUrl(sessionId: string): Promise<string> {
                const result = await this.mcpServerManager.executeTool(
                        PLAYWRIGHT_MCP_NAME,
                        'browser_get_current_url',
                        {}
                );
                return result.data?.url ?? this.sessions.get(sessionId)?.url ?? '';
        }

        // =======================================================================
        // Interaction
        // =======================================================================

        async click(sessionId: string, selector: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_click', { selector });
        }

        async fill(sessionId: string, selector: string, value: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_fill', { selector, value });
        }

        async select(sessionId: string, selector: string, value: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_select', { selector, value });
        }

        async hover(sessionId: string, selector: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_hover', { selector });
        }

        async evaluate(sessionId: string, script: string): Promise<unknown> {
                const result = await this.mcpServerManager.executeTool(
                        PLAYWRIGHT_MCP_NAME,
                        'browser_evaluate',
                        { script }
                );
                return result.data?.result;
        }

        async press(sessionId: string, key: string): Promise<void> {
                await this.executeAction(sessionId, 'browser_press', { key });
        }

        // =======================================================================
        // Observation
        // =======================================================================

        async screenshot(sessionId: string, fullPage: boolean = false): Promise<IBrowserScreenshot> {
                return this.captureScreenshot(sessionId, fullPage);
        }

        async getAccessibilityTree(sessionId: string): Promise<string> {
                const result = await this.mcpServerManager.executeTool(
                        PLAYWRIGHT_MCP_NAME,
                        'browser_get_accessibility_tree',
                        {}
                );
                const tree = result.data?.tree ?? '';

                const session = this.sessions.get(sessionId);
                if (session) {
                        (session as any).accessibilityTree = tree;
                }

                return tree;
        }

        async getPageSource(sessionId: string): Promise<string> {
                const result = await this.mcpServerManager.executeTool(
                        PLAYWRIGHT_MCP_NAME,
                        'browser_get_page_source',
                        {}
                );
                return result.data?.source ?? '';
        }

        async getConsoleLogs(sessionId: string): Promise<IBrowserConsoleEntry[]> {
                const result = await this.mcpServerManager.executeTool(
                        PLAYWRIGHT_MCP_NAME,
                        'browser_get_console_logs',
                        {}
                );

                const rawLogs: Array<{ level: string; message: string; source: string }> = result.data?.logs ?? [];
                const logs: IBrowserConsoleEntry[] = rawLogs.map(entry => ({
                        level: (['log', 'warn', 'error', 'info'].includes(entry.level) ? entry.level : 'log') as IBrowserConsoleEntry['level'],
                        message: entry.message,
                        source: entry.source,
                        timestamp: Date.now()
                }));

                // Store in session for agent context
                const session = this.sessions.get(sessionId);
                if (session) {
                        session.consoleLogs = logs;
                }

                return logs;
        }

        // =======================================================================
        // Visual Comparison
        // =======================================================================

        async compareWithPrevious(sessionId: string): Promise<IBrowserDiff | undefined> {
                const session = this.sessions.get(sessionId);
                if (!session || session.screenshots.length < 2) {
                        return undefined;
                }

                const current = session.screenshots[session.screenshots.length - 1];
                const previous = session.screenshots[session.screenshots.length - 2];

                return this.computeDiff(previous, current);
        }

        async compareSessions(sessionIdA: string, sessionIdB: string): Promise<IBrowserDiff> {
                const sessionA = this.sessions.get(sessionIdA);
                const sessionB = this.sessions.get(sessionIdB);

                if (!sessionA?.screenshots.length || !sessionB?.screenshots.length) {
                        throw new Error('Both sessions must have at least one screenshot for comparison');
                }

                return this.computeDiff(
                        sessionA.screenshots[sessionA.screenshots.length - 1],
                        sessionB.screenshots[sessionB.screenshots.length - 1]
                );
        }

        // =======================================================================
        // Agent Integration
        // =======================================================================

        getLastNScreenshots(sessionId: string, n: number): IBrowserScreenshot[] {
                const session = this.sessions.get(sessionId);
                if (!session) {
                        return [];
                }
                return session.screenshots.slice(-Math.min(n, MAX_SCREENSHOT_HISTORY));
        }

        async getContextForAgent(sessionId: string): Promise<string> {
                const session = this.sessions.get(sessionId);
                if (!session) {
                        return '(No active browser session)';
                }

                const parts: string[] = [];

                // Current page metadata
                parts.push(`Current URL: ${session.url}`);
                parts.push(`Page Title: ${session.title}`);
                parts.push(`Viewport: ${session.viewport.width}x${session.viewport.height}`);
                parts.push(`Session Status: ${session.status}`);
                parts.push('');

                // Recent actions (last N)
                const recentActions = session.actions.slice(-MAX_RECENT_ACTIONS_FOR_CONTEXT);
                if (recentActions.length > 0) {
                        parts.push('Recent Actions:');
                        for (const action of recentActions) {
                                const time = new Date(action.timestamp).toISOString();
                                parts.push(`  - ${action.type} at ${time}`);
                        }
                        parts.push('');
                }

                // Accessibility tree -- the token-efficient representation of the DOM
                try {
                        const tree = await this.getAccessibilityTree(sessionId);
                        if (tree) {
                                parts.push('Page Structure (Accessibility Tree):');
                                parts.push(tree.substring(0, ACCESSIBILITY_TREE_TOKEN_LIMIT));
                                if (tree.length > ACCESSIBILITY_TREE_TOKEN_LIMIT) {
                                        parts.push(`\n... (truncated, ${tree.length - ACCESSIBILITY_TREE_TOKEN_LIMIT} more characters)`);
                                }
                                parts.push('');
                        } else {
                                parts.push('(Accessibility tree unavailable -- page may still be loading)');
                                parts.push('');
                        }
                } catch (e) {
                        parts.push('(Accessibility tree unavailable)');
                        parts.push('');
                }

                // Console errors and warnings
                try {
                        const logs = await this.getConsoleLogs(sessionId);
                        const issues = logs.filter(l => l.level === 'error' || l.level === 'warn');
                        if (issues.length > 0) {
                                parts.push(`Console Issues (${issues.length} total, showing last ${MAX_CONSOLE_ERRORS_FOR_CONTEXT}):`);
                                for (const issue of issues.slice(-MAX_CONSOLE_ERRORS_FOR_CONTEXT)) {
                                        parts.push(`  [${issue.level.toUpperCase()}] ${issue.message}`);
                                }
                                parts.push('');
                        }
                } catch {
                        // Console logs unavailable -- non-critical
                }

                // Last screenshot metadata (not the image itself, to save tokens)
                if (session.screenshots.length > 0) {
                        const lastShot = session.screenshots[session.screenshots.length - 1];
                        parts.push(`Last Screenshot: ${lastShot.url} at ${new Date(lastShot.timestamp).toISOString()} (${lastShot.viewport.width}x${lastShot.viewport.height}, ${lastShot.fullPage ? 'full page' : 'viewport'})`);
                        parts.push('');
                }

                return parts.join('\n');
        }

        // =======================================================================
        // Private Helpers
        // =======================================================================

        /**
         * Ensure the Playwright MCP server is installed and running.
         * Auto-installs on first use if not already present.
         */
        private async ensurePlaywright(): Promise<void> {
                if (this.playwrightInstalled) {
                        return;
                }

                // Check if Playwright MCP server is already installed
                const installed = this.mcpServerManager.listInstalledServers();
                const hasPlaywright = installed.some(s => s.name === PLAYWRIGHT_MCP_NAME);

                if (!hasPlaywright) {
                        this.logService.info('[Browser] Auto-installing Playwright MCP server...');

                        try {
                                // Create server definition for Playwright MCP
                                const playwrightDef: IMCPServerDefinition = {
                                        name: PLAYWRIGHT_MCP_NAME,
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-playwright'],
                                        env: {},
                                        transport: MCPTransportType.Stdio,
                                        categories: ['browser'],
                                        description: 'Playwright browser automation MCP server for Kovix',
                                        autoRestart: true
                                };

                                await this.mcpServerManager.installServer(playwrightDef);
                                await this.mcpServerManager.startServer(PLAYWRIGHT_MCP_NAME);
                                this.playwrightInstalled = true;

                                this.logService.info('[Browser] Playwright MCP installed and started successfully');
                        } catch (error) {
                                this.logService.error('[Browser] Failed to auto-install Playwright MCP:', error);
                                throw new Error(
                                        'Playwright MCP server is required for browser automation. ' +
                                        'Please install it manually: npx -y @modelcontextprotocol/server-playwright'
                                );
                        }
                } else {
                        // Ensure the server is running
                        const status = this.mcpServerManager.getServerStatus(PLAYWRIGHT_MCP_NAME);
                        if (status !== 'connected') {
                                try {
                                        await this.mcpServerManager.startServer(PLAYWRIGHT_MCP_NAME);
                                } catch (error) {
                                        this.logService.warn('[Browser] Playwright MCP server was installed but failed to start:', error);
                                        throw new Error(
                                                'Playwright MCP server is installed but not running. ' +
                                                'Try restarting it via MCP Server Manager.'
                                        );
                                }
                        }
                        this.playwrightInstalled = true;
                }
        }

        /**
         * Get an active (non-closed) session or throw.
         */
        private getActiveSession(sessionId: string): SessionInternal {
                const session = this.sessions.get(sessionId);
                if (!session) {
                        throw new Error(`Browser session ${sessionId} not found`);
                }
                if (session.status === BrowserSessionStatus.Closed) {
                        throw new Error(`Browser session ${sessionId} is closed`);
                }
                return session;
        }

        /**
         * Execute a browser action via Playwright MCP, update session state, and handle errors.
         */
        private async executeAction(sessionId: string, toolName: string, args: Record<string, unknown>): Promise<void> {
                const session = this.getActiveSession(sessionId);
                session.status = BrowserSessionStatus.Interacting;
                session.lastActivity = Date.now();

                try {
                        await this.mcpServerManager.executeTool(PLAYWRIGHT_MCP_NAME, toolName, args);
                        session.actions.push({
                                type: toolName,
                                timestamp: Date.now(),
                                data: args
                        });
                        session.status = BrowserSessionStatus.Idle;
                } catch (error) {
                        session.status = BrowserSessionStatus.Error;
                        this._onDidError.fire({
                                sessionId,
                                error: error instanceof Error ? error.message : String(error)
                        });
                        this.logService.error(`[Browser] Action ${toolName} failed for session ${sessionId}: ${error}`);
                        throw error;
                }
        }

        /**
         * Capture a screenshot and store it in the session's gallery.
         * Automatically trims the gallery to MAX_SCREENSHOT_HISTORY entries.
         */
        private async captureScreenshot(sessionId: string, fullPage: boolean = false): Promise<IBrowserScreenshot> {
                const session = this.sessions.get(sessionId);
                if (!session) {
                        throw new Error(`Browser session ${sessionId} not found for screenshot`);
                }

                const result = await this.mcpServerManager.executeTool(
                        PLAYWRIGHT_MCP_NAME,
                        'browser_screenshot',
                        { fullPage }
                );

                const base64 = result.data?.screenshot ?? '';
                const screenshot: IBrowserScreenshot = {
                        sessionId,
                        base64,
                        timestamp: Date.now(),
                        url: session.url,
                        fullPage,
                        viewport: { ...session.viewport }
                };

                // Add to gallery and trim
                session.screenshots.push(screenshot);
                if (session.screenshots.length > MAX_SCREENSHOT_HISTORY) {
                        session.screenshots = session.screenshots.slice(-MAX_SCREENSHOT_HISTORY);
                }

                // Update session screenshot reference
                (session as any).screenshot = base64;
                session.lastActivity = Date.now();

                this._onDidScreenshot.fire(screenshot);
                return screenshot;
        }

        /**
         * Compute a visual diff between two screenshots.
         * Uses base64 size comparison as a lightweight heuristic.
         * In production, replace with pixelmatch or similar library for pixel-level diff.
         */
        private async computeDiff(before: IBrowserScreenshot, after: IBrowserScreenshot): Promise<IBrowserDiff> {
                // Lightweight diff score based on base64 payload size difference
                // This catches major layout/content changes; pixel-level diff would be more precise
                const beforeSize = before.base64.length;
                const afterSize = after.base64.length;
                const sizeDiff = Math.abs(afterSize - beforeSize);
                const maxSize = Math.max(beforeSize, afterSize, 1);
                const diffScore = (sizeDiff / maxSize) * 100;

                // Classify diff magnitude for quick assessment
                // Score 0-5: essentially identical (rounding/rendering variance)
                // Score 5-30: minor changes (text edits, small UI tweaks)
                // Score 30-100: major changes (layout shifts, new content)
                this.logService.info(`[Browser] Diff score: ${diffScore.toFixed(1)}% (before: ${beforeSize}B, after: ${afterSize}B)`);

                return {
                        before,
                        after,
                        diffScore: Math.min(diffScore, 100)
                };
        }

        /**
         * Strip internal fields (screenshots, actions, consoleLogs) for public API.
         */
        private toPublicSession(session: SessionInternal): IBrowserSession {
                return {
                        id: session.id,
                        url: session.url,
                        title: session.title,
                        status: session.status,
                        screenshot: session.screenshot,
                        accessibilityTree: session.accessibilityTree,
                        lastActivity: session.lastActivity,
                        viewport: session.viewport
                };
        }

        // --- Lifecycle ------------------------------------------------------

        override dispose(): void {
                this.closeAllSessions().catch(e =>
                        this.logService.error('[Browser] Error closing sessions during dispose:', e)
                );
                super.dispose();
        }
}
