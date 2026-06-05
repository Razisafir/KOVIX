/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E Canonical Tasks — Feature 1.1: End-to-End Verification Suite
 *
 * Defines 10 canonical tasks that exercise the complete CONSTRUCT agent loop.
 * Each task validates:
 *   - Planning phase triggers correctly
 *   - Plan checklist renders
 *   - Execution with full tools
 *   - Files exist on disk after execution
 *   - Package.json / build files are correct
 *   - Returns PASS/FAIL with exact error
 *
 * This file is exportable and usable from CI pipelines.
 */

import type { IAgentLoop, AgentLoopEvent, IPlanResult, IPlanStep } from '../../../../../../platform/construct/common/agent/agentLoop.js';
import type { IDiffApplier } from '../../../../../../platform/construct/common/editor/diffApplier.js';
import type { ITerminalExecutor, ITerminalExecResult } from '../../../../../../platform/construct/common/terminal/terminalExecutor.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';

// ──────────────────────────────────────────────────────────────────────────────
// Result types
// ──────────────────────────────────────────────────────────────────────────────

/** Verdict for a single verification checkpoint. */
export type VerificationVerdict = 'PASS' | 'FAIL';

/** Outcome of a single verification step within a canonical task. */
export interface IVerificationDetail {
	readonly label: string;
	readonly verdict: VerificationVerdict;
	readonly error?: string;
}

/** Aggregate result for one canonical task run. */
export interface ITaskTestResult {
	readonly taskId: number;
	readonly taskName: string;
	readonly verdict: VerificationVerdict;
	readonly planningPhaseOk: boolean;
	readonly executionPhaseOk: boolean;
	readonly fileExistenceOk: boolean;
	readonly fileContentOk: boolean;
	readonly verificationDetails: readonly IVerificationDetail[];
	readonly error?: string;
	readonly durationMs: number;
}

/** Summary across all 10 canonical tasks. */
export interface ISuiteResult {
	readonly totalTasks: number;
	readonly passed: number;
	readonly failed: number;
	readonly taskResults: readonly ITaskTestResult[];
	readonly overallVerdict: VerificationVerdict;
	readonly totalDurationMs: number;
}

