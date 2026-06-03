/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Workflow Content / Webview Handler Registration
 *  Phase 28: All webview handlers (Pricing + Launch + GOD Mode + Welcome + Integration)
 *
 *  This module wires ICreditSystem, ICostGovernor, IGodModeActivator,
 *  and ILaunchChecklist into the Construct agent panel via webview
 *  message handlers. Phase 27 added 14 pricing handlers; Phase 28 adds
 *  16 launch/GOD mode/welcome/integration handlers.
 *--------------------------------------------------------------------------------------------*/

import { ICreditSystem, ICostGovernor } from '../../../../platform/construct/common/pricing/creditSystem.js';
import { IGodModeActivator, ILaunchChecklist } from '../../../../platform/construct/common/integration/godModeActivator.js';
import {
        CreditActionType,
        SubscriptionTier,
        ICreditBudget,
        IPricingAlert,
        ICreditUsage,
} from '../../../../platform/construct/common/pricing/pricingTypes.js';
import {
        GodModeState,
        IGodModeConfig,
        WelcomeDemoType,
} from '../../../../platform/construct/common/integration/launchTypes.js';

/**
 * Register all webview message handlers for the Construct IDE.
 *
 * Call this from the ConstructAgentViewPane (or equivalent webview host)
 * after the webview is ready. Each handler receives a message payload
 * and returns a serialisable result that is posted back to the webview.
 */
