// Copyright (c) 2025 Razisafir. All rights reserved.
// Kovix proprietary code. See CONSTRUCT_LICENSE.txt.
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import {
        IConstructProjectService,
} from '../../../../../../platform/construct/common/project/constructProjectService.js';
import {
        ProjectTemplate,
        ProjectStatus,
        IKovixProject,
        IProjectCreationInput,
        IProjectSummary,
} from '../../../../../../platform/construct/common/project/constructProjectTypes.js';

// --- Constants ----------------------------------------------------------------

const CONSTRUCT_DIR = '.construct';
const PROJECT_MANIFEST = 'project.json';
const GLOBAL_REGISTRY_DIR = '.kovix';
const GLOBAL_REGISTRY_FILE = 'projects.json';

// --- Scaffold file entry ------------------------------------------------------

interface IScaffoldFile {
        readonly path: string;
        readonly content: string;
}

// --- Global registry types ----------------------------------------------------

interface IGlobalRegistryEntry {
        readonly id: string;
        readonly name: string;
        readonly template: ProjectTemplate;
        readonly status: ProjectStatus;
        readonly workspaceRoot: string;
        readonly lastActiveAt: number;
        readonly createdAt: number;
}

// --- Implementation -----------------------------------------------------------

export class ConstructProjectServiceImpl extends Disposable implements IConstructProjectService {
        readonly _serviceBrand: undefined;

        private _activeProject: IKovixProject | null = null;
        private readonly _projects = new Map<string, IKovixProject>();

        private readonly _onDidCreateProject = this._register(new Emitter<IKovixProject>());
        readonly onDidCreateProject = this._onDidCreateProject.event;

        private readonly _onDidDeleteProject = this._register(new Emitter<string>());
        readonly onDidDeleteProject = this._onDidDeleteProject.event;

        private readonly _onDidChangeProjectStatus = this._register(new Emitter<{ id: string; status: ProjectStatus }>());
        readonly onDidChangeProjectStatus = this._onDidChangeProjectStatus.event;

        get activeProject(): IKovixProject | null {
                return this._activeProject;
        }

        get projects(): ReadonlyArray<IProjectSummary> {
                const now = Date.now();
                return Array.from(this._projects.values()).map(p => ({
                        id: p.id,
                        name: p.name,
                        template: p.template,
                        status: p.status,
                        lastActiveAt: now,
                }));
        }

        constructor(
                @IFileService private readonly fileService: IFileService,
                @IWorkspaceContextService _workspaceContextService: IWorkspaceContextService,
                @ILogService private readonly logService: ILogService,
        ) {
                super();
                this.loadGlobalRegistry().catch(err => {
                        this.logService.warn('[ConstructProject] Failed to load global registry on init:', err instanceof Error ? err.message : String(err));
                });
                this.logService.info('[ConstructProject] Service created');
        }

        // --- Public API ------------------------------------------------------------

