/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import {
        IHookService, HookEvent, HookCallback, HookContext, IHookDefinition
} from '../../../../../../platform/construct/common/hooks/hookService.js';

export class HookServiceImpl extends Disposable implements IHookService {
        declare readonly _serviceBrand: undefined;

        private hooks: Map<HookEvent, HookCallback[]> = new Map();
        private hookDefinitions: IHookDefinition[] = [];

        constructor(
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
        }

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
                                        this.logService.info(`[HookService] Hook for event "${event}" aborted the operation`);
                                        return false;
                                }
                        } catch (error) {
                                // Handle hook errors gracefully (log but don't crash)
                                this.logService.error(`[HookService] Hook for event "${event}" threw an error:`, error);
                        }
                }

                return true;
        }

        getRegisteredHooks(): Map<HookEvent, HookCallback[]> {
                return new Map(this.hooks);
        }

        async loadHooksFromFile(): Promise<void> {
                const workspace = this.workspaceContextService.getWorkspace();
                if (!workspace.folders.length) { return; }

                try {
                        const hooksFileUri = URI.joinPath(workspace.folders[0].uri, '.kovix', 'hooks.json');
                        const content = await this.fileService.readFile(hooksFileUri);
                        const text = content.value.toString();
                        const config = JSON.parse(text);

                        if (Array.isArray(config.hooks)) {
                                this.hookDefinitions = config.hooks.filter((h: IHookDefinition) => h.enabled !== false);

                                // Register built-in hook implementations for known hook types
                                for (const hookDef of this.hookDefinitions) {
                                        if (hookDef.type === 'grind_loop' && hookDef.event === 'onTaskComplete') {
                                                this.registerGrindLoopHook(hookDef);
                                        } else if (hookDef.type === 'notification' && hookDef.event === 'onError') {
                                                this.registerNotificationHook(hookDef);
                                        }
                                }
                        }

                        this.logService.info(`[HookService] Loaded ${this.hookDefinitions.length} hooks from .kovix/hooks.json`);
                } catch {
                        // .kovix/hooks.json may not exist, that's fine
                }
        }

        private registerGrindLoopHook(hookDef: IHookDefinition): void {
                const maxIterations = typeof hookDef.config?.maxIterations === 'number' ? hookDef.config.maxIterations : 3;
                let iteration = 0;

                this.registerHook('onTaskComplete', async (context: HookContext) => {
                        if (iteration >= maxIterations) {
                                iteration = 0;
                                return true; // Stop grind loop
                        }

                        // Check if tests pass — if the context indicates failure, re-run
                        if (context.metadata?.testsFailed === true || context.error) {
                                iteration++;
                                this.logService.info(`[HookService] Grind loop iteration ${iteration}/${maxIterations}`);

                                // The grind loop re-runs by returning false to signal the task is not complete
                                // The agent loop should handle this by re-running with the error context
                                return false;
                        }

                        iteration = 0;
                        return true;
                });
        }

        private registerNotificationHook(hookDef: IHookDefinition): void {
                this.registerHook('onError', async (context: HookContext) => {
                        this.logService.warn(
                                `[HookService] Error notification: ${context.error?.message ?? 'Unknown error'}`
                        );
                        return true;
                });
        }
}
