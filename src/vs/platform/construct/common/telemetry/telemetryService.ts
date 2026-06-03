/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Telemetry Service Interface
 *  Privacy-first telemetry service with tier-based collection controls.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { DataTier, ITelemetryEvent, IPrivacyConfig, IPrivacyReport } from './telemetryTypes.js';

export const ITelemetryService = createDecorator<ITelemetryService>('construct.telemetryService');

export interface ITelemetryService extends IDisposable {
	readonly _serviceBrand: undefined;

	// ─── Tier Management ──────────────────────────────────────────────

	/** Get the current data tier (free / paid / enterprise). */
	getCurrentTier(): DataTier;

	/** Set the data tier. Paid/enterprise disables all collection. */
	setTier(tier: DataTier): void;

	/** Whether data collection is currently enabled (based on tier + config). */
	isCollectionEnabled(): boolean;

	// ─── Recording Methods ────────────────────────────────────────────

	/** Record a generic telemetry event (fire-and-forget, async). */
	recordEvent(type: number, data: object): void;

	/** Record a conversation snippet (PII stripped before buffering). */
	recordConversation(messages: string[]): void;

	/** Record a code edit (pattern only, no source). */
	recordCodeEdit(before: string, after: string): void;

	/** Record a tool call (aggregated, no args). */
	recordToolCall(tool: string, args: object, result: object, duration: number): void;

	/** Record an error (pattern + anonymized stack). */
	recordError(error: Error, context: object): void;

	/** Record a performance metric. */
	recordPerformance(metric: string, value: number): void;

	/** Record feature usage. */
	recordFeatureUsage(feature: string): void;

	// ─── Buffer Management ────────────────────────────────────────────

	/** Flush the local buffer and upload to the analytics endpoint. */
	flush(): Promise<void>;

	/** Get the local event buffer (for user transparency). */
	getLocalBuffer(): ITelemetryEvent[];

	/** Get the number of events in the buffer. */
	getEventCount(): number;

	/** Clear the local buffer. */
	clearBuffer(): void;

	// ─── Privacy Config ───────────────────────────────────────────────

	/** Get the current privacy configuration. */
	getPrivacyConfig(): IPrivacyConfig;

	/** Update the privacy configuration. */
	updatePrivacyConfig(config: Partial<IPrivacyConfig>): void;

	/** Get a human-readable privacy report. */
	getPrivacyReport(): IPrivacyReport;

	// ─── GDPR Compliance ──────────────────────────────────────────────

	/** Export all user data (GDPR right to access). */
	exportUserData(): Promise<object>;

	/** Delete all user data (GDPR right to deletion). */
	deleteUserData(): Promise<void>;

	// ─── Events ───────────────────────────────────────────────────────

	/** Fired when an event is recorded. */
	readonly onDidRecordEvent: Event<ITelemetryEvent>;

	/** Fired when events are flushed/uploaded. */
	readonly onDidFlush: Event<number>;

	/** Fired when the tier changes. */
	readonly onTierChange: Event<DataTier>;
}
