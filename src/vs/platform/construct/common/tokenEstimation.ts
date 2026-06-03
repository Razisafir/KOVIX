/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 3: Token Estimation System
 *
 *  REAL token estimation with provider-specific pricing.
 *  All estimates are explicitly marked as approximate.
 *
 *  Adapted from Real-construct for Construct IDE.
 *  Branding: construct → construct, Construct IDE → Construct IDE
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

// -- Service Identifiers --

export const ITokenEstimationService = createDecorator<ITokenEstimationService>('construct.tokenEstimationService');

// -- Enumerations --

/**
 * Warning levels for token usage.
 */
export enum TokenWarningLevel {
	None = 'none',
	Low = 'low',           // Approaching 50% of context window
	Medium = 'medium',     // Approaching 75% of context window
	High = 'high',         // Approaching 90% of context window
	Critical = 'critical', // Exceeds context window
}

// -- Data Types --

/**
 * Token estimation for a single operation.
 */
export interface TokenEstimate {
	readonly inputTokens: { min: number; max: number; estimated: number };
	readonly outputTokens: { min: number; max: number; estimated: number };
	readonly totalTokens: { min: number; max: number; estimated: number };
	readonly costUSD: { min: number; max: number; estimated: number };
	readonly durationMs: { min: number; max: number; estimated: number };
	readonly warningLevel: TokenWarningLevel;
	readonly contextWindowUsage: number;  // 0-1, how much of context window used
	readonly isApproximate: true;         // ALWAYS true
	readonly modelId: string;
	readonly providerId: string;
}

/**
 * Aggregate token estimation for a full execution plan.
 */
export interface PlanTokenEstimate {
	readonly planId: string;
	readonly perMilestone: Map<string, TokenEstimate>;
	readonly total: TokenEstimate;
	readonly retryBuffer: TokenEstimate;   // Estimated cost of retries (usually +20-50%)
	readonly includesRetryEstimate: boolean;
}

/**
 * Token usage snapshot (real, not estimated).
 */
export interface TokenUsageSnapshot {
	readonly timestamp: number;
	readonly totalInputTokens: number;
	readonly totalOutputTokens: number;
	readonly totalTokens: number;
	readonly totalCostUSD: number;
	readonly byProvider: Map<string, { input: number; output: number; cost: number }>;
	readonly byProject: Map<string, { input: number; output: number; cost: number }>;
}

// -- Service Interface --

/**
 * ITokenEstimationService -- Real token estimation with honest approximations.
 *
 * REAL responsibilities:
 *   - Estimate tokens for planning phase
 *   - Calculate cost based on provider pricing
 *   - Track real usage vs estimates
 *   - Warn when approaching context limits
 *   - Provide per-milestone estimates
 *
 * HONEST: All estimates are approximate. Real token counts come from
 * provider API responses. Estimates use heuristic tokenization.
 */
export interface ITokenEstimationService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeUsage: Event<TokenUsageSnapshot>;

	// Estimation
	estimateTokens(text: string, modelId: string): TokenEstimate;
	estimatePlan(planMilestones: { description: string; stepCount: number }[], modelId: string, providerId: string): PlanTokenEstimate;
	estimateRetryBuffer(baseEstimate: TokenEstimate, expectedRetryRate: number): TokenEstimate;

	// Real usage tracking
	recordUsage(providerId: string, modelId: string, projectId: string, inputTokens: number, outputTokens: number): void;
	getCurrentUsage(): TokenUsageSnapshot;
	getUsageForProject(projectId: string): { input: number; output: number; cost: number };
	getUsageForProvider(providerId: string): { input: number; output: number; cost: number };

	// Warnings
	getWarningLevel(estimatedTokens: number, modelId: string): TokenWarningLevel;
	readonly onWarningLevelChanged: Event<{ level: TokenWarningLevel; context: string }>;
}
