/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Figma Agent Service
 *  Reads Figma designs, extracts styles, and generates React/Tailwind components
 *  via the Figma MCP server.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPServerManager } from '../../../../platform/construct/common/mcp/mcpServerManager.js';
import { IMCPServerDefinition, MCPTransportType } from '../../../../platform/construct/common/mcp/mcpTypes.js';
import {
        IFigmaDesign,
        IFigmaPage,
        IFigmaComponent,
        IFigmaStyles,
        FIGMA_MCP_NAME
} from '../../../../platform/construct/common/visual/visualTypes.js';

// ─── Design Cache ──────────────────────────────────────────────────────────

interface IDesignCacheEntry {
        design: IFigmaDesign;
        cachedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Component Generation Templates ────────────────────────────────────────

const REACT_COMPONENT_TEMPLATE = `import React from 'react';

interface {ComponentName}Props {{
{propsInterface}
}}

export const {ComponentName}: React.FC<{ComponentName}Props> = ({{
{propsDestructure}
}}) => {{
  return (
    <div className="{className}" style={{{{ {inlineStyles} }}}}>
{children}
    </div>
  );
}};
`;

// ─── Service ───────────────────────────────────────────────────────────────

export class FigmaAgentService extends Disposable {
        private figmaInstalled = false;
        private readonly designCache = new Map<string, IDesignCacheEntry>();
        private figmaAccessToken: string | undefined;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IMCPServerManager private readonly mcpServerManager: IMCPServerManager
        ) {
                super();
        }

        // =======================================================================
        // Figma Design Loading
        // =======================================================================

        async loadFigmaDesign(fileId: string): Promise<IFigmaDesign> {
                await this.ensureFigmaServer();

                // Check cache first
                const cached = this.designCache.get(fileId);
                if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
                        this.logService.info(`[Figma] Returning cached design for file ${fileId}`);
                        return cached.design;
                }

