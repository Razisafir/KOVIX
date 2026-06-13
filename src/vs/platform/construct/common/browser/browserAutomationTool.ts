/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IBrowserAutomationTool = createDecorator<IBrowserAutomationTool>('construct.browserAutomationTool');

/**
 * Result of reading DOM content.
 */
export interface IBrowserReadResult {
	/** The HTML content */
	html: string;
	/** The text content */
	text: string;
	/** Console errors found */
	consoleErrors: string[];
	/** Page title */
	title: string;
}

/**
 * IBrowserAutomationTool — browser automation for the agent.
 *
 * Provides tools to open URLs, take screenshots, click elements,
 * and read DOM content. Uses VS Code's built-in webview for rendering.
 */
export interface IBrowserAutomationTool {
	readonly _serviceBrand: undefined;

	/**
	 * Open a URL in a browser session.
	 *
	 * @param url The URL to open.
	 * @returns Session ID for subsequent operations.
	 */
	openUrl(url: string): Promise<string>;

	/**
	 * Take a screenshot of the current page.
	 *
	 * @param sessionId The browser session ID.
	 * @returns Base64-encoded screenshot image.
	 */
	takeScreenshot(sessionId: string): Promise<string>;

	/**
	 * Click an element matching the CSS selector.
	 *
	 * @param sessionId The browser session ID.
	 * @param selector CSS selector for the element to click.
	 */
	clickElement(sessionId: string, selector: string): Promise<void>;

	/**
	 * Read the DOM content of the current page.
	 *
	 * @param sessionId The browser session ID.
	 * @param selector Optional CSS selector to read a specific element.
	 * @returns Structured DOM content and metadata.
	 */
	readDom(sessionId: string, selector?: string): Promise<IBrowserReadResult>;
}