        async createProject(input: IProjectCreationInput): Promise<IKovixProject> {
                const id = generateUuid();
                const now = Date.now();

                const project: IKovixProject = {
                        id,
                        name: input.name,
                        description: input.description,
                        template: input.template,
                        techStack: input.techStack,
                        goals: input.goals,
                        workspaceRoot: input.workspaceRoot,
                        status: ProjectStatus.Initializing,
                        createdAt: now,
                        updatedAt: now,
                };

                this.logService.info(`[ConstructProject] Creating project "${input.name}" with template ${input.template}`);

                // 1. Scaffold the workspace files based on template
                const scaffoldFiles = this.getScaffoldForTemplate(input.template, input.name);
                const workspaceRoot = URI.file(input.workspaceRoot);

                for (const file of scaffoldFiles) {
                        const fileUri = URI.joinPath(workspaceRoot, file.path);
                        try {
                                await this.ensureParentDirectory(fileUri);
                                await this.fileService.writeFile(fileUri, VSBuffer.wrap(new TextEncoder().encode(file.content)));
                        } catch (error) {
                                this.logService.warn(`[ConstructProject] Failed to write scaffold file ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                }

                // 2. Write the .construct/project.json manifest
                const constructDir = URI.joinPath(workspaceRoot, CONSTRUCT_DIR);
                try {
                        await this.fileService.createFolder(constructDir);
                } catch {
                        // Directory might already exist
                }

                const manifestUri = URI.joinPath(constructDir, PROJECT_MANIFEST);
                const manifestContent = JSON.stringify({
                        ...project,
                        status: ProjectStatus.Active,
                        updatedAt: Date.now(),
                }, null, 2);
                await this.fileService.writeFile(manifestUri, VSBuffer.wrap(new TextEncoder().encode(manifestContent)));

                // 3. Update project status to active
                const activeProject: IKovixProject = {
                        ...project,
                        status: ProjectStatus.Active,
                        updatedAt: Date.now(),
                };

                // 4. Register in global registry
                this._projects.set(id, activeProject);
                await this.writeGlobalRegistry();

                // 5. Set as active project
                this._activeProject = activeProject;

                // 6. Fire events
                this._onDidCreateProject.fire(activeProject);

                this.logService.info(`[ConstructProject] Project "${input.name}" created successfully (id: ${id})`);
                return activeProject;
        }

        async deleteProject(id: string, removeFiles?: boolean): Promise<void> {
                const project = this._projects.get(id);
                if (!project) {
                        this.logService.warn(`[ConstructProject] Cannot delete unknown project: ${id}`);
                        return;
                }

                // Optionally remove workspace files
                if (removeFiles) {
                        try {
                                const workspaceUri = URI.file(project.workspaceRoot);
                                await this.fileService.del(workspaceUri, { recursive: true });
                        } catch (error) {
                                this.logService.warn(`[ConstructProject] Failed to remove workspace files: ${error instanceof Error ? error.message : String(error)}`);
                        }
                }

                // Remove from registry
                this._projects.delete(id);

                // Clear active project if it was the one deleted
                if (this._activeProject?.id === id) {
                        this._activeProject = null;
                }

                await this.writeGlobalRegistry();
                this._onDidDeleteProject.fire(id);

                this.logService.info(`[ConstructProject] Project ${id} deleted (removeFiles: ${!!removeFiles})`);
        }

        async loadProject(id: string): Promise<IKovixProject> {
                const project = this._projects.get(id);
                if (!project) {
                        throw new Error(`Project not found: ${id}`);
                }

                // Try to read the manifest from disk for the latest state
                try {
                        const manifestUri = URI.joinPath(URI.file(project.workspaceRoot), CONSTRUCT_DIR, PROJECT_MANIFEST);
                        const content = await this.fileService.readFile(manifestUri);
                        const manifest = JSON.parse(new TextDecoder().decode(content.value.buffer)) as IKovixProject;

                        const updatedProject: IKovixProject = {
                                ...manifest,
                                updatedAt: Date.now(),
                        };

                        this._projects.set(id, updatedProject);
                        this._activeProject = updatedProject;
                        await this.writeGlobalRegistry();

                        this.logService.info(`[ConstructProject] Project "${manifest.name}" loaded (id: ${id})`);
                        return updatedProject;
                } catch (error) {
                        // Fallback to in-memory version
                        this._activeProject = project;
                        this.logService.warn(`[ConstructProject] Could not read manifest for ${id}, using in-memory copy`);
                        return project;
                }
        }

        async updateProjectStatus(id: string, status: ProjectStatus): Promise<void> {
                const project = this._projects.get(id);
                if (!project) {
                        this.logService.warn(`[ConstructProject] Cannot update status for unknown project: ${id}`);
                        return;
                }

                const updatedProject: IKovixProject = {
                        ...project,
                        status,
                        updatedAt: Date.now(),
                };

                this._projects.set(id, updatedProject);

                // Update the manifest on disk
                try {
                        const manifestUri = URI.joinPath(URI.file(project.workspaceRoot), CONSTRUCT_DIR, PROJECT_MANIFEST);
                        const manifestContent = JSON.stringify(updatedProject, null, 2);
                        await this.fileService.writeFile(manifestUri, VSBuffer.wrap(new TextEncoder().encode(manifestContent)));
                } catch (error) {
                        this.logService.warn(`[ConstructProject] Could not update manifest on disk: ${error instanceof Error ? error.message : String(error)}`);
                }

                // Update active project reference
                if (this._activeProject?.id === id) {
                        this._activeProject = updatedProject;
                }

                await this.writeGlobalRegistry();
                this._onDidChangeProjectStatus.fire({ id, status });

                this.logService.info(`[ConstructProject] Project ${id} status changed to ${status}`);
        }

        getProject(id: string): IKovixProject | undefined {
                return this._projects.get(id);
        }

        setActiveProject(id: string): void {
                const project = this._projects.get(id);
                if (project) {
                        this._activeProject = project;
                        this.logService.info(`[ConstructProject] Active project set to "${project.name}" (id: ${id})`);
                } else {
                        this.logService.warn(`[ConstructProject] Cannot set active project: unknown id ${id}`);
                }
        }

        async detectAndLoadProject(workspaceRoot: string): Promise<IKovixProject | null> {
                const manifestUri = URI.joinPath(URI.file(workspaceRoot), CONSTRUCT_DIR, PROJECT_MANIFEST);

                try {
                        const content = await this.fileService.readFile(manifestUri);
                        const manifest = JSON.parse(new TextDecoder().decode(content.value.buffer)) as IKovixProject;

                        this._projects.set(manifest.id, manifest);
                        this._activeProject = manifest;
                        await this.writeGlobalRegistry();

                        this.logService.info(`[ConstructProject] Detected and loaded project "${manifest.name}" from workspace (id: ${manifest.id})`);
                        return manifest;
                } catch {
                        this.logService.trace(`[ConstructProject] No .construct/project.json found at ${workspaceRoot}`);
                        return null;
                }
        }

        // --- Template Scaffolds ----------------------------------------------------

        private getScaffoldForTemplate(template: ProjectTemplate, projectName: string): IScaffoldFile[] {
                switch (template) {
                        case ProjectTemplate.Empty:
                                return this.scaffoldEmpty(projectName);
                        case ProjectTemplate.WebApp:
                                return this.scaffoldWebApp(projectName);
                        case ProjectTemplate.APIServer:
                                return this.scaffoldAPIServer(projectName);
                        case ProjectTemplate.CLITool:
                                return this.scaffoldCLITool(projectName);
                        case ProjectTemplate.MobileApp:
                                return this.scaffoldMobileApp(projectName);
                        case ProjectTemplate.DesktopApp:
                                return this.scaffoldDesktopApp(projectName);
                        case ProjectTemplate.DataScience:
                                return this.scaffoldDataScience(projectName);
                        case ProjectTemplate.GameDev:
                                return this.scaffoldGameDev(projectName);
                        default:
                                return this.scaffoldEmpty(projectName);
                }
        }

        private scaffoldEmpty(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: '',
                                        main: 'index.js',
                                        scripts: {
                                                start: 'node index.js',
                                        },
                                        keywords: [],
                                        license: 'MIT',
                                }, null, 2),
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\ndist/\n.env\n.construct/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA new KOVIX project.\n`,
                        },
                ];
        }

        private scaffoldWebApp(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'Web application built with KOVIX',
                                        type: 'module',
                                        scripts: {
                                                dev: 'vite',
                                                build: 'tsc && vite build',
                                                preview: 'vite preview',
                                        },
                                        devDependencies: {
                                                typescript: '^5.4.0',
                                                vite: '^5.2.0',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'tsconfig.json',
                                content: JSON.stringify({
                                        compilerOptions: {
                                                target: 'ES2022',
                                                module: 'ESNext',
                                                moduleResolution: 'bundler',
                                                strict: true,
                                                esModuleInterop: true,
                                                skipLibCheck: true,
                                                forceConsistentCasingInFileNames: true,
                                                outDir: './dist',
                                                rootDir: './src',
                                        },
                                        include: ['src'],
                                        exclude: ['node_modules', 'dist'],
                                }, null, 2),
                        },
                        {
                                path: 'vite.config.ts',
                                content: `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n\troot: '.',\n\tbuild: {\n\t\toutDir: 'dist',\n\t},\n\tserver: {\n\t\tport: 3000,\n\t\topen: true,\n\t},\n});\n`,
                        },
                        {
                                path: 'index.html',
                                content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\t<title>${projectName}</title>\n</head>\n<body>\n\t<div id="app"></div>\n\t<script type="module" src="/src/main.ts"></script>\n</body>\n</html>\n`,
                        },
                        {
                                path: 'src/main.ts',
                                content: `/**\n * ${projectName} — Entry point\n */\n\nconst app = document.getElementById('app')!;\n\napp.innerHTML = \`\n\t<h1>${projectName}</h1>\n\t<p>Your web application is running.</p>\n\`;\n\nconsole.log('[${projectName}] App initialized');\n`,
                        },
                        {
                                path: 'src/style.css',
                                content: `:root {\n\tfont-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n\tcolor: #1a1a2e;\n\tbackground-color: #ffffff;\n}\n\nbody {\n\tmargin: 0;\n\tdisplay: flex;\n\tplace-items: center;\n\tmin-height: 100vh;\n}\n\n#app {\n\tmax-width: 1280px;\n\tmargin: 0 auto;\n\tpadding: 2rem;\n\ttext-align: center;\n}\n`,
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\ndist/\n.env\n.construct/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA web application built with TypeScript and Vite.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
                        },
                ];
        }

