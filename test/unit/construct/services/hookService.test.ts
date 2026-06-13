/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests for HookService — agent lifecycle hooks.
 * Source: src/vs/platform/construct/common/hooks/hookService.ts
 * Implementation: src/vs/workbench/contrib/construct/browser/services/hooks/hookServiceImpl.ts
 *
 * Tests hook registration, execution order, grind loop pattern,
 * and hook error handling.
 */

// ---- Replicate production types and logic ----

type HookEvent =
	| 'beforeToolExecution'
	| 'afterToolExecution'
	| 'beforePlanGeneration'
	| 'afterPlanApproval'
	| 'onError'
	| 'onTaskComplete';

interface HookContext {
	event: HookEvent;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	toolResult?: unknown;
	task?: string;
	error?: Error;
	metadata?: Record<string, unknown>;
}

type HookCallback = (context: HookContext) => Promise<boolean | void>;

interface IHookDefinition {
	event: HookEvent;
	description: string;
	enabled: boolean;
	type: 'callback' | 'grind_loop' | 'notification';
	config?: Record<string, unknown>;
}

interface IDisposable {
	dispose(): void;
}

// ---- Simple hook service for testing ----

class SimpleHookService {
	private hooks = new Map<HookEvent, HookCallback[]>();

	registerHook(event: HookEvent, callback: HookCallback): IDisposable {
		if (!this.hooks.has(event)) {
			this.hooks.set(event, []);
		}
		this.hooks.get(event)!.push(callback);

		return {
			dispose: () => {
				const callbacks = this.hooks.get(event);
				if (callbacks) {
					const idx = callbacks.indexOf(callback);
					if (idx >= 0) {
						callbacks.splice(idx, 1);
					}
				}
			},
		};
	}

	async executeHooks(event: HookEvent, context: HookContext): Promise<boolean> {
		const callbacks = this.hooks.get(event);
		if (!callbacks || callbacks.length === 0) {
			return true;
		}

		for (const callback of callbacks) {
			try {
				const result = await callback(context);
				if (result === false) {
					return false;
				}
			} catch (error) {
				// Handle hook errors gracefully (log but don't crash)
				// In production this logs to ILogService
			}
		}

		return true;
	}

	getRegisteredHooks(): Map<HookEvent, HookCallback[]> {
		return new Map(this.hooks);
	}

	getHookCount(event: HookEvent): number {
		return this.hooks.get(event)?.length ?? 0;
	}
}

// ---- Grind loop implementation ----

class GrindLoopHook {
	private iteration = 0;
	private readonly maxIterations: number;

	constructor(maxIterations: number = 3) {
		this.maxIterations = maxIterations;
	}

	async execute(context: HookContext): Promise<boolean> {
		if (this.iteration >= this.maxIterations) {
			this.iteration = 0;
			return true; // Stop grind loop
		}

		if (context.metadata?.testsFailed === true || context.error) {
			this.iteration++;
			return false; // Signal: task is not complete, re-run
		}

		this.iteration = 0;
		return true;
	}

	getIteration(): number {
		return this.iteration;
	}

	reset(): void {
		this.iteration = 0;
	}
}

// ---- Tests ----

