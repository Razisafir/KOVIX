/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Welcome Screen View
 *  Phase 28: First-launch welcome screen with feature tour and quick start
 *
 *  Provides an interactive onboarding experience with 5 feature steps,
 *  live demos, quick start buttons, recent projects, and telemetry consent.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICreditSystem } from '../../../../../platform/construct/common/pricing/creditSystem.js';
import { SubscriptionTier, TIER_CONFIG } from '../../../../../platform/construct/common/pricing/pricingTypes.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import {
        WelcomeDemoType,
        IRecentProject,
} from '../../../../../platform/construct/common/integration/launchTypes.js';

// ── Constants ─────────────────────────────────────────────────

const CONSTRUCT_VERSION = 'v1.0.0-god-mode';
const STORAGE_KEY_RECENT_PROJECTS = 'construct.welcome.recentProjects';
const STORAGE_KEY_TELEMETRY_CONSENTED = 'construct.telemetry.consented';
const STORAGE_KEY_WELCOME_SHOWN = 'construct.welcome.shown';

// ── Feature Tour Steps ────────────────────────────────────────

interface IFeatureStep {
        readonly id: WelcomeDemoType;
        readonly title: string;
        readonly subtitle: string;
        readonly description: string;
        readonly icon: string;
}

const FEATURE_STEPS: IFeatureStep[] = [
        {
                id: 'multi-agent',
                title: 'Meet your AI team',
                subtitle: 'Phase 20: Multi-Agent Orchestration',
                description: 'CONSTRUCT deploys specialized AI agents that work in parallel. A planner decomposes your goal, coders execute in parallel, testers validate, and reviewers check quality — all orchestrated automatically with dependency graphs and milestones.',
                icon: '$(organization)',
        },
        {
                id: 'mcp-marketplace',
                title: 'Infinite tools',
                subtitle: 'Phase 17: MCP Server Marketplace',
                description: 'Connect to 10,000+ tool connectors through the Model Context Protocol marketplace. Web search, database queries, API integrations, cloud services — your agents have access to every tool they need, automatically discovered and configured.',
                icon: '$(extensions)',
        },
        {
                id: 'memory',
                title: 'Never forgets',
                subtitle: 'Phase 19: Four-Layer Memory',
                description: 'CONSTRUCT remembers everything across sessions. Working memory tracks your active context, episodic memory records every action, semantic memory builds knowledge, and procedural memory learns patterns that work — so it gets smarter over time.',
                icon: '$(brain)',
        },
        {
                id: 'timeline',
                title: 'See the future',
                subtitle: 'Phase 25: Visual Execution Timeline',
                description: 'Watch your AI team work in real-time with a Gantt-chart timeline. See which agents are running, their dependencies, milestones reached, and estimated completion — full transparency into what CONSTRUCT is doing and why.',
                icon: '$(watch)',
        },
        {
                id: 'godmode',
                title: 'Go GOD Mode',
                subtitle: 'Phase 28: Final Integration',
                description: 'Activate GOD Mode to unleash the full power of CONSTRUCT. One goal, automated execution across all phases — planning, coding, testing, reviewing, deploying. With credit transparency, safety checkpoints, and emergency stop, you stay in control.',
                icon: '$(zap)',
        },
];

// ── Quick Start Templates ─────────────────────────────────────

interface IQuickStartTemplate {
        readonly label: string;
        readonly description: string;
        readonly goal: string;
        readonly icon: string;
}

const QUICK_START_TEMPLATES: IQuickStartTemplate[] = [
        {
                label: 'Create a React app',
                description: 'Full-stack React application with authentication',
                goal: 'Create a React app with JWT authentication, Express backend, and Prisma ORM',
                icon: '$(code)',
        },
        {
                label: 'Build an API',
                description: 'REST API with database and tests',
                goal: 'Build a REST API with Express, Prisma ORM, SQLite database, and comprehensive tests',
                icon: '$(server)',
        },
        {
                label: 'Fix bugs',
                description: 'Find and fix issues in your codebase',
                goal: 'Analyze the codebase, find bugs, and fix them with tests',
                icon: '$(bug)',
        },
        {
                label: 'Open 3D Studio',
                description: 'Create 3D scenes and visual content',
                goal: 'Open the 3D visual creation studio',
                icon: '$(cube)',
        },
];

// ══════════════════════════════════════════════════════════════
// ConstructWelcome — Welcome screen logic
// ══════════════════════════════════════════════════════════════

