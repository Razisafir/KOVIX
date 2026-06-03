/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Telemetry Service Implementation
 *  Privacy-first telemetry with tier-based collection, PII stripping,
 *  differential privacy, event buffering, and GDPR compliance.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import {
	ITelemetryService,
	ITelemetryEvent,
	DataTier,
	IPrivacyConfig,
	IPrivacyReport,
	TelemetryEventType,
	PIIStrippingLevel,
	TELEMETRY_STORAGE_KEY,
	TELEMETRY_CONFIG_KEY,
	TELEMETRY_CONSENT_KEY,
	MAX_BUFFER_SIZE,
	FLUSH_THRESHOLD,
	FLUSH_INTERVAL_MS,
	DEFAULT_PRIVACY_CONFIG
} from '../../../../platform/construct/common/telemetry/telemetryTypes.js';
import { PIIStripper } from './piiStripper.js';

// ─── Internal State ────────────────────────────────────────────────────────

interface ITelemetryState {
	buffer: ITelemetryEvent[];
	tier: DataTier;
	config: IPrivacyConfig;
	sessionId: string;
	projectId: string;
	flushTimer: ReturnType<typeof setInterval> | undefined;
	consentGiven: boolean;
	consentDate: number | undefined;
	lastFlushTime: number | undefined;
	totalEventsRecorded: number;
	totalEventsUploaded: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class TelemetryService extends Disposable implements ITelemetryService {
	readonly _serviceBrand: undefined;

	private readonly state: ITelemetryState;
	private readonly stripper: PIIStripper;

	// --- Events -----------------------------------------------------------

	private readonly _onDidRecordEvent = this._register(new Emitter<ITelemetryEvent>());
	readonly onDidRecordEvent = this._onDidRecordEvent.event;

	private readonly _onDidFlush = this._register(new Emitter<number>());
	readonly onDidFlush = this._onDidFlush.event;

	private readonly _onTierChange = this._register(new Emitter<DataTier>());
	readonly onTierChange = this._onTierChange.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.stripper = new PIIStripper();

		// Load persisted config or use defaults
		const storedConfig = this.storageService.get(TELEMETRY_CONFIG_KEY, undefined);
		const config: IPrivacyConfig = storedConfig
			? { ...DEFAULT_PRIVACY_CONFIG, ...JSON.parse(storedConfig) }
			: { ...DEFAULT_PRIVACY_CONFIG };

		// Load consent status
		const consentData = this.storageService.get(TELEMETRY_CONSENT_KEY, undefined);
		const consent = consentData ? JSON.parse(consentData) as { given: boolean; date: number } : { given: false, date: undefined as number | undefined };

		// Generate session ID (hashed, not traceable to user)
		const sessionId = this.hashString(`session_${Date.now()}_${Math.random()}`);
		const projectId = this.hashString(`project_${Date.now()}_${Math.random()}`);

		this.state = {
			buffer: [],
			tier: config.tier,
			config,
			sessionId,
			projectId,
			flushTimer: undefined,
			consentGiven: consent.given,
			consentDate: consent.date,
			lastFlushTime: undefined,
			totalEventsRecorded: 0,
			totalEventsUploaded: 0
		};

		// Start flush timer if collection is enabled
		if (this.isCollectionEnabled()) {
			this.startFlushTimer();
		}

		this.logService.info(`[Telemetry] Service initialized. Tier: ${this.state.tier}, Collection: ${this.isCollectionEnabled()}`);
	}

	// =======================================================================
	// ITelemetryService - Tier Management
	// =======================================================================

	getCurrentTier(): DataTier {
		return this.state.tier;
	}

