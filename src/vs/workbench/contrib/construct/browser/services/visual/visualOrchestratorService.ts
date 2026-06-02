/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Visual Orchestrator Service
 *  Coordinates Three.js, Blender, Figma, and Visual Reviewer agents.
 *  Routes tasks from AgentPoolService to the appropriate visual agent.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IBrowserAutomationService } from '../../../../platform/construct/common/mcp/browserAutomation.js';
import {
        IVisualAgentManager,
        I3DScene,
        I3DObject,
        I3DMaterial,
        I3DAnimation,
        IFigmaDesign,
        IVisualPreview,
        IVisualDiff
} from '../../../../platform/construct/common/visual/visualAgentManager.js';
import {
        VisualAgentType
} from '../../../../platform/construct/common/visual/visualTypes.js';
import { ThreeJsAgentService } from './threeJsAgentService.js';
import { FigmaAgentService } from './figmaAgentService.js';
import { VisualPreviewService } from './visualPreviewService.js';

// ─── Task Routing ──────────────────────────────────────────────────────────

interface IVisualTask {
        readonly id: string;
        readonly type: VisualAgentType;
        readonly action: string;
        readonly params: Record<string, unknown>;
        readonly createdAt: number;
        status: 'pending' | 'running' | 'completed' | 'failed';
        result?: unknown;
        error?: string;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class VisualOrchestratorService extends Disposable implements IVisualAgentManager {
        readonly _serviceBrand: undefined;

        private readonly threeJsAgent: ThreeJsAgentService;
        private readonly figmaAgent: FigmaAgentService;
        private readonly previewService: VisualPreviewService;

        private readonly tasks = new Map<string, IVisualTask>();
        private nextTaskId = 0;

        // --- Events -----------------------------------------------------------

        private readonly _onSceneChange = this._register(new Emitter<I3DScene>());
        readonly onSceneChange = this._onSceneChange.event;

        private readonly _onDesignLoad = this._register(new Emitter<IFigmaDesign>());
        readonly onDesignLoad = this._onDesignLoad.event;

        private readonly _onPreviewUpdate = this._register(new Emitter<IVisualPreview>());
        readonly onPreviewUpdate = this._onPreviewUpdate.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IMCPServerManager mcpServerManager: IMCPServerManager,
                @IBrowserAutomationService browserService: IBrowserAutomationService
        ) {
                super();

                // Instantiate sub-agents
                this.threeJsAgent = this._register(new ThreeJsAgentService(logService, mcpServerManager));
                this.figmaAgent = this._register(new FigmaAgentService(logService, mcpServerManager));
                this.previewService = this._register(new VisualPreviewService(logService, browserService));
        }

        // =======================================================================
        // IVisualAgentManager - 3D Scene Management
        // =======================================================================

        async create3DScene(name: string, projectId?: string): Promise<I3DScene> {
                const scene = await this.threeJsAgent.create3DScene(name, projectId);
                this._onSceneChange.fire(scene);
                return scene;
        }

