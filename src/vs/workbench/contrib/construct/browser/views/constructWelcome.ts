/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Welcome Screen View
 *  MVP: First-launch welcome with quick start templates
 *
 *  No pricing, no credit system, no GOD mode. BYOK only.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

// ── Constants ─────────────────────────────────────────────────

const CONSTRUCT_VERSION = 'v0.1.0-mvp';
const STORAGE_KEY_RECENT_PROJECTS = 'construct.welcome.recentProjects';
const STORAGE_KEY_WELCOME_SHOWN = 'construct.welcome.shown';

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
                label: 'Docker setup',
                description: 'Containerize your application',
                goal: 'Create Docker configuration for the current project with docker-compose',
                icon: '$(package)',
        },
];

// ── Feature Descriptions ──────────────────────────────────────

interface IFeature {
        readonly title: string;
        readonly description: string;
        readonly icon: string;
}

const FEATURES: IFeature[] = [
        {
                title: 'AI Coding Agent',
                description: 'Describe what you want in natural language. Construct reads files, writes code, runs commands, and iterates until the task is done.',
                icon: '$(robot)',
        },
        {
                title: 'Real LLM Connection',
                description: 'Connect your Anthropic API key and get real Claude responses. No simulations, no stubs — real AI power.',
                icon: '$(sparkle)',
        },
        {
                title: 'MCP Filesystem Tools',
                description: 'Read, write, and edit files through the Model Context Protocol. Your agent has full filesystem access.',
                icon: '$(folder)',
        },
        {
                title: 'Terminal Access',
                description: 'Run commands safely with built-in security checks. Install packages, run tests, start servers — all from the agent.',
                icon: '$(terminal)',
        },
];

// ══════════════════════════════════════════════════════════════
// ConstructWelcome — Welcome screen logic
// ══════════════════════════════════════════════════════════════

export class ConstructWelcome extends Disposable {

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService,
                @IConfigurationService private readonly configurationService: IConfigurationService,
        ) {
                super();
                void this.configurationService;
                this.logService.info(`[Welcome] Initialized — version: ${CONSTRUCT_VERSION}`);
        }

        // ── Version ────────────────────────────────────────────

        getVersion(): string {
                return CONSTRUCT_VERSION;
        }

        // ── Features ───────────────────────────────────────────

        getFeatures(): IFeature[] {
                return [...FEATURES];
        }

        // ── Quick Start ────────────────────────────────────────

        getQuickStartTemplates(): IQuickStartTemplate[] {
                return [...QUICK_START_TEMPLATES];
        }

        // ── Recent Projects ────────────────────────────────────

        getRecentProjects(): { name: string; path: string; lastOpened: number }[] {
                try {
                        const saved = this.storageService.get(STORAGE_KEY_RECENT_PROJECTS, StorageScope.PROFILE, undefined);
                        if (saved) {
                                return JSON.parse(saved);
                        }
                } catch (err) {
                        this.logService.error('[Welcome] Failed to load recent projects:', err);
                }
                return [];
        }

        addRecentProject(project: { name: string; path: string; lastOpened: number }): void {
                const projects = this.getRecentProjects();
                const filtered = projects.filter(p => p.path !== project.path);
                filtered.unshift(project);
                const trimmed = filtered.slice(0, 10);
                this.storageService.store(
                        STORAGE_KEY_RECENT_PROJECTS,
                        JSON.stringify(trimmed),
                        StorageScope.PROFILE,
                        StorageTarget.MACHINE,
                );
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

        override dispose(): void {
                super.dispose();
        }
}
