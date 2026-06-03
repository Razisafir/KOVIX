/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Data Pipeline Interface
 *  Processing, batching, and uploading of anonymized telemetry data.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IAnonymizedData, ITelemetryEvent, IEventValidation, IPrivacyReport } from './telemetryTypes.js';

export const IDataPipeline = createDecorator<IDataPipeline>('construct.dataPipeline');

export interface IDataPipeline extends IDisposable {
	readonly _serviceBrand: undefined;

	// ─── Processing ───────────────────────────────────────────────────

	/** Process a raw event: strip PII, apply differential privacy noise. */
	processEvent(event: ITelemetryEvent): IAnonymizedData;

	/** Batch events together: deduplicate, aggregate within time windows. */
	batchEvents(events: ITelemetryEvent[]): ITelemetryEvent[];

	/** Upload a batch of events to the analytics endpoint via HTTPS POST. */
	uploadBatch(events: ITelemetryEvent[]): Promise<boolean>;

	/** Validate an event against the expected schema. */
	validateEvent(event: ITelemetryEvent): IEventValidation;

	// ─── Privacy ──────────────────────────────────────────────────────

	/** Generate a privacy report detailing what is and isn't collected. */
	getPrivacyReport(): IPrivacyReport;

	// ─── Health ───────────────────────────────────────────────────────

	/** Get pipeline health metrics. */
	getHealthMetrics(): IPipelineHealth;

	// ─── Events ───────────────────────────────────────────────────────

	/** Fired when a batch has been processed. */
	readonly onDidProcessBatch: Event<number>;

	/** Fired when an upload fails. */
	readonly onUploadError: Event<string>;
}

// ─── Pipeline Health ───────────────────────────────────────────────────────

export interface IPipelineHealth {
	readonly uploadSuccessRate: number;
	readonly averageUploadLatencyMs: number;
	readonly bufferSize: number;
	readonly lastUploadTimestamp: number | undefined;
	readonly totalEventsProcessed: number;
	readonly totalEventsUploaded: number;
	readonly totalUploadFailures: number;
}