export class ConstructWelcome extends Disposable {
        private _currentStep: number = 0;
        private _telemetryConsented: boolean | undefined;

        constructor(
                @ICreditSystem private readonly creditSystem: ICreditSystem,
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();

                this._telemetryConsented = this._loadTelemetryConsent();
                this.logService.info(`[Welcome] Initialized — version: ${CONSTRUCT_VERSION}`);
        }

        // ── Version ────────────────────────────────────────────

        getVersion(): string {
                return CONSTRUCT_VERSION;
        }

        // ── Feature Tour ───────────────────────────────────────

        getFeatureSteps(): IFeatureStep[] {
                return [...FEATURE_STEPS];
        }

        getCurrentStep(): number {
                return this._currentStep;
        }

        nextStep(): IFeatureStep | undefined {
                if (this._currentStep < FEATURE_STEPS.length - 1) {
                        this._currentStep++;
                        return FEATURE_STEPS[this._currentStep];
                }
                return undefined;
        }

        previousStep(): IFeatureStep | undefined {
                if (this._currentStep > 0) {
                        this._currentStep--;
                        return FEATURE_STEPS[this._currentStep];
                }
                return undefined;
        }

        goToStep(index: number): IFeatureStep | undefined {
                if (index >= 0 && index < FEATURE_STEPS.length) {
                        this._currentStep = index;
                        return FEATURE_STEPS[this._currentStep];
                }
                return undefined;
        }

        // ── Demo Simulation ────────────────────────────────────

        startDemo(demoType: WelcomeDemoType): {
                simulatedOutput: string;
                durationMs: number;
        } {
                let simulatedOutput: string;
                let durationMs = 500;

                switch (demoType) {
                        case 'multi-agent':
                                simulatedOutput = [
                                        'Planner Agent: Decomposing goal into 5 milestones...',
                                        '  Milestone 1: Project scaffolding ✓',
                                        '  Milestone 2: Frontend components (in progress)',
                                        '  Milestone 3: Backend API (queued)',
                                        '  Milestone 4: Database schema (queued)',
                                        '  Milestone 5: Integration tests (queued)',
                                        '',
                                        'Coder Agent (Frontend): Creating Login.tsx...',
                                        'Coder Agent (Backend): Setting up Express routes...',
                                ].join('\n');
                                durationMs = 2000;
                                break;

                        case 'mcp-marketplace':
                                simulatedOutput = [
                                        'MCP Marketplace — Available Servers:',
                                        '  • brave-search: Web search (installed)',
                                        '  • github-mcp: GitHub API (installed)',
                                        '  • postgres-mcp: PostgreSQL client',
                                        '  • stripe-mcp: Stripe payment integration',
                                        '  • figma-mcp: Figma design import',
                                        '  ... 9,995 more connectors',
                                ].join('\n');
                                durationMs = 1000;
                                break;

                        case 'memory':
                                simulatedOutput = [
                                        'Memory Query: "What auth pattern do we use?"',
                                        '',
                                        'Working Memory: Active files: auth.ts, login.tsx',
                                        'Episodic Memory: "Last session, switched from session-based to JWT auth"',
                                        'Semantic Memory: "This project uses JWT with RS256 signing"',
                                        'Procedural Memory: "For auth: create middleware → generate token → verify on each request"',
                                ].join('\n');
                                durationMs = 1500;
                                break;

                        case 'timeline':
                                simulatedOutput = [
                                        'Execution Timeline:',
                                        '  [09:00] Planner Agent  ████████░░ 80% — 4/5 milestones',
                                        '  [09:02] Coder-Frontend ██████████ 100% ✓',
                                        '  [09:02] Coder-Backend  ██████░░░░ 60%',
                                        '  [09:01] Tester Agent   ░░░░░░░░░░ 0% (queued)',
                                        '  [09:05] Review Agent   ░░░░░░░░░░ 0% (queued)',
                                ].join('\n');
                                durationMs = 1200;
                                break;

                        case 'godmode':
                                simulatedOutput = [
                                        'GOD Mode Activation Sequence:',
                                        '',
                                        '  Checking prerequisites... ✓',
                                        '  Creating git checkpoint... ✓',
                                        '  3... 2... 1...',
                                        '',
                                        '  ★ GOD MODE ACTIVE ★',
                                        '  Goal: "Build a full-stack SaaS"',
                                        '  Credits: 490/500 remaining',
                                        '  Agents: 6 active',
                                ].join('\n');
                                durationMs = 3000;
                                break;

                        default:
                                simulatedOutput = 'Demo not available';
                                durationMs = 500;
                }

                this.logService.trace(`[Welcome] Demo started: ${demoType}`);
                return { simulatedOutput, durationMs };
        }