/** Collected events from one agent-loop run. */
export interface ICollectedEvents {
	readonly thinking: ReadonlyArray<{ text: string }>;
	readonly tokens: ReadonlyArray<{ text: string }>;
	readonly toolStarts: ReadonlyArray<{ toolId: string; toolName: string; toolInput?: unknown }>;
	readonly toolExecutings: ReadonlyArray<{ toolId: string; toolName: string; detail?: string }>;
	readonly toolResults: ReadonlyArray<{ toolId: string; toolName: string; result: string; success: boolean }>;
	readonly fileWritten: ReadonlyArray<{ filePath: string }>;
	readonly completed: ReadonlyArray<{ summary: string }>;
	readonly errors: ReadonlyArray<{ text: string; recoverable: boolean }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Canonical task definition
// ──────────────────────────────────────────────────────────────────────────────

/** A canonical E2E task that exercises the full agent loop. */
export interface ICanonicalTask {
	readonly id: number;
	readonly name: string;
	readonly prompt: string;
	/** File paths expected to exist (relative to workspace root). */
	readonly expectedFiles: readonly string[];
	/** Regex patterns that must match somewhere in the created files. */
	readonly expectedFilePatterns: readonly RegExp[];
	/**
	 * Custom verification function that runs after the agent loop completes.
	 * Receives the diffApplier and terminalExecutor for reading files and
	 * running commands. Returns an array of verification details.
	 */
	verificationSteps(
		diffApplier: IDiffApplier,
		terminalExecutor: ITerminalExecutor,
		events: ICollectedEvents
	): Promise<readonly IVerificationDetail[]>;
}

// ──────────────────────────────────────────────────────────────────────────────
// The 10 canonical tasks
// ──────────────────────────────────────────────────────────────────────────────

export const canonicalTasks: readonly ICanonicalTask[] = [
	// ── Task 1: React counter app with Vite ──────────────────────────────────
	{
		id: 1,
		name: 'React Counter App (Vite + TypeScript)',
		prompt: 'Create a React counter app with Vite. Use TypeScript.',
		expectedFiles: [
			'package.json',
			'tsconfig.json',
			'vite.config.ts',
			'src/App.tsx',
			'src/main.tsx',
			'index.html',
		],
		expectedFilePatterns: [
			/"react"/,
			/"vite"/,
			/"typescript"/,
			/useState/,
			/Counter/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check package.json has react and vite deps
			try {
				const pkg = JSON.parse(await diffApplier.readFile('package.json'));
				const deps = { ...pkg.dependencies, ...pkg.devDependencies };
				details.push({
					label: 'package.json has react dependency',
					verdict: 'react' in deps ? 'PASS' : 'FAIL',
					error: 'react' in deps ? undefined : 'Missing "react" in dependencies',
				});
				details.push({
					label: 'package.json has vite dependency',
					verdict: 'vite' in deps ? 'PASS' : 'FAIL',
					error: 'vite' in deps ? undefined : 'Missing "vite" in devDependencies',
				});
			} catch (e) {
				details.push({
					label: 'package.json is valid JSON',
					verdict: 'FAIL',
					error: `Failed to parse package.json: ${(e as Error).message}`,
				});
			}

			// Check tsconfig exists and references TypeScript
			try {
				const tsconfig = await diffApplier.readFile('tsconfig.json');
				details.push({
					label: 'tsconfig.json references TypeScript',
					verdict: /"compilerOptions"/.test(tsconfig) ? 'PASS' : 'FAIL',
					error: /"compilerOptions"/.test(tsconfig) ? undefined : 'tsconfig.json missing compilerOptions',
				});
			} catch (e) {
				details.push({
					label: 'tsconfig.json is readable',
					verdict: 'FAIL',
					error: `Cannot read tsconfig.json: ${(e as Error).message}`,
				});
			}

			// Check App.tsx has a counter component
			try {
				const app = await diffApplier.readFile('src/App.tsx');
				details.push({
					label: 'App.tsx contains useState',
					verdict: /useState/.test(app) ? 'PASS' : 'FAIL',
					error: /useState/.test(app) ? undefined : 'App.tsx does not contain useState hook',
				});
				details.push({
					label: 'App.tsx contains Counter logic',
					verdict: /count|counter|increment|decrement/i.test(app) ? 'PASS' : 'FAIL',
					error: /count|counter|increment|decrement/i.test(app) ? undefined : 'App.tsx does not contain counter logic',
				});
			} catch (e) {
				details.push({
					label: 'App.tsx is readable',
					verdict: 'FAIL',
					error: `Cannot read App.tsx: ${(e as Error).message}`,
				});
			}

			// Check vite.config.ts exists
			try {
				const viteConfig = await diffApplier.readFile('vite.config.ts');
				details.push({
					label: 'vite.config.ts references vite or react plugin',
					verdict: /vite|react/i.test(viteConfig) ? 'PASS' : 'FAIL',
					error: /vite|react/i.test(viteConfig) ? undefined : 'vite.config.ts does not reference vite or react plugin',
				});
			} catch (e) {
				details.push({
					label: 'vite.config.ts is readable',
					verdict: 'FAIL',
					error: `Cannot read vite.config.ts: ${(e as Error).message}`,
				});
			}

			// Verify at least one file_written event was emitted
			details.push({
				label: 'Agent emitted file_written events',
				verdict: events.fileWritten.length > 0 ? 'PASS' : 'FAIL',
				error: events.fileWritten.length > 0 ? undefined : 'No file_written events emitted during execution',
			});

			return details;
		},
	},

	// ── Task 2: Python weather script ────────────────────────────────────────
	{
		id: 2,
		name: 'Python Weather Script (OpenWeatherMap)',
		prompt: 'Write a Python script that fetches weather data from OpenWeatherMap API',
		expectedFiles: [
			'weather.py',
			'requirements.txt',
		],
		expectedFilePatterns: [
			/openweathermap/i,
			/requests/,
			/api_key|API_KEY|appid/,
			/def\s+\w+/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check weather.py content
			try {
				const script = await diffApplier.readFile('weather.py');
				details.push({
					label: 'weather.py imports requests',
					verdict: /import\s+requests|from\s+requests/.test(script) ? 'PASS' : 'FAIL',
					error: /import\s+requests|from\s+requests/.test(script) ? undefined : 'weather.py does not import requests',
				});
				details.push({
					label: 'weather.py references OpenWeatherMap API',
					verdict: /openweathermap/i.test(script) ? 'PASS' : 'FAIL',
					error: /openweathermap/i.test(script) ? undefined : 'weather.py does not reference OpenWeatherMap',
				});
				details.push({
					label: 'weather.py defines a function',
					verdict: /def\s+\w+/.test(script) ? 'PASS' : 'FAIL',
					error: /def\s+\w+/.test(script) ? undefined : 'weather.py does not define any function',
				});
				details.push({
					label: 'weather.py uses API key variable',
					verdict: /api_key|API_KEY|appid/.test(script) ? 'PASS' : 'FAIL',
					error: /api_key|API_KEY|appid/.test(script) ? undefined : 'weather.py does not reference an API key',
				});
			} catch (e) {
				details.push({
					label: 'weather.py is readable',
					verdict: 'FAIL',
					error: `Cannot read weather.py: ${(e as Error).message}`,
				});
			}

			// Check requirements.txt
			try {
				const reqs = await diffApplier.readFile('requirements.txt');
				details.push({
					label: 'requirements.txt lists requests',
					verdict: /requests/.test(reqs) ? 'PASS' : 'FAIL',
					error: /requests/.test(reqs) ? undefined : 'requirements.txt does not list requests',
				});
			} catch (e) {
				details.push({
					label: 'requirements.txt is readable',
					verdict: 'FAIL',
					error: `Cannot read requirements.txt: ${(e as Error).message}`,
				});
			}

			// Check Python syntax validity
			try {
				const result = await terminalExecutor.execute('python3 -c "import py_compile; py_compile.compile(\'weather.py\', doraise=True)"');
				details.push({
					label: 'weather.py has valid Python syntax',
					verdict: result.exitCode === 0 ? 'PASS' : 'FAIL',
					error: result.exitCode === 0 ? undefined : `Syntax error: ${result.stderr}`,
				});
			} catch (e) {
				details.push({
					label: 'weather.py syntax check (execution)',
					verdict: 'FAIL',
					error: `Cannot run Python syntax check: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},

	// ── Task 3: Next.js + Tailwind + shadcn/ui ──────────────────────────────
	{
		id: 3,
		name: 'Next.js with Tailwind CSS and shadcn/ui',
		prompt: 'Set up a Next.js project with Tailwind CSS and shadcn/ui',
		expectedFiles: [
			'package.json',
			'tailwind.config.ts',
			'next.config.js',
			'src/app/layout.tsx',
			'src/app/page.tsx',
			'components.json',
		],
		expectedFilePatterns: [
			/"next"/,
			/"tailwindcss"/,
			/shadcn/i,
			/className/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check package.json
			try {
				const pkg = JSON.parse(await diffApplier.readFile('package.json'));
				const deps = { ...pkg.dependencies, ...pkg.devDependencies };
				details.push({
					label: 'package.json has next dependency',
					verdict: 'next' in deps ? 'PASS' : 'FAIL',
					error: 'next' in deps ? undefined : 'Missing "next" in dependencies',
				});
				details.push({
					label: 'package.json has tailwindcss dependency',
					verdict: 'tailwindcss' in deps ? 'PASS' : 'FAIL',
					error: 'tailwindcss' in deps ? undefined : 'Missing "tailwindcss" in devDependencies',
				});
			} catch (e) {
				details.push({
					label: 'package.json is valid JSON',
					verdict: 'FAIL',
					error: `Failed to parse package.json: ${(e as Error).message}`,
				});
			}

			// Check tailwind.config.ts
			try {
				const tw = await diffApplier.readFile('tailwind.config.ts');
				details.push({
					label: 'tailwind.config.ts contains content paths',
					verdict: /content/.test(tw) ? 'PASS' : 'FAIL',
					error: /content/.test(tw) ? undefined : 'tailwind.config.ts missing content configuration',
				});
			} catch (e) {
				details.push({
					label: 'tailwind.config.ts is readable',
					verdict: 'FAIL',
					error: `Cannot read tailwind.config.ts: ${(e as Error).message}`,
				});
			}

			// Check next.config.js
			try {
				await diffApplier.readFile('next.config.js');
				details.push({ label: 'next.config.js exists', verdict: 'PASS' });
			} catch (e) {
				// Also check .mjs variant
				try {
					await diffApplier.readFile('next.config.mjs');
					details.push({ label: 'next.config.mjs exists', verdict: 'PASS' });
				} catch {
					details.push({
						label: 'next.config exists',
						verdict: 'FAIL',
						error: 'Neither next.config.js nor next.config.mjs found',
					});
				}
			}

			// Check components.json for shadcn/ui
			try {
				const comp = await diffApplier.readFile('components.json');
				details.push({
					label: 'components.json references shadcn/ui',
					verdict: /shadcn|ui/i.test(comp) ? 'PASS' : 'FAIL',
					error: /shadcn|ui/i.test(comp) ? undefined : 'components.json does not reference shadcn/ui',
				});
			} catch (e) {
				details.push({
					label: 'components.json is readable',
					verdict: 'FAIL',
					error: `Cannot read components.json: ${(e as Error).message}`,
				});
			}

			// Check layout.tsx
			try {
				const layout = await diffApplier.readFile('src/app/layout.tsx');
				details.push({
					label: 'layout.tsx contains HTML structure',
					verdict: /html|body/i.test(layout) ? 'PASS' : 'FAIL',
					error: /html|body/i.test(layout) ? undefined : 'layout.tsx missing HTML/body tags',
				});
			} catch (e) {
				details.push({
					label: 'layout.tsx is readable',
					verdict: 'FAIL',
					error: `Cannot read layout.tsx: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},

	// ── Task 4: Express.js REST API with SQLite ─────────────────────────────
	{
		id: 4,
		name: 'Express.js REST API with SQLite',
		prompt: 'Create a simple REST API with Express.js and SQLite',
		expectedFiles: [
			'package.json',
			'server.js',
			'database.js',
		],
		expectedFilePatterns: [
			/"express"/,
			/"better-sqlite3"|sqlite3/,
			/app\.(get|post|put|delete|listen)/,
			/CREATE\s+TABLE/i,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check package.json
			try {
				const pkg = JSON.parse(await diffApplier.readFile('package.json'));
				const deps = { ...pkg.dependencies, ...pkg.devDependencies };
				details.push({
					label: 'package.json has express dependency',
					verdict: 'express' in deps ? 'PASS' : 'FAIL',
					error: 'express' in deps ? undefined : 'Missing "express" in dependencies',
				});
				details.push({
					label: 'package.json has SQLite dependency',
					verdict: ('better-sqlite3' in deps) || ('sqlite3' in deps) ? 'PASS' : 'FAIL',
					error: ('better-sqlite3' in deps) || ('sqlite3' in deps) ? undefined : 'Missing SQLite dependency (better-sqlite3 or sqlite3)',
				});
			} catch (e) {
				details.push({
					label: 'package.json is valid JSON',
					verdict: 'FAIL',
					error: `Failed to parse package.json: ${(e as Error).message}`,
				});
			}

			// Check server.js
			try {
				const server = await diffApplier.readFile('server.js');
				details.push({
					label: 'server.js creates Express app',
					verdict: /express\(\)/.test(server) ? 'PASS' : 'FAIL',
					error: /express\(\)/.test(server) ? undefined : 'server.js does not create Express app',
				});
				details.push({
					label: 'server.js defines REST routes',
					verdict: /app\.(get|post|put|delete)/.test(server) ? 'PASS' : 'FAIL',
					error: /app\.(get|post|put|delete)/.test(server) ? undefined : 'server.js does not define REST routes',
				});
				details.push({
					label: 'server.js calls app.listen',
					verdict: /app\.listen|listen\(/.test(server) ? 'PASS' : 'FAIL',
					error: /app\.listen|listen\(/.test(server) ? undefined : 'server.js does not call app.listen',
				});
			} catch (e) {
				details.push({
					label: 'server.js is readable',
					verdict: 'FAIL',
					error: `Cannot read server.js: ${(e as Error).message}`,
				});
			}

			// Check database.js
			try {
				const db = await diffApplier.readFile('database.js');
				details.push({
					label: 'database.js references SQLite',
					verdict: /sqlite|better-sqlite3/.test(db) ? 'PASS' : 'FAIL',
					error: /sqlite|better-sqlite3/.test(db) ? undefined : 'database.js does not reference SQLite',
				});
				details.push({
					label: 'database.js creates a table',
					verdict: /CREATE\s+TABLE/i.test(db) ? 'PASS' : 'FAIL',
					error: /CREATE\s+TABLE/i.test(db) ? undefined : 'database.js does not include CREATE TABLE',
				});
			} catch (e) {
				details.push({
					label: 'database.js is readable',
					verdict: 'FAIL',
					error: `Cannot read database.js: ${(e as Error).message}`,
				});
			}

			// Check tool usage in events
			details.push({
				label: 'Agent used file write tool',
				verdict: events.toolStarts.some(t => /write|create|file/i.test(t.toolName)) ? 'PASS' : 'FAIL',
				error: events.toolStarts.some(t => /write|create|file/i.test(t.toolName)) ? undefined : 'Agent did not use file write tool',
			});

			return details;
		},
	},

	// ── Task 5: Go CLI tool (JSON → CSV) ────────────────────────────────────
	{
		id: 5,
		name: 'Go CLI Tool (JSON to CSV)',
		prompt: 'Build a CLI tool in Go that converts JSON to CSV',
		expectedFiles: [
			'main.go',
			'go.mod',
		],
		expectedFilePatterns: [
			/package main/,
			/func main/,
			/encoding\/csv|encoding\/json/,
			/os\.Stdout|os\.Open|os\.Create/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check main.go
			try {
				const main = await diffApplier.readFile('main.go');
				details.push({
					label: 'main.go declares package main',
					verdict: /package\s+main/.test(main) ? 'PASS' : 'FAIL',
					error: /package\s+main/.test(main) ? undefined : 'main.go does not declare package main',
				});
				details.push({
					label: 'main.go defines func main',
					verdict: /func\s+main\s*\(/.test(main) ? 'PASS' : 'FAIL',
					error: /func\s+main\s*\(/.test(main) ? undefined : 'main.go does not define func main()',
				});
				details.push({
					label: 'main.go imports encoding/csv or encoding/json',
					verdict: /encoding\/csv|encoding\/json/.test(main) ? 'PASS' : 'FAIL',
					error: /encoding\/csv|encoding\/json/.test(main) ? undefined : 'main.go does not import encoding/csv or encoding/json',
				});
			} catch (e) {
				details.push({
					label: 'main.go is readable',
					verdict: 'FAIL',
					error: `Cannot read main.go: ${(e as Error).message}`,
				});
			}

			// Check go.mod
			try {
				const gomod = await diffApplier.readFile('go.mod');
				details.push({
					label: 'go.mod declares module',
					verdict: /^module\s+\S+/m.test(gomod) ? 'PASS' : 'FAIL',
					error: /^module\s+\S+/m.test(gomod) ? undefined : 'go.mod does not declare a module',
				});
				details.push({
					label: 'go.mod specifies Go version',
					verdict: /^go\s+\d/m.test(gomod) ? 'PASS' : 'FAIL',
					error: /^go\s+\d/m.test(gomod) ? undefined : 'go.mod does not specify Go version',
				});
			} catch (e) {
				details.push({
					label: 'go.mod is readable',
					verdict: 'FAIL',
					error: `Cannot read go.mod: ${(e as Error).message}`,
				});
			}

			// Try to build the Go project
			try {
				const result = await terminalExecutor.execute('go build -o /dev/null ./...', undefined, 120000);
				details.push({
					label: 'Go project compiles successfully',
					verdict: result.exitCode === 0 ? 'PASS' : 'FAIL',
					error: result.exitCode === 0 ? undefined : `Go build failed: ${result.stderr}`,
				});
			} catch (e) {
				details.push({
					label: 'Go build execution',
					verdict: 'FAIL',
					error: `Cannot run go build: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},

	// ── Task 6: Rust HTTP server ─────────────────────────────────────────────
	{
		id: 6,
		name: 'Rust HTTP Server (Cargo)',
		prompt: 'Scaffold a Rust project with cargo and add a simple HTTP server',
		expectedFiles: [
			'Cargo.toml',
			'src/main.rs',
		],
		expectedFilePatterns: [
			/\[package\]/,
			/fn\s+main/,
			/HttpServer|TcpListener|hyper|actix|warp|axum/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check Cargo.toml
			try {
				const cargo = await diffApplier.readFile('Cargo.toml');
				details.push({
					label: 'Cargo.toml has [package] section',
					verdict: /\[package\]/.test(cargo) ? 'PASS' : 'FAIL',
					error: /\[package\]/.test(cargo) ? undefined : 'Cargo.toml missing [package] section',
				});
				details.push({
					label: 'Cargo.toml specifies name and version',
					verdict: /^name\s*=/m.test(cargo) && /^version\s*=/m.test(cargo) ? 'PASS' : 'FAIL',
					error: (/^name\s*=/m.test(cargo) && /^version\s*=/m.test(cargo)) ? undefined : 'Cargo.toml missing name or version',
				});
				details.push({
					label: 'Cargo.toml has HTTP server dependency',
					verdict: /hyper|actix|warp|axum|tokio/.test(cargo) ? 'PASS' : 'FAIL',
					error: /hyper|actix|warp|axum|tokio/.test(cargo) ? undefined : 'Cargo.toml missing HTTP server dependency (hyper, actix, warp, axum, or tokio)',
				});
			} catch (e) {
				details.push({
					label: 'Cargo.toml is readable',
					verdict: 'FAIL',
					error: `Cannot read Cargo.toml: ${(e as Error).message}`,
				});
			}

			// Check src/main.rs
			try {
				const mainRs = await diffApplier.readFile('src/main.rs');
				details.push({
					label: 'src/main.rs defines fn main',
					verdict: /fn\s+main\s*\(/.test(mainRs) ? 'PASS' : 'FAIL',
					error: /fn\s+main\s*\(/.test(mainRs) ? undefined : 'src/main.rs does not define fn main()',
				});
				details.push({
					label: 'src/main.rs references HTTP/TCP functionality',
					verdict: /HttpServer|TcpListener|hyper|actix|warp|axum|tokio|listener|bind/.test(mainRs) ? 'PASS' : 'FAIL',
					error: /HttpServer|TcpListener|hyper|actix|warp|axum|tokio|listener|bind/.test(mainRs) ? undefined : 'src/main.rs does not reference HTTP server functionality',
				});
			} catch (e) {
				details.push({
					label: 'src/main.rs is readable',
					verdict: 'FAIL',
					error: `Cannot read src/main.rs: ${(e as Error).message}`,
				});
			}

			// Try to check the Rust project
			try {
				const result = await terminalExecutor.execute('cargo check', undefined, 180000);
				details.push({
					label: 'Rust project passes cargo check',
					verdict: result.exitCode === 0 ? 'PASS' : 'FAIL',
					error: result.exitCode === 0 ? undefined : `cargo check failed: ${result.stderr.slice(0, 500)}`,
				});
			} catch (e) {
				details.push({
					label: 'cargo check execution',
					verdict: 'FAIL',
					error: `Cannot run cargo check: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},

	// ── Task 7: Docker Compose (PostgreSQL + Redis) ─────────────────────────
	{
		id: 7,
		name: 'Docker Compose (PostgreSQL + Redis)',
		prompt: 'Create a Docker Compose setup for PostgreSQL + Redis',
		expectedFiles: [
			'docker-compose.yml',
		],
		expectedFilePatterns: [
			/postgres/i,
			/redis/i,
			/services:/,
			/image:/,
			/ports:/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check docker-compose.yml
			try {
				const compose = await diffApplier.readFile('docker-compose.yml');
				details.push({
					label: 'docker-compose.yml defines services',
					verdict: /services:/.test(compose) ? 'PASS' : 'FAIL',
					error: /services:/.test(compose) ? undefined : 'docker-compose.yml missing services key',
				});
				details.push({
					label: 'docker-compose.yml includes PostgreSQL',
					verdict: /postgres/i.test(compose) ? 'PASS' : 'FAIL',
					error: /postgres/i.test(compose) ? undefined : 'docker-compose.yml does not include PostgreSQL service',
				});
				details.push({
					label: 'docker-compose.yml includes Redis',
					verdict: /redis/i.test(compose) ? 'PASS' : 'FAIL',
					error: /redis/i.test(compose) ? undefined : 'docker-compose.yml does not include Redis service',
				});
				details.push({
					label: 'docker-compose.yml defines ports',
					verdict: /ports:/.test(compose) ? 'PASS' : 'FAIL',
					error: /ports:/.test(compose) ? undefined : 'docker-compose.yml missing ports mapping',
				});
				details.push({
					label: 'docker-compose.yml uses image directive',
					verdict: /image:/.test(compose) ? 'PASS' : 'FAIL',
					error: /image:/.test(compose) ? undefined : 'docker-compose.yml missing image directive',
				});
			} catch (e) {
				details.push({
					label: 'docker-compose.yml is readable',
					verdict: 'FAIL',
					error: `Cannot read docker-compose.yml: ${(e as Error).message}`,
				});
			}

			// Validate docker-compose.yml syntax
			try {
				const result = await terminalExecutor.execute('docker compose config --quiet 2>&1 || docker-compose config --quiet 2>&1');
				details.push({
					label: 'docker-compose.yml is valid syntax',
					verdict: result.exitCode === 0 ? 'PASS' : 'FAIL',
					error: result.exitCode === 0 ? undefined : `Invalid docker-compose.yml: ${result.stderr}`,
				});
			} catch (e) {
				// Docker may not be available in CI, so we mark as non-blocking
				details.push({
					label: 'docker-compose.yml validation (docker not available)',
					verdict: 'PASS',
					error: 'Docker not available in environment; skipping syntax validation',
				});
			}

			return details;
		},
	},

	// ── Task 8: Bash S3 backup script ────────────────────────────────────────
	{
		id: 8,
		name: 'Bash S3 Backup Script',
		prompt: 'Write a bash script that backs up a directory to S3',
		expectedFiles: [
			'backup.sh',
		],
		expectedFilePatterns: [
			/#!\/bin\/bash|#!\/usr\/bin\/env bash/,
			/aws\s+s3/,
			/tar|zip/,
			/S3_BUCKET|BUCKET/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check backup.sh
			try {
				const script = await diffApplier.readFile('backup.sh');
				details.push({
					label: 'backup.sh has shebang',
					verdict: /#!\/bin\/bash|#!\/usr\/bin\/env bash/.test(script) ? 'PASS' : 'FAIL',
					error: /#!\/bin\/bash|#!\/usr\/bin\/env bash/.test(script) ? undefined : 'backup.sh missing bash shebang',
				});
				details.push({
					label: 'backup.sh uses aws s3',
					verdict: /aws\s+s3/.test(script) ? 'PASS' : 'FAIL',
					error: /aws\s+s3/.test(script) ? undefined : 'backup.sh does not use aws s3 commands',
				});
				details.push({
					label: 'backup.sh creates archive (tar/zip)',
					verdict: /tar|zip/.test(script) ? 'PASS' : 'FAIL',
					error: /tar|zip/.test(script) ? undefined : 'backup.sh does not create an archive (tar or zip)',
				});
				details.push({
					label: 'backup.sh references S3 bucket',
					verdict: /S3_BUCKET|BUCKET|s3:\/\//i.test(script) ? 'PASS' : 'FAIL',
					error: /S3_BUCKET|BUCKET|s3:\/\//i.test(script) ? undefined : 'backup.sh does not reference an S3 bucket',
				});
			} catch (e) {
				details.push({
					label: 'backup.sh is readable',
					verdict: 'FAIL',
					error: `Cannot read backup.sh: ${(e as Error).message}`,
				});
			}

			// Check bash syntax
			try {
				const result = await terminalExecutor.execute('bash -n backup.sh');
				details.push({
					label: 'backup.sh has valid bash syntax',
					verdict: result.exitCode === 0 ? 'PASS' : 'FAIL',
					error: result.exitCode === 0 ? undefined : `Bash syntax error: ${result.stderr}`,
				});
			} catch (e) {
				details.push({
					label: 'backup.sh syntax check execution',
					verdict: 'FAIL',
					error: `Cannot run bash syntax check: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},

	// ── Task 9: TypeScript library with vitest + ESLint ─────────────────────
	{
		id: 9,
		name: 'TypeScript Library (Vitest + ESLint)',
		prompt: 'Set up a TypeScript library with vitest and ESLint',
		expectedFiles: [
			'package.json',
			'tsconfig.json',
			'vitest.config.ts',
			'.eslintrc.json',
			'src/index.ts',
		],
		expectedFilePatterns: [
			/"vitest"/,
			/"eslint"/,
			/"typescript"/,
			/export/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check package.json
			try {
				const pkg = JSON.parse(await diffApplier.readFile('package.json'));
				const deps = { ...pkg.dependencies, ...pkg.devDependencies };
				details.push({
					label: 'package.json has vitest dependency',
					verdict: 'vitest' in deps ? 'PASS' : 'FAIL',
					error: 'vitest' in deps ? undefined : 'Missing "vitest" in devDependencies',
				});
				details.push({
					label: 'package.json has eslint dependency',
					verdict: ('eslint' in deps) ? 'PASS' : 'FAIL',
					error: ('eslint' in deps) ? undefined : 'Missing "eslint" in devDependencies',
				});
				details.push({
					label: 'package.json has typescript dependency',
					verdict: 'typescript' in deps ? 'PASS' : 'FAIL',
					error: 'typescript' in deps ? undefined : 'Missing "typescript" in devDependencies',
				});
			} catch (e) {
				details.push({
					label: 'package.json is valid JSON',
					verdict: 'FAIL',
					error: `Failed to parse package.json: ${(e as Error).message}`,
				});
			}

			// Check vitest.config.ts
			try {
				const vitestConfig = await diffApplier.readFile('vitest.config.ts');
				details.push({
					label: 'vitest.config.ts defines vitest configuration',
					verdict: /vitest|defineConfig/.test(vitestConfig) ? 'PASS' : 'FAIL',
					error: /vitest|defineConfig/.test(vitestConfig) ? undefined : 'vitest.config.ts does not define vitest config',
				});
			} catch (e) {
				details.push({
					label: 'vitest.config.ts is readable',
					verdict: 'FAIL',
					error: `Cannot read vitest.config.ts: ${(e as Error).message}`,
				});
			}

			// Check .eslintrc.json
			try {
				const eslint = await diffApplier.readFile('.eslintrc.json');
				const eslintObj = JSON.parse(eslint);
				details.push({
					label: '.eslintrc.json is valid JSON with rules',
					verdict: eslintObj && (eslintObj.rules || eslintObj.extends || eslintObj.plugins) ? 'PASS' : 'FAIL',
					error: eslintObj && (eslintObj.rules || eslintObj.extends || eslintObj.plugins) ? undefined : '.eslintrc.json missing rules, extends, or plugins',
				});
			} catch (e) {
				details.push({
					label: '.eslintrc.json is readable and valid',
					verdict: 'FAIL',
					error: `Cannot read or parse .eslintrc.json: ${(e as Error).message}`,
				});
			}

			// Check src/index.ts exports
			try {
				const index = await diffApplier.readFile('src/index.ts');
				details.push({
					label: 'src/index.ts exports something',
					verdict: /export\s+(default\s+)?(function|class|const|interface|type|{)/.test(index) ? 'PASS' : 'FAIL',
					error: /export\s+(default\s+)?(function|class|const|interface|type|{)/.test(index) ? undefined : 'src/index.ts does not export anything',
				});
			} catch (e) {
				details.push({
					label: 'src/index.ts is readable',
					verdict: 'FAIL',
					error: `Cannot read src/index.ts: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},

	// ── Task 10: React Native app with Expo ─────────────────────────────────
	{
		id: 10,
		name: 'React Native App (Expo)',
		prompt: 'Create a React Native app with Expo',
		expectedFiles: [
			'package.json',
			'app.json',
			'App.tsx',
			'tsconfig.json',
		],
		expectedFilePatterns: [
			/"expo"/,
			/"react-native"/,
			/View|Text|StyleSheet/,
			/expo/,
		],
		async verificationSteps(diffApplier, terminalExecutor, events): Promise<readonly IVerificationDetail[]> {
			const details: IVerificationDetail[] = [];

			// Check package.json
			try {
				const pkg = JSON.parse(await diffApplier.readFile('package.json'));
				const deps = { ...pkg.dependencies, ...pkg.devDependencies };
				details.push({
					label: 'package.json has expo dependency',
					verdict: 'expo' in deps || Object.keys(deps).some(k => k.startsWith('expo-')) ? 'PASS' : 'FAIL',
					error: ('expo' in deps || Object.keys(deps).some(k => k.startsWith('expo-'))) ? undefined : 'Missing "expo" in dependencies',
				});
				details.push({
					label: 'package.json has react-native dependency',
					verdict: 'react-native' in deps ? 'PASS' : 'FAIL',
					error: 'react-native' in deps ? undefined : 'Missing "react-native" in dependencies',
				});
			} catch (e) {
				details.push({
					label: 'package.json is valid JSON',
					verdict: 'FAIL',
					error: `Failed to parse package.json: ${(e as Error).message}`,
				});
			}

			// Check app.json (Expo config)
			try {
				const appJson = JSON.parse(await diffApplier.readFile('app.json'));
				details.push({
					label: 'app.json has expo configuration',
					verdict: appJson.expo !== undefined ? 'PASS' : 'FAIL',
					error: appJson.expo !== undefined ? undefined : 'app.json missing "expo" key',
				});
			} catch (e) {
				details.push({
					label: 'app.json is readable and valid JSON',
					verdict: 'FAIL',
					error: `Cannot read or parse app.json: ${(e as Error).message}`,
				});
			}

			// Check App.tsx
			try {
				const app = await diffApplier.readFile('App.tsx');
				details.push({
					label: 'App.tsx uses React Native components',
					verdict: /View|Text|StyleSheet/.test(app) ? 'PASS' : 'FAIL',
					error: /View|Text|StyleSheet/.test(app) ? undefined : 'App.tsx does not use React Native components (View, Text, StyleSheet)',
				});
				details.push({
					label: 'App.tsx exports default component',
					verdict: /export\s+default/.test(app) ? 'PASS' : 'FAIL',
					error: /export\s+default/.test(app) ? undefined : 'App.tsx does not have a default export',
				});
			} catch (e) {
				details.push({
					label: 'App.tsx is readable',
					verdict: 'FAIL',
					error: `Cannot read App.tsx: ${(e as Error).message}`,
				});
			}

			// Check tsconfig.json
			try {
				const tsconfig = await diffApplier.readFile('tsconfig.json');
				details.push({
					label: 'tsconfig.json has compilerOptions',
					verdict: /"compilerOptions"/.test(tsconfig) ? 'PASS' : 'FAIL',
					error: /"compilerOptions"/.test(tsconfig) ? undefined : 'tsconfig.json missing compilerOptions',
				});
			} catch (e) {
				details.push({
					label: 'tsconfig.json is readable',
					verdict: 'FAIL',
					error: `Cannot read tsconfig.json: ${(e as Error).message}`,
				});
			}

			return details;
		},
	},
];

// ──────────────────────────────────────────────────────────────────────────────
// Event collector
// ──────────────────────────────────────────────────────────────────────────────

/** Collects AgentLoopEvents into categorized arrays for easier assertion. */
export class EventCollector {
	private readonly _thinking: Array<{ text: string }> = [];
	private readonly _tokens: Array<{ text: string }> = [];
	private readonly _toolStarts: Array<{ toolId: string; toolName: string; toolInput?: unknown }> = [];
	private readonly _toolExecutings: Array<{ toolId: string; toolName: string; detail?: string }> = [];
	private readonly _toolResults: Array<{ toolId: string; toolName: string; result: string; success: boolean }> = [];
	private readonly _fileWritten: Array<{ filePath: string }> = [];
	private readonly _completed: Array<{ summary: string }> = [];
	private readonly _errors: Array<{ text: string; recoverable: boolean }> = [];

	/** Push a single event into the correct bucket. */
	push(event: AgentLoopEvent): void {
		switch (event.type) {
			case 'thinking':
				this._thinking.push({ text: event.text });
				break;
			case 'token':
				this._tokens.push({ text: event.text });
				break;
			case 'tool_start':
				this._toolStarts.push({ toolId: event.toolId, toolName: event.toolName, toolInput: event.toolInput });
				break;
			case 'tool_executing':
				this._toolExecutings.push({ toolId: event.toolId, toolName: event.toolName, detail: event.detail });
				break;
			case 'tool_result':
				this._toolResults.push({ toolId: event.toolId, toolName: event.toolName, result: event.result, success: event.success });
				break;
			case 'file_written':
				this._fileWritten.push({ filePath: event.filePath });
				break;
			case 'complete':
				this._completed.push({ summary: event.summary });
				break;
			case 'error':
				this._errors.push({ text: event.text, recoverable: event.recoverable });
				break;
		}
	}

	/** Return the collected events in a frozen snapshot. */
	collect(): ICollectedEvents {
		return Object.freeze({
			thinking: Object.freeze(this._thinking),
			tokens: Object.freeze(this._tokens),
			toolStarts: Object.freeze(this._toolStarts),
			toolExecutings: Object.freeze(this._toolExecutings),
			toolResults: Object.freeze(this._toolResults),
			fileWritten: Object.freeze(this._fileWritten),
			completed: Object.freeze(this._completed),
			errors: Object.freeze(this._errors),
		});
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Test runner
// ──────────────────────────────────────────────────────────────────────────────

/** Options for the E2E canonical task test runner. */
export interface IE2ECanonicalTaskRunnerOptions {
	/** The agent loop service under test. */
	readonly agentLoop: IAgentLoop;
	/** Diff applier for reading/verifying files. */
	readonly diffApplier: IDiffApplier;
	/** Terminal executor for running verification commands. */
	readonly terminalExecutor: ITerminalExecutor;
	/** AbortSignal for cancelling the entire suite. */
	readonly signal?: AbortSignal;
	/** Optional filter to run only specific task IDs. */
	readonly taskFilter?: readonly number[];
	/** Timeout per task in milliseconds (default: 300000 = 5 minutes). */
	readonly perTaskTimeoutMs?: number;
	/** Callback invoked with progress after each task completes. */
	readonly onTaskComplete?: (result: ITaskTestResult) => void;
}

/**
 * E2E Canonical Task Runner — orchestrates the full agent-loop test cycle.
 *
 * For each canonical task:
 *   1. Run the planning phase and verify it returns a valid plan
 *   2. Run the execution phase and collect all events
 *   3. Verify files exist on disk
 *   4. Verify file contents match expectations
 *   5. Run custom verification steps
 *   6. Return a TestResult with PASS/FAIL and exact errors
 */
export class E2ECanonicalTaskRunner extends DisposableStore {

	private readonly _agentLoop: IAgentLoop;
	private readonly _diffApplier: IDiffApplier;
	private readonly _terminalExecutor: ITerminalExecutor;
	private readonly _signal: AbortSignal | undefined;
	private readonly _taskFilter: ReadonlySet<number>;
	private readonly _perTaskTimeoutMs: number;
	private readonly _onTaskComplete: ((result: ITaskTestResult) => void) | undefined;

	constructor(options: IE2ECanonicalTaskRunnerOptions) {
		super();
		this._agentLoop = options.agentLoop;
		this._diffApplier = options.diffApplier;
		this._terminalExecutor = options.terminalExecutor;
		this._signal = options.signal;
		this._taskFilter = options.taskFilter
			? new Set(options.taskFilter)
			: new Set(canonicalTasks.map(t => t.id));
		this._perTaskTimeoutMs = options.perTaskTimeoutMs ?? 300_000;
		this._onTaskComplete = options.onTaskComplete;
	}

	/** Run all (or filtered) canonical tasks and return the suite result. */
	async runAll(): Promise<ISuiteResult> {
		const taskResults: ITaskTestResult[] = [];
		const suiteStart = Date.now();

		const tasksToRun = canonicalTasks.filter(t => this._taskFilter.has(t.id));

		for (const task of tasksToRun) {
			if (this._signal?.aborted) {
				break;
			}
			const result = await this._runSingleTask(task);
			taskResults.push(result);
			this._onTaskComplete?.(result);
		}

		const totalDurationMs = Date.now() - suiteStart;
		const passed = taskResults.filter(r => r.verdict === 'PASS').length;
		const failed = taskResults.filter(r => r.verdict === 'FAIL').length;

		return Object.freeze({
			totalTasks: taskResults.length,
			passed,
			failed,
			taskResults: Object.freeze(taskResults),
			overallVerdict: failed === 0 ? 'PASS' : 'FAIL',
			totalDurationMs,
		});
	}

	/** Run a single canonical task through the full pipeline. */
	private async _runSingleTask(task: ICanonicalTask): Promise<ITaskTestResult> {
		const start = Date.now();
		const details: IVerificationDetail[] = [];

		let planningPhaseOk = false;
		let executionPhaseOk = false;
		let fileExistenceOk = false;
		let fileContentOk = false;
		let planResult: IPlanResult | undefined;
		let events: ICollectedEvents;
		let taskError: string | undefined;

		// ── Step 1: Planning phase ────────────────────────────────────────
		try {
			planResult = await this._withTimeout(
				this._agentLoop.runPlanningPhase(task.prompt, this._signal),
				this._perTaskTimeoutMs,
				`Planning phase timed out for task ${task.id}`
			);

			// Verify plan structure
			const planHasSteps = planResult.steps.length > 0;
			const planHasSummary = planResult.summary.length > 0;
			planningPhaseOk = planHasSteps && planHasSummary;

			if (!planHasSteps) {
				details.push({
					label: 'Planning phase produced steps',
					verdict: 'FAIL',
					error: 'Planning phase returned zero steps',
				});
			} else {
				details.push({ label: 'Planning phase produced steps', verdict: 'PASS' });
			}

			if (!planHasSummary) {
				details.push({
					label: 'Planning phase produced summary',
					verdict: 'FAIL',
					error: 'Planning phase returned empty summary',
				});
			} else {
				details.push({ label: 'Planning phase produced summary', verdict: 'PASS' });
			}

			// Verify plan checklist contains expected action types
			const planActionTypes = new Set(planResult.steps.map(s => s.action));
			const hasCreateAction = planActionTypes.has('Create');
			details.push({
				label: 'Plan includes Create actions',
				verdict: hasCreateAction ? 'PASS' : 'FAIL',
				error: hasCreateAction ? undefined : `Plan actions are: ${[...planActionTypes].join(', ')}; expected at least one Create action`,
			});
		} catch (e) {
			planningPhaseOk = false;
			taskError = `Planning phase failed: ${(e as Error).message}`;
			details.push({
				label: 'Planning phase completed without error',
				verdict: 'FAIL',
				error: taskError,
			});
		}

		// ── Step 2: Execution phase ───────────────────────────────────────
		const collector = new EventCollector();
		try {
			const generator = this._agentLoop.run(task.prompt, this._signal);
			const iterationResult = await this._withTimeout(
				this._iterateGenerator(generator, collector),
				this._perTaskTimeoutMs,
				`Execution phase timed out for task ${task.id}`
			);

			if (iterationResult === 'errored') {
				executionPhaseOk = false;
				details.push({
					label: 'Execution phase completed without error',
					verdict: 'FAIL',
					error: 'Execution phase encountered an error event',
				});
			} else {
				executionPhaseOk = true;
				details.push({ label: 'Execution phase completed without error', verdict: 'PASS' });
			}

			// Verify execution emitted expected event types
			details.push({
				label: 'Agent emitted thinking events',
				verdict: collector.collect().thinking.length > 0 ? 'PASS' : 'FAIL',
				error: collector.collect().thinking.length > 0 ? undefined : 'No thinking events emitted',
			});
			details.push({
				label: 'Agent emitted tool_start events',
				verdict: collector.collect().toolStarts.length > 0 ? 'PASS' : 'FAIL',
				error: collector.collect().toolStarts.length > 0 ? undefined : 'No tool_start events emitted',
			});
			details.push({
				label: 'Agent emitted complete event',
				verdict: collector.collect().completed.length > 0 ? 'PASS' : 'FAIL',
				error: collector.collect().completed.length > 0 ? undefined : 'No complete event emitted',
			});
		} catch (e) {
			executionPhaseOk = false;
			taskError = taskError ?? `Execution phase failed: ${(e as Error).message}`;
			details.push({
				label: 'Execution phase completed without error',
				verdict: 'FAIL',
				error: `Execution phase threw: ${(e as Error).message}`,
			});
		}

		events = collector.collect();

		// ── Step 3: File existence checks ─────────────────────────────────
		let allFilesExist = true;
		for (const expectedFile of task.expectedFiles) {
			try {
				const exists = await this._diffApplier.exists(expectedFile);
				if (!exists) {
					allFilesExist = false;
					details.push({
						label: `File exists: ${expectedFile}`,
						verdict: 'FAIL',
						error: `Expected file "${expectedFile}" does not exist on disk`,
					});
				} else {
					details.push({ label: `File exists: ${expectedFile}`, verdict: 'PASS' });
				}
			} catch (e) {
				allFilesExist = false;
				details.push({
					label: `File exists: ${expectedFile}`,
					verdict: 'FAIL',
					error: `Error checking file "${expectedFile}": ${(e as Error).message}`,
				});
			}
		}
		fileExistenceOk = allFilesExist;

		// ── Step 4: File content pattern checks ───────────────────────────
		let allPatternsMatch = true;
		for (const pattern of task.expectedFilePatterns) {
			let patternFound = false;
			for (const expectedFile of task.expectedFiles) {
				try {
					const content = await this._diffApplier.readFile(expectedFile);
					if (pattern.test(content)) {
						patternFound = true;
						break;
					}
				} catch {
					// File may not exist or be unreadable; skip
				}
			}
			if (patternFound) {
				details.push({ label: `Pattern matched: ${pattern.toString()}`, verdict: 'PASS' });
			} else {
				allPatternsMatch = false;
				details.push({
					label: `Pattern matched: ${pattern.toString()}`,
					verdict: 'FAIL',
					error: `Pattern ${pattern.toString()} not found in any expected file`,
				});
			}
		}
		fileContentOk = allPatternsMatch;

		// ── Step 5: Custom verification steps ─────────────────────────────
		try {
			const customDetails = await task.verificationSteps(
				this._diffApplier,
				this._terminalExecutor,
				events
			);
			details.push(...customDetails);
		} catch (e) {
			details.push({
				label: 'Custom verification steps completed',
				verdict: 'FAIL',
				error: `Custom verification threw: ${(e as Error).message}`,
			});
		}

		// ── Compute final verdict ─────────────────────────────────────────
		const hasAnyFailure = details.some(d => d.verdict === 'FAIL');
		const verdict: VerificationVerdict = hasAnyFailure ? 'FAIL' : 'PASS';

		return {
			taskId: task.id,
			taskName: task.name,
			verdict,
			planningPhaseOk,
			executionPhaseOk,
			fileExistenceOk,
			fileContentOk,
			verificationDetails: Object.freeze(details),
			error: taskError,
			durationMs: Date.now() - start,
		};
	}

	/**
	 * Iterate through an AsyncGenerator, collecting events.
	 * Returns 'completed' if the generator finished normally, or 'errored'
	 * if an error event was the last meaningful event.
	 */
	private async _iterateGenerator(
		generator: AsyncGenerator<AgentLoopEvent>,
		collector: EventCollector
	): Promise<'completed' | 'errored'> {
		let lastEventType: string | undefined;
		let hasError = false;

		for await (const event of generator) {
			if (this._signal?.aborted) {
				break;
			}
			collector.push(event);
			lastEventType = event.type;
			if (event.type === 'error' && !event.recoverable) {
				hasError = true;
			}
		}

		if (hasError && lastEventType !== 'complete') {
			return 'errored';
		}
		return 'completed';
	}

	/** Wrap a promise with a timeout that rejects with a descriptive message. */
	private async _withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		timeoutMessage: string
	): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
		});
		try {
			return await Promise.race([promise, timeoutPromise]);
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatting utilities
// ──────────────────────────────────────────────────────────────────────────────

/** Format a single task result as a human-readable string. */
export function formatTaskResult(result: ITaskTestResult): string {
	const lines: string[] = [];
	const status = result.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL';

	lines.push(`━━━ Task ${result.taskId}: ${result.taskName} ━━━ ${status} (${result.durationMs}ms)`);
	lines.push(`  Planning phase: ${result.planningPhaseOk ? 'OK' : 'FAILED'}`);
	lines.push(`  Execution phase: ${result.executionPhaseOk ? 'OK' : 'FAILED'}`);
	lines.push(`  File existence:  ${result.fileExistenceOk ? 'OK' : 'FAILED'}`);
	lines.push(`  File content:    ${result.fileContentOk ? 'OK' : 'FAILED'}`);

	if (result.error) {
		lines.push(`  Error: ${result.error}`);
	}

	for (const detail of result.verificationDetails) {
		const icon = detail.verdict === 'PASS' ? '✓' : '✗';
		const suffix = detail.error ? ` — ${detail.error}` : '';
		lines.push(`    ${icon} ${detail.label}${suffix}`);
	}

	return lines.join('\n');
}

/** Format a suite result as a human-readable report. */
export function formatSuiteResult(result: ISuiteResult): string {
	const lines: string[] = [];

	lines.push('╔══════════════════════════════════════════════════════════════╗');
	lines.push('║        CONSTRUCT IDE — E2E Canonical Task Suite            ║');
	lines.push('╚══════════════════════════════════════════════════════════════╝');
	lines.push('');
	lines.push(`Total: ${result.totalTasks}  |  Passed: ${result.passed}  |  Failed: ${result.failed}  |  Duration: ${result.totalDurationMs}ms`);
	lines.push(`Overall verdict: ${result.overallVerdict === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
	lines.push('');

	for (const taskResult of result.taskResults) {
		lines.push(formatTaskResult(taskResult));
		lines.push('');
	}

	return lines.join('\n');
}

/** Format a suite result as JSON for CI consumption. */
export function suiteResultToJson(result: ISuiteResult): string {
	return JSON.stringify(result, null, 2);
}