export function registerAllHandlers(
        creditSystem: ICreditSystem,
        costGovernor: ICostGovernor,
        godModeActivator: IGodModeActivator,
        launchChecklist: ILaunchChecklist,
        postMessage: (channel: string, data: unknown) => void,
): Map<string, (payload: any) => Promise<unknown> | unknown> {
        const handlers = new Map<string, (payload: any) => Promise<unknown> | unknown>();

        // ══════════════════════════════════════════════════════════
        // Phase 27: Pricing Handlers (14)
        // ══════════════════════════════════════════════════════════

        // ── pricing:getStatus ──────────────────────────────────
        handlers.set('pricing:getStatus', (_payload: any) => {
                const subscription = creditSystem.getSubscription();
                const remaining = creditSystem.getCreditsRemaining();
                const total = creditSystem.getCreditsTotal();
                const usedThisMonth = creditSystem.getUsageThisMonth();
                const usedToday = creditSystem.getUsageToday();
                const tier = creditSystem.getCurrentTier();

                return {
                        tier,
                        subscription,
                        creditsRemaining: remaining,
                        creditsTotal: total,
                        usedThisMonth,
                        usedToday,
                        emergencyMode: costGovernor.isEmergencyMode(),
                        autoSwitchRecommended: costGovernor.shouldAutoSwitchModel(),
                };
        });

        // ── pricing:getHistory ─────────────────────────────────
        handlers.set('pricing:getHistory', (payload: { limit?: number; startDate?: number; endDate?: number }) => {
                return creditSystem.getUsageHistory(payload.limit, payload.startDate, payload.endDate);
        });

        // ── pricing:getBreakdown ───────────────────────────────
        handlers.set('pricing:getBreakdown', (_payload: any) => {
                const breakdown = creditSystem.getUsageByActionType();
                const result: Record<string, number> = {};
                for (const [key, value] of breakdown) {
                        result[key] = value;
                }
                return result;
        });

        // ── pricing:estimate ───────────────────────────────────
        handlers.set('pricing:estimate', (payload: { prompt: string; model: string }) => {
                return creditSystem.estimateCost(payload.prompt, payload.model);
        });

        // ── pricing:estimatePlan ───────────────────────────────
        handlers.set('pricing:estimatePlan', (payload: { agentCount: number; estimatedSteps: number; model: string }) => {
                const credits = creditSystem.estimatePlanCost(payload);
                return { estimatedCredits: credits };
        });

        // ── pricing:setBudget ──────────────────────────────────
        handlers.set('pricing:setBudget', (payload: ICreditBudget) => {
                creditSystem.setBudget(payload);
                return { success: true };
        });

        // ── pricing:getBudget ──────────────────────────────────
        handlers.set('pricing:getBudget', (_payload: any) => {
                return creditSystem.getBudget();
        });

        // ── pricing:getAlerts ──────────────────────────────────
        handlers.set('pricing:getAlerts', (_payload: any) => {
                return creditSystem.getAlerts();
        });

        // ── pricing:upgrade ────────────────────────────────────
        handlers.set('pricing:upgrade', (_payload: any) => {
                creditSystem.upgradeFlow();
                return { success: true };
        });

        // ── pricing:purchase ───────────────────────────────────
        handlers.set('pricing:purchase', async (payload: { amount: number }) => {
                const success = await creditSystem.purchaseCredits(payload.amount);
                return { success };
        });

        // ── pricing:getPricingTable ────────────────────────────
        handlers.set('pricing:getPricingTable', (_payload: any) => {
                return creditSystem.getPricingTable();
        });

        // ── pricing:consume ────────────────────────────────────
        handlers.set('pricing:consume', (payload: { amount: number; actionType: CreditActionType; metadata?: { model?: string; sessionId?: string; agentType?: string; description?: string } }) => {
                const success = creditSystem.consumeCredits(payload.amount, payload.actionType, payload.metadata);
                return { success };
        });

        // ── pricing:exportUsage ────────────────────────────────
        handlers.set('pricing:exportUsage', (_payload: any) => {
                const csv = creditSystem.exportUsageCSV();
                return { csv };
        });

        // ── pricing:simulateTier ───────────────────────────────
        handlers.set('pricing:simulateTier', (payload: { tier: SubscriptionTier }) => {
                creditSystem.simulateTier(payload.tier);
                return { success: true };
        });

        // ══════════════════════════════════════════════════════════
        // Phase 28: Launch & GOD Mode Handlers (16)
        // ══════════════════════════════════════════════════════════

        // ── launch:runChecklist ────────────────────────────────
        // Runs the full launch checklist (15 checks).
        handlers.set('launch:runChecklist', async (_payload: any) => {
                const status = await launchChecklist.runAllChecks();
                return status;
        });

        // ── launch:getStatus ───────────────────────────────────
        // Returns the most recent launch status without re-running.
        handlers.set('launch:getStatus', (_payload: any) => {
                return launchChecklist.getStatus();
        });

        // ── godmode:activate ───────────────────────────────────
        // Activates GOD Mode with the given configuration.
        handlers.set('godmode:activate', async (payload: { goal: string; model?: string; autoOpenTimeline?: boolean; createCheckpoint?: boolean; maxCredits?: number }) => {
                const config: IGodModeConfig = {
                        goal: payload.goal,
                        model: payload.model,
                        autoOpenTimeline: payload.autoOpenTimeline,
                        createCheckpoint: payload.createCheckpoint,
                        maxCredits: payload.maxCredits,
                };
                const activated = await godModeActivator.activate(config);
                return { activated };
        });

        // ── godmode:pause ──────────────────────────────────────
        // Pauses GOD Mode at the current milestone.
        handlers.set('godmode:pause', (_payload: any) => {
                const paused = godModeActivator.pause();
                return { paused };
        });

        // ── godmode:resume ─────────────────────────────────────
        // Resumes GOD Mode from a paused state.
        handlers.set('godmode:resume', (_payload: any) => {
                const resumed = godModeActivator.resume();
                return { resumed };
        });

        // ── godmode:stop ───────────────────────────────────────
        // Stops GOD Mode and returns a session summary.
        handlers.set('godmode:stop', async (_payload: any) => {
                const summary = await godModeActivator.stop();
                return summary;
        });

        // ── godmode:status ─────────────────────────────────────
        // Returns the current GOD Mode status.
        handlers.set('godmode:status', (_payload: any) => {
                return godModeActivator.getStatus();
        });

        // ── welcome:show ───────────────────────────────────────
        // Returns welcome screen data (version, feature steps, tier info).
        handlers.set('welcome:show', (_payload: any) => {
                const tier = creditSystem.getCurrentTier();
                const remaining = creditSystem.getCreditsRemaining();
                const total = creditSystem.getCreditsTotal();
                const version = 'v1.0.0-god-mode';

                return {
                        version,
                        tier,
                        creditsRemaining: remaining,
                        creditsTotal: total,
                };
        });

        // ── welcome:getRecentProjects ──────────────────────────
        // Returns the list of recent projects.
        handlers.set('welcome:getRecentProjects', (_payload: any) => {
                // In production, this would use ConstructWelcome.getRecentProjects()
                return [];
        });

        // ── welcome:startDemo ──────────────────────────────────
        // Starts a welcome screen demo by type.
        handlers.set('welcome:startDemo', (payload: { demoType: WelcomeDemoType }) => {
                // In production, this would use ConstructWelcome.startDemo()
                return {
                        demoType: payload.demoType,
                        started: true,
                };
        });

        // ── welcome:consentTelemetry ───────────────────────────
        // Records telemetry consent choice.
        handlers.set('welcome:consentTelemetry', (payload: { consented: boolean }) => {
                // In production, this would use ConstructWelcome.consentTelemetry()
                return { success: true, consented: payload.consented };
        });

        // ── integration:test1 ──────────────────────────────────
        // Runs integration test 1: React + auth app.
        handlers.set('integration:test1', async (_payload: any) => {
                const result = await godModeActivator.runIntegrationTest('react-auth');
                return result;
        });

        // ── integration:test2 ──────────────────────────────────
        // Runs integration test 2: 3D portfolio.
        handlers.set('integration:test2', async (_payload: any) => {
                const result = await godModeActivator.runIntegrationTest('3d-portfolio');
                return result;
        });

        // ── integration:test3 ──────────────────────────────────
        // Runs integration test 3: Fix bugs.
        handlers.set('integration:test3', async (_payload: any) => {
                const result = await godModeActivator.runIntegrationTest('fix-bugs');
                return result;
        });

        // ── integration:test4 ──────────────────────────────────
        // Runs integration test 4: Collaborative GOD mode.
        handlers.set('integration:test4', async (_payload: any) => {
                const result = await godModeActivator.runIntegrationTest('collaborative');
                return result;
        });

        // ══════════════════════════════════════════════════════════
        // Event Forwarders — Subscribe to service events and post to webview
        // ══════════════════════════════════════════════════════════

        // Phase 27: Credit events
        creditSystem.onCreditsChanged((e: { remaining: number; total: number; consumed: number }) => {
                postMessage('pricing:creditsChanged', e);
        });

        creditSystem.onBudgetWarning((alert: IPricingAlert) => {
                postMessage('pricing:budgetWarning', alert);
        });

        creditSystem.onEmergencyStop((e: { creditsRemaining: number }) => {
                postMessage('pricing:emergencyStop', e);
        });

        creditSystem.onTierChanged((e: { from: SubscriptionTier; to: SubscriptionTier }) => {
                postMessage('pricing:tierChanged', e);
        });

        creditSystem.onUsageRecorded((usage: ICreditUsage) => {
                postMessage('pricing:usageRecorded', usage);
        });

        // Phase 28: GOD Mode events
        godModeActivator.onStateChanged((state: GodModeState) => {
                postMessage('godmode:stateChanged', { state });
        });

        godModeActivator.onCountdown((count: number) => {
                postMessage('godmode:countdown', { count });
        });

        godModeActivator.onStopped((summary) => {
                postMessage('godmode:stopped', summary);
        });

        // Phase 28: Launch checklist events
        launchChecklist.onCheckCompleted((result) => {
                postMessage('launch:checkCompleted', result);
        });

        launchChecklist.onAllChecksCompleted((status) => {
                postMessage('launch:allChecksCompleted', status);
        });

        return handlers;
}