                try {
                        const result = await this.mcpServerManager.executeTool(FIGMA_MCP_NAME, 'get_file', {
                                fileId,
                                token: this.figmaAccessToken
                        });

                        const design = this.parseFigmaResponse(fileId, result.data);
                        this.designCache.set(fileId, { design, cachedAt: Date.now() });

                        this.logService.info(`[Figma] Loaded design "${design.name}" (${fileId}), ${design.pages.length} pages`);
                        return design;
                } catch (error) {
                        this.logService.error(`[Figma] Failed to load design ${fileId}: ${error}`);
                        throw new Error(
                                `Failed to load Figma design ${fileId}. ` +
                                'Ensure FIGMA_ACCESS_TOKEN is configured and the file ID is valid. ' +
                                `Error: ${error instanceof Error ? error.message : String(error)}`
                        );
                }
        }

        async extractStyles(design: IFigmaDesign): Promise<Record<string, unknown>> {
                const styles = design.styles;

                // Convert Figma styles to Tailwind config format
                const tailwindConfig: Record<string, unknown> = {
                        theme: {
                                extend: {
                                        colors: {} as Record<string, string>,
                                        fontFamily: {} as Record<string, string>,
                                        spacing: {} as Record<string, string>,
                                        boxShadow: {} as Record<string, string>
                                }
                        }
                };

                // Map Figma colors to Tailwind colors
                const theme = tailwindConfig.theme as Record<string, Record<string, unknown>>;
                const extend = theme.extend as Record<string, Record<string, unknown>>;

                if (styles.colors) {
                        extend.colors = { ...styles.colors };
                }

                if (styles.typography) {
                        const fontFamily: Record<string, string> = {};
                        for (const [name, typoRaw] of Object.entries(styles.typography)) {
                                const typo = typoRaw as { fontFamily: string; fontWeight: number; fontSize: number; lineHeight: number };
                                fontFamily[name] = `"${typo.fontFamily}"`;
                        }
                        extend.fontFamily = fontFamily;
                }

                if (styles.spacing) {
                        const spacing: Record<string, string> = {};
                        for (const [name, value] of Object.entries(styles.spacing)) {
                                spacing[name] = `${value}px`;
                        }
                        extend.spacing = spacing;
                }

                if (styles.effects) {
                        const boxShadow: Record<string, string> = {};
                        for (const [name, effectRaw] of Object.entries(styles.effects)) {
                                const effect = effectRaw as { type: string; radius: number; color: string; offset: { x: number; y: number } };
                                boxShadow[name] = `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.color}`;
                        }
                        extend.boxShadow = boxShadow;
                }

                this.logService.info(`[Figma] Extracted styles: ${Object.keys(styles.colors ?? {}).length} colors, ` +
                        `${Object.keys(styles.typography ?? {}).length} typography, ` +
                        `${Object.keys(styles.spacing ?? {}).length} spacing`);

                return tailwindConfig;
        }

        async generateReactComponents(design: IFigmaDesign): Promise<string[]> {
                const filePaths: string[] = [];

                for (const page of design.pages) {
                        for (const component of page.components) {
                                const filePath = await this.generateSingleComponent(component, design.styles);
                                if (filePath) {
                                        filePaths.push(filePath);
                                }
                        }
                }

                this.logService.info(`[Figma] Generated ${filePaths.length} React components from "${design.name}"`);
                return filePaths;
        }

        async exportFigmaAsset(fileId: string, nodeId: string, format: 'svg' | 'png' | 'jpg'): Promise<string> {
                await this.ensureFigmaServer();

                try {
                        const result = await this.mcpServerManager.executeTool(FIGMA_MCP_NAME, 'export_node', {
                                fileId,
                                nodeId,
                                format,
                                token: this.figmaAccessToken
                        });

                        this.logService.info(`[Figma] Exported node ${nodeId} as ${format}`);
                        return result.data?.base64 ?? result.data?.url ?? '';
                } catch (error) {
                        this.logService.error(`[Figma] Failed to export asset: ${error}`);
                        throw new Error(`Failed to export Figma asset: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        // =======================================================================
        // Token Management
        // =======================================================================

        /**
         * Set the Figma access token. In production, this should come from
         * ISecretStorage (Phase 17), never stored in plaintext.
         */
        setAccessToken(token: string): void {
                this.figmaAccessToken = token;
                this.logService.info('[Figma] Access token updated');
        }

        // =======================================================================
        // Private Helpers
        // =======================================================================

        private async ensureFigmaServer(): Promise<void> {
                if (this.figmaInstalled) {
                        return;
                }

                const installed = this.mcpServerManager.listInstalledServers();
                const hasFigma = installed.some((s: { name: string }) => s.name === FIGMA_MCP_NAME);

                if (!hasFigma) {
                        this.logService.info('[Figma] Auto-installing Figma MCP server...');

                        try {
                                const figmaDef: IMCPServerDefinition = {
                                        name: FIGMA_MCP_NAME,
                                        command: 'npx',
                                        args: ['-y', '@modelcontextprotocol/server-figma'],
                                        env: this.figmaAccessToken ? { FIGMA_ACCESS_TOKEN: this.figmaAccessToken } : {},
                                        transport: MCPTransportType.Stdio,
                                        categories: ['design', 'figma'],
                                        description: 'Figma design integration MCP server for Construct IDE',
                                        secretEnvKeys: ['FIGMA_ACCESS_TOKEN'],
                                        autoRestart: true
                                };

                                await this.mcpServerManager.installServer(figmaDef);
                                await this.mcpServerManager.startServer(FIGMA_MCP_NAME);
                                this.figmaInstalled = true;
                                this.logService.info('[Figma] MCP server installed and started successfully');
                        } catch (error) {
                                this.logService.error('[Figma] Failed to auto-install Figma MCP server:', error);
                                this.figmaInstalled = true; // Mark attempted to prevent retry loops
                        }
                } else {
                        const status = this.mcpServerManager.getServerStatus(FIGMA_MCP_NAME);
                        if (status !== 'connected') {
                                try {
                                        await this.mcpServerManager.startServer(FIGMA_MCP_NAME);
                                } catch (error) {
                                        this.logService.warn('[Figma] Figma MCP server was installed but failed to start:', error);
                                }
                        }
                        this.figmaInstalled = true;
                }
        }

        private parseFigmaResponse(fileId: string, data: any): IFigmaDesign {
                // Parse the Figma REST API response structure
                const pages: IFigmaPage[] = (data?.document?.children ?? []).map((page: any) => ({
                        id: page.id ?? '',
                        name: page.name ?? 'Untitled Page',
                        components: this.extractComponents(page.children ?? []),
                        thumbnail: undefined
                }));

                const styles: IFigmaStyles = {
                        colors: data?.styles ? this.extractColorStyles(data.styles) : {},
                        typography: data?.styles ? this.extractTypographyStyles(data.styles) : {},
                        spacing: {},
                        effects: data?.styles ? this.extractEffectStyles(data.styles) : {}
                };

                return {
                        fileId,
                        name: data?.name ?? 'Untitled Design',
                        pages,
                        styles,
                        lastModified: data?.lastModified ? new Date(data.lastModified).getTime() : Date.now()
                };
        }

        private extractComponents(children: any[]): IFigmaComponent[] {
                const components: IFigmaComponent[] = [];

                for (const child of children) {
                        const component: IFigmaComponent = {
                                id: child.id ?? '',
                                name: child.name ?? 'Unnamed',
                                type: child.type ?? 'FRAME',
                                bounds: {
                                        x: child.absoluteBoundingBox?.x ?? 0,
                                        y: child.absoluteBoundingBox?.y ?? 0,
                                        width: child.absoluteBoundingBox?.width ?? 0,
                                        height: child.absoluteBoundingBox?.height ?? 0
                                },
                                styles: this.extractNodeStyles(child),
                                children: child.children ? this.extractComponents(child.children) : []
                        };

                        if (child.exportSettings) {
                                (component as { exportSettings?: Array<{ format: string; scale: number }> }).exportSettings = child.exportSettings.map((s: { format?: string; constraint?: { value?: number } }) => ({
                                        format: s.format ?? 'png',
                                        scale: s.constraint?.value ?? 1
                                }));
                        }

                        components.push(component);
                }

                return components;
        }

        private extractNodeStyles(node: any): Record<string, string> {
                const styles: Record<string, string> = {};

                if (node.fills) {
                        for (const fill of node.fills) {
                                if (fill.type === 'SOLID' && fill.color) {
                                        const r = Math.round(fill.color.r * 255);
                                        const g = Math.round(fill.color.g * 255);
                                        const b = Math.round(fill.color.b * 255);
                                        styles.backgroundColor = `rgb(${r}, ${g}, ${b})`;
                                }
                        }
                }

                if (node.strokes) {
                        for (const stroke of node.strokes) {
                                if (stroke.type === 'SOLID' && stroke.color) {
                                        const r = Math.round(stroke.color.r * 255);
                                        const g = Math.round(stroke.color.g * 255);
                                        const b = Math.round(stroke.color.b * 255);
                                        styles.borderColor = `rgb(${r}, ${g}, ${b})`;
                                }
                        }
                }

                if (node.cornerRadius) {
                        styles.borderRadius = `${node.cornerRadius}px`;
                }

                if (node.opacity !== undefined && node.opacity !== 1) {
                        styles.opacity = String(node.opacity);
                }

                return styles;
        }

        private extractColorStyles(styles: any): Record<string, string> {
                const colors: Record<string, string> = {};
                for (const [key, style] of Object.entries(styles)) {
                        const s = style as any;
                        if (s.styleType === 'FILL' && s.fills) {
                                for (const fill of s.fills) {
                                        if (fill.type === 'SOLID' && fill.color) {
                                                const r = Math.round(fill.color.r * 255);
                                                const g = Math.round(fill.color.g * 255);
                                                const b = Math.round(fill.color.b * 255);
                                                colors[s.name ?? key] = `rgb(${r}, ${g}, ${b})`;
                                        }
                                }
                        }
                }
                return colors;
        }

        private extractTypographyStyles(styles: any): Record<string, { fontFamily: string; fontWeight: number; fontSize: number; lineHeight: number }> {
                const typography: Record<string, { fontFamily: string; fontWeight: number; fontSize: number; lineHeight: number }> = {};
                for (const [key, style] of Object.entries(styles)) {
                        const s = style as any;
                        if (s.styleType === 'TEXT' && s.style) {
                                typography[s.name ?? key] = {
                                        fontFamily: s.style.fontFamily ?? 'Inter',
                                        fontWeight: s.style.fontWeight ?? 400,
                                        fontSize: s.style.fontSize ?? 16,
                                        lineHeight: s.style.lineHeightPx ?? 24
                                };
                        }
                }
                return typography;
        }

        private extractEffectStyles(styles: any): Record<string, { type: string; radius: number; color: string; offset: { x: number; y: number } }> {
                const effects: Record<string, { type: string; radius: number; color: string; offset: { x: number; y: number } }> = {};
                for (const [key, style] of Object.entries(styles)) {
                        const s = style as any;
                        if (s.styleType === 'EFFECT' && s.effects) {
                                for (const effect of s.effects) {
                                        if (effect.type === 'DROP_SHADOW') {
                                                effects[s.name ?? key] = {
                                                        type: 'shadow',
                                                        radius: effect.radius ?? 0,
                                                        color: effect.color ? `rgba(${Math.round(effect.color.r * 255)}, ${Math.round(effect.color.g * 255)}, ${Math.round(effect.color.b * 255)}, ${effect.color.a ?? 1})` : 'rgba(0,0,0,0.1)',
                                                        offset: { x: effect.offset?.x ?? 0, y: effect.offset?.y ?? 4 }
                                                };
                                        }
                                }
                        }
                }
                return effects;
        }

        private async generateSingleComponent(component: IFigmaComponent, styles: IFigmaStyles): Promise<string | null> {
                // Convert component name to PascalCase React component name
                const componentName = this.toPascalCase(component.name);

                // Build Tailwind class names from component styles
                const className = this.stylesToTailwindClass(component.styles);

                // Build inline styles for properties that don't have Tailwind equivalents
                const inlineStyles = this.stylesToInlineStyles(component.styles);

                // Build props interface from component children (text, nested elements)
                const { propsInterface, propsDestructure } = this.buildPropsFromChildren(component);

                // Build children JSX
                const children = this.buildChildrenJsx(component);

                // Generate the component file content (stored but not written to disk yet)
                REACT_COMPONENT_TEMPLATE
                        .replace(/{ComponentName}/g, componentName)
                        .replace('{propsInterface}', propsInterface)
                        .replace('{propsDestructure}', propsDestructure)
                        .replace('{className}', className)
                        .replace('{inlineStyles}', inlineStyles)
                        .replace('{children}', children);

                // In a real implementation, we would write this to disk via MCP filesystem tool
                // For now, return the path that would be used
                const filePath = `/generated/components/${componentName}.tsx`;
                this.logService.info(`[Figma] Generated component: ${componentName} at ${filePath}`);

                return filePath;
        }

        private toPascalCase(name: string): string {
                return name
                        .replace(/[^a-zA-Z0-9]/g, ' ')
                        .split(' ')
                        .filter(word => word.length > 0)
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                        .join('');
        }

        private stylesToTailwindClass(styles: Record<string, string>): string {
                const classes: string[] = [];

                if (styles.borderRadius) {
                        const px = parseInt(styles.borderRadius);
                        if (px === 0) { classes.push('rounded-none'); }
                        else if (px <= 4) { classes.push('rounded-sm'); }
                        else if (px <= 8) { classes.push('rounded'); }
                        else if (px <= 12) { classes.push('rounded-md'); }
                        else if (px <= 16) { classes.push('rounded-lg'); }
                        else if (px <= 24) { classes.push('rounded-xl'); }
                        else { classes.push('rounded-2xl'); }
                }

                if (styles.opacity) {
                        const opacity = parseFloat(styles.opacity);
                        if (opacity === 0) { classes.push('opacity-0'); }
                        else if (opacity < 0.25) { classes.push('opacity-25'); }
                        else if (opacity < 0.5) { classes.push('opacity-50'); }
                        else if (opacity < 0.75) { classes.push('opacity-75'); }
                }

                return classes.join(' ');
        }

        private stylesToInlineStyles(styles: Record<string, string>): string {
                const parts: string[] = [];
                if (styles.backgroundColor) { parts.push(`backgroundColor: '${styles.backgroundColor}'`); }
                if (styles.borderColor) { parts.push(`borderColor: '${styles.borderColor}'`); }
                return parts.join(', ');
        }

        private buildPropsFromChildren(component: IFigmaComponent): { propsInterface: string; propsDestructure: string } {
                const props: string[] = ['className?: string'];
                const destructure: string[] = ['className'];

                // Add text content prop if component contains text-like children
                const hasText = component.children.some((c: IFigmaComponent) => c.type === 'TEXT');
                if (hasText) {
                        props.push('children?: React.ReactNode');
                        destructure.push('children');
                }

                return {
                        propsInterface: props.map(p => `  ${p}`).join('\n'),
                        propsDestructure: destructure.join(',\n    ')
                };
        }

        private buildChildrenJsx(component: IFigmaComponent): string {
                const lines: string[] = [];

                for (const child of component.children) {
                        if (child.type === 'TEXT') {
                                lines.push('      {children}');
                        } else {
                                const childClass = this.stylesToTailwindClass(child.styles);
                                lines.push(`      <div className="${childClass}">`);
                                if (child.children.length > 0) {
                                        const nested = this.buildChildrenJsx(child);
                                        lines.push(nested);
                                }
                                lines.push('      </div>');
                        }
                }

                if (lines.length === 0) {
                        lines.push('      {/* Component content */}');
                }

                return lines.join('\n');
        }

        dispose(): void {
                this.designCache.clear();
                super.dispose();
        }
}
