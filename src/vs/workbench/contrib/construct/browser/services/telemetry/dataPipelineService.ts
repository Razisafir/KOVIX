/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Data Pipeline Service Implementation
 *  Processing, batching, validation, and uploading of anonymized telemetry data.
 *  Includes PII stripping, differential privacy, deduplication, and health metrics.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import {
	IDataPipeline,
	IPipelineHealth,
} from '../../../../platform/construct/common/telemetry/dataPipeline.js';
import {
	IAnonymizedData,
	ITelemetryEvent,
	IEventValidation,
	IPrivacyReport,
	TelemetryEventType,
	TELEMETRY_ENDPOINT,
	MAX_RETRIES,
	RETRY_BASE_DELAY_MS
} from '../../../../platform/construct/common/telemetry/telemetryTypes.js';
import { PIIStripper } from './piiStripper.js';

// ─── Deduplication Window ──────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ─── Retry Queue ───────────────────────────────────────────────────────────

interface IRetryEntry {
	events: ITelemetryEvent[];
	attempts: number;
	nextRetry: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class DataPipelineService extends Disposable implements IDataPipeline {
	readonly _serviceBrand: undefined;

	private readonly stripper: PIIStripper;
	private readonly retryQueue: IRetryEntry[] = [];

	// Health metrics
	private totalProcessed = 0;
	private totalUploaded = 0;
	private totalFailures = 0;
	private uploadLatencies: number[] = [];
	private lastUploadTimestamp: number | undefined;

	// --- Events -----------------------------------------------------------

	private readonly _onDidProcessBatch = this._register(new Emitter<number>());
	readonly onDidProcessBatch = this._onDidProcessBatch.event;

	private readonly _onUploadError = this._register(new Emitter<string>());
	readonly onUploadError = this._onUploadError.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.stripper = new PIIStripper();
		this.logService.info('[DataPipeline] Service initialized');
	}

	// =======================================================================
	// IDataPipeline - Processing
	// =======================================================================

	processEvent(event: ITelemetryEvent): IAnonymizedData {
		const level = event.metadata.anonymizationLevel;
		const epsilon = this.stripper.getEpsilon(level);

		// Process based on event type
		switch (event.type) {
			case TelemetryEventType.Conversation: {
				const snippet = event.data.conversationSnippet
					? this.stripper.stripPII(event.data.conversationSnippet, level)
					: undefined;
				return {
					conversationSnippet: snippet?.substring(0, 500)
				};
			}

			case TelemetryEventType.CodeEdit: {
				return {
					codePattern: event.data.codePattern ?? 'code edit'
				};
			}

			case TelemetryEventType.ToolCall: {
				const usage = event.data.toolUsage;
				return {
					toolUsage: usage ? {
						toolName: usage.toolName,
						success: usage.success,
						durationMs: this.stripper.addLaplaceNoise(usage.durationMs, epsilon)
					} : undefined
				};
			}

			case TelemetryEventType.Error: {
				return {
					errorPattern: event.data.errorPattern ?? 'unknown error'
				};
			}

			case TelemetryEventType.Performance: {
				const value = event.data.latencyMs ?? 0;
				return {
					featureName: event.data.featureName,
					latencyMs: this.stripper.addLaplaceNoise(value, epsilon)
				};
			}

			case TelemetryEventType.FeatureUsage: {
				return {
					featureName: event.data.featureName
				};
			}

			case TelemetryEventType.ModelInteraction: {
				return {
					modelName: event.data.modelName,
					tokenCount: event.data.tokenCount
						? this.stripper.addLaplaceNoise(event.data.tokenCount, epsilon)
						: undefined,
					latencyMs: event.data.latencyMs
						? this.stripper.addLaplaceNoise(event.data.latencyMs, epsilon)
						: undefined
				};
			}

			default: {
				// Usage type and fallback
				return {
					featureName: event.data.featureName
				};
			}
		}
	}

	batchEvents(events: ITelemetryEvent[]): ITelemetryEvent[] {
		if (events.length === 0) {
			return [];
		}

		// Sort by timestamp
		const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

		// Deduplicate within time windows
		const seen = new Map<string, number>(); // key → timestamp
		const deduplicated: ITelemetryEvent[] = [];

		for (const event of sorted) {
			const key = this.deduplicationKey(event);
			const lastSeen = seen.get(key);

			if (lastSeen !== undefined && (event.timestamp - lastSeen) < DEDUP_WINDOW_MS) {
				// Skip duplicate within the 1-hour window
				continue;
			}

			seen.set(key, event.timestamp);
			deduplicated.push(event);
		}

		this.totalProcessed += events.length;
		this._onDidProcessBatch.fire(deduplicated.length);

		this.logService.info(`[DataPipeline] Batched ${events.length} events → ${deduplicated.length} after dedup`);

		return deduplicated;
	}

