/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Visual Preview Service
 *  Provides embedded browser preview, live reload, screenshot gallery,
 *  performance overlay, device emulation, and visual regression comparison.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserAutomationService } from '../../../../platform/construct/common/mcp/browserAutomation.js';
import {
        IVisualPreview,
        IVisualDiff,
        VISUAL_PREVIEW_SESSION_PREFIX
} from '../../../../platform/construct/common/visual/visualTypes.js';

// ─── Device Viewport Presets ───────────────────────────────────────────────

const DEVICE_PRESETS: Record<string, { width: number; height: number; label: string }> = {
        mobile: { width: 375, height: 812, label: 'Mobile (iPhone X)' },
        tablet: { width: 768, height: 1024, label: 'Tablet (iPad)' },
        desktop: { width: 1440, height: 900, label: 'Desktop (1440x900)' },
        desktopLg: { width: 1920, height: 1080, label: 'Desktop Large (1920x1080)' }
};

// ─── Internal Preview State ────────────────────────────────────────────────

interface IPreviewState {
        sessionId: string;
        url: string;
        device: string;
        screenshots: IVisualPreview[];
        performanceMetrics: {
                fps: number;
                drawCalls: number;
                memoryMB: number;
        };
        lastUpdated: number;
}

const MAX_SCREENSHOTS_PER_PREVIEW = 20;

// ─── Service ───────────────────────────────────────────────────────────────

