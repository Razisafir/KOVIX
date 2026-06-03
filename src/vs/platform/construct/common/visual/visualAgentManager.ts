/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Visual Agent Manager Interface
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	I3DScene,
	I3DObject,
	I3DMaterial,
	I3DAnimation,
	IFigmaDesign,
	IVisualPreview,
	IVisualDiff
} from './visualTypes.js';

export const IVisualAgentManager = createDecorator<IVisualAgentManager>('construct.visualAgentManager');

export interface IVisualAgentManager extends IDisposable {
	readonly _serviceBrand: undefined;

	// ─── 3D Scene Management ────────────────────────────────────────────

	/** Create a new 3D scene. Auto-installs Three.js MCP server if needed. */
	create3DScene(name: string, projectId?: string): Promise<I3DScene>;

	/** Add a 3D object to an existing scene. */
	addObject(sceneId: string, object: I3DObject): Promise<void>;

	/** Remove an object from a scene by its ID. */
	removeObject(sceneId: string, objectId: string): Promise<void>;

	/** Update the transform (position, rotation, scale) of an object. */
	updateTransform(sceneId: string, objectId: string, transform: Partial<I3DObject['transform']>): Promise<void>;

	/** Set or update the material on an object. */
	setMaterial(sceneId: string, objectId: string, material: I3DMaterial): Promise<void>;

	/** Add an animation to a scene. */
	addAnimation(sceneId: string, animation: I3DAnimation): Promise<void>;

	/** Update scene lighting configuration. */
	setLighting(sceneId: string, lighting: Partial<I3DScene['lighting']>): Promise<void>;

	/** Update scene camera configuration. */
	setCamera(sceneId: string, camera: Partial<I3DScene['camera']>): Promise<void>;

	/** Export a scene to the specified format. Returns file path or base64. */
	exportScene(sceneId: string, format: 'gltf' | 'obj' | 'fbx'): Promise<string>;

	/** Get a scene by ID. */
	getScene(sceneId: string): I3DScene | undefined;

	/** List all scenes. */
	getAllScenes(): I3DScene[];

	// ─── Figma Design Integration ───────────────────────────────────────

	/** Load a Figma design file. Requires FIGMA_ACCESS_TOKEN in SecretStorage. */
	loadFigmaDesign(fileId: string): Promise<IFigmaDesign>;

	/** Extract styles from a Figma design (colors, typography, spacing). */
	extractStyles(design: IFigmaDesign): Promise<Record<string, unknown>>;

	/** Generate React/Tailwind components from a Figma design. Returns file paths. */
	generateReactComponents(design: IFigmaDesign): Promise<string[]>;

	/** Export a Figma node as an image asset. */
	exportFigmaAsset(fileId: string, nodeId: string, format: 'svg' | 'png' | 'jpg'): Promise<string>;

	// ─── Visual Preview & Comparison ────────────────────────────────────

	/** Take a visual preview (screenshot + performance metrics) of a session. */
	takeVisualPreview(sessionId: string): Promise<IVisualPreview>;

	/** Compare two visual previews and return a diff score. */
	compareVisuals(beforeId: string, afterId: string): Promise<IVisualDiff>;

	// ─── Events ─────────────────────────────────────────────────────────

	/** Fired when a scene is created, modified, or deleted. */
	readonly onSceneChange: Event<I3DScene>;

	/** Fired when a Figma design is loaded. */
	readonly onDesignLoad: Event<IFigmaDesign>;

	/** Fired when a visual preview is updated. */
	readonly onPreviewUpdate: Event<IVisualPreview>;
}
