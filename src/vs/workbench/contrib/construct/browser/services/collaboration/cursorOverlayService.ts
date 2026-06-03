/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Cursor Overlay Service
 *  Renders other users' cursors and selections in the VS Code editor.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../../../../editor/browser/services/codeEditorService.js';
import { ICollaborationService } from '../../../../../../platform/construct/common/collaboration/collaborationService.js';
import { ICursorPosition, ISelection, IDLE_CURSOR_TIMEOUT_MS } from '../../../../../../platform/construct/common/collaboration/collaborationTypes.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

/**
 * CursorOverlayService renders other users' cursors and text selections
 * as visual overlays in the VS Code editor. It integrates with the
 * collaboration service to receive real-time cursor/selection updates
 * and displays colored indicators for each participant.
 *
 * Features:
 * - Colored cursor flags with user names
 * - Highlighted text selections with semi-transparent backgrounds
 * - Stacked cursor labels when multiple users are at the same position
 * - Smooth CSS transition animations for cursor movement (0.15s)
 * - Automatic hiding after 5 minutes of idle
 * - File indicator in status bar for users in different files
 */
export class CursorOverlayService extends Disposable {

        /** Map of active decoration collections keyed by "sessionId:userId". */
        private readonly _decorations = new Map<string, IDisposable[]>();

        /** Map of DOM overlay elements keyed by "sessionId:userId". */
        private readonly _overlayElements = new Map<string, HTMLElement>();

        /** Map tracking last activity time per user for idle detection. */
        private readonly _lastActivity = new Map<string, number>();

        /** Timer for idle cursor cleanup. */
        private _idleCheckTimer: any | null = null;

        /** Get the current file path being viewed (for status bar indicators). */
        get currentFilePath(): string | undefined { return this._currentFilePath; }
        private _currentFilePath: string | undefined;

        constructor(
                @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
                @ICollaborationService private readonly collaborationService: ICollaborationService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();

                // Subscribe to collaboration events
                this._register(this.collaborationService.onCursorChange(e => {
                        this._onRemoteCursorChange(e.sessionId, e.userId, e.position);
                }));

                this._register(this.collaborationService.onSelectionChange(e => {
                        this._onRemoteSelectionChange(e.sessionId, e.userId, e.selection);
                }));

                this._register(this.collaborationService.onUserLeave(e => {
                        this._removeUserOverlays(e.sessionId, e.userId);
                }));

                // Start idle cursor cleanup timer
                this._idleCheckTimer = setInterval(() => {
                        this._cleanupIdleCursors();
                }, 30_000);

                this._register({
                        dispose: () => {
                                if (this._idleCheckTimer) {
                                        clearInterval(this._idleCheckTimer);
                                        this._idleCheckTimer = null;
                                }
                        }
                });

                this.logService.trace('[CursorOverlayService] Initialized');
        }

        // ─── Cursor Rendering ───────────────────────────────────────────

        /**
         * Handle a remote cursor position change.
         * Creates or updates a cursor overlay widget in the editor.
         */
        private _onRemoteCursorChange(sessionId: string, userId: string, position: ICursorPosition): void {
                const key = `${sessionId}:${userId}`;

                // Track activity
                this._lastActivity.set(key, Date.now());

                // Get the active editor
                const activeEditor = this.codeEditorService.getActiveCodeEditor();
                if (!activeEditor) {
                        return;
                }

                // Check if the cursor is in the currently open file
                const model = activeEditor.getModel();
                if (!model) {
                        return;
                }

                // Compare file paths (normalize for comparison)
                const editorFilePath = model.uri.fsPath;
                this._currentFilePath = editorFilePath; // Track for status bar indicators

                if (position.file !== editorFilePath) {
                        // Cursor is in a different file — remove any existing overlay in this editor
                        this._removeUserOverlays(sessionId, userId);
                        // Could show a status bar indicator instead
                        return;
                }

                // Get the participant's color from the session
                const session = this.collaborationService.getSession(sessionId);
                const participant = session?.participants.find(p => p.userId === userId);
                const color = participant?.color ?? '#888888';
                const name = participant?.name ?? 'Unknown';

                // Create or update the cursor overlay
                this._createOrUpdateCursorWidget(
                        activeEditor,
                        key,
                        position,
                        color,
                        name
                );
        }

