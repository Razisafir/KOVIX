// Copyright (c) 2025 Razisafir. All rights reserved.
// CONSTRUCT IDE proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

export const IConstructNotificationService = createDecorator<IConstructNotificationService>('construct.notificationService');

/**
 * Severity levels for notifications.
 */
export type ConstructNotificationSeverity = 'info' | 'warning' | 'error' | 'success';

/**
 * A notification entry in the notification center.
 */
export interface IConstructNotification {
	/** Unique identifier for this notification. */
	readonly id: string;
	/** Severity level. */
	readonly severity: ConstructNotificationSeverity;
	/** Short title/message. */
	readonly title: string;
	/** Detailed message body. */
	readonly message?: string;
	/** Source of the notification (e.g., 'Agent', 'MCP', 'Memory'). */
	readonly source: string;
	/** Timestamp when the notification was created. */
	readonly timestamp: number;
	/** Whether the notification has been read/dismissed. */
	read: boolean;
	/** Optional action labels for the notification. */
	actions?: string[];
}

/**
 * Service for managing CONSTRUCT-specific notifications.
 *
 * Currently, the agent completes tasks silently with no toast or popup.
 * This service provides a unified notification system that:
 * - Shows toast notifications for important events
 * - Maintains a notification center history
 * - Supports actions on notifications (e.g., 'View Diff', 'Open File')
 * - Integrates with VS Code's built-in notification system
 */
export interface IConstructNotificationService {
	readonly _serviceBrand: undefined;

	/** Event fired when a new notification is added. */
	readonly onDidAddNotification: Event<IConstructNotification>;
	/** Event fired when a notification is read/dismissed. */
	readonly onDidRemoveNotification: Event<string>;
	/** Current notification history. */
	readonly notifications: ReadonlyArray<IConstructNotification>;

	/**
	 * Show an info notification.
	 */
	info(title: string, message?: string, source?: string, actions?: string[]): void;

	/**
	 * Show a warning notification.
	 */
	warning(title: string, message?: string, source?: string, actions?: string[]): void;

	/**
	 * Show an error notification.
	 */
	error(title: string, message?: string, source?: string, actions?: string[]): void;

	/**
	 * Show a success notification.
	 */
	success(title: string, message?: string, source?: string, actions?: string[]): void;

	/**
	 * Mark a notification as read.
	 */
	markRead(id: string): void;

	/**
	 * Dismiss/remove a notification.
	 */
	dismiss(id: string): void;

	/**
	 * Clear all notifications.
	 */
	clearAll(): void;

	/**
	 * Get unread notification count.
	 */
	getUnreadCount(): number;
}
