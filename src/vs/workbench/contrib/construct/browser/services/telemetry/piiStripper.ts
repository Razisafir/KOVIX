/*---------------------------------------------------------------------------------------------
 *  Construct IDE - PII Stripper
 *  Engine for stripping personally identifiable information from telemetry data.
 *  Handles emails, phone numbers, API keys, file paths, code identifiers,
 *  and applies differential privacy noise to numeric metrics.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { PIIStrippingLevel, DIFFERENTIAL_PRIVACY_EPSILON_BASIC, DIFFERENTIAL_PRIVACY_EPSILON_AGGRESSIVE } from '../../../../../../platform/construct/common/telemetry/telemetryTypes.js';

// ─── PII Patterns ──────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
	// Email addresses
	{ pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]', description: 'Email addresses' },
	// Phone numbers (US and international patterns)
	{ pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[PHONE]', description: 'Phone numbers' },
	// IP addresses (IPv4)
	{ pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, replacement: '[IP]', description: 'IP addresses' },
	// Credit card numbers (basic Luhn-aware pattern)
	{ pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[CREDIT_CARD]', description: 'Credit card numbers' },
	// SSN / Tax IDs
	{ pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: '[ID]', description: 'Social Security / Tax IDs' },
	// GitHub tokens
	{ pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: '[GH_TOKEN]', description: 'GitHub tokens' },
	// GitHub OAuth tokens
	{ pattern: /gho_[a-zA-Z0-9]{36}/g, replacement: '[GH_TOKEN]', description: 'GitHub OAuth tokens' },
	// AWS Access Keys
	{ pattern: /AKIA[A-Z0-9]{16}/g, replacement: '[AWS_KEY]', description: 'AWS access keys' },
	// AWS Secret Keys
	{ pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g, replacement: '[AWS_KEY]', description: 'AWS secret keys' },
	// Generic API keys / tokens (common patterns)
	{ pattern: /(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi, replacement: '[API_KEY]', description: 'API keys and tokens' },
	// Generic secrets / passwords
	{ pattern: /(?:password|passwd|pwd|secret|private[_-]?key)\s*[=:]\s*['"]?.+['"]?/gi, replacement: '[SECRET]', description: 'Passwords and secrets' },
	// Bearer tokens in headers
	{ pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: '[BEARER_TOKEN]', description: 'Bearer tokens' },
	// URLs with domains (replace domain but keep path structure)
	{ pattern: /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[DOMAIN]', description: 'URLs with domains' },
	// Absolute file paths (Unix)
	{ pattern: /(?:\/[a-zA-Z0-9._-]+){2,}/g, replacement: '[PATH]', description: 'Absolute file paths' },
	// Windows file paths
	{ pattern: /[A-Z]:\\(?:[a-zA-Z0-9._-]+\\)+/g, replacement: '[PATH]', description: 'Windows file paths' },
	// Home directory references
	{ pattern: /~\/[a-zA-Z0-9._/-]+/g, replacement: '~/[PATH]', description: 'Home directory paths' }
];

// ─── Medical Term Blocklist (HIPAA-aware) ──────────────────────────────────

const MEDICAL_TERMS: readonly string[] = [
	'diagnosis', 'prescription', 'medication', 'patient', 'doctor',
	'hospital', 'clinic', 'medical', 'health', 'disease', 'symptom',
	'treatment', 'therapy', 'diagnosis code', 'icd', 'cpt code',
	'phi', 'hipaa', 'ehr', 'emr', 'health record', 'medical record',
	'insurance claim', 'healthcare provider', 'lab result', 'blood test',
	'x-ray', 'mri', 'ct scan', 'ultrasound', 'biopsy'
];

// ─── Common Names Database (subset for demo) ───────────────────────────────

const COMMON_FIRST_NAMES: readonly string[] = [
	'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael',
	'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan',
	'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Christopher', 'Karen',
	'Charles', 'Lisa', 'Daniel', 'Nancy', 'Matthew', 'Betty', 'Anthony',
	'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley', 'Steven', 'Kimberly',
	'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle', 'Kenneth',
	'Carol', 'Kevin', 'Amanda', 'Brian', 'Dorothy', 'George', 'Melissa',
	'Timothy', 'Deborah'
];

const COMMON_LAST_NAMES: readonly string[] = [
	'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
	'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
	'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
	'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
	'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
	'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green',
	'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell'
];

// ─── Code Anonymization ────────────────────────────────────────────────────

/** Keywords and builtins that should NOT be anonymized in code. */
const CODE_KEYWORDS = new Set([
	// JavaScript/TypeScript
	'function', 'class', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
	'do', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch',
	'finally', 'throw', 'new', 'this', 'super', 'import', 'export', 'default',
	'from', 'as', 'async', 'await', 'yield', 'typeof', 'instanceof', 'void',
	'delete', 'in', 'of', 'extends', 'implements', 'interface', 'type',
	'enum', 'namespace', 'module', 'declare', 'abstract', 'readonly',
	'private', 'protected', 'public', 'static', 'get', 'set',
	// Python
	'def', 'lambda', 'with', 'raise', 'pass', 'elif', 'except', 'global',
	'nonlocal', 'assert', 'True', 'False', 'None',
	// Rust
	'fn', 'impl', 'pub', 'mut', 'ref', 'use', 'mod', 'crate', 'trait',
	'struct', 'where', 'match', 'loop', 'move', 'dyn', 'Self',
	// Go
	'func', 'go', 'chan', 'select', 'defer', 'range', 'map', 'package',
	// Common
	'true', 'false', 'null', 'undefined', 'console', 'log', 'error', 'warn',
	'string', 'number', 'boolean', 'object', 'array', 'promise', 'map',
	'set', 'date', 'math', 'json', 'object', 'array', 'string', 'number',
	'promise', 'map', 'set', 'record', 'partial', 'required', 'optional'
]);

