/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Telemetry Types
 *  Privacy-first telemetry and data collection pipeline types.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// ─── Data Tier ─────────────────────────────────────────────────────────────

export type DataTier = 'free' | 'paid' | 'enterprise';

// ─── Telemetry Event Types ─────────────────────────────────────────────────

export const enum TelemetryEventType {
	Conversation = 'conversation',
	CodeEdit = 'code_edit',
	ToolCall = 'tool_call',
	Error = 'error',
	Usage = 'usage',
	Performance = 'performance',
	FeatureUsage = 'feature_usage',
	ModelInteraction = 'model_interaction'
}

// ─── PII Stripping Level ───────────────────────────────────────────────────

export type PIIStrippingLevel = 'none' | 'basic' | 'aggressive';

// ─── Core Interfaces ───────────────────────────────────────────────────────

export interface ITelemetryEvent {
	readonly id: string;
	readonly type: TelemetryEventType;
	readonly timestamp: number;
	readonly sessionId: string;
	readonly projectId: string;
	readonly data: IAnonymizedData;
	readonly metadata: ITelemetryMetadata;
}

export interface ITelemetryMetadata {
	readonly version: string;
	readonly platform: string;
	readonly tier: DataTier;
	readonly anonymizationLevel: PIIStrippingLevel;
}

export interface IAnonymizedData {
	readonly conversationSnippet?: string;
	readonly codePattern?: string;
	readonly toolUsage?: {
		readonly toolName: string;
		readonly success: boolean;
		readonly durationMs: number;
	};
	readonly errorPattern?: string;
	readonly featureName?: string;
	readonly modelName?: string;
	readonly tokenCount?: number;
	readonly latencyMs?: number;
}

export interface IPrivacyConfig {
	tier: DataTier;
	collectConversations: boolean;
	collectCodePatterns: boolean;
	collectToolUsage: boolean;
	collectErrors: boolean;
	collectPerformance: boolean;
	differentialPrivacyEpsilon: number;
	retentionDays: number;
	piiStrippingLevel: PIIStrippingLevel;
}

// ─── Validation ────────────────────────────────────────────────────────────

export interface IEventValidation {
	readonly valid: boolean;
	readonly errors: string[];
}

// ─── Privacy Report ────────────────────────────────────────────────────────

export interface IPrivacyReport {
	readonly whatWeCollect: string[];
	readonly whatWeDoNotCollect: string[];
	readonly dataUsageExplanation: string;
	readonly retentionPolicy: string;
	readonly thirdPartySharing: string;
	readonly tier: DataTier;
	readonly lastUpdated: number;
}

// ─── Upload Result ─────────────────────────────────────────────────────────

export interface IUploadResult {
	readonly success: boolean;
	readonly eventsUploaded: number;
	readonly timestamp: number;
	readonly error?: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

export const TELEMETRY_STORAGE_KEY = 'construct.telemetry.buffer';
export const TELEMETRY_CONFIG_KEY = 'construct.telemetry.config';
export const TELEMETRY_CONSENT_KEY = 'construct.telemetry.consent';
export const TELEMETRY_ENDPOINT = 'https://telemetry.construct.ai/v1/events';
export const MAX_BUFFER_SIZE = 1000;
export const FLUSH_THRESHOLD = 500;
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_RETRIES = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETENTION_DAYS_DEFAULT = 90;
export const DIFFERENTIAL_PRIVACY_EPSILON_BASIC = 1.0;
export const DIFFERENTIAL_PRIVACY_EPSILON_AGGRESSIVE = 0.1;
export const DEFAULT_PRIVACY_CONFIG: IPrivacyConfig = {
	tier: 'free',
	collectConversations: true,
	collectCodePatterns: true,
	collectToolUsage: true,
	collectErrors: true,
	collectPerformance: true,
	differentialPrivacyEpsilon: DIFFERENTIAL_PRIVACY_EPSILON_BASIC,
	retentionDays: RETENTION_DAYS_DEFAULT,
	piiStrippingLevel: 'aggressive'
};
