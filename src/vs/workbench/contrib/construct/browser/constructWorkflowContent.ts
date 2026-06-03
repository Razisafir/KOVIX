/*---------------------------------------------------------------------------------------------
 *  Construct IDE — MVP Webview Handler Registration
 *  5 engine handlers + event forwarders. No pricing, no GOD mode.
 *
 *  MVP: Agent run/cancel, MCP server management, terminal execution,
 *  file operations, and settings. All handlers wire directly to engine services.
 *--------------------------------------------------------------------------------------------*/

import { IAnthropicProviderService } from '../../../../platform/construct/common/anthropicProvider.js';
import { IMCPProcessService } from '../../../../platform/construct/common/mcpProcess.js';
import { IAgentLoopService } from '../../../../platform/construct/common/agentLoop.js';
import { ITerminalExecutorService } from '../../../../platform/construct/common/terminalExecutor.js';
import { IDiffApplierService } from '../../../../platform/construct/common/diffApplier.js';

/**
 * Register all webview message handlers for the Construct IDE MVP.
 *
 * Call this from the ConstructAgentViewPane after the webview is ready.
 * Each handler receives a message payload and returns a serialisable result
 * that is posted back to the webview.
 */
export function registerAllHandlers(
	anthropicProvider: IAnthropicProviderService,
	mcpProcess: IMCPProcessService,
	agentLoop: IAgentLoopService,
	terminalExecutor: ITerminalExecutorService,
	diffApplier: IDiffApplierService,
	postMessage: (channel: string, data: unknown) => void,
): Map<string, (payload: any) => Promise<unknown> | unknown> {
	const handlers = new Map<string, (payload: any) => Promise<unknown> | unknown>();

	// ══════════════════════════════════════════════════════════
	// Chat / Agent Handlers
	// ══════════════════════════════════════════════════════════

	/** Send a chat message to the agent loop */
	handlers.set('chat:sendMessage', async (payload: { message: string }) => {
		return agentLoop.processMessage(payload.message);
	});

	/** Cancel the running agent loop */
	handlers.set('chat:cancel', () => {
		agentLoop.cancel();
		return { cancelled: true };
	});

	/** Get current agent state */
	handlers.set('chat:getState', () => {
		return agentLoop.getState();
	});

	/** Get conversation history */
	handlers.set('chat:getHistory', () => {
		return agentLoop.getConversationHistory();
	});

	/** Get agent state (alias) */
	handlers.set('agent:getState', () => {
		return agentLoop.getState();
	});

	// ══════════════════════════════════════════════════════════
	// MCP Server Handlers
	// ══════════════════════════════════════════════════════════

	/** List all MCP server statuses */
	handlers.set('mcp:listServers', () => {
		return mcpProcess.getAllServerStatuses();
	});

	/** Start an MCP server */
	handlers.set('mcp:startServer', async (payload: { serverId: string }) => {
		const config = mcpProcess.getServers().find(s => s.id === payload.serverId);
		if (config) {
			await mcpProcess.startServer(config);
			return { success: true };
		}
		return { success: false, error: `Server config not found: ${payload.serverId}` };
	});

	/** Stop an MCP server */
	handlers.set('mcp:stopServer', async (payload: { serverId: string }) => {
		await mcpProcess.stopServer(payload.serverId);
		return { success: true };
	});

	/** List all available MCP tools */
	handlers.set('mcp:listTools', () => {
		return mcpProcess.getAllTools();
	});

	// ══════════════════════════════════════════════════════════
	// Terminal Handlers
	// ══════════════════════════════════════════════════════════

	/** Execute a terminal command */
	handlers.set('terminal:execute', async (payload: { command: string; cwd?: string; timeout?: number }) => {
		return terminalExecutor.execute(payload.command, payload.cwd, payload.timeout);
	});

	/** Check if a command is running */
	handlers.set('terminal:isRunning', () => {
		return terminalExecutor.isRunning();
	});

	// ══════════════════════════════════════════════════════════
	// File / Diff Handlers
	// ══════════════════════════════════════════════════════════

	/** Apply a diff to a file (old content → new content) */
	handlers.set('file:applyDiff', async (payload: { filePath: string; oldContent: string; newContent: string }) => {
		return diffApplier.applyDiff(payload.filePath, payload.oldContent, payload.newContent);
	});

	/** Read a file */
	handlers.set('file:read', async (payload: { filePath: string }) => {
		try {
			const content = await diffApplier.readFile(payload.filePath);
			return { success: true, content };
		} catch (error) {
			return { success: false, error: (error as Error).message };
		}
	});

	/** Write a file */
	handlers.set('file:write', async (payload: { filePath: string; content: string }) => {
		return diffApplier.writeFile(payload.filePath, payload.content);
	});

	/** Create a new file */
	handlers.set('file:create', async (payload: { filePath: string; content: string }) => {
		return diffApplier.createFile(payload.filePath, payload.content);
	});

	/** Delete a file */
	handlers.set('file:delete', async (payload: { filePath: string }) => {
		return diffApplier.deleteFile(payload.filePath);
	});

	/** Rollback last change to a file */
	handlers.set('file:rollback', async (payload: { filePath: string }) => {
		const success = await diffApplier.rollback(payload.filePath);
		return { success };
	});

	/** Get pending changes */
	handlers.set('file:getPendingChanges', () => {
		const changes = diffApplier.getPendingChanges();
		return Array.from(changes.entries()).map(([key, value]) => [key, value]);
	});

	// ══════════════════════════════════════════════════════════
	// Settings Handlers
	// ══════════════════════════════════════════════════════════

	/** Get API key status */
	handlers.set('settings:getApiKey', () => {
		return anthropicProvider.getApiKeyStatus();
	});

	/** Set API key */
	handlers.set('settings:setApiKey', async (payload: { apiKey: string }) => {
		await anthropicProvider.setApiKey(payload.apiKey);
		return { success: true };
	});

	/** Get active model */
	handlers.set('settings:getModel', () => {
		return { model: anthropicProvider.getActiveModel() };
	});

	/** Set active model */
	handlers.set('settings:setModel', (payload: { model: string }) => {
		anthropicProvider.setActiveModel(payload.model);
		return { success: true };
	});

	/** Get available models */
	handlers.set('settings:getModels', () => {
		return { models: anthropicProvider.getAvailableModels() };
	});

	/** Test LLM connection */
	handlers.set('settings:testConnection', async () => {
		try {
			const response = await anthropicProvider.sendMessage(
				[{ role: 'user', content: 'Say "OK" and nothing else.' }],
				{ maxTokens: 10 },
			);
			const text = response.content.find(b => b.type === 'text')?.text ?? 'Connected';
			return { success: true, message: text };
		} catch (error) {
			return { success: false, error: (error as Error).message };
		}
	});

	// ══════════════════════════════════════════════════════════
	// Event Forwarders — Subscribe to service events, post to webview
	// ══════════════════════════════════════════════════════════

	agentLoop.onStateChange((state) => postMessage('agent:stateChanged', { state }));
	agentLoop.onMessage((msg) => postMessage('chat:message', msg));
	agentLoop.onToolCall((tc) => postMessage('agent:toolCall', tc));
	agentLoop.onToolResult((tr) => postMessage('agent:toolResult', tr));
	mcpProcess.onDidChangeServerState((e) => postMessage('mcp:serverStateChanged', e));
	mcpProcess.onDidServerError((e) => postMessage('mcp:serverError', e));
	terminalExecutor.onOutput((e) => postMessage('terminal:output', e));
	terminalExecutor.onComplete((e) => postMessage('terminal:complete', e));
	diffApplier.onDidChangeFile((e) => postMessage('file:changed', e));

	return handlers;
}