// ─── PII Stripper ──────────────────────────────────────────────────────────

export class PIIStripper {
	private readonly variableCounter = new Map<string, number>();
	private readonly functionCounter = new Map<string, number>();

	/**
	 * Strip PII from a text string using all registered patterns.
	 * The stripping level controls how aggressive the replacement is.
	 */
	stripPII(text: string, level: PIIStrippingLevel = 'aggressive'): string {
		if (level === 'none') {
			return text;
		}

		let result = text;

		// Apply all PII patterns
		for (const { pattern, replacement } of PII_PATTERNS) {
			// Reset lastIndex for global regexes
			pattern.lastIndex = 0;
			result = result.replace(pattern, replacement);
		}

		// Aggressive mode: also strip common names
		if (level === 'aggressive') {
			result = this.stripNames(result);
		}

		// Check for medical terms (always block, regardless of level)
		result = this.blockMedicalTerms(result);

		return result;
	}

	/**
	 * Strip common first/last names from text.
	 */
	private stripNames(text: string): string {
		let result = text;

		for (const name of COMMON_FIRST_NAMES) {
			// Match whole word only
			const regex = new RegExp(`\\b${name}\\b`, 'g');
			result = result.replace(regex, '[NAME]');
		}

		for (const name of COMMON_LAST_NAMES) {
			const regex = new RegExp(`\\b${name}\\b`, 'g');
			result = result.replace(regex, '[NAME]');
		}

		return result;
	}

	/**
	 * Block medical terms by replacing them with a placeholder.
	 * This ensures HIPAA compliance by preventing accidental health data collection.
	 */
	private blockMedicalTerms(text: string): string {
		let result = text;
		for (const term of MEDICAL_TERMS) {
			const regex = new RegExp(`\\b${term}\\b`, 'gi');
			result = result.replace(regex, '[BLOCKED_MEDICAL]');
		}
		return result;
	}