        private scaffoldAPIServer(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'API server built with KOVIX',
                                        type: 'module',
                                        scripts: {
                                                dev: 'tsx watch src/index.ts',
                                                build: 'tsc',
                                                start: 'node dist/index.js',
                                        },
                                        dependencies: {
                                                express: '^4.18.0',
                                                cors: '^2.8.5',
                                                dotenv: '^16.4.0',
                                        },
                                        devDependencies: {
                                                '@types/express': '^4.17.0',
                                                '@types/cors': '^2.8.0',
                                                typescript: '^5.4.0',
                                                tsx: '^4.7.0',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'tsconfig.json',
                                content: JSON.stringify({
                                        compilerOptions: {
                                                target: 'ES2022',
                                                module: 'ESNext',
                                                moduleResolution: 'bundler',
                                                strict: true,
                                                esModuleInterop: true,
                                                skipLibCheck: true,
                                                forceConsistentCasingInFileNames: true,
                                                outDir: './dist',
                                                rootDir: './src',
                                        },
                                        include: ['src'],
                                        exclude: ['node_modules', 'dist'],
                                }, null, 2),
                        },
                        {
                                path: 'src/index.ts',
                                content: `/**\n * ${projectName} — API Server Entry Point\n */\n\nimport express from 'express';\nimport cors from 'cors';\nimport dotenv from 'dotenv';\n\nimport { healthRouter } from './routes/health.js';\nimport { apiRouter } from './routes/api.js';\n\ndotenv.config();\n\nconst app = express();\nconst PORT = process.env.PORT ?? 3001;\n\n// Middleware\napp.use(cors());\napp.use(express.json());\n\n// Routes\napp.use('/health', healthRouter);\napp.use('/api', apiRouter);\n\napp.listen(PORT, () => {\n\tconsole.log(\`[\${process.env.NODE_ENV ?? 'development'}] API server running on http://localhost:\${PORT}\`);\n});\n`,
                        },
                        {
                                path: 'src/routes/health.ts',
                                content: `import { Router } from 'express';\n\nexport const healthRouter = Router();\n\nhealthRouter.get('/', (_req, res) => {\n\tres.json({ status: 'ok', timestamp: new Date().toISOString() });\n});\n`,
                        },
                        {
                                path: 'src/routes/api.ts',
                                content: `import { Router } from 'express';\n\nexport const apiRouter = Router();\n\n/**\n * Sample API route — replace with your own logic.\n */\napiRouter.get('/', (_req, res) => {\n\tres.json({ message: 'API is running', version: '0.1.0' });\n});\n`,
                        },
                        {
                                path: '.env.example',
                                content: `# Server configuration\nPORT=3001\nNODE_ENV=development\n\n# Database (if needed)\n# DATABASE_URL=postgresql://user:password@localhost:5432/mydb\n`,
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\ndist/\n.env\n.construct/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nAn API server built with Express and TypeScript.\n\n## Getting Started\n\n\`\`\`bash\ncp .env.example .env\nnpm install\nnpm run dev\n\`\`\`\n\n## API Endpoints\n\n- \`GET /health\` — Health check\n- \`GET /api\` — API info\n`,
                        },
                ];
        }

        private scaffoldCLITool(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'CLI tool built with KOVIX',
                                        type: 'module',
                                        bin: {
                                                [this.sanitizePackageName(projectName)]: './dist/index.js',
                                        },
                                        scripts: {
                                                dev: 'tsx src/index.ts',
                                                build: 'tsc',
                                                start: 'node dist/index.js',
                                        },
                                        dependencies: {
                                                commander: '^12.0.0',
                                                chalk: '^5.3.0',
                                        },
                                        devDependencies: {
                                                typescript: '^5.4.0',
                                                tsx: '^4.7.0',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'tsconfig.json',
                                content: JSON.stringify({
                                        compilerOptions: {
                                                target: 'ES2022',
                                                module: 'ESNext',
                                                moduleResolution: 'bundler',
                                                strict: true,
                                                esModuleInterop: true,
                                                skipLibCheck: true,
                                                forceConsistentCasingInFileNames: true,
                                                outDir: './dist',
                                                rootDir: './src',
                                        },
                                        include: ['src'],
                                        exclude: ['node_modules', 'dist'],
                                }, null, 2),
                        },
                        {
                                path: 'src/index.ts',
                                content: `#!/usr/bin/env node\n\n/**\n * ${projectName} — CLI Tool\n */\n\nimport { Command } from 'commander';\n\nconst program = new Command();\n\nprogram\n\t.name('${this.sanitizePackageName(projectName)}')\n\t.description('${projectName} CLI tool')\n\t.version('0.1.0');\n\nprogram\n\t.command('hello')\n\t.description('Say hello')\n\t.option('-n, --name <name>', 'your name', 'World')\n\t.action((options) => {\n\t\tconsole.log(\`Hello, \${options.name}!\`);\n\t});\n\nprogram.parse();\n`,
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\ndist/\n.env\n.construct/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA CLI tool built with Commander.js and TypeScript.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev -- hello --name "Kovix"\n\`\`\`\n`,
                        },
                ];
        }

        private scaffoldMobileApp(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'Mobile app built with KOVIX',
                                        scripts: {
                                                start: 'expo start',
                                                android: 'expo start --android',
                                                ios: 'expo start --ios',
                                                web: 'expo start --web',
                                        },
                                        dependencies: {
                                                expo: '~50.0.0',
                                                'react-native': '0.73.0',
                                                react: '18.2.0',
                                        },
                                        devDependencies: {
                                                '@types/react': '^18.2.0',
                                                typescript: '^5.4.0',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'tsconfig.json',
                                content: JSON.stringify({
                                        compilerOptions: {
                                                target: 'ESNext',
                                                module: 'ESNext',
                                                moduleResolution: 'bundler',
                                                strict: true,
                                                jsx: 'react-native',
                                                esModuleInterop: true,
                                                skipLibCheck: true,
                                                forceConsistentCasingInFileNames: true,
                                                allowImportingTsExtensions: true,
                                                noEmit: true,
                                        },
                                        include: ['src', 'App.tsx'],
                                        exclude: ['node_modules'],
                                }, null, 2),
                        },
                        {
                                path: 'App.tsx',
                                content: `import React from 'react';\nimport { StyleSheet, Text, View } from 'react-native';\n\nexport default function App() {\n\treturn (\n\t\t<View style={styles.container}>\n\t\t\t<Text style={styles.title}>${projectName}</Text>\n\t\t\t<Text style={styles.subtitle}>Your mobile app is running.</Text>\n\t\t</View>\n\t);\n}\n\nconst styles = StyleSheet.create({\n\tcontainer: {\n\t\tflex: 1,\n\t\tbackgroundColor: '#fff',\n\t\talignItems: 'center',\n\t\tjustifyContent: 'center',\n\t},\n\ttitle: {\n\t\tfontSize: 24,\n\t\tfontWeight: 'bold',\n\t\tmarginBottom: 8,\n\t},\n\tsubtitle: {\n\t\tfontSize: 16,\n\t\tcolor: '#666',\n\t},\n});\n`,
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\n.expo/\ndist/\n.env\n.construct/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA mobile app built with React Native and Expo.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n`,
                        },
                ];
        }

        private scaffoldDesktopApp(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'Desktop app built with KOVIX',
                                        main: 'src/main.ts',
                                        scripts: {
                                                dev: 'electron .',
                                                build: 'tsc && electron-builder',
                                        },
                                        dependencies: {
                                                'electron-store': '^8.1.0',
                                        },
                                        devDependencies: {
                                                electron: '^28.0.0',
                                                'electron-builder': '^24.9.0',
                                                typescript: '^5.4.0',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'tsconfig.json',
                                content: JSON.stringify({
                                        compilerOptions: {
                                                target: 'ES2022',
                                                module: 'commonjs',
                                                moduleResolution: 'node',
                                                strict: true,
                                                esModuleInterop: true,
                                                skipLibCheck: true,
                                                forceConsistentCasingInFileNames: true,
                                                outDir: './dist',
                                                rootDir: './src',
                                        },
                                        include: ['src'],
                                        exclude: ['node_modules', 'dist'],
                                }, null, 2),
                        },
                        {
                                path: 'src/main.ts',
                                content: `/**\n * ${projectName} — Electron Main Process\n */\n\nimport { app, BrowserWindow } from 'electron';\nimport * as path from 'path';\n\nlet mainWindow: BrowserWindow | null = null;\n\nfunction createWindow(): void {\n\tmainWindow = new BrowserWindow({\n\t\twidth: 1200,\n\t\theight: 800,\n\t\twebPreferences: {\n\t\t\tnodeIntegration: true,\n\t\t\tcontextIsolation: false,\n\t\t},\n\t\ttitle: '${projectName}',\n\t});\n\n\tmainWindow.loadFile(path.join(__dirname, '..', 'index.html'));\n\n\tmainWindow.on('closed', () => {\n\t\tmainWindow = null;\n\t});\n}\n\napp.on('ready', createWindow);\n\napp.on('window-all-closed', () => {\n\tif (process.platform !== 'darwin') {\n\t\tapp.quit();\n\t}\n});\n\napp.on('activate', () => {\n\tif (mainWindow === null) {\n\t\tcreateWindow();\n\t}\n});\n`,
                        },
                        {
                                path: 'index.html',
                                content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\t<title>${projectName}</title>\n\t<style>\n\t\tbody {\n\t\t\tfont-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n\t\t\tmargin: 0;\n\t\t\tpadding: 2rem;\n\t\t\tcolor: #1a1a2e;\n\t\t}\n\t\th1 { font-size: 24px; font-weight: 600; }\n\t\tp { color: #666; }\n\t</style>\n</head>\n<body>\n\t<h1>${projectName}</h1>\n\t<p>Your desktop application is running.</p>\n</body>\n</html>\n`,
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\ndist/\n.env\n.construct/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA desktop app built with Electron and TypeScript.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
                        },
                ];
        }

        private scaffoldDataScience(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'Data science project built with KOVIX',
                                        scripts: {
                                                notebook: 'jupyter notebook',
                                                pipeline: 'python src/pipeline.py',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'requirements.txt',
                                content: `# Core\nnumpy>=1.26.0\npandas>=2.2.0\nscikit-learn>=1.4.0\nmatplotlib>=3.8.0\n\n# Notebooks\njupyter>=1.0.0\nipykernel>=6.29.0\n\n# Optional\n# torch>=2.2.0\n# tensorflow>=2.15.0\n`,
                        },
                        {
                                path: 'notebooks/exploration.ipynb',
                                content: JSON.stringify({
                                        cells: [
                                                {
                                                        cell_type: 'markdown',
                                                        metadata: {},
                                                        source: [`# ${projectName}\\n`, 'Data exploration notebook'],
                                                },
                                                {
                                                        cell_type: 'code',
                                                        execution_count: null,
                                                        metadata: {},
                                                        outputs: [],
                                                        source: [
                                                                'import pandas as pd\n',
                                                                'import numpy as np\n',
                                                                'import matplotlib.pyplot as plt\n',
                                                                '\n',
                                                                'print("Data science environment ready!")',
                                                        ],
                                                },
                                        ],
                                        metadata: {
                                                kernelspec: {
                                                        display_name: 'Python 3',
                                                        language: 'python',
                                                        name: 'python3',
                                                },
                                                language_info: {
                                                        name: 'python',
                                                        version: '3.11.0',
                                                },
                                        },
                                        nbformat: 4,
                                        nbformat_minor: 4,
                                }, null, 2),
                        },
                        {
                                path: 'src/__init__.py',
                                content: '',
                        },
                        {
                                path: 'src/pipeline.py',
                                content: `"""${projectName} — Data Pipeline"""\n\nimport pandas as pd\nimport numpy as np\n\n\ndef load_data(path: str) -> pd.DataFrame:\n\t"""Load data from a CSV file."""\n\treturn pd.read_csv(path)\n\n\ndef preprocess(df: pd.DataFrame) -> pd.DataFrame:\n\t"""Preprocess the data."""\n\t# Add your preprocessing steps here\n\treturn df\n\n\ndef main() -> None:\n\tprint("[Pipeline] Starting data pipeline...")\n\t# df = load_data("data/raw.csv")\n\t# df = preprocess(df)\n\t# df.to_csv("data/processed.csv", index=False)\n\tprint("[Pipeline] Done.")\n\n\nif __name__ == "__main__":\n\tmain()\n`,
                        },
                        {
                                path: 'data/.gitkeep',
                                content: '',
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\n__pycache__/\n*.pyc\n.env\n.construct/\ndata/raw/\nmodels/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA data science project with Jupyter notebooks and Python pipelines.\n\n## Getting Started\n\n\`\`\`bash\npip install -r requirements.txt\njupyter notebook\n\`\`\`\n`,
                        },
                ];
        }

        private scaffoldGameDev(projectName: string): IScaffoldFile[] {
                return [
                        {
                                path: 'package.json',
                                content: JSON.stringify({
                                        name: this.sanitizePackageName(projectName),
                                        version: '0.1.0',
                                        description: 'Game project built with KOVIX',
                                        type: 'module',
                                        scripts: {
                                                dev: 'vite',
                                                build: 'tsc && vite build',
                                                preview: 'vite preview',
                                        },
                                        dependencies: {
                                                pixi: '^7.3.0',
                                        },
                                        devDependencies: {
                                                typescript: '^5.4.0',
                                                vite: '^5.2.0',
                                        },
                                }, null, 2),
                        },
                        {
                                path: 'tsconfig.json',
                                content: JSON.stringify({
                                        compilerOptions: {
                                                target: 'ES2022',
                                                module: 'ESNext',
                                                moduleResolution: 'bundler',
                                                strict: true,
                                                esModuleInterop: true,
                                                skipLibCheck: true,
                                                forceConsistentCasingInFileNames: true,
                                                outDir: './dist',
                                                rootDir: './src',
                                        },
                                        include: ['src'],
                                        exclude: ['node_modules', 'dist'],
                                }, null, 2),
                        },
                        {
                                path: 'vite.config.ts',
                                content: `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n\troot: '.',\n\tbuild: {\n\t\toutDir: 'dist',\n\t},\n\tserver: {\n\t\tport: 3000,\n\t\topen: true,\n\t},\n});\n`,
                        },
                        {
                                path: 'index.html',
                                content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\t<title>${projectName}</title>\n\t<style>\n\t\t* { margin: 0; padding: 0; box-sizing: border-box; }\n\t\tbody { background: #000; overflow: hidden; }\n\t\tcanvas { display: block; }\n\t</style>\n</head>\n<body>\n\t<script type="module" src="/src/main.ts"></script>\n</body>\n</html>\n`,
                        },
                        {
                                path: 'src/main.ts',
                                content: `/**\n * ${projectName} — Game Entry Point\n */\n\nimport { Application, Graphics } from 'pixi';\n\nconst app = new Application();\n\nasync function init(): Promise<void> {\n\tawait app.init({\n\t\twidth: window.innerWidth,\n\t\theight: window.innerHeight,\n\t\tbackgroundColor: 0x0a0e1a,\n\t\tresizeTo: window,\n\t});\n\n\tdocument.body.appendChild(app.canvas);\n\n\t// Draw a simple shape as a starting point\n\tconst graphics = new Graphics();\n\tgraphics.circle(400, 300, 50);\n\tgraphics.fill(0x00e5ff);\n\n\tapp.stage.addChild(graphics);\n\n\tconsole.log('[${projectName}] Game initialized');\n}\n\ninit().catch(console.error);\n`,
                        },
                        {
                                path: 'src/game/config.ts',
                                content: `/**\n * Game configuration constants.\n */\n\nexport const GAME_CONFIG = {\n\ttitle: '${projectName}',\n\tversion: '0.1.0',\n\twidth: 800,\n\theight: 600,\n\tbackgroundColor: 0x0a0e1a,\n\tfps: 60,\n} as const;\n`,
                        },
                        {
                                path: '.gitignore',
                                content: 'node_modules/\ndist/\n.env\n.construct/\nassets/raw/\n',
                        },
                        {
                                path: 'README.md',
                                content: `# ${projectName}\n\nA game project built with PixiJS and TypeScript.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
                        },
                ];
        }

        // --- Global Registry -------------------------------------------------------

        private getGlobalRegistryPath(): string {
                // Use the user's home directory for the global project registry
                const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
                return `${homeDir}/${GLOBAL_REGISTRY_DIR}/${GLOBAL_REGISTRY_FILE}`;
        }

        private async readGlobalRegistry(): Promise<IGlobalRegistryEntry[]> {
                const registryPath = this.getGlobalRegistryPath();
                try {
                        const uri = URI.file(registryPath);
                        const content = await this.fileService.readFile(uri);
                        return JSON.parse(new TextDecoder().decode(content.value.buffer)) as IGlobalRegistryEntry[];
                } catch {
                        return [];
                }
        }

        private async writeGlobalRegistry(): Promise<void> {
                const registryPath = this.getGlobalRegistryPath();
                const entries: IGlobalRegistryEntry[] = Array.from(this._projects.values()).map(p => ({
                        id: p.id,
                        name: p.name,
                        template: p.template,
                        status: p.status,
                        workspaceRoot: p.workspaceRoot,
                        lastActiveAt: p.updatedAt,
                        createdAt: p.createdAt,
                }));

                try {
                        const registryDir = URI.file(registryPath.replace(`/${GLOBAL_REGISTRY_FILE}`, ''));
                        await this.fileService.createFolder(registryDir);

                        const uri = URI.file(registryPath);
                        const content = JSON.stringify(entries, null, 2);
                        await this.fileService.writeFile(uri, VSBuffer.wrap(new TextEncoder().encode(content)));
                } catch (error) {
                        this.logService.warn(`[ConstructProject] Failed to write global registry: ${error instanceof Error ? error.message : String(error)}`);
                }
        }

        private async loadGlobalRegistry(): Promise<void> {
                const entries = await this.readGlobalRegistry();
                for (const entry of entries) {
                        // Reconstruct IKovixProject from registry entry
                        // Full details will be loaded on demand via loadProject()
                        const project: IKovixProject = {
                                id: entry.id,
                                name: entry.name,
                                description: '',
                                template: entry.template,
                                techStack: [],
                                goals: [],
                                workspaceRoot: entry.workspaceRoot,
                                status: entry.status,
                                createdAt: entry.createdAt,
                                updatedAt: entry.lastActiveAt,
                        };
                        this._projects.set(entry.id, project);
                }

                if (entries.length > 0) {
                        this.logService.info(`[ConstructProject] Loaded ${entries.length} projects from global registry`);
                }
        }

        // --- Utilities -------------------------------------------------------------

        private async ensureParentDirectory(fileUri: URI): Promise<void> {
                const parentPath = fileUri.fsPath.substring(0, fileUri.fsPath.lastIndexOf(/[/\\]/.test(fileUri.fsPath) ? (fileUri.fsPath.includes('\\') ? '\\' : '/') : '/'));
                if (parentPath) {
                        try {
                                await this.fileService.createFolder(URI.file(parentPath));
                        } catch {
                                // Directory might already exist
                        }
                }
        }

        private sanitizePackageName(name: string): string {
                return name
                        .toLowerCase()
                        .replace(/[^a-z0-9._-]/g, '-')
                        .replace(/^-+|-+$/g, '')
                        .replace(/\.+/g, '.')
                        .substring(0, 214);
        }

        override dispose(): void {
                // Persist registry before disposal
                this.writeGlobalRegistry().catch(err => {
                        this.logService.warn('[ConstructProject] Failed to persist registry on dispose:', err instanceof Error ? err.message : String(err));
                });
                super.dispose();
        }
}
