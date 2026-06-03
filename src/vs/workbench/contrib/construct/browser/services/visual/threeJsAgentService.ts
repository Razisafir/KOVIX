/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Three.js Agent Service
 *  Manages 3D scene creation, modification, and export via the Three.js MCP server.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPServerDefinition, MCPTransportType } from '../../../../platform/construct/common/mcp/mcpTypes.js';
import {
        I3DScene,
        I3DObject,
        I3DMaterial,
        I3DAnimation,
        I3DTransform,
        THREEJS_MCP_NAME,
        DEFAULT_SCENE_LIGHTING,
        DEFAULT_SCENE_CAMERA
} from '../../../../platform/construct/common/visual/visualTypes.js';

// ─── Internal Types ────────────────────────────────────────────────────────

interface ISceneInternal {
        id: string;
        name: string;
        projectId: string;
        objects: I3DObject[];
        materials: I3DMaterial[];
        animations: I3DAnimation[];
        lighting: I3DScene['lighting'];
        camera: I3DScene['camera'];
        createdAt: number;
        updatedAt: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class ThreeJsAgentService extends Disposable {
        private readonly scenes = new Map<string, ISceneInternal>();
        private threeJsInstalled = false;
        private nextSceneId = 0;
        private nextObjectId = 0;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager
        ) {
                super();
        }

        // =======================================================================
        // 3D Scene Management
        // =======================================================================

        async create3DScene(name: string, projectId: string = 'default'): Promise<I3DScene> {
                await this.ensureThreeJsServer();

                const id = `scene-${++this.nextSceneId}`;
                const now = Date.now();

                const scene: ISceneInternal = {
                        id,
                        name,
                        projectId,
                        objects: [],
                        materials: [],
                        animations: [],
                        lighting: { ...DEFAULT_SCENE_LIGHTING },
                        camera: { ...DEFAULT_SCENE_CAMERA },
                        createdAt: now,
                        updatedAt: now
                };

                // Create scene via Three.js MCP server
                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'create_scene', {
                                sceneId: id,
                                name,
                                lighting: scene.lighting,
                                camera: scene.camera
                        });

