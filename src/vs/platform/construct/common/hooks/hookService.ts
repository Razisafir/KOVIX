/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';

export const IHookService = createDecorator<IHookService>('construct.hookService');

/**
 * Events that hooks can be registered for.
 */
export type HookEvent =
	| 'beforeToolExecution'
	| 'afterToolExecution'
	| 'beforePlanGeneration'
	| 'afterPlanApproval'
	| 'onError'
	| 'onTaskComplete';

/**
 * Context passed to hooks when they are executed.
 */
export interface HookContext {
	/** The event that triggered the hook */
	event: HookEvent;
	/** The tool name, if applicable */
	toolName?: string;
	/** The tool input, if applicable */
	toolInput?: Record<string, unknown>;
	/** The tool result, if applicable */
	toolResult?: unknown;
	/** The task description, if applicable */
	task?: string;
	/** Error information, if applicable */
	error?: Error;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * A hook callback function.
 * Return true to continue, false to abort the operation.
 */
export type HookCallback = (context: HookContext) => Promise<boolean | void>;

/**
 * A hook definition from .kovix/hooks.json.
 */
export interface IHookDefinition {
	/** The event to hook into */
	event: HookEvent;
	/** A description of what this hook does */
	description: string;
	/** Whether this hook is enabled */
	enabled: boolean;
	/** Hook type */
	type: 'callback' | 'grind_loop' | 'notification';
	/** Configuration for the hook */
	config?: Record<string, unknown>;
}

/**
 * IHookService — manages agent lifecycle hooks.
 *
 * Hooks allow customization of agent behavior at key points:
 * - before/after tool execution
 * - before/after plan generation/approval
 * - on errors
 * - on task completion
 *
 * The "grind loop" pattern: onTaskComplete hook that checks if tests
 * pass, and if not, re-runs the agent with the error context.
 */
export interface IHookService {
	readonly _serviceBrand: undefined;

	/**
	 * Register a hook for a specific event.
	 *
	 * @param event The event to hook into.
	 * @param callback The hook callback function.
	 * @returns Disposable to unregister the hook.
	 */
	registerHook(event: HookEvent, callback: HookCallback): IDisposable;

	/**
	 * Execute all hooks registered for a specific event.
	 * Hooks are executed in registration order.
	 * If any hook returns false, the operation is aborted.
	 *
	 * @param event The event that occurred.
	 * @param context The hook context.
	 * @returns Whether all hooks allowed the operation to proceed.
	 */
	executeHooks(event: HookEvent, context: HookContext): Promise<boolean>;

	/**
	 * Get all registered hooks.
	 */
	getRegisteredHooks(): Map<HookEvent, HookCallback[]>;

	/**
	 * Load hooks from .kovix/hooks.json file.
	 */
	loadHooksFromFile(): Promise<void>;
}

/**
 * Import for the IDisposable return type.
 */
import { IDisposable } from '../../../../base/common/lifecycle.js';