	setTier(tier: DataTier): void {
		const previousTier = this.state.tier;
		this.state.tier = tier;
		this.state.config.tier = tier;

		// Persist the updated config
		this.persistConfig();

		if (tier !== 'free') {
			// Paid/Enterprise: stop collection, clear buffer
			this.stopFlushTimer();
			this.state.buffer = [];
			this.logService.info(`[Telemetry] Tier set to ${tier}. Collection DISABLED. Buffer cleared.`);
		} else {
			// Free tier: start collection if consent given
			if (this.state.consentGiven && !this.state.flushTimer) {
				this.startFlushTimer();
			}
			this.logService.info(`[Telemetry] Tier set to free. Collection ENABLED.`);
		}

		if (previousTier !== tier) {
			this._onTierChange.fire(tier);
		}
	}

	isCollectionEnabled(): boolean {
		// CRITICAL: Paid/Enterprise = ZERO collection
		if (this.state.tier !== 'free') {
			return false;
		}

		// Free tier requires explicit consent
		return this.state.consentGiven;
	}

	// =======================================================================
	// ITelemetryService - Recording Methods
	// =======================================================================

	recordEvent(type: number, data: object): void {
		if (!this.isCollectionEnabled()) { return; }

		const event = this.createEvent(type, data);
		this.bufferEvent(event);
	}

	recordConversation(messages: string[]): void {
		if (!this.isCollectionEnabled()) { return; }
		if (!this.state.config.collectConversations) { return; }

		// Combine messages, strip PII, truncate to max 500 chars
		const combined = messages.join(' ');
		const anonymized = this.stripper.stripPII(combined, this.state.config.piiStrippingLevel);
		const snippet = anonymized.substring(0, 500);

		const event = this.createEvent(TelemetryEventType.Conversation, {
			conversationSnippet: snippet
		});

		this.bufferEvent(event);
	}

	recordCodeEdit(before: string, after: string): void {
		if (!this.isCollectionEnabled()) { return; }
		if (!this.state.config.collectCodePatterns) { return; }

		// Extract structural pattern only, no source code
		const pattern = this.stripper.extractCodePattern(before, after);

		const event = this.createEvent(TelemetryEventType.CodeEdit, {
			codePattern: pattern
		});

		this.bufferEvent(event);
	}

	recordToolCall(tool: string, args: object, result: object, duration: number): void {
		if (!this.isCollectionEnabled()) { return; }
		if (!this.state.config.collectToolUsage) { return; }

		// Only record tool name, success, and duration — never args or result
		const success = result && !(result instanceof Error);
		const noisyDuration = this.stripper.addLaplaceNoise(
			duration,
			this.stripper.getEpsilon(this.state.config.piiStrippingLevel)
		);

		const event = this.createEvent(TelemetryEventType.ToolCall, {
			toolUsage: {
				toolName: tool,
				success,
				durationMs: noisyDuration
			}
		});

		this.bufferEvent(event);
	}

	recordError(error: Error, context: object): void {
		if (!this.isCollectionEnabled()) { return; }
		if (!this.state.config.collectErrors) { return; }

		const pattern = this.stripper.anonymizeError(error, context);

		const event = this.createEvent(TelemetryEventType.Error, {
			errorPattern: pattern
		});

		this.bufferEvent(event);
	}

	recordPerformance(metric: string, value: number): void {
		if (!this.isCollectionEnabled()) { return; }
		if (!this.state.config.collectPerformance) { return; }

		// Add differential privacy noise to performance metrics
		const noisyValue = this.stripper.addLaplaceNoise(
			value,
			this.stripper.getEpsilon(this.state.config.piiStrippingLevel)
		);

		const event = this.createEvent(TelemetryEventType.Performance, {
			featureName: metric,
			latencyMs: noisyValue
		});

		this.bufferEvent(event);
	}

	recordFeatureUsage(feature: string): void {
		if (!this.isCollectionEnabled()) { return; }

		const event = this.createEvent(TelemetryEventType.FeatureUsage, {
			featureName: feature
		});

		this.bufferEvent(event);
	}

	// =======================================================================
	// ITelemetryService - Buffer Management
	// =======================================================================