                        this.scenes.set(id, scene);
                        this.logService.info(`[ThreeJS] Created scene "${name}" (${id}) for project ${projectId}`);
                } catch (error) {
                        this.logService.error(`[ThreeJS] Failed to create scene via MCP: ${error}`);
                        // Store locally anyway for graceful fallback
                        this.scenes.set(id, scene);
                        this.logService.info(`[ThreeJS] Scene "${name}" created in local-only mode (MCP unavailable)`);
                }

                return this.toPublicScene(scene);
        }

        async addObject(sceneId: string, object: I3DObject): Promise<void> {
                const scene = this.getSceneInternal(sceneId);

                // Assign ID if not provided
                if (!object.id) {
                        object = { ...object, id: `obj-${++this.nextObjectId}` };
                }

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'add_mesh', {
                                sceneId,
                                objectId: object.id,
                                type: object.type,
                                geometry: object.geometry,
                                material: object.material,
                                transform: object.transform,
                                name: object.name
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP addObject failed, storing locally: ${error}`);
                }

                scene.objects.push(object);
                scene.updatedAt = Date.now();
                this.logService.info(`[ThreeJS] Added object "${object.name}" (${object.id}) to scene ${sceneId}`);
        }

        async removeObject(sceneId: string, objectId: string): Promise<void> {
                const scene = this.getSceneInternal(sceneId);
                const index = scene.objects.findIndex(o => o.id === objectId);
                if (index === -1) {
                        throw new Error(`Object ${objectId} not found in scene ${sceneId}`);
                }

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'remove_mesh', {
                                sceneId,
                                objectId
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP removeObject failed, updating locally: ${error}`);
                }

                scene.objects.splice(index, 1);
                scene.updatedAt = Date.now();
                this.logService.info(`[ThreeJS] Removed object ${objectId} from scene ${sceneId}`);
        }

        async updateTransform(sceneId: string, objectId: string, transform: Partial<I3DTransform>): Promise<void> {
                const scene = this.getSceneInternal(sceneId);
                const object = scene.objects.find(o => o.id === objectId);
                if (!object) {
                        throw new Error(`Object ${objectId} not found in scene ${sceneId}`);
                }

                const newTransform: I3DTransform = {
                        position: { ...object.transform.position, ...transform.position },
                        rotation: { ...object.transform.rotation, ...transform.rotation },
                        scale: { ...object.transform.scale, ...transform.scale }
                };

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'update_transform', {
                                sceneId,
                                objectId,
                                transform: newTransform
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP updateTransform failed, updating locally: ${error}`);
                }

                object.transform = newTransform;
                scene.updatedAt = Date.now();
        }

        async setMaterial(sceneId: string, objectId: string, material: I3DMaterial): Promise<void> {
                const scene = this.getSceneInternal(sceneId);
                const object = scene.objects.find(o => o.id === objectId);
                if (!object) {
                        throw new Error(`Object ${objectId} not found in scene ${sceneId}`);
                }

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'set_material', {
                                sceneId,
                                objectId,
                                material
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP setMaterial failed, updating locally: ${error}`);
                }

                object.material = material;

                // Track material in scene-level array for re-use
                const existingMatIndex = scene.materials.findIndex(m => m.id === material.id);
                if (existingMatIndex !== -1) {
                        scene.materials[existingMatIndex] = material;
                } else {
                        scene.materials.push(material);
                }

                scene.updatedAt = Date.now();
                this.logService.info(`[ThreeJS] Set material "${material.name}" on object ${objectId}`);
        }

        async addAnimation(sceneId: string, animation: I3DAnimation): Promise<void> {
                const scene = this.getSceneInternal(sceneId);

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'add_animation', {
                                sceneId,
                                animation
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP addAnimation failed, storing locally: ${error}`);
                }

                scene.animations.push(animation);
                scene.updatedAt = Date.now();
                this.logService.info(`[ThreeJS] Added animation "${animation.name}" to scene ${sceneId}`);
        }

        async setLighting(sceneId: string, lighting: Partial<I3DScene['lighting']>): Promise<void> {
                const scene = this.getSceneInternal(sceneId);
                scene.lighting = { ...scene.lighting, ...lighting };

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'add_light', {
                                sceneId,
                                lighting: scene.lighting
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP setLighting failed, updating locally: ${error}`);
                }

                scene.updatedAt = Date.now();
        }

        async setCamera(sceneId: string, camera: Partial<I3DScene['camera']>): Promise<void> {
                const scene = this.getSceneInternal(sceneId);
                scene.camera = { ...scene.camera, ...camera };

                try {
                        await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'set_camera', {
                                sceneId,
                                camera: scene.camera
                        });
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP setCamera failed, updating locally: ${error}`);
                }

                scene.updatedAt = Date.now();
        }

        async exportScene(sceneId: string, format: 'gltf' | 'obj' | 'fbx'): Promise<string> {
                const scene = this.getSceneInternal(sceneId);

                try {
                        const result = await this.mcpServerManager.executeTool(THREEJS_MCP_NAME, 'export_gltf', {
                                sceneId,
                                format
                        });
                        this.logService.info(`[ThreeJS] Exported scene ${sceneId} as ${format}`);
                        return result.data?.path ?? result.data?.base64 ?? '';
                } catch (error) {
                        this.logService.warn(`[ThreeJS] MCP exportScene failed: ${error}`);
                        // Generate a placeholder JSON representation as fallback
                        const fallback = JSON.stringify({
                                format,
                                scene: {
                                        name: scene.name,
                                        objects: scene.objects.length,
                                        materials: scene.materials.length,
                                        animations: scene.animations.length
                                },
                                note: 'Exported in fallback mode - MCP server was unavailable'
                        }, null, 2);
                        return Buffer.from(fallback).toString('base64');
                }
        }

        getScene(sceneId: string): I3DScene | undefined {
                const scene = this.scenes.get(sceneId);
                return scene ? this.toPublicScene(scene) : undefined;
        }

        getAllScenes(): I3DScene[] {
                return Array.from(this.scenes.values()).map((s: ISceneInternal) => this.toPublicScene(s));
        }

        // =======================================================================
        // Private Helpers
        // =======================================================================

        private async ensureThreeJsServer(): Promise<void> {
                if (this.threeJsInstalled) {
                        return;
                }

                const installed = this.mcpServerManager.listInstalledServers();
                const hasThreeJs = installed.some((s: { name: string }) => s.name === THREEJS_MCP_NAME);

                if (!hasThreeJs) {
                        this.logService.info('[ThreeJS] Auto-installing Three.js MCP server...');

                        try {
                                const threeJsDef: IMCPServerDefinition = {
                                        name: THREEJS_MCP_NAME,
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-threejs'],
                                        env: {},
                                        transport: MCPTransportType.Stdio,
                                        categories: ['3d', 'visualization'],
                                        description: 'Three.js 3D rendering MCP server for Construct IDE',
                                        autoRestart: true
                                };

                                await this.mcpServerManager.installServer(threeJsDef);
                                await this.mcpServerManager.startServer(THREEJS_MCP_NAME);
                                this.threeJsInstalled = true;
                                this.logService.info('[ThreeJS] MCP server installed and started successfully');
                        } catch (error) {
                                this.logService.error('[ThreeJS] Failed to auto-install Three.js MCP server:', error);
                                // Don't throw - allow graceful fallback with local-only mode
                                this.threeJsInstalled = true; // Mark as attempted to avoid retry loops
                        }
                } else {
                        const status = this.mcpServerManager.getServerStatus(THREEJS_MCP_NAME);
                        if (status !== 'connected') {
                                try {
                                        await this.mcpServerManager.startServer(THREEJS_MCP_NAME);
                                } catch (error) {
                                        this.logService.warn('[ThreeJS] Three.js MCP server was installed but failed to start:', error);
                                }
                        }
                        this.threeJsInstalled = true;
                }
        }

        private getSceneInternal(sceneId: string): ISceneInternal {
                const scene = this.scenes.get(sceneId);
                if (!scene) {
                        throw new Error(`Scene ${sceneId} not found`);
                }
                return scene;
        }

        private toPublicScene(scene: ISceneInternal): I3DScene {
                return {
                        id: scene.id,
                        name: scene.name,
                        projectId: scene.projectId,
                        objects: scene.objects,
                        materials: scene.materials,
                        animations: scene.animations,
                        lighting: scene.lighting,
                        camera: scene.camera,
                        createdAt: scene.createdAt,
                        updatedAt: scene.updatedAt
                };
        }

        dispose(): void {
                this.scenes.clear();
                super.dispose();
        }
}