        async addObject(sceneId: string, object: I3DObject): Promise<void> {
                await this.threeJsAgent.addObject(sceneId, object);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async removeObject(sceneId: string, objectId: string): Promise<void> {
                await this.threeJsAgent.removeObject(sceneId, objectId);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async updateTransform(sceneId: string, objectId: string, transform: Partial<I3DObject['transform']>): Promise<void> {
                await this.threeJsAgent.updateTransform(sceneId, objectId, transform);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async setMaterial(sceneId: string, objectId: string, material: I3DMaterial): Promise<void> {
                await this.threeJsAgent.setMaterial(sceneId, objectId, material);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async addAnimation(sceneId: string, animation: I3DAnimation): Promise<void> {
                await this.threeJsAgent.addAnimation(sceneId, animation);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async setLighting(sceneId: string, lighting: Partial<I3DScene['lighting']>): Promise<void> {
                await this.threeJsAgent.setLighting(sceneId, lighting);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async setCamera(sceneId: string, camera: Partial<I3DScene['camera']>): Promise<void> {
                await this.threeJsAgent.setCamera(sceneId, camera);
                const scene = this.threeJsAgent.getScene(sceneId);
                if (scene) { this._onSceneChange.fire(scene); }
        }

        async exportScene(sceneId: string, format: 'gltf' | 'obj' | 'fbx'): Promise<string> {
                return this.threeJsAgent.exportScene(sceneId, format);
        }

        getScene(sceneId: string): I3DScene | undefined {
                return this.threeJsAgent.getScene(sceneId);
        }

        getAllScenes(): I3DScene[] {
                return this.threeJsAgent.getAllScenes();
        }

        // =======================================================================
        // IVisualAgentManager - Figma Integration
        // =======================================================================

        async loadFigmaDesign(fileId: string): Promise<IFigmaDesign> {
                const design = await this.figmaAgent.loadFigmaDesign(fileId);
                this._onDesignLoad.fire(design);
                return design;
        }

        async extractStyles(design: IFigmaDesign): Promise<Record<string, unknown>> {
                return this.figmaAgent.extractStyles(design);
        }

        async generateReactComponents(design: IFigmaDesign): Promise<string[]> {
                return this.figmaAgent.generateReactComponents(design);
        }

        async exportFigmaAsset(fileId: string, nodeId: string, format: 'svg' | 'png' | 'jpg'): Promise<string> {
                return this.figmaAgent.exportFigmaAsset(fileId, nodeId, format);
        }

        // =======================================================================
        // IVisualAgentManager - Visual Preview
        // =======================================================================

        async takeVisualPreview(sessionId: string): Promise<IVisualPreview> {
                const preview = await this.previewService.takeVisualPreview(sessionId);
                this._onPreviewUpdate.fire(preview);
                return preview;
        }

        async compareVisuals(beforeId: string, afterId: string): Promise<IVisualDiff> {
                return this.previewService.compareVisuals(beforeId, afterId);
        }

        // =======================================================================
        // Task Routing (for Multi-Agent integration from Phase 20)
        // =======================================================================

        /**
         * Route a visual task to the appropriate agent based on type.
         * Used by AgentPoolService (Phase 20) for parallel visual tasks.
         */
        async routeTask(taskType: VisualAgentType, action: string, params: Record<string, unknown>): Promise<unknown> {
                const taskId = `visual-task-${++this.nextTaskId}`;
                const task: IVisualTask = {
                        id: taskId,
                        type: taskType,
                        action,
                        params,
                        createdAt: Date.now(),
                        status: 'running'
                };
                this.tasks.set(taskId, task);

                this.logService.info(`[VisualOrchestrator] Routing task ${taskId}: ${taskType}/${action}`);

                try {
                        let result: unknown;

                        switch (taskType) {
                                case VisualAgentType.THREE_JS:
                                        result = await this.routeThreeJsTask(action, params);
                                        break;
                                case VisualAgentType.FIGMA:
                                        result = await this.routeFigmaTask(action, params);
                                        break;
                                case VisualAgentType.VISUAL_REVIEWER:
                                        result = await this.routeReviewerTask(action, params);
                                        break;
                                case VisualAgentType.BLENDER:
                                        // Blender MCP server is not yet implemented; placeholder
                                        this.logService.warn('[VisualOrchestrator] Blender agent not yet implemented');
                                        result = { error: 'Blender agent not yet implemented', action };
                                        break;
                                default:
                                        throw new Error(`Unknown visual agent type: ${taskType}`);
                        }

                        task.status = 'completed';
                        task.result = result;
                        return result;
                } catch (error) {
                        task.status = 'failed';
                        task.error = error instanceof Error ? error.message : String(error);
                        this.logService.error(`[VisualOrchestrator] Task ${taskId} failed: ${task.error}`);
                        throw error;
                }
        }

        getTaskStatus(taskId: string): IVisualTask | undefined {
                return this.tasks.get(taskId);
        }

        // =======================================================================
        // Private Task Routers
        // =======================================================================

        private async routeThreeJsTask(action: string, params: Record<string, unknown>): Promise<unknown> {
                switch (action) {
                        case 'createScene':
                                return this.create3DScene(
                                        params.name as string,
                                        params.projectId as string | undefined
                                );
                        case 'addObject':
                                return this.addObject(
                                        params.sceneId as string,
                                        params.object as I3DObject
                                );
                        case 'setMaterial':
                                return this.setMaterial(
                                        params.sceneId as string,
                                        params.objectId as string,
                                        params.material as I3DMaterial
                                );
                        case 'exportScene':
                                return this.exportScene(
                                        params.sceneId as string,
                                        (params.format ?? 'gltf') as 'gltf' | 'obj' | 'fbx'
                                );
                        default:
                                throw new Error(`Unknown Three.js action: ${action}`);
                }
        }

        private async routeFigmaTask(action: string, params: Record<string, unknown>): Promise<unknown> {
                switch (action) {
                        case 'loadDesign':
                                return this.loadFigmaDesign(params.fileId as string);
                        case 'extractStyles':
                                return this.extractStyles(params.design as IFigmaDesign);
                        case 'generateComponents':
                                return this.generateReactComponents(params.design as IFigmaDesign);
                        default:
                                throw new Error(`Unknown Figma action: ${action}`);
                }
        }

        private async routeReviewerTask(action: string, params: Record<string, unknown>): Promise<unknown> {
                switch (action) {
                        case 'takePreview':
                                return this.takeVisualPreview(params.sessionId as string);
                        case 'compareVisuals':
                                return this.compareVisuals(
                                        params.beforeId as string,
                                        params.afterId as string
                                );
                        default:
                                throw new Error(`Unknown Visual Reviewer action: ${action}`);
                }
        }

        dispose(): void {
                this.tasks.clear();
                super.dispose();
        }
}