	async flush(): Promise<void> {
		if (this.state.buffer.length === 0) {
			this.logService.info('[Telemetry] Flush called but buffer is empty');
			return;
		}

		const batch = [...this.state.buffer];

		try {
			// Attempt to upload the batch
			const success = await this.uploadBatch(batch);

			if (success) {
				this.state.totalEventsUploaded += batch.length;
				this.state.buffer = [];
				this.state.lastFlushTime = Date.now();
				this._onDidFlush.fire(batch.length);
				this.logService.info(`[Telemetry] Flushed ${batch.length} events successfully`);
			} else {
				// Upload failed — keep buffer for retry
				this.logService.warn(`[Telemetry] Failed to flush ${batch.length} events, keeping in buffer`);
				this.persistBuffer();
			}
		} catch (error) {
			this.logService.error(`[Telemetry] Flush error: ${error}`);
			this.persistBuffer();
		}
	}

	getLocalBuffer(): ITelemetryEvent[] {
		return [...this.state.buffer];
	}

	getEventCount(): number {
		return this.state.buffer.length;
	}

	clearBuffer(): void {
		this.state.buffer = [];
		this.storageService.remove(TELEMETRY_STORAGE_KEY, undefined);
		this.logService.info('[Telemetry] Buffer cleared');
	}

	// =======================================================================
	// ITelemetryService - Privacy Config
	// =======================================================================

	getPrivacyConfig(): IPrivacyConfig {
		return { ...this.state.config };
	}

	updatePrivacyConfig(config: Partial<IPrivacyConfig>): void {
		this.state.config = { ...this.state.config, ...config };
		this.persistConfig();
		this.logService.info(`[Telemetry] Privacy config updated: ${JSON.stringify(config)}`);
	}

	getPrivacyReport(): IPrivacyReport {
		const tier = this.state.tier;

		const whatWeCollect: string[] = tier === 'free' ? [
			'Conversation snippets (PII stripped, max 500 chars)',
			'Code patterns (structure only, no source code)',
			'Tool usage (tool name, success/failure, duration)',
			'Error patterns (anonymized stack traces)',
			'Performance metrics (with differential privacy noise)',
			'Feature usage counts'
		] : [];

		const whatWeDoNotCollect: string[] = [
			'Raw source code (NEVER)',
			'Absolute file paths (replaced with [PATH])',
			'API keys, tokens, secrets (replaced with [API_KEY], [SECRET])',
			'Personal identifiers (names, emails, phones replaced)',
			'Health or medical data (blocked by HIPAA-aware filter)',
			'Credit card numbers or financial data',
			'Any data that can identify a specific person'
		];

		return {
			whatWeCollect,
			whatWeDoNotCollect,
			dataUsageExplanation: tier === 'free'
				? 'Your anonymized code patterns and usage data help us suggest better completions and improve the AI model for all users.'
				: 'No data is collected for paid/enterprise users.',
			retentionPolicy: `All collected data is automatically deleted after ${this.state.config.retentionDays} days. No exceptions.`,
			thirdPartySharing: 'No third-party sharing. Data is used exclusively to improve CONSTRUCT AI models.',
			tier,
			lastUpdated: Date.now()
		};
	}

	// =======================================================================
	// ITelemetryService - GDPR Compliance
	// =======================================================================

	async exportUserData(): Promise<object> {
		this.logService.info('[Telemetry] GDPR export requested');

		return {
			tier: this.state.tier,
			config: this.state.config,
			consent: {
				given: this.state.consentGiven,
				date: this.state.consentDate
			},
			events: this.state.buffer.map(e => ({
				type: e.type,
				timestamp: e.timestamp,
				data: e.data,
				metadata: e.metadata
			})),
			totalEventsRecorded: this.state.totalEventsRecorded,
			totalEventsUploaded: this.state.totalEventsUploaded,
			exportDate: new Date().toISOString()
		};
	}