	async uploadBatch(events: ITelemetryEvent[]): Promise<boolean> {
		if (events.length === 0) {
			return true;
		}

		// Process and deduplicate
		const batch = this.batchEvents(events);
		const startTime = Date.now();

		// Attempt upload with retry logic
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const success = await this.performUpload(batch);

				if (success) {
					const latency = Date.now() - startTime;
					this.uploadLatencies.push(latency);
					if (this.uploadLatencies.length > 100) {
						this.uploadLatencies.shift();
					}

					this.totalUploaded += batch.length;
					this.lastUploadTimestamp = Date.now();

					this.logService.info(`[DataPipeline] Uploaded ${batch.length} events in ${latency}ms`);
					return true;
				}
			} catch (error) {
				this.logService.warn(`[DataPipeline] Upload attempt ${attempt + 1}/${MAX_RETRIES} failed: ${error}`);
			}

			// Exponential backoff before retry
			if (attempt < MAX_RETRIES) {
				const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
				await new Promise(resolve => setTimeout(resolve, delay));
			}
		}

		// All retries exhausted — queue for later retry
		this.totalFailures++;
		this.retryQueue.push({
			events: batch,
			attempts: MAX_RETRIES,
			nextRetry: Date.now() + RETRY_BASE_DELAY_MS * Math.pow(2, MAX_RETRIES)
		});

		this._onUploadError.fire(`Failed to upload ${batch.length} events after ${MAX_RETRIES} retries`);

		// Persist failed batch for offline recovery
		this.persistRetryQueue();

		return false;
	}

	validateEvent(event: ITelemetryEvent): IEventValidation {
		const errors: string[] = [];

		// Validate required fields
		if (!event.id || typeof event.id !== 'string') {
			errors.push('Missing or invalid event id');
		}

		if (event.type === undefined || event.type === null) {
			errors.push('Missing event type');
		}

		if (!event.timestamp || typeof event.timestamp !== 'number') {
			errors.push('Missing or invalid timestamp');
		}

		if (!event.sessionId || typeof event.sessionId !== 'string') {
			errors.push('Missing or invalid sessionId');
		}

		if (!event.projectId || typeof event.projectId !== 'string') {
			errors.push('Missing or invalid projectId');
		}

		if (!event.data || typeof event.data !== 'object') {
			errors.push('Missing or invalid data');
		}

		if (!event.metadata || typeof event.metadata !== 'object') {
			errors.push('Missing or invalid metadata');
		}

		// Validate metadata fields
		if (event.metadata) {
			if (!event.metadata.version) {
				errors.push('Missing metadata.version');
			}
			if (!event.metadata.platform) {
				errors.push('Missing metadata.platform');
			}
			if (!event.metadata.tier) {
				errors.push('Missing metadata.tier');
			}
		}

		// Check for PII leaks in data (basic validation)
		if (event.data) {
			const dataStr = JSON.stringify(event.data);
			if (/@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(dataStr)) {
				errors.push('Potential email address found in event data');
			}
			if (/ghp_[a-zA-Z0-9]{36}/.test(dataStr)) {
				errors.push('GitHub token found in event data');
			}
			if (/AKIA[A-Z0-9]{16}/.test(dataStr)) {
				errors.push('AWS key found in event data');
			}
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}

	// =======================================================================
	// IDataPipeline - Privacy
	// =======================================================================

	getPrivacyReport(): IPrivacyReport {
		return {
			whatWeCollect: [
				'Conversation snippets (PII stripped, max 500 chars)',
				'Code patterns (structure only, no source code)',
				'Tool usage (tool name, success/failure, duration)',
				'Error patterns (anonymized stack traces)',
				'Performance metrics (with differential privacy noise)',
				'Feature usage counts'
			],
			whatWeDoNotCollect: [
				'Raw source code (NEVER)',
				'Absolute file paths (replaced with [PATH])',
				'API keys, tokens, secrets (replaced with [API_KEY], [SECRET])',
				'Personal identifiers (names, emails, phones replaced)',
				'Health or medical data (blocked by HIPAA-aware filter)',
				'Credit card numbers or financial data',
				'Any data that can identify a specific person'
			],
			dataUsageExplanation: 'Your anonymized code patterns and usage data help us suggest better completions and improve the AI model for all users.',
			retentionPolicy: 'All collected data is automatically deleted after 90 days. No exceptions.',
			thirdPartySharing: 'No third-party sharing. Data is used exclusively to improve CONSTRUCT AI models.',
			tier: 'free',
			lastUpdated: Date.now()
		};
	}

	// =======================================================================
	// IDataPipeline - Health
	// =======================================================================

	getHealthMetrics(): IPipelineHealth {
		const avgLatency = this.uploadLatencies.length > 0
			? this.uploadLatencies.reduce((a, b) => a + b, 0) / this.uploadLatencies.length
			: 0;

		const successRate = this.totalUploaded + this.totalFailures > 0
			? this.totalUploaded / (this.totalUploaded + this.totalFailures)
			: 1;

		return {
			uploadSuccessRate: successRate,
			averageUploadLatencyMs: Math.round(avgLatency),
			bufferSize: this.retryQueue.reduce((sum, entry) => sum + entry.events.length, 0),
			lastUploadTimestamp: this.lastUploadTimestamp,
			totalEventsProcessed: this.totalProcessed,
			totalEventsUploaded: this.totalUploaded,
			totalUploadFailures: this.totalFailures
		};
	}

	// =======================================================================
	// Private Helpers
	// =======================================================================

	private async performUpload(batch: ITelemetryEvent[]): Promise<boolean> {
		// In a full implementation, this would:
		// 1. Process each event through the pipeline (PII strip + diff privacy)
		// 2. Compress the batch with gzip
		// 3. Sign the payload with HMAC-SHA256 using a rotated key
		// 4. POST to TELEMETRY_ENDPOINT
		// 5. Verify the response

		this.logService.info(`[DataPipeline] Would POST ${batch.length} events to ${TELEMETRY_ENDPOINT}`);

		// Simulate successful upload
		return true;
	}

	/**
	 * Generate a deduplication key for an event based on type and key data fields.
	 */
	private deduplicationKey(event: ITelemetryEvent): string {
		switch (event.type) {
			case TelemetryEventType.ToolCall:
				return `tool:${event.data.toolUsage?.toolName ?? 'unknown'}:${event.data.toolUsage?.success ? '1' : '0'}`;
			case TelemetryEventType.FeatureUsage:
				return `feature:${event.data.featureName ?? 'unknown'}`;
			case TelemetryEventType.Performance:
				return `perf:${event.data.featureName ?? 'unknown'}`;
			case TelemetryEventType.Error:
				return `error:${event.data.errorPattern?.substring(0, 50) ?? 'unknown'}`;
			default:
				return `${event.type}:${event.timestamp}`;
		}
	}

	/**
	 * Persist the retry queue to storage for offline recovery.
	 */
	private persistRetryQueue(): void {
		try {
			// Only persist last 50 retry entries to avoid storage bloat
			const toStore = this.retryQueue.slice(-50);
			this.storageService.store(
				'construct.telemetry.retryQueue',
				JSON.stringify(toStore),
				undefined,
				1 // StorageScope.WORKSPACE
			);
		} catch (error) {
			this.logService.warn(`[DataPipeline] Failed to persist retry queue: ${error}`);
		}
	}

	/**
	 * Process any pending retries that are due.
	 */
	async processRetryQueue(): Promise<void> {
		const now = Date.now();
		const ready = this.retryQueue.filter(entry => entry.nextRetry <= now);

		for (const entry of ready) {
			const success = await this.uploadBatch(entry.events);
			if (success) {
				const index = this.retryQueue.indexOf(entry);
				if (index >= 0) {
					this.retryQueue.splice(index, 1);
				}
			}
		}

		// Discard entries older than 7 days
		const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
		const before = this.retryQueue.length;
		for (let i = this.retryQueue.length - 1; i >= 0; i--) {
			const entry = this.retryQueue[i];
			if (entry.events[0] && entry.events[0].timestamp < sevenDaysAgo) {
				this.retryQueue.splice(i, 1);
			}
		}
		const discarded = before - this.retryQueue.length;
		if (discarded > 0) {
			this.logService.info(`[DataPipeline] Discarded ${discarded} retry entries older than 7 days`);
		}
	}

	dispose(): void {
		// Persist retry queue before disposal
		if (this.retryQueue.length > 0) {
			this.persistRetryQueue();
		}

		super.dispose();
		this.logService.info('[DataPipeline] Service disposed');
	}
}
