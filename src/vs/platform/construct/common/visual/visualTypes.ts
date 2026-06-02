/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Visual / 3D Types and Interfaces
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// ─── Agent Type Enums ──────────────────────────────────────────────────────

export const enum VisualAgentType {
        THREE_JS = 'threejs',
        BLENDER = 'blender',
        FIGMA = 'figma',
        VISUAL_REVIEWER = 'visual-reviewer'
}

// ─── 3D Scene Types ────────────────────────────────────────────────────────

export const enum Object3DType {
        Mesh = 'mesh',
        Light = 'light',
        Camera = 'camera',
        Group = 'group'
}

export interface I3DTransform {
        readonly position: { x: number; y: number; z: number };
        readonly rotation: { x: number; y: number; z: number };
        readonly scale: { x: number; y: number; z: number };
}

export interface I3DGeometry {
        readonly type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'custom';
        readonly params: Record<string, number>;
}

export interface I3DMaterial {
        readonly id: string;
        readonly name: string;
        readonly type: 'standard' | 'phong' | 'lambert' | 'physical' | 'basic' | 'shader';
        readonly color?: string;
        readonly emissive?: string;
        readonly metalness?: number;
        readonly roughness?: number;
        readonly opacity?: number;
        readonly transparent?: boolean;
        readonly wireframe?: boolean;
        readonly map?: string; // texture URL
        readonly normalMap?: string;
        readonly roughnessMap?: string;
        readonly metalnessMap?: string;
}

export interface I3DObject {
        id: string;
        name: string;
        type: Object3DType;
        geometry?: I3DGeometry;
        material?: I3DMaterial;
        transform: I3DTransform;
        children: I3DObject[];
        visible: boolean;
        castShadow: boolean;
        receiveShadow: boolean;
}

export interface I3DLighting {
        readonly ambientColor: string;
        readonly ambientIntensity: number;
        readonly directionalColor: string;
        readonly directionalIntensity: number;
        readonly directionalPosition: { x: number; y: number; z: number };
}

export interface I3DCamera {
        readonly type: 'perspective' | 'orthographic';
        readonly fov: number;
        readonly near: number;
        readonly far: number;
        readonly position: { x: number; y: number; z: number };
        readonly lookAt: { x: number; y: number; z: number };
}

export interface I3DAnimation {
        readonly id: string;
        readonly name: string;
        readonly targetObjectId: string;
        readonly property: string;
        readonly keyframes: Array<{
                readonly time: number;
                readonly value: number | { x: number; y: number; z: number };
                readonly easing?: string;
        }>;
        readonly duration: number;
        readonly loop: boolean;
}

export interface I3DScene {
        readonly id: string;
        readonly name: string;
        readonly projectId: string;
        objects: I3DObject[];
        materials: I3DMaterial[];
        animations: I3DAnimation[];
        lighting: I3DLighting;
        camera: I3DCamera;
        readonly createdAt: number;
        updatedAt: number;
}

// ─── Figma Design Types ────────────────────────────────────────────────────

export interface IFigmaStyles {
        colors: Record<string, string>;
        typography: Record<string, { fontFamily: string; fontWeight: number; fontSize: number; lineHeight: number }>;
        spacing: Record<string, number>;
        effects: Record<string, { type: string; radius: number; color: string; offset: { x: number; y: number } }>;
}

export interface IFigmaExportSettings {
        readonly format: 'svg' | 'png' | 'jpg';
        readonly scale: number;
        readonly suffix?: string;
}

export interface IFigmaComponent {
        readonly id: string;
        readonly name: string;
        readonly type: string;
        readonly bounds: { x: number; y: number; width: number; height: number };
        readonly styles: Record<string, string>;
        readonly children: IFigmaComponent[];
        readonly exportSettings?: IFigmaExportSettings[];
}

export interface IFigmaPage {
        readonly id: string;
        readonly name: string;
        readonly components: IFigmaComponent[];
        readonly thumbnail?: string; // base64
}

export interface IFigmaDesign {
        readonly fileId: string;
        readonly name: string;
        readonly pages: IFigmaPage[];
        readonly styles: IFigmaStyles;
        readonly lastModified: number;
}

// ─── Visual Preview & Diff ─────────────────────────────────────────────────

export interface IVisualPreview {
        readonly sessionId: string;
        readonly screenshot?: string; // base64
        readonly liveUrl?: string;
        readonly fps?: number;
        readonly drawCalls?: number;
        readonly memoryMB?: number;
        readonly timestamp: number;
}

export interface IVisualDiff {
        readonly before: IVisualPreview;
        readonly after: IVisualPreview;
        readonly diffScore: number; // 0-100, lower = more similar
        readonly diffImage?: string; // base64
}

// ─── Agent Config ──────────────────────────────────────────────────────────

export interface IVisualAgentConfig {
        readonly agentType: VisualAgentType;
        readonly model?: string;
        readonly systemPrompt?: string;
        readonly tools?: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const THREEJS_MCP_NAME = 'threejs-server';
export const BLENDER_MCP_NAME = 'blender-mcp';
export const FIGMA_MCP_NAME = 'figma-mcp';

export const VISUAL_PREVIEW_SESSION_PREFIX = 'visual-preview-';
export const FIGMA_TOKEN_KEY = 'construct.visual.figmaAccessToken';

export const DEFAULT_SCENE_LIGHTING: I3DLighting = {
        ambientColor: '#404040',
        ambientIntensity: 0.6,
        directionalColor: '#ffffff',
        directionalIntensity: 0.8,
        directionalPosition: { x: 5, y: 10, z: 7 }
};

export const DEFAULT_SCENE_CAMERA: I3DCamera = {
        type: 'perspective',
        fov: 75,
        near: 0.1,
        far: 1000,
        position: { x: 0, y: 5, z: 10 },
        lookAt: { x: 0, y: 0, z: 0 }
};