        // ── Quick Start ────────────────────────────────────────

        getQuickStartTemplates(): IQuickStartTemplate[] {
                return [...QUICK_START_TEMPLATES];
        }

        // ── Recent Projects ────────────────────────────────────

        getRecentProjects(): IRecentProject[] {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_RECENT_PROJECTS, StorageScope.PROFILE, undefined);
                        if (saved) {
                                return JSON.parse(saved) as IRecentProject[];
                        }
                } catch (err) {
                        this.logService.error('[Welcome] Failed to load recent projects:', err);
                }
                return [];
        }

        addRecentProject(project: IRecentProject): void {
                const projects = this.getRecentProjects();

                // Remove duplicate if exists
                const filtered = projects.filter(p => p.path !== project.path);

                // Add to front
                filtered.unshift(project);

                // Keep only last 10
                const trimmed = filtered.slice(0, 10);

                this.storageService.store(
                        STORAGE_KEY_RECENT_PROJECTS,
                        JSON.stringify(trimmed),
                        StorageScope.PROFILE,
                        StorageTarget.MACHINE,
                );
        }

        // ── Telemetry Consent ──────────────────────────────────

        getTelemetryConsent(): boolean | undefined {
                return this._telemetryConsented;
        }

        consentTelemetry(consented: boolean): void {
                this._telemetryConsented = consented;

                this.storageService.store(
                        STORAGE_KEY_TELEMETRY_CONSENTED,
                        String(consented),
                        StorageScope.PROFILE,
                        StorageTarget.MACHINE,
                );

                // Update configuration
                try {
                        this.configurationService.updateValue('construct.telemetry.enabled', consented);
                        this.configurationService.updateValue('construct.telemetry.consented', consented);
                } catch {
                        // Configuration update may fail in some contexts
                }

                this.logService.info(`[Welcome] Telemetry consent: ${consented}`);
        }

        needsTelemetryConsent(): boolean {
                return this._telemetryConsented === undefined;
        }

        // ── Pricing Tier ───────────────────────────────────────

        getCurrentTierInfo(): {
                tier: SubscriptionTier;
                creditsRemaining: number;
                creditsTotal: number;
                priceLabel: string;
                features: string[];
                upgradeCTA: string;
        } {
                const tier = this.creditSystem.getCurrentTier();
                const config = TIER_CONFIG[tier];

                let upgradeCTA = '';
                switch (tier) {
                        case SubscriptionTier.Free:
                                upgradeCTA = 'Upgrade to Pro — 500 credits/month';
                                break;
                        case SubscriptionTier.Pro:
                                upgradeCTA = 'Upgrade to Team — 1000 credits/user/month';
                                break;
                        case SubscriptionTier.Team:
                                upgradeCTA = 'Upgrade to Enterprise — Unlimited credits';
                                break;
                        case SubscriptionTier.Enterprise:
                        case SubscriptionTier.GodMode:
                                upgradeCTA = '';
                                break;
                }

                return {
                        tier,
                        creditsRemaining: this.creditSystem.getCreditsRemaining(),
                        creditsTotal: this.creditSystem.getCreditsTotal(),
                        priceLabel: config.priceLabel,
                        features: config.features,
                        upgradeCTA,
                };
        }

        // ── Welcome State ──────────────────────────────────────

        hasSeenWelcome(): boolean {
                try {
                        return this.storageService.getBoolean(STORAGE_KEY_WELCOME_SHOWN, StorageScope.PROFILE, false);
                } catch {
                        return false;
                }
        }

        markWelcomeShown(): void {
                this.storageService.store(STORAGE_KEY_WELCOME_SHOWN, 'true', StorageScope.PROFILE, StorageTarget.MACHINE);
        }

        // ── Private Helpers ────────────────────────────────────

        private _loadTelemetryConsent(): boolean | undefined {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_TELEMETRY_CONSENTED, StorageScope.PROFILE, undefined);
                        if (saved === 'true') { return true; }
                        if (saved === 'false') { return false; }
                } catch {
                        // Ignore
                }
                return undefined;
        }

        override dispose(): void {
                super.dispose();
        }
}