export class VisualPreviewService extends Disposable {
        private readonly previews = new Map<string, IPreviewState>();
        private nextPreviewId = 0;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IBrowserAutomationService private readonly browserService: IBrowserAutomationService
        ) {
                super();
        }

        // =======================================================================
        // Preview Management
        // =======================================================================

        async createPreview(url: string, device: string = 'desktop'): Promise<IVisualPreview> {
                const preset = DEVICE_PRESETS[device] ?? DEVICE_PRESETS.desktop;
                const sessionId = `${VISUAL_PREVIEW_SESSION_PREFIX}${++this.nextPreviewId}`;

                // Create browser session with device viewport
                const session = await this.browserService.createSession(url, {
                        width: preset.width,
                        height: preset.height
                });

                const state: IPreviewState = {
                        sessionId: session.id,
                        url,
                        device,
                        screenshots: [],
                        performanceMetrics: { fps: 0, drawCalls: 0, memoryMB: 0 },
                        lastUpdated: Date.now()
                };

                this.previews.set(sessionId, state);

                // Take initial screenshot
                const preview = await this.capturePreview(sessionId);
                this.logService.info(`[VisualPreview] Created preview session ${sessionId} at ${url} (${preset.label})`);

                return preview;
        }

        async takeVisualPreview(sessionId: string): Promise<IVisualPreview> {
                return this.capturePreview(sessionId);
        }

        async compareVisuals(beforeId: string, afterId: string): Promise<IVisualDiff> {
                const beforeState = this.previews.get(beforeId);
                const afterState = this.previews.get(afterId);

                if (!beforeState || !afterState) {
                        throw new Error('Both preview sessions must exist for comparison');
                }

                const beforePreview = beforeState.screenshots.length > 0
                        ? beforeState.screenshots[beforeState.screenshots.length - 1]
                        : await this.capturePreview(beforeId);

                const afterPreview = afterState.screenshots.length > 0
                        ? afterState.screenshots[afterState.screenshots.length - 1]
                        : await this.capturePreview(afterId);

                // Use browser service comparison if both sessions share the same browser session
                const diff = await this.computeVisualDiff(beforePreview, afterPreview);

                this.logService.info(`[VisualPreview] Compared ${beforeId} vs ${afterId}: diff score ${diff.diffScore.toFixed(1)}%`);
                return diff;
        }

        // =======================================================================
        // Device Emulation
        // =======================================================================

        async switchDevice(sessionId: string, device: string): Promise<IVisualPreview> {
                const state = this.getPreviewState(sessionId);

                // Navigate with new viewport (creates new browser session with correct size)
                await this.browserService.navigate(state.sessionId, state.url);

                state.device = device;
                state.lastUpdated = Date.now();

                return this.capturePreview(sessionId);
        }

        getDevicePresets(): Array<{ id: string; width: number; height: number; label: string }> {
                return Object.entries(DEVICE_PRESETS).map(([id, preset]) => ({
                        id,
                        ...preset
                }));
        }

        // =======================================================================
        // Performance Metrics
        // =======================================================================

        async getPerformanceMetrics(sessionId: string): Promise<{ fps: number; drawCalls: number; memoryMB: number }> {
                const state = this.getPreviewState(sessionId);

                // Attempt to extract performance metrics via browser evaluation
                try {
                        const metricsResult = await this.browserService.evaluate(
                                state.sessionId,
                                `(() => {
                                        const perf = window.__construct_perf || {};
                                        return {
                                                fps: perf.fps || 0,
                                                drawCalls: perf.drawCalls || 0,
                                                memoryMB: perf.memoryMB || (performance?.memory?.usedJSHeapSize
                                                        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
                                                        : 0)
                                        };
                                })()`
                        );

                        const metrics = metricsResult as any;
                        state.performanceMetrics = {
                                fps: metrics?.fps ?? 0,
                                drawCalls: metrics?.drawCalls ?? 0,
                                memoryMB: metrics?.memoryMB ?? 0
                        };
                } catch (error) {
                        // Performance metrics not available for non-3D pages
                        this.logService.debug(`[VisualPreview] Performance metrics unavailable for ${sessionId}`);
                }

                return { ...state.performanceMetrics };
        }

        // =======================================================================
        // Screenshot Gallery
        // =======================================================================

        getScreenshotGallery(sessionId: string): IVisualPreview[] {
                const state = this.previews.get(sessionId);
                return state ? [...state.screenshots] : [];
        }

        // =======================================================================
        // Live Reload Support
        // =======================================================================

        async refreshPreview(sessionId: string): Promise<IVisualPreview> {
                const state = this.getPreviewState(sessionId);

                try {
                        await this.browserService.reload(state.sessionId);
                } catch (error) {
                        this.logService.warn(`[VisualPreview] Failed to reload ${sessionId}: ${error}`);
                }

                return this.capturePreview(sessionId);
        }

        // =======================================================================
        // Preview Cleanup
        // =======================================================================

        async closePreview(sessionId: string): Promise<void> {
                const state = this.previews.get(sessionId);
                if (!state) { return; }

                try {
                        await this.browserService.closeSession(state.sessionId);
                } catch (error) {
                        this.logService.warn(`[VisualPreview] Error closing browser session: ${error}`);
                }

                this.previews.delete(sessionId);
                this.logService.info(`[VisualPreview] Closed preview ${sessionId}`);
        }

        // =======================================================================
        // Private Helpers
        // =======================================================================

        private async capturePreview(sessionId: string): Promise<IVisualPreview> {
                const state = this.getPreviewState(sessionId);

                let screenshotBase64: string | undefined;
                let liveUrl: string | undefined;

                try {
                        const screenshot = await this.browserService.screenshot(state.sessionId);
                        screenshotBase64 = screenshot.base64;
                        liveUrl = screenshot.url;
                } catch (error) {
                        this.logService.warn(`[VisualPreview] Screenshot failed for ${sessionId}: ${error}`);
                }

                // Get performance metrics
                const metrics = await this.getPerformanceMetrics(sessionId);

                const preview: IVisualPreview = {
                        sessionId,
                        screenshot: screenshotBase64,
                        liveUrl,
                        fps: metrics.fps,
                        drawCalls: metrics.drawCalls,
                        memoryMB: metrics.memoryMB,
                        timestamp: Date.now()
                };

                // Add to gallery and trim
                state.screenshots.push(preview);
                if (state.screenshots.length > MAX_SCREENSHOTS_PER_PREVIEW) {
                        state.screenshots = state.screenshots.slice(-MAX_SCREENSHOTS_PER_PREVIEW);
                }

                state.lastUpdated = Date.now();
                return preview;
        }

        private async computeVisualDiff(before: IVisualPreview, after: IVisualPreview): Promise<IVisualDiff> {
                // Lightweight diff score based on screenshot payload size comparison
                // In production, this would use pixelmatch or similar for pixel-level diffing
                const beforeSize = before.screenshot?.length ?? 0;
                const afterSize = after.screenshot?.length ?? 0;

                if (beforeSize === 0 && afterSize === 0) {
                        return { before, after, diffScore: 0 };
                }

                const sizeDiff = Math.abs(afterSize - beforeSize);
                const maxSize = Math.max(beforeSize, afterSize, 1);
                const diffScore = Math.min((sizeDiff / maxSize) * 100, 100);

                return {
                        before,
                        after,
                        diffScore
                };
        }

        private getPreviewState(sessionId: string): IPreviewState {
                const state = this.previews.get(sessionId);
                if (!state) {
                        throw new Error(`Visual preview session ${sessionId} not found`);
                }
                return state;
        }

        dispose(): void {
                // Close all preview browser sessions
                for (const state of this.previews.values()) {
                        this.browserService.closeSession(state.sessionId).catch((e: unknown) =>
                                this.logService.warn(`[VisualPreview] Error closing session during dispose: ${e}`)
                        );
                }
                this.previews.clear();
                super.dispose();
        }
}