/**
 * Register pricing-related webview message handlers.
 * Legacy function — delegates to registerAllHandlers.
 *
 * @deprecated Use registerAllHandlers() instead for full Phase 28 support.
 */
export function registerPricingHandlers(
        creditSystem: ICreditSystem,
        costGovernor: ICostGovernor,
        postMessage: (channel: string, data: unknown) => void,
): Map<string, (payload: any) => Promise<unknown> | unknown> {
        // Create stub activator and checklist for backward compatibility
        // In production, use registerAllHandlers() with actual service instances
        const handlers = new Map<string, (payload: any) => Promise<unknown> | unknown>();

        // Pricing handlers only (same as before)
        handlers.set('pricing:getStatus', () => ({
                tier: creditSystem.getCurrentTier(),
                subscription: creditSystem.getSubscription(),
                creditsRemaining: creditSystem.getCreditsRemaining(),
                creditsTotal: creditSystem.getCreditsTotal(),
                usedThisMonth: creditSystem.getUsageThisMonth(),
                usedToday: creditSystem.getUsageToday(),
                emergencyMode: costGovernor.isEmergencyMode(),
                autoSwitchRecommended: costGovernor.shouldAutoSwitchModel(),
        }));

        handlers.set('pricing:getHistory', (payload: { limit?: number; startDate?: number; endDate?: number }) => {
                return creditSystem.getUsageHistory(payload.limit, payload.startDate, payload.endDate);
        });

        handlers.set('pricing:getBreakdown', () => {
                const breakdown = creditSystem.getUsageByActionType();
                const result: Record<string, number> = {};
                for (const [key, value] of breakdown) {
                        result[key] = value;
                }
                return result;
        });

        handlers.set('pricing:estimate', (payload: { prompt: string; model: string }) => {
                return creditSystem.estimateCost(payload.prompt, payload.model);
        });

        handlers.set('pricing:estimatePlan', (payload: { agentCount: number; estimatedSteps: number; model: string }) => {
                return { estimatedCredits: creditSystem.estimatePlanCost(payload) };
        });

        handlers.set('pricing:setBudget', (payload: ICreditBudget) => {
                creditSystem.setBudget(payload);
                return { success: true };
        });

        handlers.set('pricing:getBudget', () => creditSystem.getBudget());
        handlers.set('pricing:getAlerts', () => creditSystem.getAlerts());

        handlers.set('pricing:upgrade', () => {
                creditSystem.upgradeFlow();
                return { success: true };
        });

        handlers.set('pricing:purchase', async (payload: { amount: number }) => {
                return { success: await creditSystem.purchaseCredits(payload.amount) };
        });

        handlers.set('pricing:getPricingTable', () => creditSystem.getPricingTable());

        handlers.set('pricing:consume', (payload: { amount: number; actionType: CreditActionType; metadata?: any }) => {
                return { success: creditSystem.consumeCredits(payload.amount, payload.actionType, payload.metadata) };
        });

        handlers.set('pricing:exportUsage', () => ({ csv: creditSystem.exportUsageCSV() }));

        handlers.set('pricing:simulateTier', (payload: { tier: SubscriptionTier }) => {
                creditSystem.simulateTier(payload.tier);
                return { success: true };
        });

        // Event forwarders
        creditSystem.onCreditsChanged((e) => postMessage('pricing:creditsChanged', e));
        creditSystem.onBudgetWarning((alert) => postMessage('pricing:budgetWarning', alert));
        creditSystem.onEmergencyStop((e) => postMessage('pricing:emergencyStop', e));
        creditSystem.onTierChanged((e) => postMessage('pricing:tierChanged', e));
        creditSystem.onUsageRecorded((usage) => postMessage('pricing:usageRecorded', usage));

        return handlers;
}