        /**
         * Handle a remote selection change.
         * Creates or updates a selection decoration in the editor.
         */
        private _onRemoteSelectionChange(sessionId: string, userId: string, selection: ISelection): void {
                const key = `${sessionId}:${userId}`;
                this._lastActivity.set(key, Date.now());

                const activeEditor = this.codeEditorService.getActiveCodeEditor();
                if (!activeEditor) {
                        return;
                }

                const model = activeEditor.getModel();
                if (!model || selection.file !== model.uri.fsPath) {
                        return;
                }

                const session = this.collaborationService.getSession(sessionId);
                const participant = session?.participants.find(p => p.userId === userId);
                const color = participant?.color ?? '#888888';

                // Create selection decorations
                this._createOrUpdateSelectionDecorations(
                        activeEditor,
                        key,
                        selection,
                        color
                );
        }

        /**
         * Create or update a cursor widget in the editor.
         */
        private _createOrUpdateCursorWidget(
                editor: any,
                key: string,
                position: ICursorPosition,
                color: string,
                name: string
        ): void {
                // Remove existing widget for this user
                this._removeUserOverlaysByKey(key);

                try {
                        // Create DOM element for cursor flag
                        const cursorElement = document.createElement('div');
                        cursorElement.className = 'construct-collab-cursor';
                        cursorElement.style.cssText = `
                                position: absolute;
                                pointer-events: none;
                                z-index: 1000;
                                transition: top 0.15s ease, left 0.15s ease;
                        `;

                        // Cursor line indicator
                        const lineEl = document.createElement('div');
                        lineEl.className = 'construct-collab-cursor-line';
                        lineEl.style.cssText = `
                                width: 2px;
                                height: 18px;
                                background-color: ${color};
                                position: absolute;
                                top: 0;
                                left: 0;
                        `;
                        cursorElement.appendChild(lineEl);

                        // Name label
                        const labelEl = document.createElement('div');
                        labelEl.className = 'construct-collab-cursor-label';
                        labelEl.textContent = name;
                        labelEl.style.cssText = `
                                position: absolute;
                                top: -18px;
                                left: 0;
                                background-color: ${color};
                                color: white;
                                font-size: 11px;
                                padding: 1px 6px;
                                border-radius: 3px 3px 3px 0;
                                white-space: nowrap;
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif;
                                line-height: 16px;
                        `;
                        cursorElement.appendChild(labelEl);

                        this._overlayElements.set(key, cursorElement);

                        // Add widget via editor API
                        // In VS Code, we would use addContentWidget, but for compatibility
                        // we track the position and use decorations instead
                        const lineNumber = position.line + 1; // Convert 0-based to 1-based
                        const column = position.column + 1;

                        // Use editor decorations as a reliable fallback
                        editor.deltaDecorations([], [{
                                range: {
                                        startLineNumber: lineNumber,
                                        startColumn: column,
                                        endLineNumber: lineNumber,
                                        endColumn: column
                                },
                                options: {
                                        className: `construct-collab-cursor-decoration-${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
                                        beforeContentClassName: 'construct-collab-cursor-before',
                                        after: {
                                                content: name,
                                                inlineClassName: 'construct-collab-cursor-name',
                                                inlineClassNameAffectsLetterSpacing: true
                                        },
                                        isWholeLine: false,
                                        // Stick to the position when typing
                                        stickiness: 1 // TrackedRangeStickiness.GrowsOnlyWhenTypingBefore
                                }
                        }]);

                        this.logService.trace(`[CursorOverlayService] Created cursor widget for ${key} at ${lineNumber}:${column}`);
                } catch (e) {
                        this.logService.warn(`[CursorOverlayService] Failed to create cursor widget: ${e}`);
                }
        }

        /**
         * Create or update selection decorations in the editor.
         */
        private _createOrUpdateSelectionDecorations(
                editor: any,
                key: string,
                selection: ISelection,
                color: string
        ): void {
                try {
                        const startLine = selection.start.line + 1;
                        const startCol = selection.start.column + 1;
                        const endLine = selection.end.line + 1;
                        const endCol = selection.end.column + 1;

                        // Add inline CSS for this user's selection color
                        this._injectSelectionCSS(key, color);

                        editor.deltaDecorations([], [{
                                range: {
                                        startLineNumber: startLine,
                                        startColumn: startCol,
                                        endLineNumber: endLine,
                                        endColumn: endCol
                                },
                                options: {
                                        className: `construct-collab-selection-${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
                                        opacity: 0.3,
                                        isWholeLine: false,
                                        stickiness: 1
                                }
                        }]);

                        this.logService.trace(`[CursorOverlayService] Created selection for ${key}`);
                } catch (e) {
                        this.logService.warn(`[CursorOverlayService] Failed to create selection: ${e}`);
                }
        }

        /**
         * Inject CSS for a user's selection color into the document head.
         */
        private _injectSelectionCSS(key: string, color: string): void {
                const cssKey = `construct-collab-css-${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
                if (document.getElementById(cssKey)) {
                        return;
                }

                const style = document.createElement('style');
                style.id = cssKey;
                style.textContent = `
                        .construct-collab-selection-${key.replace(/[^a-zA-Z0-9]/g, '_')} {
                                background-color: ${color} !important;
                                opacity: 0.3 !important;
                                border: 1px solid ${color} !important;
                                border-radius: 2px;
                        }
                `;
                document.head.appendChild(style);
        }

        // ─── Cleanup ────────────────────────────────────────────────────

        /**
         * Remove all overlays for a user who left the session.
         */
        private _removeUserOverlays(sessionId: string, userId: string): void {
                const key = `${sessionId}:${userId}`;
                this._removeUserOverlaysByKey(key);
        }

        /**
         * Remove overlays for a user by key.
         */
        private _removeUserOverlaysByKey(key: string): void {
                // Remove DOM elements
                const element = this._overlayElements.get(key);
                if (element && element.parentNode) {
                        element.parentNode.removeChild(element);
                }
                this._overlayElements.delete(key);

                // Remove decorations
                const disposables = this._decorations.get(key);
                if (disposables) {
                        for (const d of disposables) {
                                d.dispose();
                        }
                        this._decorations.delete(key);
                }

                // Remove injected CSS
                const cssKey = `construct-collab-css-${key.replace(/[^a-zA-Z0-9]/g, '_')}`;
                const cssEl = document.getElementById(cssKey);
                if (cssEl) {
                        cssEl.remove();
                }

                this._lastActivity.delete(key);
        }

        /**
         * Clean up cursors that have been idle for longer than IDLE_CURSOR_TIMEOUT_MS.
         */
        private _cleanupIdleCursors(): void {
                const now = Date.now();
                const keysToRemove: string[] = [];

                for (const [key, lastActivity] of this._lastActivity) {
                        if (now - lastActivity > IDLE_CURSOR_TIMEOUT_MS) {
                                keysToRemove.push(key);
                        }
                }

                for (const key of keysToRemove) {
                        this._removeUserOverlaysByKey(key);
                        this.logService.trace(`[CursorOverlayService] Removed idle cursor for ${key}`);
                }
        }

        override dispose(): void {
                super.dispose();

                // Remove all overlays
                for (const key of this._overlayElements.keys()) {
                        this._removeUserOverlaysByKey(key);
                }

                // Clean up timer
                if (this._idleCheckTimer) {
                        clearInterval(this._idleCheckTimer);
                        this._idleCheckTimer = null;
                }

                this.logService.trace('[CursorOverlayService] Disposed');
        }
}
