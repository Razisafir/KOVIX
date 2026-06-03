/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ISkillsMarketplace } from '../../../../../../platform/construct/common/skills/skillsMarketplace.js';
import { ISkill, ISkillSearchQuery, SkillCategory, SkillStepType } from '../../../../../../platform/construct/common/skills/skillsTypes.js';

const CACHE_KEY = 'construct.skills.marketplace.cache';
const RATINGS_KEY = 'construct.skills.marketplace.ratings';
const INSTALLED_KEY = 'construct.skills.marketplace.installed';
const CACHE_TTL_MS = 3600000; // 1 hour

export class SkillsMarketplaceService extends Disposable implements ISkillsMarketplace {
        readonly _serviceBrand: undefined;

        private catalog: ISkill[] = [];
        private installedSkills = new Set<string>();
        private skillRatings = new Map<string, { rating: number; count: number }>();
        private cacheTimestamp = 0;

        private readonly _onDidUpdateCatalog = this._register(new Emitter<ISkill[]>());
        readonly onDidUpdateCatalog = this._onDidUpdateCatalog.event;

        private readonly _onDidInstallSkill = this._register(new Emitter<string>());
        readonly onDidInstallSkill = this._onDidInstallSkill.event;

        private readonly _onDidUninstallSkill = this._register(new Emitter<string>());
        readonly onDidUninstallSkill = this._onDidUninstallSkill.event;

        constructor(
                @ILogService private readonly logService: ILogService,
                @IStorageService private readonly storageService: IStorageService
        ) {
                super();
                this.loadPersistedData();
                this.seedBuiltinSkills();
        }

        private loadPersistedData(): void {
                try {
                        const installed = this.storageService.getObject<string[]>(INSTALLED_KEY, StorageScope.PROFILE, []);
                        this.installedSkills = new Set(installed);

                        const ratings = this.storageService.getObject<Record<string, { rating: number; count: number }>>(RATINGS_KEY, StorageScope.PROFILE, {});
                        this.skillRatings = new Map(Object.entries(ratings));

                        this.logService.info(`[SkillsMarketplace] Loaded ${installed.length} installed skills`);
                } catch (error) {
                        this.logService.warn('[SkillsMarketplace] Failed to load persisted data:', error);
                }
        }

        async fetchCatalog(): Promise<ISkill[]> {
                if (this.catalog.length > 0 && (Date.now() - this.cacheTimestamp) < CACHE_TTL_MS) {
                        return this.catalog;
                }

                try {
                        this.logService.info('[SkillsMarketplace] Fetching catalog...');

                        // In production, fetch from GitHub/registry. For now, use seeded skills
                        this.catalog = this.getSeededSkills();
                        this.cacheTimestamp = Date.now();

                        this.storageService.store(CACHE_KEY, JSON.stringify({ catalog: this.catalog, timestamp: this.cacheTimestamp }), StorageScope.PROFILE, StorageTarget.MACHINE);
                        this._onDidUpdateCatalog.fire(this.catalog);

                        return this.catalog;
                } catch (error) {
                        this.logService.error('[SkillsMarketplace] Failed to fetch catalog:', error);
                        return this.catalog.length > 0 ? this.catalog : this.getSeededSkills();
                }
        }

