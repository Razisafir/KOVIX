/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { IConstructNotificationService, IConstructNotification, ConstructNotificationSeverity } from '../../../../../../platform/construct/common/notification/constructNotificationService.js';

let notificationId = 0;

/**
 * Browser-layer notification service implementation.
 * Delegates to VS Code's INotificationService for toast notifications
 * and maintains an internal history for the notification center.
 */
export class ConstructNotificationBrowserService extends Disposable implements IConstructNotificationService {
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
		@INotificationService private readonly vsNotificationService: INotificationService,
	) {
		super();
		this.logService.info('[ConstructNotification] Browser service created');
	}

	info(title: string, message?: string, source?: string, actions?: string[]): void {
		this._addNotification('info', title, message, source, actions);
		this.vsNotificationService.info(message ?? title);
	}

	warning(title: string, message?: string, source?: string, actions?: string[]): void {
		this._addNotification('warning', title, message, source, actions);
		this.vsNotificationService.warn(message ?? title);
	}

	error(title: string, message?: string, source?: string, actions?: string[]): void {
		this._addNotification('error', title, message, source, actions);
		this.vsNotificationService.error(message ?? title);
	}

	success(title: string, message?: string, source?: string, actions?: string[]): void {
		this._addNotification('success', title, message, source, actions);
		this.vsNotificationService.info(`✓ ${message ?? title}`);
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
		this._notifications.unshift(notification); // Most recent first
		// Keep last 100 notifications
		if (this._notifications.length > 100) {
			this._notifications.length = 100;
		}
		this._onDidAddNotification.fire(notification);
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