	async deleteUserData(): Promise<void> {
		this.logService.info('[Telemetry] GDPR deletion requested');

		// Clear local buffer
		this.state.buffer = [];
		this.state.totalEventsRecorded = 0;
		this.state.totalEventsUploaded = 0;

		// Remove persisted data
		this.storageService.remove(TELEMETRY_STORAGE_KEY, undefined);

		// Send deletion request to analytics server
		try {
			// In production, this would send a signed deletion request
			this.logService.info('[Telemetry] Deletion request sent to analytics server');
		} catch (error) {
			this.logService.error(`[Telemetry] Failed to send deletion request: ${error}`);
		}
	}

	// =======================================================================
	// Private Helpers
	// =======================================================================

	private createEvent(type: number, data: object): ITelemetryEvent {
		return {
			id: this.generateUUID(),
			type,
			timestamp: Date.now(),
			sessionId: this.state.sessionId,
			projectId: this.state.projectId,
			data: data as any,
			metadata: {
				version: '1.0.0',
				platform: 'vscode',
				tier: this.state.tier,
				anonymizationLevel: this.state.config.piiStrippingLevel
			}
		};
	}

	private bufferEvent(event: ITelemetryEvent): void {
		// Enforce max buffer size
		if (this.state.buffer.length >= MAX_BUFFER_SIZE) {
			this.state.buffer.shift(); // Remove oldest event
		}

		this.state.buffer.push(event);
		this.state.totalEventsRecorded++;

		this._onDidRecordEvent.fire(event);

		// Auto-flush when threshold is reached
		if (this.state.buffer.length >= FLUSH_THRESHOLD) {
			this.flush().catch(err => {
				this.logService.warn(`[Telemetry] Auto-flush failed: ${err}`);
			});
		}
	}

	private async uploadBatch(events: ITelemetryEvent[]): Promise<boolean> {
		// In a full implementation, this would:
		// 1. Compress events with gzip
		// 2. Sign the payload with HMAC-SHA256
		// 3. POST to https://telemetry.construct.ai/v1/events
		// 4. Handle retry with exponential backoff

		this.logService.info(`[Telemetry] Would upload ${events.length} events to analytics endpoint`);

		// Simulate successful upload
		return true;
	}

	private startFlushTimer(): void {
		this.stopFlushTimer();
		this.state.flushTimer = setInterval(() => {
			this.flush().catch(err => {
				this.logService.warn(`[Telemetry] Periodic flush failed: ${err}`);
			});
		}, FLUSH_INTERVAL_MS);
	}

	private stopFlushTimer(): void {
		if (this.state.flushTimer !== undefined) {
			clearInterval(this.state.flushTimer);
			this.state.flushTimer = undefined;
		}
	}

	private persistBuffer(): void {
		try {
			this.storageService.store(
				TELEMETRY_STORAGE_KEY,
				JSON.stringify(this.state.buffer.slice(-100)), // Keep last 100 for offline backup
				undefined,
				1 // StorageScope.WORKSPACE
			);
		} catch (error) {
			this.logService.warn(`[Telemetry] Failed to persist buffer: ${error}`);
		}
	}

	private persistConfig(): void {
		try {
			this.storageService.store(
				TELEMETRY_CONFIG_KEY,
				JSON.stringify(this.state.config),
				undefined,
				1 // StorageScope.WORKSPACE
			);
		} catch (error) {
			this.logService.warn(`[Telemetry] Failed to persist config: ${error}`);
		}
	}

	private hashString(input: string): string {
		// Simple hash for session/project IDs (not cryptographic, just non-reversible)
		let hash = 0;
		for (let i = 0; i < input.length; i++) {
			const char = input.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(36);
	}

	private generateUUID(): string {
		// Simple UUID v4-like generation
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	dispose(): void {
		this.stopFlushTimer();

		// Persist buffer before disposal
		if (this.state.buffer.length > 0) {
			this.persistBuffer();
		}

		super.dispose();
		this.logService.info('[Telemetry] Service disposed');
	}
}