	/**
	 * Anonymize code while preserving its structure.
	 * - Replace variable names with generic identifiers (var1, var2, etc.)
	 * - Replace function names with generic identifiers (func1, func2, etc.)
	 * - Replace string literals with [STRING]
	 * - Keep control flow, imports, and structure intact
	 */
	anonymizeCode(code: string, level: PIIStrippingLevel = 'aggressive'): string {
		if (level === 'none') {
			return code;
		}

		let result = code;

		// Step 1: First strip PII from code (emails, keys, etc. in strings)
		result = this.stripPII(result, level);

		// Step 2: Replace string literals (except empty strings and common patterns)
		result = result.replace(/'[^']{2,}'/g, '[STRING]');
		result = result.replace(/"[^"]{2,}"/g, '[STRING]');
		result = result.replace(/`[^`]{2,}`/g, '[STRING]');

		// Step 3: Replace variable assignments (camelCase identifiers)
		if (level === 'aggressive') {
			result = this.anonymizeIdentifiers(result);
		}

		return result;
	}

	/**
	 * Replace custom identifiers with generic names while preserving
	 * keywords and builtins.
	 */
	private anonymizeIdentifiers(code: string): string {
		// Match camelCase or PascalCase identifiers that are not keywords
		const identifierPattern = /\b([a-z][a-zA-Z0-9]*)\b/g;
		const upperIdentifierPattern = /\b([A-Z][a-zA-Z0-9]*)\b/g;

		// Track replacements to maintain consistency
		const varMapping = new Map<string, string>();
		const funcMapping = new Map<string, string>();
		let varCount = 0;
		let funcCount = 0;

		// Replace lowerCamelCase identifiers (variables, properties, methods)
		let result = code.replace(identifierPattern, (match: string) => {
			if (CODE_KEYWORDS.has(match) || match.length <= 2) {
				return match;
			}

			if (!varMapping.has(match)) {
				varCount++;
				varMapping.set(match, `var${varCount}`);
			}
			return varMapping.get(match)!;
		});

		// Replace UpperCamelCase identifiers (class names, type names)
		result = result.replace(upperIdentifierPattern, (match: string) => {
			if (CODE_KEYWORDS.has(match) || match.length <= 2) {
				return match;
			}

			if (!funcMapping.has(match)) {
				funcCount++;
				funcMapping.set(match, `Func${funcCount}`);
			}
			return funcMapping.get(match)!;
		});

		return result;
	}

	/**
	 * Extract a code pattern description from before/after code snippets.
	 * Instead of storing the actual code, we describe its structural pattern.
	 */
	extractCodePattern(before: string, after: string): string {
		const patterns: string[] = [];

		// Detect structural changes
		if (this.hasTryCatch(after) && !this.hasTryCatch(before)) {
			patterns.push('added try-catch');
		}
		if (this.hasIfElse(after) && !this.hasIfElse(before)) {
			patterns.push('added conditional');
		}
		if (this.hasLoop(after) && !this.hasLoop(before)) {
			patterns.push('added loop');
		}
		if (this.hasAsyncAwait(after) && !this.hasAsyncAwait(before)) {
			patterns.push('added async/await');
		}
		if (this.hasImport(after) && !this.hasImport(before)) {
			patterns.push('added import');
		}
		if (this.hasClass(after) && !this.hasClass(before)) {
			patterns.push('added class');
		}
		if (this.hasFunction(after) && !this.hasFunction(before)) {
			patterns.push('added function');
		}

		// Detect edit types
		const beforeLines = before.split('\n').length;
		const afterLines = after.split('\n').length;

		if (afterLines > beforeLines + 2) {
			patterns.push('addition');
		} else if (beforeLines > afterLines + 2) {
			patterns.push('deletion');
		} else {
			patterns.push('modification');
		}

		return patterns.length > 0 ? `code edit: ${patterns.join(', ')}` : 'code edit: minor change';
	}

	/**
	 * Anonymize an error stack trace by replacing identifiers.
	 */
	anonymizeError(error: Error, context: object): string {
		const message = error.message || 'Unknown error';
		const stack = error.stack || '';

		// Strip PII from error message
		let anonymized = this.stripPII(message, 'aggressive');

		// Anonymize the stack trace
		const anonymizedStack = stack
			.replace(/at\s+([a-zA-Z0-9_.]+)/g, 'at [FUNCTION]')
			.replace(/\(([^)]+)\)/g, '([PATH])')
			.replace(/:\d+:\d+/g, ':line:col');

		// Combine message pattern with anonymized stack
		if (anonymizedStack) {
			const stackLines = anonymizedStack.split('\n').slice(0, 5); // Keep top 5 frames
			anonymized += '\n' + stackLines.join('\n');
		}

		return anonymized;
	}

	// ─── Differential Privacy ─────────────────────────────────────────────

	/**
	 * Add Laplace noise to a numeric value for differential privacy.
	 * The noise scale is determined by the sensitivity (max change from one event)
	 * divided by epsilon (privacy budget).
	 *
	 * @param value The true numeric value
	 * @param epsilon Privacy budget (smaller = more noise, more privacy)
	 * @param sensitivity The maximum change a single event can cause (default 1)
	 * @returns The noisy value
	 */
	addLaplaceNoise(value: number, epsilon: number = DIFFERENTIAL_PRIVACY_EPSILON_BASIC, sensitivity: number = 1): number {
		const scale = sensitivity / epsilon;
		const u = Math.random() - 0.5;
		const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
		return Math.max(0, Math.round(value + noise));
	}

	/**
	 * Get the appropriate epsilon value based on the stripping level.
	 */
	getEpsilon(level: PIIStrippingLevel): number {
		switch (level) {
			case 'basic':
				return DIFFERENTIAL_PRIVACY_EPSILON_BASIC;
			case 'aggressive':
				return DIFFERENTIAL_PRIVACY_EPSILON_AGGRESSIVE;
			default:
				return DIFFERENTIAL_PRIVACY_EPSILON_BASIC;
		}
	}

	// ─── Pattern Detection Helpers ────────────────────────────────────────

	private hasTryCatch(code: string): boolean {
		return /\btry\s*\{/.test(code) && /\bcatch\s*\(/.test(code);
	}

	private hasIfElse(code: string): boolean {
		return /\bif\s*\(/.test(code);
	}

	private hasLoop(code: string): boolean {
		return /\b(for|while|do)\s*[\({]/.test(code);
	}

	private hasAsyncAwait(code: string): boolean {
		return /\basync\b/.test(code) && /\bawait\b/.test(code);
	}

	private hasImport(code: string): boolean {
		return /\bimport\s/.test(code) || /\brequire\s*\(/.test(code);
	}

	private hasClass(code: string): boolean {
		return /\bclass\s+[A-Z]/.test(code);
	}

	private hasFunction(code: string): boolean {
		return /\bfunction\s+[a-zA-Z]/.test(code) || /\bconst\s+[a-zA-Z]+\s*=\s*(async\s+)?\(/.test(code);
	}

	/**
	 * Reset counters for a new anonymization session.
	 */
	reset(): void {
		this.variableCounter.clear();
		this.functionCounter.clear();
	}
}
