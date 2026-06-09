// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConstructNotificationService, IConstructNotification, ConstructNotificationSeverity } from '../common/notification/constructNotificationService.js';
import { ILogService } from '../../log/common/log.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';

let notificationId = 0;

/**
 * Node-layer notification service.
 * Manages system-level notifications (toast/notification center).
 */
export class ConstructNotificationNodeService extends Disposable implements IConstructNotificationService {
        declare readonly _serviceBrand: undefined;

        private readonly _notifications: IConstructNotification[] = [];

        private readonly _onDidAddNotification = this._register(new Emitter<IConstructNotification>());
        readonly onDidAddNotification = this._onDidAddNotification.event;
        private readonly _onDidRemoveNotification = this._register(new Emitter<string>());
        readonly onDidRemoveNotification = this._onDidRemoveNotification.event;

        get notifications(): ReadonlyArray<IConstructNotification> {
                return this._notifications;
        }

        constructor(
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.logService.info('[NotificationNode] Service created');
        }

        info(title: string, message?: string, source?: string, actions?: string[]): void {
                this._addNotification('info', title, message, source, actions);
        }

        warning(title: string, message?: string, source?: string, actions?: string[]): void {
                this._addNotification('warning', title, message, source, actions);
        }

        error(title: string, message?: string, source?: string, actions?: string[]): void {
                this._addNotification('error', title, message, source, actions);
        }

        success(title: string, message?: string, source?: string, actions?: string[]): void {
                this._addNotification('success', title, message, source, actions);
        }

        private _addNotification(severity: ConstructNotificationSeverity, title: string, message?: string, source?: string, actions?: string[]): void {
                const notification: IConstructNotification = {
                        id: String(++notificationId),
                        severity,
                        title,
                        message,
                        source: source ?? 'CONSTRUCT',
                        timestamp: Date.now(),
                        read: false,
                        actions,
                };
                this._notifications.push(notification);
                this._onDidAddNotification.fire(notification);
                this.logService.info(`[NotificationNode] ${severity.toUpperCase()}: ${title}`);
        }

        markRead(id: string): void {
                const n = this._notifications.find(n => n.id === id);
                if (n) { n.read = true; }
        }

        dismiss(id: string): void {
                const idx = this._notifications.findIndex(n => n.id === id);
                if (idx >= 0) {
                        this._notifications.splice(idx, 1);
                        this._onDidRemoveNotification.fire(id);
                }
        }

        clearAll(): void {
                this._notifications.length = 0;
        }

        getUnreadCount(): number {
                return this._notifications.filter(n => !n.read).length;
        }
}