        async searchCatalog(query: ISkillSearchQuery): Promise<{ skills: ISkill[]; total: number }> {
                let skills = await this.fetchCatalog();

                if (query.text) {
                        const lower = query.text.toLowerCase();
                        skills = skills.filter(s =>
                                s.name.toLowerCase().includes(lower) ||
                                s.description.toLowerCase().includes(lower) ||
                                s.tags.some(t => t.toLowerCase().includes(lower))
                        );
                }

                if (query.category) {
                        skills = skills.filter(s => s.category === query.category);
                }

                if (query.tags && query.tags.length > 0) {
                        skills = skills.filter(s => query.tags!.some(t => s.tags.includes(t)));
                }

                if (query.author) {
                        skills = skills.filter(s => s.author === query.author);
                }

                if (query.minRating !== undefined) {
                        skills = skills.filter(s => s.rating >= query.minRating!);
                }

                if (query.maxPrice !== undefined) {
                        skills = skills.filter(s => s.price <= query.maxPrice!);
                }

                if (query.verifiedOnly) {
                        skills = skills.filter(s => s.verified);
                }

                // Sort
                switch (query.sortBy) {
                        case 'rating':
                                skills.sort((a, b) => b.rating - a.rating);
                                break;
                        case 'downloads':
                                skills.sort((a, b) => b.downloadCount - a.downloadCount);
                                break;
                        case 'recent':
                                skills.sort((a, b) => b.updatedAt - a.updatedAt);
                                break;
                        case 'price':
                                skills.sort((a, b) => a.price - b.price);
                                break;
                        case 'relevance':
                        default:
                                skills.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.rating - a.rating);
                }

                const total = skills.length;
                const paginated = skills.slice(query.offset, query.offset + query.limit);