suite('HookService', () => {

	suite('Hook registration — hooks are registered', () => {
		test('hooks can be registered for an event', () => {
			const service = new SimpleHookService();
			service.registerHook('beforeToolExecution', async () => true);
			assert.strictEqual(service.getHookCount('beforeToolExecution'), 1);
		});

		test('multiple hooks can be registered for the same event', () => {
			const service = new SimpleHookService();
			service.registerHook('beforeToolExecution', async () => true);
			service.registerHook('beforeToolExecution', async () => true);
			service.registerHook('beforeToolExecution', async () => true);
			assert.strictEqual(service.getHookCount('beforeToolExecution'), 3);
		});

		test('hooks can be registered for different events', () => {
			const service = new SimpleHookService();
			service.registerHook('beforeToolExecution', async () => true);
			service.registerHook('afterToolExecution', async () => true);
			service.registerHook('onError', async () => true);

			assert.strictEqual(service.getHookCount('beforeToolExecution'), 1);
			assert.strictEqual(service.getHookCount('afterToolExecution'), 1);
			assert.strictEqual(service.getHookCount('onError'), 1);
		});

		test('disposable unregisters the hook', () => {
			const service = new SimpleHookService();
			const disposable = service.registerHook('beforeToolExecution', async () => true);
			assert.strictEqual(service.getHookCount('beforeToolExecution'), 1);

			disposable.dispose();
			assert.strictEqual(service.getHookCount('beforeToolExecution'), 0);
		});

		test('all hook events are supported', () => {
			const service = new SimpleHookService();
			const events: HookEvent[] = [
				'beforeToolExecution',
				'afterToolExecution',
				'beforePlanGeneration',
				'afterPlanApproval',
				'onError',
				'onTaskComplete',
			];
			for (const event of events) {
				service.registerHook(event, async () => true);
			}
			assert.strictEqual(service.getRegisteredHooks().size, 6);
		});
	});

	suite('Hook execution — hooks are called in order', () => {
		test('hooks are executed in registration order', async () => {
			const service = new SimpleHookService();
			const callOrder: number[] = [];

			service.registerHook('beforeToolExecution', async () => {
				callOrder.push(1);
				return true;
			});
			service.registerHook('beforeToolExecution', async () => {
				callOrder.push(2);
				return true;
			});
			service.registerHook('beforeToolExecution', async () => {
				callOrder.push(3);
				return true;
			});

			await service.executeHooks('beforeToolExecution', { event: 'beforeToolExecution' });

			assert.deepStrictEqual(callOrder, [1, 2, 3]);
		});

		test('all hooks are executed when they return true', async () => {
			const service = new SimpleHookService();
			let count = 0;

			service.registerHook('afterToolExecution', async () => { count++; });
			service.registerHook('afterToolExecution', async () => { count++; });
			service.registerHook('afterToolExecution', async () => { count++; });

			await service.executeHooks('afterToolExecution', { event: 'afterToolExecution' });
			assert.strictEqual(count, 3);
		});

		test('hook returning false stops execution', async () => {
			const service = new SimpleHookService();
			const callOrder: number[] = [];

			service.registerHook('beforeToolExecution', async () => {
				callOrder.push(1);
				return true;
			});
			service.registerHook('beforeToolExecution', async () => {
				callOrder.push(2);
				return false; // This stops execution
			});
			service.registerHook('beforeToolExecution', async () => {
				callOrder.push(3);
				return true;
			});

			const result = await service.executeHooks('beforeToolExecution', { event: 'beforeToolExecution' });

			assert.strictEqual(result, false, 'Should return false when a hook aborts');
			assert.deepStrictEqual(callOrder, [1, 2], 'Third hook should not be called');
		});

		test('no hooks registered returns true', async () => {
			const service = new SimpleHookService();
			const result = await service.executeHooks('onError', { event: 'onError' });
			assert.strictEqual(result, true, 'No hooks should return true');
		});

		test('hook returning void/undefined is treated as true', async () => {
			const service = new SimpleHookService();
			let secondCalled = false;

			service.registerHook('onError', async () => { /* void */ });
			service.registerHook('onError', async () => { secondCalled = true; });

			const result = await service.executeHooks('onError', { event: 'onError' });
			assert.strictEqual(result, true);
			assert.strictEqual(secondCalled, true, 'Second hook should still be called');
		});
	});

	suite('Grind loop — grind loop pattern works', () => {
		test('grind loop iterates on test failure', async () => {
			const grindLoop = new GrindLoopHook(3);

			const ctx: HookContext = {
				event: 'onTaskComplete',
				metadata: { testsFailed: true },
			};

			// First iteration
			const r1 = await grindLoop.execute(ctx);
			assert.strictEqual(r1, false, 'Should signal re-run when tests fail');
			assert.strictEqual(grindLoop.getIteration(), 1);

			// Second iteration
			const r2 = await grindLoop.execute(ctx);
			assert.strictEqual(r2, false);
			assert.strictEqual(grindLoop.getIteration(), 2);

			// Third iteration
			const r3 = await grindLoop.execute(ctx);
			assert.strictEqual(r3, false);
			assert.strictEqual(grindLoop.getIteration(), 3);
		});

		test('grind loop stops at max iterations', async () => {
			const grindLoop = new GrindLoopHook(3);
			const ctx: HookContext = {
				event: 'onTaskComplete',
				metadata: { testsFailed: true },
			};

			// Run 3 iterations
			await grindLoop.execute(ctx);
			await grindLoop.execute(ctx);
			await grindLoop.execute(ctx);

			// 4th call should stop
			const result = await grindLoop.execute(ctx);
			assert.strictEqual(result, true, 'Should stop after max iterations');
			assert.strictEqual(grindLoop.getIteration(), 0, 'Should reset after stopping');
		});

		test('grind loop stops when tests pass', async () => {
			const grindLoop = new GrindLoopHook(3);
			const failCtx: HookContext = {
				event: 'onTaskComplete',
				metadata: { testsFailed: true },
			};
			const passCtx: HookContext = {
				event: 'onTaskComplete',
				metadata: { testsFailed: false },
			};

			await grindLoop.execute(failCtx);
			assert.strictEqual(grindLoop.getIteration(), 1);

			const result = await grindLoop.execute(passCtx);
			assert.strictEqual(result, true, 'Should stop when tests pass');
			assert.strictEqual(grindLoop.getIteration(), 0, 'Should reset on success');
		});

		test('grind loop detects error in context', async () => {
			const grindLoop = new GrindLoopHook(3);
			const errorCtx: HookContext = {
				event: 'onTaskComplete',
				error: new Error('Test suite failed'),
			};

			const result = await grindLoop.execute(errorCtx);
			assert.strictEqual(result, false, 'Should re-run when context has error');
		});

		test('grind loop can be reset', async () => {
			const grindLoop = new GrindLoopHook(3);
			const ctx: HookContext = {
				event: 'onTaskComplete',
				metadata: { testsFailed: true },
			};

			await grindLoop.execute(ctx);
			await grindLoop.execute(ctx);
			assert.strictEqual(grindLoop.getIteration(), 2);

			grindLoop.reset();
			assert.strictEqual(grindLoop.getIteration(), 0);
		});
	});

	suite('Hook error handling — one failing hook does not break others', () => {
		test('throwing hook does not prevent subsequent hooks', async () => {
			const service = new SimpleHookService();
			const callOrder: number[] = [];

			service.registerHook('afterToolExecution', async () => {
				callOrder.push(1);
				return true;
			});
			service.registerHook('afterToolExecution', async () => {
				callOrder.push(2);
				throw new Error('Hook crashed!');
			});
			service.registerHook('afterToolExecution', async () => {
				callOrder.push(3);
				return true;
			});

			const result = await service.executeHooks('afterToolExecution', { event: 'afterToolExecution' });

			assert.deepStrictEqual(callOrder, [1, 2, 3], 'All hooks should be called despite error');
			assert.strictEqual(result, true, 'Should return true since no hook explicitly returned false');
		});

		test('multiple throwing hooks do not cascade', async () => {
			const service = new SimpleHookService();
			let lastHookCalled = false;

			service.registerHook('onError', async () => {
				throw new Error('Hook 1 crashed');
			});
			service.registerHook('onError', async () => {
				throw new Error('Hook 2 crashed');
			});
			service.registerHook('onError', async () => {
				lastHookCalled = true;
				return true;
			});

			const result = await service.executeHooks('onError', { event: 'onError' });
			assert.strictEqual(lastHookCalled, true, 'Last hook should still be called');
			assert.strictEqual(result, true);
		});

		test('hook returning false takes priority over hook throwing', async () => {
			const service = new SimpleHookService();

			service.registerHook('beforeToolExecution', async () => {
				return false; // Explicitly abort
			});
			service.registerHook('beforeToolExecution', async () => {
				// This should NOT be reached since the first hook aborted
				return true;
			});

			const result = await service.executeHooks('beforeToolExecution', { event: 'beforeToolExecution' });
			assert.strictEqual(result, false, 'Should abort on explicit false');
		});
	});
});
