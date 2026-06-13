// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IBrowserAutomationService = createDecorator<IBrowserAutomationService>('construct.browserAutomation');

// --- Session Types ---------------------------------------------------------

export interface IBrowserSession {
        readonly id: string;
        readonly url: string;
        readonly title: string;
        readonly status: BrowserSessionStatus;
        readonly screenshot?: string; // base64
        readonly accessibilityTree?: string;
        readonly lastActivity: number;
        readonly viewport: { width: number; height: number };
}

export const enum BrowserSessionStatus {
        Idle = 'idle',
        Navigating = 'navigating',
        Interacting = 'interacting',
        Error = 'error',
        Closed = 'closed'
}

// --- Screenshot & Comparison -----------------------------------------------

export interface IBrowserScreenshot {
        readonly sessionId: string;
        readonly base64: string;
        readonly timestamp: number;
        readonly url: string;
        readonly fullPage: boolean;
        readonly viewport: { width: number; height: number };
}

export interface IBrowserDiff {
        readonly before: IBrowserScreenshot;
        readonly after: IBrowserScreenshot;
        /** 0-100, lower is more similar */
        readonly diffScore: number;
        /** Visual diff image (base64 PNG) */
        readonly diffBase64?: string;
}

// --- Console & Diagnostics -------------------------------------------------

export interface IBrowserConsoleEntry {
        readonly level: 'log' | 'warn' | 'error' | 'info';
        readonly message: string;
        readonly source: string;
        readonly timestamp: number;
}

// --- Agent Context ---------------------------------------------------------

export interface IBrowserActionRecord {
        readonly type: string;
        readonly timestamp: number;
        readonly data: unknown;
}

// --- Service Interface -----------------------------------------------------

export interface IBrowserAutomationService extends IDisposable {
        readonly _serviceBrand: undefined;

        // --- Session Management ----------------------------------------------

        /** Create a new browser session, auto-installing Playwright MCP if needed. */
        createSession(url?: string, viewport?: { width: number; height: number }): Promise<IBrowserSession>;

        /** Close a specific session. */
        closeSession(sessionId: string): Promise<void>;

        /** Close all open sessions. */
        closeAllSessions(): Promise<void>;

        /** Get a session by ID. */
        getSession(sessionId: string): IBrowserSession | undefined;

        /** Get all active sessions. */
        getAllSessions(): IBrowserSession[];

        // --- Navigation ------------------------------------------------------

        /** Navigate to a URL. */
        navigate(sessionId: string, url: string): Promise<void>;

        /** Go back in browser history. */
        goBack(sessionId: string): Promise<void>;

        /** Go forward in browser history. */
        goForward(sessionId: string): Promise<void>;

        /** Reload the current page. */
        reload(sessionId: string): Promise<void>;

        /** Get the current URL of the session. */
        getCurrentUrl(sessionId: string): Promise<string>;

        // --- Interaction -----------------------------------------------------

        /** Click an element matching the selector. */
        click(sessionId: string, selector: string): Promise<void>;

        /** Fill an input element with a value. */
        fill(sessionId: string, selector: string, value: string): Promise<void>;

        /** Select an option in a dropdown. */
        select(sessionId: string, selector: string, value: string): Promise<void>;

        /** Hover over an element. */
        hover(sessionId: string, selector: string): Promise<void>;

        /** Execute JavaScript in the page context. */
        evaluate(sessionId: string, script: string): Promise<unknown>;

        /** Press a keyboard key. */
        press(sessionId: string, key: string): Promise<void>;

        // --- Observation -----------------------------------------------------

        /** Capture a screenshot of the current page. */
        screenshot(sessionId: string, fullPage?: boolean): Promise<IBrowserScreenshot>;

        /** Get the accessibility tree (token-efficient representation of page structure). */
        getAccessibilityTree(sessionId: string): Promise<string>;

        /** Get the raw HTML page source. */
        getPageSource(sessionId: string): Promise<string>;

        /** Get browser console logs for the session. */
        getConsoleLogs(sessionId: string): Promise<IBrowserConsoleEntry[]>;

        // --- Visual Comparison -----------------------------------------------

        /** Compare current screenshot with the previous one in the same session. */
        compareWithPrevious(sessionId: string): Promise<IBrowserDiff | undefined>;

        /** Compare screenshots between two sessions. */
        compareSessions(sessionIdA: string, sessionIdB: string): Promise<IBrowserDiff>;

        // --- Agent Integration -----------------------------------------------

        /** Get the last N screenshots for a session (max 10). */
        getLastNScreenshots(sessionId: string, n: number): IBrowserScreenshot[];

        /** Assemble a context string for the AI agent (accessibility tree + actions + console). */
        getContextForAgent(sessionId: string): Promise<string>;

        // --- Events ----------------------------------------------------------

        /** Fired when a new session is created. */
        readonly onDidCreateSession: Event<IBrowserSession>;

        /** Fired when a session is closed. */
        readonly onDidCloseSession: Event<string>;

        /** Fired when a navigation completes. */
        readonly onDidNavigate: Event<{ sessionId: string; url: string }>;

        /** Fired when a screenshot is captured. */
        readonly onDidScreenshot: Event<IBrowserScreenshot>;

        /** Fired when an error occurs in a session. */
        readonly onDidError: Event<{ sessionId: string; error: string }>;
}