                return { skills: paginated, total };
        }

        async getFeaturedSkills(): Promise<ISkill[]> {
                const { skills } = await this.searchCatalog({
                        sortBy: 'relevance',
                        limit: 10,
                        offset: 0
                });
                return skills.filter(s => s.featured);
        }

        async getSkillsByCategory(category: SkillCategory): Promise<ISkill[]> {
                const { skills } = await this.searchCatalog({
                        category,
                        sortBy: 'downloads',
                        limit: 50,
                        offset: 0
                });
                return skills;
        }

        async getAllCategories(): Promise<SkillCategory[]> {
                const skills = await this.fetchCatalog();
                const categories = new Set(skills.map(s => s.category));
                return Array.from(categories).sort();
        }

        async getSkillById(id: string): Promise<ISkill | undefined> {
                const skills = await this.fetchCatalog();
                return skills.find(s => s.id === id);
        }

        async installSkill(skillId: string): Promise<void> {
                const skill = await this.getSkillById(skillId);
                if (!skill) { throw new Error(`Skill ${skillId} not found`); }

                this.installedSkills.add(skillId);
                this.persistInstalled();

                this._onDidInstallSkill.fire(skillId);
                this.logService.info(`[SkillsMarketplace] Installed skill: ${skill.name}`);
        }

        async uninstallSkill(skillId: string): Promise<void> {
                this.installedSkills.delete(skillId);
                this.persistInstalled();

                this._onDidUninstallSkill.fire(skillId);
                this.logService.info(`[SkillsMarketplace] Uninstalled skill: ${skillId}`);
        }

        isInstalled(skillId: string): boolean {
                return this.installedSkills.has(skillId);
        }

        getInstalledSkills(): ISkill[] {
                return this.catalog.filter(s => this.installedSkills.has(s.id));
        }

        async rateSkill(skillId: string, rating: number, comment?: string): Promise<void> {
                const current = this.skillRatings.get(skillId) ?? { rating: 0, count: 0 };
                const newCount = current.count + 1;
                const newRating = ((current.rating * current.count) + Math.max(1, Math.min(5, rating))) / newCount;

                this.skillRatings.set(skillId, { rating: newRating, count: newCount });
                this.persistRatings();

                this.logService.info(`[SkillsMarketplace] Rated ${skillId}: ${rating}/5`);
        }

        getSkillRating(skillId: string): number {
                return this.skillRatings.get(skillId)?.rating ?? 0;
        }

        getSkillReviews(_skillId: string): Array<{ rating: number; comment: string; author: string; timestamp: number }> {
                // In production, fetch from backend
                return [];
        }

        async refreshCatalog(): Promise<void> {
                this.cacheTimestamp = 0;
                await this.fetchCatalog();
        }

        getLastSyncTime(): number {
                return this.cacheTimestamp;
        }

        getCatalogVersion(): string {
                return '1.0.0';
        }

        private persistInstalled(): void {
                this.storageService.store(INSTALLED_KEY, Array.from(this.installedSkills), StorageScope.PROFILE, StorageTarget.USER);
        }

        private persistRatings(): void {
                this.storageService.store(RATINGS_KEY, Object.fromEntries(this.skillRatings), StorageScope.PROFILE, StorageTarget.USER);
        }

        private seedBuiltinSkills(): void {
                if (this.catalog.length > 0) { return; }
                this.catalog = this.getSeededSkills();
                this.logService.info(`[SkillsMarketplace] Seeded ${this.catalog.length} built-in skills`);
        }

        private getSeededSkills(): ISkill[] {
                const now = Date.now();

                return [
                        // Frontend
                        {
                                id: 'construct/react-component',
                                name: 'React Component with Tests',
                                description: 'Create a React functional component with TypeScript, Storybook story, and comprehensive unit tests using React Testing Library',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Frontend,
                                tags: ['react', 'typescript', 'testing', 'component'],
                                rating: 4.8,
                                downloadCount: 15000,
                                price: 0,
                                content: '# React Component Skill\n\nCreates a complete React component with TypeScript types, unit tests with React Testing Library, and Storybook story.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Analyze component requirements', content: 'Create a React component named {{componentName}} with props: {{props}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create component file', filePath: 'src/components/{{componentName}}/{{componentName}}.tsx', fileContent: 'import React from \'react\';\n\nexport interface {{componentName}}Props {\n  {{props}}\n}\n\nexport const {{componentName}}: React.FC<{{componentName}}Props> = (props) => {\n  return <div>{/* implementation */}</div>;\n};\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create test file', filePath: 'src/components/{{componentName}}/{{componentName}}.test.tsx', fileContent: 'import { render, screen } from \'@testing-library/react\';\nimport { {{componentName}} } from \'./{{componentName}}\';\n\ndescribe(\'{{componentName}}\', () => {\n  it(\'renders correctly\', () => {\n    render(<{{componentName}} />);\n  });\n});\n' },
                                        { type: SkillStepType.Verify, description: 'Verify tests pass', condition: 'testsPass' }
                                ],
                                requiredTools: ['file_write', 'terminal_execute'],
                                examples: ['Button with variants', 'Card with header/content/footer', 'Modal with backdrop'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        {
                                id: 'construct/nextjs-page',
                                name: 'Next.js Page with API Route',
                                description: 'Create a Next.js page with server-side rendering, client-side data fetching, and matching API route with validation',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Frontend,
                                tags: ['nextjs', 'react', 'api', 'ssr'],
                                rating: 4.7,
                                downloadCount: 12000,
                                price: 0,
                                content: '# Next.js Page Skill\n\nFull-stack Next.js page creation with API integration.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Plan page structure', content: 'Create Next.js page {{pageName}} with API route /api/{{pageName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create API route', filePath: 'src/app/api/{{pageName}}/route.ts', fileContent: 'import { NextResponse } from \'next/server\';\n\nexport async function GET() {\n  return NextResponse.json({ data: [] });\n}\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create page component', filePath: 'src/app/{{pageName}}/page.tsx', fileContent: 'export default async function {{pageName}}Page() {\n  const data = await fetch(\'/api/{{pageName}}\').then(r => r.json());\n  return <div>{JSON.stringify(data)}</div>;\n}\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Blog post page', 'Product catalog', 'User dashboard'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        // Backend
                        {
                                id: 'construct/express-api',
                                name: 'Express REST API',
                                description: 'Create a production-ready Express.js REST API with middleware, validation, error handling, and OpenAPI documentation',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Backend,
                                tags: ['express', 'nodejs', 'rest', 'api', 'openapi'],
                                rating: 4.6,
                                downloadCount: 11000,
                                price: 0,
                                content: '# Express API Skill\n\nProduction-ready REST API with all best practices.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design API endpoints', content: 'Create Express API for {{resourceName}} with CRUD operations' },
                                        { type: SkillStepType.FileEdit, description: 'Create server entry', filePath: 'src/server.ts', fileContent: 'import express from \'express\';\nimport { {{resourceName}}Router } from \'./routes/{{resourceName}}\';\n\nconst app = express();\napp.use(express.json());\napp.use(\'/api/{{resourceName}}\', {{resourceName}}Router);\napp.listen(3000);\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create route handlers', filePath: 'src/routes/{{resourceName}}.ts', fileContent: 'import { Router } from \'express\';\n\nexport const {{resourceName}}Router = Router();\n\n{{resourceName}}Router.get(\'/\', async (req, res) => {\n  res.json({ data: [] });\n});\n' },
                                        { type: SkillStepType.Verify, description: 'Verify server starts', condition: 'serverStarts' }
                                ],
                                requiredTools: ['file_write', 'terminal_execute'],
                                examples: ['User management API', 'E-commerce API', 'Blog API'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        {
                                id: 'construct/prisma-schema',
                                name: 'Prisma Database Schema',
                                description: 'Generate a Prisma schema with models, relations, indexes, and seed data for PostgreSQL',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Backend,
                                tags: ['prisma', 'database', 'postgresql', 'orm'],
                                rating: 4.5,
                                downloadCount: 9000,
                                price: 0,
                                content: '# Prisma Schema Skill\n\nDatabase schema design with Prisma ORM.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design database schema', content: 'Create Prisma schema for {{projectName}} with models: {{models}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create schema file', filePath: 'prisma/schema.prisma', fileContent: 'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel {{modelName}} {\n  id        Int      @id @default(autoincrement())\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n}\n' },
                                        { type: SkillStepType.ToolCall, description: 'Run Prisma generate', toolName: 'terminal_execute', toolArgs: { command: 'npx prisma generate' } }
                                ],
                                requiredTools: ['file_write', 'terminal_execute'],
                                examples: ['E-commerce schema', 'Social media schema', 'SaaS multi-tenant schema'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        // DevOps
                        {
                                id: 'construct/docker-node',
                                name: 'Dockerize Node.js App',
                                description: 'Create optimized multi-stage Dockerfile for Node.js with health checks, non-root user, and docker-compose for local development',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.DevOps,
                                tags: ['docker', 'nodejs', 'container', 'devops'],
                                rating: 4.7,
                                downloadCount: 13000,
                                price: 0,
                                content: '# Docker Node.js Skill\n\nProduction Docker setup with best practices.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Analyze app structure', content: 'Dockerize {{appName}} Node.js application' },
                                        { type: SkillStepType.FileEdit, description: 'Create Dockerfile', filePath: 'Dockerfile', fileContent: 'FROM node:18-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\n\nFROM node:18-alpine AS runtime\nWORKDIR /app\nCOPY --from=builder /app/node_modules ./node_modules\nCOPY . .\nUSER node\nEXPOSE 3000\nHEALTHCHECK --interval=30s CMD node healthcheck.js\nCMD ["node", "server.js"]\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create docker-compose', filePath: 'docker-compose.yml', fileContent: 'version: "3.8"\nservices:\n  app:\n    build: .\n    ports:\n      - "3000:3000"\n    environment:\n      - NODE_ENV=production\n' },
                                        { type: SkillStepType.Verify, description: 'Verify Docker build', condition: 'dockerBuilds' }
                                ],
                                requiredTools: ['file_write', 'terminal_execute'],
                                examples: ['Express API', 'Next.js app', 'Microservice'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        {
                                id: 'construct/github-actions',
                                name: 'GitHub Actions CI/CD',
                                description: 'Create comprehensive GitHub Actions workflows for testing, building, and deploying with matrix builds and caching',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.DevOps,
                                tags: ['github-actions', 'ci/cd', 'automation', 'testing'],
                                rating: 4.6,
                                downloadCount: 10000,
                                price: 0,
                                content: '# GitHub Actions CI/CD Skill\n\nComplete CI/CD pipeline setup.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Plan CI/CD pipeline', content: 'Create GitHub Actions for {{projectName}} with test, build, deploy stages' },
                                        { type: SkillStepType.FileEdit, description: 'Create CI workflow', filePath: '.github/workflows/ci.yml', fileContent: 'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 18\n          cache: \'npm\'\n      - run: npm ci\n      - run: npm test\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create deploy workflow', filePath: '.github/workflows/deploy.yml', fileContent: 'name: Deploy\non:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo "Deploying..."\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Node.js project', 'Python project', 'Docker deployment'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        {
                                id: 'construct/terraform-aws',
                                name: 'Terraform AWS Infrastructure',
                                description: 'Provision AWS infrastructure with Terraform including VPC, ECS, RDS, and load balancer with state management',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.DevOps,
                                tags: ['terraform', 'aws', 'infrastructure', 'iac'],
                                rating: 4.6,
                                downloadCount: 8500,
                                price: 0,
                                content: '# Terraform AWS Skill\n\nProduction infrastructure as code.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design infrastructure', content: 'Create Terraform for {{appName}} on AWS' },
                                        { type: SkillStepType.FileEdit, description: 'Create main.tf', filePath: 'terraform/main.tf', fileContent: 'terraform {\n  required_providers {\n    aws = { source = "hashicorp/aws", version = "~> 5.0" }\n  }\n}\n\nprovider "aws" {\n  region = var.aws_region\n}\n\nresource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create variables', filePath: 'terraform/variables.tf', fileContent: 'variable "aws_region" {\n  default = "us-east-1"\n}\n\nvariable "app_name" {\n  default = "{{appName}}"\n}\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Web app infrastructure', 'Microservices cluster', 'Serverless setup'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        {
                                id: 'construct/kubernetes-deploy',
                                name: 'Kubernetes Deployment',
                                description: 'Create Kubernetes manifests with deployments, services, ingress, config maps, and secrets for container orchestration',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.DevOps,
                                tags: ['kubernetes', 'k8s', 'containers', 'orchestration'],
                                rating: 4.5,
                                downloadCount: 7500,
                                price: 0,
                                content: '# Kubernetes Deployment Skill\n\nProduction K8s manifests.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Plan K8s architecture', content: 'Create K8s deployment for {{appName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create deployment', filePath: 'k8s/deployment.yml', fileContent: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{appName}}\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: {{appName}}\n  template:\n    spec:\n      containers:\n      - name: {{appName}}\n        image: {{appName}}:latest\n        ports:\n        - containerPort: 3000\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create service', filePath: 'k8s/service.yml', fileContent: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: {{appName}}-service\nspec:\n  selector:\n    app: {{appName}}\n  ports:\n  - port: 80\n    targetPort: 3000\n  type: LoadBalancer\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Web app deployment', 'Microservices', 'Cron jobs'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        // Testing
                        {
                                id: 'construct/test-suite',
                                name: 'Comprehensive Test Suite',
                                description: 'Generate a complete test suite with unit, integration, and e2e tests using Jest, Supertest, and Playwright',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Testing,
                                tags: ['testing', 'jest', 'playwright', 'e2e'],
                                rating: 4.5,
                                downloadCount: 8000,
                                price: 0,
                                content: '# Test Suite Skill\n\nComplete testing setup for any project.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Analyze codebase', content: 'Create test suite for {{projectName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create Jest config', filePath: 'jest.config.js', fileContent: 'module.exports = {\n  preset: \'ts-jest\',\n  testEnvironment: \'node\',\n  collectCoverageFrom: [\'src/**/*.ts\'],\n  coverageThreshold: {\n    global: { branches: 80, functions: 80, lines: 80 }\n  }\n};\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create test utilities', filePath: 'src/test/setup.ts', fileContent: 'import { jest } from \'@jest/globals\';\n\nbeforeEach(() => {\n  jest.clearAllMocks();\n});\n' },
                                        { type: SkillStepType.Verify, description: 'Run tests', condition: 'testsPass' }
                                ],
                                requiredTools: ['file_write', 'terminal_execute'],
                                examples: ['API testing', 'Component testing', 'E2E flow testing'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        // Security
                        {
                                id: 'construct/auth-system',
                                name: 'Authentication System',
                                description: 'Implement JWT authentication with refresh tokens, password hashing, rate limiting, and OAuth2 integration',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Security,
                                tags: ['auth', 'jwt', 'oauth', 'security', 'encryption'],
                                rating: 4.8,
                                downloadCount: 14000,
                                price: 0,
                                content: '# Authentication System Skill\n\nProduction-ready auth with security best practices.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design auth flow', content: 'Implement auth for {{appName}} with JWT + refresh tokens' },
                                        { type: SkillStepType.FileEdit, description: 'Create auth middleware', filePath: 'src/middleware/auth.ts', fileContent: 'import jwt from \'jsonwebtoken\';\nimport bcrypt from \'bcrypt\';\n\nconst JWT_SECRET = process.env.JWT_SECRET!;\nconst SALT_ROUNDS = 12;\n\nexport const hashPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);\nexport const comparePassword = (password: string, hash: string) => bcrypt.compare(password, hash);\nexport const generateToken = (payload: object) => jwt.sign(payload, JWT_SECRET, { expiresIn: \'1h\' });\nexport const verifyToken = (token: string) => jwt.verify(token, JWT_SECRET);\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create login route', filePath: 'src/routes/auth.ts', fileContent: 'import { Router } from \'express\';\nimport { hashPassword, comparePassword, generateToken } from \'../middleware/auth\';\n\nexport const authRouter = Router();\n\nauthRouter.post(\'/register\', async (req, res) => {\n  const { email, password } = req.body;\n  const hashedPassword = await hashPassword(password);\n  res.json({ success: true });\n});\n' },
                                        { type: SkillStepType.Verify, description: 'Verify auth works', condition: 'authTestsPass' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['JWT auth', 'OAuth2 integration', 'Session-based auth'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        // 3D/Visual
                        {
                                id: 'construct/threejs-scene',
                                name: 'Three.js 3D Scene',
                                description: 'Create an interactive Three.js scene with lighting, materials, camera controls, and responsive design',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.ThreeD,
                                tags: ['threejs', '3d', 'webgl', 'interactive'],
                                rating: 4.4,
                                downloadCount: 6000,
                                price: 0,
                                content: '# Three.js Scene Skill\n\nInteractive 3D web experiences.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Plan 3D scene', content: 'Create Three.js scene: {{sceneDescription}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create scene component', filePath: 'src/components/Scene3D.tsx', fileContent: 'import { useRef, useEffect } from \'react\';\nimport * as THREE from \'three\';\n\nexport const Scene3D: React.FC = () => {\n  const containerRef = useRef<HTMLDivElement>(null);\n  \n  useEffect(() => {\n    const scene = new THREE.Scene();\n    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);\n    const renderer = new THREE.WebGLRenderer();\n    renderer.setSize(window.innerWidth, window.innerHeight);\n    containerRef.current?.appendChild(renderer.domElement);\n    \n    const geometry = new THREE.BoxGeometry();\n    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });\n    const cube = new THREE.Mesh(geometry, material);\n    scene.add(cube);\n    camera.position.z = 5;\n    \n    const animate = () => {\n      requestAnimationFrame(animate);\n      cube.rotation.x += 0.01;\n      cube.rotation.y += 0.01;\n      renderer.render(scene, camera);\n    };\n    animate();\n  }, []);\n  \n  return <div ref={containerRef} />;\n};\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Product showcase', 'Data visualization', 'Interactive game'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        },

                        // Data Science
                        {
                                id: 'construct/data-pipeline',
                                name: 'ETL Data Pipeline',
                                description: 'Create a robust ETL pipeline with Python, Pandas, and Apache Airflow for data processing and scheduling',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.DataScience,
                                tags: ['etl', 'pandas', 'python', 'airflow', 'data'],
                                rating: 4.3,
                                downloadCount: 5000,
                                price: 0,
                                content: '# ETL Pipeline Skill\n\nData processing pipelines with scheduling.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design data flow', content: 'Create ETL pipeline for {{dataSource}} to {{destination}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create extract script', filePath: 'etl/extract.py', fileContent: 'import pandas as pd\n\ndef extract_data(source_url: str) -> pd.DataFrame:\n    return pd.read_csv(source_url)\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create transform script', filePath: 'etl/transform.py', fileContent: 'import pandas as pd\n\ndef transform_data(df: pd.DataFrame) -> pd.DataFrame:\n    df = df.dropna()\n    df = df.drop_duplicates()\n    return df\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create Airflow DAG', filePath: 'dags/etl_dag.py', fileContent: 'from airflow import DAG\nfrom airflow.operators.python import PythonOperator\nfrom datetime import datetime\n\nwith DAG(\'etl_pipeline\', start_date=datetime(2024, 1, 1), schedule_interval=\'@daily\') as dag:\n    etl_task = PythonOperator(task_id=\'run_etl\', python_callable=lambda: print("Running ETL..."))\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['CSV to database', 'API to warehouse', 'Real-time streaming'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        // Documentation
                        {
                                id: 'construct/api-docs',
                                name: 'API Documentation',
                                description: 'Generate comprehensive API documentation with OpenAPI spec, markdown guides, and interactive examples',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Documentation,
                                tags: ['docs', 'openapi', 'api', 'markdown'],
                                rating: 4.5,
                                downloadCount: 7000,
                                price: 0,
                                content: '# API Documentation Skill\n\nComplete API documentation setup.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Analyze API routes', content: 'Document API for {{projectName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create OpenAPI spec', filePath: 'docs/openapi.yml', fileContent: 'openapi: 3.0.0\ninfo:\n  title: {{projectName}} API\n  version: 1.0.0\npaths:\n  /api/users:\n    get:\n      summary: List users\n      responses:\n        200:\n          description: Success\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create README', filePath: 'docs/API.md', fileContent: '# {{projectName}} API Documentation\n\n## Getting Started\n\n## Endpoints\n\n- GET /api/users - List all users\n- POST /api/users - Create user\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['REST API docs', 'GraphQL schema docs', 'SDK documentation'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        // Mobile
                        {
                                id: 'construct/react-native-screen',
                                name: 'React Native Screen',
                                description: 'Create a React Native screen with navigation, state management, platform-specific styling, and unit tests',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Mobile,
                                tags: ['react-native', 'mobile', 'ios', 'android'],
                                rating: 4.4,
                                downloadCount: 5500,
                                price: 0,
                                content: '# React Native Screen Skill\n\nCross-platform mobile screen creation.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design screen layout', content: 'Create React Native screen: {{screenName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create screen component', filePath: 'src/screens/{{screenName}}.tsx', fileContent: 'import React from \'react\';\nimport { View, Text, StyleSheet } from \'react-native\';\n\nexport const {{screenName}}Screen: React.FC = () => {\n  return (\n    <View style={styles.container}>\n      <Text>{{screenName}}</Text>\n    </View>\n  );\n};\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, justifyContent: \'center\', alignItems: \'center\' }\n});\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Login screen', 'Profile screen', 'Settings screen'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        // More Backend
                        {
                                id: 'construct/websocket-realtime',
                                name: 'WebSocket Real-time API',
                                description: 'Implement WebSocket server with rooms, presence, message broadcasting, and reconnection handling using Socket.io or ws',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Backend,
                                tags: ['websocket', 'realtime', 'socket.io', 'events'],
                                rating: 4.4,
                                downloadCount: 6500,
                                price: 0,
                                content: '# WebSocket Real-time API Skill\n\nReal-time communication infrastructure.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design real-time architecture', content: 'Create WebSocket API for {{featureName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create WebSocket server', filePath: 'src/websocket/server.ts', fileContent: 'import { Server } from \'socket.io\';\n\nconst io = new Server({ cors: { origin: \'*\' } });\n\nio.on(\'connection\', (socket) => {\n  console.log(\'Client connected:\', socket.id);\n  socket.on(\'join-room\', (roomId) => {\n    socket.join(roomId);\n    socket.to(roomId).emit(\'user-joined\', socket.id);\n  });\n  socket.on(\'disconnect\', () => {\n    console.log(\'Client disconnected:\', socket.id);\n  });\n});\n\nio.listen(3001);\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Chat application', 'Live collaboration', 'Real-time dashboard'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        {
                                id: 'construct/graphql-api',
                                name: 'GraphQL API with Apollo',
                                description: 'Create a GraphQL API with Apollo Server including type definitions, resolvers, dataloaders, and subscription support',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Backend,
                                tags: ['graphql', 'apollo', 'api', 'subscriptions'],
                                rating: 4.5,
                                downloadCount: 7000,
                                price: 0,
                                content: '# GraphQL API Skill\n\nModern GraphQL server setup.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Design GraphQL schema', content: 'Create GraphQL API for {{domain}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create schema', filePath: 'src/graphql/schema.ts', fileContent: 'import { gql } from \'apollo-server\';\n\nexport const typeDefs = gql`\n  type Query {\n    items: [Item!]!\n    item(id: ID!): Item\n  }\n  type Item {\n    id: ID!\n    name: String!\n    createdAt: String!\n  }\n`;\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create resolvers', filePath: 'src/graphql/resolvers.ts', fileContent: 'export const resolvers = {\n  Query: {\n    items: () => [],\n    item: (_: any, { id }: { id: string }) => ({ id, name: \'Test\' })\n  }\n};\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['Social media API', 'E-commerce API', 'CMS API'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: false
                        },

                        {
                                id: 'construct/stripe-payments',
                                name: 'Stripe Payments Integration',
                                description: 'Integrate Stripe for payments with checkout sessions, webhooks, subscription management, and invoice handling',
                                author: 'construct',
                                version: '1.0.0',
                                category: SkillCategory.Backend,
                                tags: ['stripe', 'payments', 'billing', 'e-commerce'],
                                rating: 4.7,
                                downloadCount: 9000,
                                price: 0,
                                content: '# Stripe Payments Skill\n\nComplete payment processing setup.',
                                steps: [
                                        { type: SkillStepType.Prompt, description: 'Plan payment flow', content: 'Integrate Stripe for {{appName}}' },
                                        { type: SkillStepType.FileEdit, description: 'Create payment service', filePath: 'src/services/payments.ts', fileContent: 'import Stripe from \'stripe\';\n\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: \'2024-06-20\' });\n\nexport const createCheckoutSession = async (priceId: string, customerId: string) => {\n  return stripe.checkout.sessions.create({\n    customer: customerId,\n    line_items: [{ price: priceId, quantity: 1 }],\n    mode: \'payment\',\n    success_url: \'/success\',\n    cancel_url: \'/cancel\'\n  });\n};\n' },
                                        { type: SkillStepType.FileEdit, description: 'Create webhook handler', filePath: 'src/routes/webhooks.ts', fileContent: 'import { Router } from \'express\';\nimport Stripe from \'stripe\';\n\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: \'2024-06-20\' });\nexport const webhookRouter = Router();\n\nwebhookRouter.post(\'/stripe\', async (req, res) => {\n  const sig = req.headers[\'stripe-signature\'];\n  const event = stripe.webhooks.constructEvent(req.body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);\n  res.json({ received: true });\n});\n' }
                                ],
                                requiredTools: ['file_write'],
                                examples: ['One-time payments', 'Subscriptions', 'Marketplace payments'],
                                createdAt: now,
                                updatedAt: now,
                                verified: true,
                                featured: true
                        }
                ];
        }
}
