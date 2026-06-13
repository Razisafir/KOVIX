"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Kovix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
// ---- Simple browser session manager for testing ----
class SimpleBrowserAutomation {
    sessions = new Map();
    sessionCounter = 0;
    openUrl(url) {
        const id = `session_${++this.sessionCounter}`;
        const session = {
            id,
            url,
            title: '',
            status: 'active',
            createdAt: Date.now(),
            lastActivity: Date.now(),
        };
        this.sessions.set(id, session);
        return id;
    }
    takeScreenshot(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        if (session.status !== 'active') {
            throw new Error(`Session ${sessionId} is not active`);
        }
        session.lastActivity = Date.now();
        // Return a base64 placeholder
        return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';
    }
    clickElement(sessionId, selector) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        if (session.status !== 'active') {
            throw new Error(`Session ${sessionId} is not active`);
        }
        session.lastActivity = Date.now();
        // Validate selector is not empty
        if (!selector || selector.trim().length === 0) {
            throw new Error('Selector must not be empty');
        }
    }
    readDom(sessionId, selector) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        if (session.status !== 'active') {
            throw new Error(`Session ${sessionId} is not active`);
        }
        session.lastActivity = Date.now();
        return {
            html: '<html><body><h1>Test Page</h1></body></html>',
            text: 'Test Page',
            consoleErrors: [],
            title: session.title || 'Test Page',
        };
    }
    closeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.status = 'closed';
        }
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    getActiveSessionCount() {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.status === 'active') {
                count++;
            }
        }
        return count;
    }
}
// ---- URL validation ----
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    }
    catch {
        return false;
    }
}
function isSafeUrl(url) {
    try {
        const parsed = new URL(url);
        // Block file:// protocol
        if (parsed.protocol === 'file:') {
            return false;
        }
        // Block javascript: protocol
        if (parsed.protocol === 'javascript:') {
            return false;
        }
        // Block data: protocol
        if (parsed.protocol === 'data:') {
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
// ---- CSS selector validation ----
function isValidSelector(selector) {
    if (!selector || selector.trim().length === 0) {
        return false;
    }
    // Basic validation: no script injection
    if (selector.includes('<script') || selector.includes('javascript:')) {
        return false;
    }
    return true;
}
// ---- Tests ----
suite('BrowserAutomation', () => {
    suite('URL opening — browser opens', () => {
        test('openUrl returns a session ID', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            assert.ok(sessionId, 'Should return a session ID');
            assert.ok(sessionId.length > 0, 'Session ID should not be empty');
        });
        test('opened session is active', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            const session = browser.getSession(sessionId);
            assert.strictEqual(session?.status, 'active');
            assert.strictEqual(session?.url, 'https://example.com');
        });
        test('multiple sessions can be opened', () => {
            const browser = new SimpleBrowserAutomation();
            const s1 = browser.openUrl('https://example.com');
            const s2 = browser.openUrl('https://github.com');
            assert.notStrictEqual(s1, s2, 'Sessions should have different IDs');
            assert.strictEqual(browser.getActiveSessionCount(), 2);
        });
        test('valid URLs pass validation', () => {
            assert.strictEqual(isValidUrl('https://example.com'), true);
            assert.strictEqual(isValidUrl('http://localhost:3000'), true);
        });
        test('invalid URLs fail validation', () => {
            assert.strictEqual(isValidUrl('not-a-url'), false);
            assert.strictEqual(isValidUrl(''), false);
        });
        test('dangerous URLs are blocked', () => {
            assert.strictEqual(isSafeUrl('file:///etc/passwd'), false, 'file:// should be blocked');
            assert.strictEqual(isSafeUrl('javascript:alert(1)'), false, 'javascript: should be blocked');
            assert.strictEqual(isSafeUrl('data:text/html,<h1>hi</h1>'), false, 'data: should be blocked');
        });
        test('safe URLs pass validation', () => {
            assert.strictEqual(isSafeUrl('https://example.com'), true);
            assert.strictEqual(isSafeUrl('http://localhost:3000'), true);
        });
    });
    suite('Screenshot — screenshot is taken', () => {
        test('takeScreenshot returns base64 string', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            const screenshot = browser.takeScreenshot(sessionId);
            assert.ok(screenshot.length > 0, 'Screenshot should not be empty');
            // Base64 string should only contain valid characters
            assert.ok(/^[A-Za-z0-9+/=]+$/.test(screenshot), 'Should be valid base64');
        });
        test('takeScreenshot on non-existent session throws', () => {
            const browser = new SimpleBrowserAutomation();
            assert.throws(() => browser.takeScreenshot('non-existent'), /not found/);
        });
        test('takeScreenshot on closed session throws', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            browser.closeSession(sessionId);
            assert.throws(() => browser.takeScreenshot(sessionId), /not active/);
        });
    });
    suite('Click — click is sent', () => {
        test('clickElement on valid session succeeds', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            assert.doesNotThrow(() => {
                browser.clickElement(sessionId, '#submit-button');
            });
        });
        test('clickElement with empty selector throws', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            assert.throws(() => browser.clickElement(sessionId, ''), /must not be empty/);
        });
        test('clickElement on non-existent session throws', () => {
            const browser = new SimpleBrowserAutomation();
            assert.throws(() => browser.clickElement('non-existent', '#btn'), /not found/);
        });
        test('valid CSS selectors pass validation', () => {
            assert.strictEqual(isValidSelector('#my-id'), true);
            assert.strictEqual(isValidSelector('.my-class'), true);
            assert.strictEqual(isValidSelector('div > p'), true);
            assert.strictEqual(isValidSelector('[data-testid="submit"]'), true);
        });
        test('invalid CSS selectors fail validation', () => {
            assert.strictEqual(isValidSelector(''), false);
            assert.strictEqual(isValidSelector('   '), false);
            assert.strictEqual(isValidSelector('<script>alert(1)</script>'), false);
        });
    });
    suite('DOM reading — DOM is read', () => {
        test('readDom returns structured result', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            const result = browser.readDom(sessionId);
            assert.ok('html' in result, 'Should have html field');
            assert.ok('text' in result, 'Should have text field');
            assert.ok('consoleErrors' in result, 'Should have consoleErrors field');
            assert.ok('title' in result, 'Should have title field');
        });
        test('readDom with selector returns content', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            const result = browser.readDom(sessionId, 'h1');
            assert.ok(result.html.length > 0, 'Should return HTML content');
            assert.ok(result.text.length > 0, 'Should return text content');
        });
        test('readDom on non-existent session throws', () => {
            const browser = new SimpleBrowserAutomation();
            assert.throws(() => browser.readDom('non-existent'), /not found/);
        });
        test('readDom on closed session throws', () => {
            const browser = new SimpleBrowserAutomation();
            const sessionId = browser.openUrl('https://example.com');
            browser.closeSession(sessionId);
            assert.throws(() => browser.readDom(sessionId), /not active/);
        });
    });
});
//# sourceMappingURL=browserAutomation.test.js.map