/*---------------------------------------------------------------------------------------------
 *  Construct IDE — Token Estimation Service (MVP Simplified)
 *
 *  Heuristic token counting only. No provider registry, no pricing calculations.
 *  Token estimates use text.length / 4 approximation.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import {
        ITokenEstimationService,
        TokenWarningLevel,
        TokenEstimate,
        PlanTokenEstimate,
        TokenUsageSnapshot,
} from '../../../../../platform/construct/common/tokenEstimation.js';

// ── Constants ─────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4; // Heuristic approximation
const STORAGE_KEY_USAGE = 'construct.tokenEstimation.usage';

// ── Default Context Windows ───────────────────────────────────

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
        'claude-sonnet-4-20250514': 200000,
        'claude-3-5-sonnet-20241022': 200000,
        'claude-3-5-haiku-20241022': 200000,
        'claude-opus-4-20250514': 200000,
};

const DEFAULT_CONTEXT_WINDOW = 200000;

// ══════════════════════════════════════════════════════════════
// TokenEstimationService
// ══════════════════════════════════════════════════════════════

export class TokenEstimationService extends Disposable implements ITokenEstimationService {
        declare readonly _serviceBrand: undefined;

        private _usage: {
                totalInput: number;
                totalOutput: number;
                totalCost: number;
                byProvider: Map<string, { input: number; output: number; cost: number }>;
                byProject: Map<string, { input: number; output: number; cost: number }>;
        } = {
                totalInput: 0,
                totalOutput: 0,
                totalCost: 0,
                byProvider: new Map(),
                byProject: new Map(),
        };

        private readonly _onDidChangeUsage = this._register(new Emitter<TokenUsageSnapshot>());
        readonly onDidChangeUsage = this._onDidChangeUsage.event;

        private readonly _onWarningLevelChanged = this._register(new Emitter<{ level: TokenWarningLevel; context: string }>());
        readonly onWarningLevelChanged = this._onWarningLevelChanged.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
        ) {
                super();
                this._loadUsage();
                this.logService.info('[TokenEstimation] Initialized');
        }

        estimateTokens(text: string, modelId: string): TokenEstimate {
                const tokenCount = Math.ceil(text.length / CHARS_PER_TOKEN);
                const contextWindow = MODEL_CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW;
                const contextUsage = tokenCount / contextWindow;

                let warningLevel = TokenWarningLevel.None;
                if (contextUsage >= 1.0) { warningLevel = TokenWarningLevel.Critical; }
                else if (contextUsage >= 0.9) { warningLevel = TokenWarningLevel.High; }
                else if (contextUsage >= 0.75) { warningLevel = TokenWarningLevel.Medium; }
                else if (contextUsage >= 0.5) { warningLevel = TokenWarningLevel.Low; }

                return {
                        inputTokens: { min: tokenCount, max: Math.ceil(tokenCount * 1.2), estimated: tokenCount },
                        outputTokens: { min: 0, max: 8192, estimated: Math.min(tokenCount, 4096) },
                        totalTokens: { min: tokenCount, max: tokenCount + 8192, estimated: tokenCount + Math.min(tokenCount, 4096) },
                        costUSD: { min: 0, max: 0, estimated: 0 }, // No pricing in MVP
                        durationMs: { min: 500, max: 30000, estimated: 3000 },
                        warningLevel,
                        contextWindowUsage: contextUsage,
                        isApproximate: true,
                        modelId,
                        providerId: 'anthropic',
                };
        }

        estimatePlan(planMilestones: { description: string; stepCount: number }[], modelId: string, _providerId: string): PlanTokenEstimate {
                const perMilestone = new Map<string, TokenEstimate>();

                for (const milestone of planMilestones) {
                        perMilestone.set(milestone.description, this.estimateTokens(milestone.description, modelId));
                }

                const total = this.estimateTokens(planMilestones.map(m => m.description).join(' '), modelId);

                return {
                        planId: `plan-${Date.now()}`,
                        perMilestone,
                        total,
                        retryBuffer: {
                                ...total,
                                totalTokens: {
                                        min: Math.ceil(total.totalTokens.min * 1.2),
                                        max: Math.ceil(total.totalTokens.max * 1.5),
                                        estimated: Math.ceil(total.totalTokens.estimated * 1.3),
                                },
                        },
                        includesRetryEstimate: true,
                };
        }

        estimateRetryBuffer(baseEstimate: TokenEstimate, expectedRetryRate: number): TokenEstimate {
                const multiplier = 1 + expectedRetryRate;
                return {
                        ...baseEstimate,
                        totalTokens: {
                                min: Math.ceil(baseEstimate.totalTokens.min * multiplier),
                                max: Math.ceil(baseEstimate.totalTokens.max * multiplier),
                                estimated: Math.ceil(baseEstimate.totalTokens.estimated * multiplier),
                        },
                };
        }

        recordUsage(providerId: string, modelId: string, projectId: string, inputTokens: number, outputTokens: number): void {
                this._usage.totalInput += inputTokens;
                this._usage.totalOutput += outputTokens;

                const provider = this._usage.byProvider.get(providerId) ?? { input: 0, output: 0, cost: 0 };
                provider.input += inputTokens;
                provider.output += outputTokens;
                this._usage.byProvider.set(providerId, provider);

                const project = this._usage.byProject.get(projectId) ?? { input: 0, output: 0, cost: 0 };
                project.input += inputTokens;
                project.output += outputTokens;
                this._usage.byProject.set(projectId, project);

                this._saveUsage();

                this._onDidChangeUsage.fire(this.getCurrentUsage());
                this.logService.trace(`[TokenEstimation] Recorded usage: +${inputTokens}in/+${outputTokens}out for ${modelId}`);
        }

        getCurrentUsage(): TokenUsageSnapshot {
                return {
                        timestamp: Date.now(),
                        totalInputTokens: this._usage.totalInput,
                        totalOutputTokens: this._usage.totalOutput,
                        totalTokens: this._usage.totalInput + this._usage.totalOutput,
                        totalCostUSD: this._usage.totalCost,
                        byProvider: new Map(this._usage.byProvider),
                        byProject: new Map(this._usage.byProject),
                };
        }

        getUsageForProject(projectId: string): { input: number; output: number; cost: number } {
                return this._usage.byProject.get(projectId) ?? { input: 0, output: 0, cost: 0 };
        }

        getUsageForProvider(providerId: string): { input: number; output: number; cost: number } {
                return this._usage.byProvider.get(providerId) ?? { input: 0, output: 0, cost: 0 };
        }

        getWarningLevel(estimatedTokens: number, modelId: string): TokenWarningLevel {
                const contextWindow = MODEL_CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW;
                const usage = estimatedTokens / contextWindow;
                if (usage >= 1.0) { return TokenWarningLevel.Critical; }
                if (usage >= 0.9) { return TokenWarningLevel.High; }
                if (usage >= 0.75) { return TokenWarningLevel.Medium; }
                if (usage >= 0.5) { return TokenWarningLevel.Low; }
                return TokenWarningLevel.None;
        }

        // ── Private Helpers ───────────────────────────────────────

        private _loadUsage(): void {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_USAGE, StorageScope.PROFILE, undefined);
                        if (saved) {
                                const data = JSON.parse(saved);
                                this._usage.totalInput = data.totalInput ?? 0;
                                this._usage.totalOutput = data.totalOutput ?? 0;
                                this._usage.totalCost = data.totalCost ?? 0;
                                if (data.byProvider) { this._usage.byProvider = new Map(Object.entries(data.byProvider)); }
                                if (data.byProject) { this._usage.byProject = new Map(Object.entries(data.byProject)); }
                        }
                } catch (err) {
                        this.logService.warn('[TokenEstimation] Failed to load usage:', err);
                }
        }

        private _saveUsage(): void {
                try {
                        const data = {
                                totalInput: this._usage.totalInput,
                                totalOutput: this._usage.totalOutput,
                                totalCost: this._usage.totalCost,
                                byProvider: Object.fromEntries(this._usage.byProvider),
                                byProject: Object.fromEntries(this._usage.byProject),
                        };
                        this.storageService.store(STORAGE_KEY_USAGE, JSON.stringify(data), StorageScope.PROFILE, StorageTarget.MACHINE);
                } catch (err) {
                        this.logService.warn('[TokenEstimation] Failed to save usage:', err);
                }
        }
}
