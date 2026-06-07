/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Construct IDE. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SEC-2: Centralised IPC channel name enum.
 * Never use plain string literals for channel names in construct code.
 * All channel references MUST go through this enum.
 */
export enum ConstructIpcChannel {
	// Agent channels
	AgentRunPlanning = 'construct:agent:runPlanning',
	AgentRunExecution = 'construct:agent:runExecution',
	AgentCancel = 'construct:agent:cancel',
	AgentUndo = 'construct:agent:undo',

	// Tool channels
	ToolExecute = 'construct:tool:execute',
	ToolList = 'construct:tool:list',

	// Terminal channels
	TerminalExecute = 'construct:terminal:execute',
	TerminalIsBlocked = 'construct:terminal:isBlocked',

	// Memory channels
	MemoryAdd = 'construct:memory:add',
	MemorySearch = 'construct:memory:search',
	MemoryGetProfile = 'construct:memory:getProfile',
	MemoryGetRecent = 'construct:memory:getRecent',

	// AI / LLM channels
	AiChat = 'construct:ai:chat',
	AiSwitchProvider = 'construct:ai:switchProvider',
	AiSetActiveModel = 'construct:ai:setActiveModel',
	AiListModels = 'construct:ai:listModels',

	// MCP channels
	McpInitialize = 'construct:mcp:initialize',
	McpReadFile = 'construct:mcp:readFile',
	McpWriteFile = 'construct:mcp:writeFile',
	McpListDirectory = 'construct:mcp:listDirectory',

	// Key / Security channels
	KeySet = 'construct:key:set',
	KeyGet = 'construct:key:get',
	KeyDelete = 'construct:key:delete',

	// Onboarding channels
	OnboardingCheckOllama = 'construct:onboarding:checkOllama',
	OnboardingSelectModel = 'construct:onboarding:selectModel',
	OnboardingFinish = 'construct:onboarding:finish',

	// Browser automation channels
	BrowserCreateSession = 'construct:browser:createSession',
	BrowserNavigate = 'construct:browser:navigate',
	BrowserScreenshot = 'construct:browser:screenshot',
	BrowserCloseSession = 'construct:browser:closeSession',
}

/**
 * SEC-2: Validate that an IPC sender frame is from a trusted origin.
 * Only vscode-webview:// and the known construct origin are allowed.
 */
export function isConstructTrustedSender(senderFrameUrl: string): boolean {
	if (senderFrameUrl.startsWith('vscode-webview://')) {
		return true;
	}
	// Allow construct's own extension host origin
	if (senderFrameUrl.startsWith('vscode-file://')) {
		return true;
	}
	return false;
}
