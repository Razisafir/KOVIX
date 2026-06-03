/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Tree-sitter / Regex-based Parser
 *  Parses source files into symbols, imports, exports, and semantic chunks.
 *  Graceful fallback to regex-based extraction when Tree-sitter is unavailable.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import {
        ISymbol,
        SymbolType,
        IFileStructure,
        SUPPORTED_LANGUAGES,
        DEFAULT_EXCLUDE_PATTERNS
} from '../../../../platform/construct/common/indexing/indexingTypes.js';

// ─── Language Detection ────────────────────────────────────────────────────

export function detectLanguage(filePath: string): string | undefined {
        const ext = filePath.substring(filePath.lastIndexOf('.'));
        return SUPPORTED_LANGUAGES[ext];
}

export function shouldIndexFile(filePath: string): boolean {
        // Skip excluded directories
        for (const pattern of DEFAULT_EXCLUDE_PATTERNS) {
                if (filePath.includes(`/${pattern}/`) || filePath.includes(`\\${pattern}\\`)) {
                        return false;
                }
        }

        // Must be a supported language
        const ext = filePath.substring(filePath.lastIndexOf('.'));
        return ext in SUPPORTED_LANGUAGES;
}

// ─── Regex Patterns by Language ────────────────────────────────────────────

interface IRegexPatterns {
        functionDecl: RegExp[];
        classDecl: RegExp[];
        interfaceDecl: RegExp[];
        enumDecl: RegExp[];
        typeDecl: RegExp[];
        importDecl: RegExp[];
        exportDecl: RegExp[];
        constDecl: RegExp[];
        commentBlock: RegExp;
}

const TYPESCRIPT_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g,
                /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,
                /(?:export\s+)?(?:async\s+)?function\s*\*\s+(\w+)\s*\(/g
        ],
        classDecl: [
                /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/g
        ],
        interfaceDecl: [
                /(?:export\s+)?interface\s+(\w+)/g
        ],
        enumDecl: [
                /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/g
        ],
        typeDecl: [
                /(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/g
        ],
        importDecl: [
                /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
                /import\s*\(['"]([^'"]+)['"]\)/g
        ],
        exportDecl: [
                /export\s+(?:default\s+)?(?:function|class|interface|enum|type|const|let|var)\s+(\w+)/g,
                /export\s*\{([^}]+)\}/g
        ],
        constDecl: [
                /(?:export\s+)?const\s+(\w+)\s*[:=]/g
        ],
        commentBlock: /\/\*\*[\s\S]*?\*\//g
};

const PYTHON_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /(?:async\s+)?def\s+(\w+)\s*\(/g
        ],
        classDecl: [
                /class\s+(\w+)/g
        ],
        interfaceDecl: [],
        enumDecl: [],
        typeDecl: [],
        importDecl: [
                /(?:from|import)\s+([a-zA-Z_][\w.]*)/g
        ],
        exportDecl: [],
        constDecl: [
                /([A-Z_][A-Z0-9_]*)\s*=/g
        ],
        commentBlock: /"""[\s\S]*?"""/g
};

const RUST_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g
        ],
        classDecl: [
                /(?:pub\s+)?struct\s+(\w+)/g,
                /(?:pub\s+)?trait\s+(\w+)/g
        ],
        interfaceDecl: [],
        enumDecl: [
                /(?:pub\s+)?enum\s+(\w+)/g
        ],
        typeDecl: [
                /(?:pub\s+)?type\s+(\w+)/g
        ],
        importDecl: [
                /use\s+([\w:]+)/g
        ],
        exportDecl: [
                /pub\s+(?:fn|struct|enum|type|trait|mod)\s+(\w+)/g
        ],
        constDecl: [
                /(?:pub\s+)?const\s+(\w+)/g
        ],
        commentBlock: /\/\*[\s\S]*?\*\//g
};

const GO_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g
        ],
        classDecl: [],
        interfaceDecl: [
                /type\s+(\w+)\s+interface\s*\{/g
        ],
        enumDecl: [],
        typeDecl: [
                /type\s+(\w+)\s+(?:struct|interface)/g
        ],
        importDecl: [
                /import\s+(?:\([\s\S]*?\)|"([^"]+)")/g
        ],
        exportDecl: [],
        constDecl: [
                /const\s+(\w+)/g
        ],
        commentBlock: /\/\*[\s\S]*?\*\//g
};

const JAVA_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:[\w<>\[\]]+\s+)+(\w+)\s*\(/g
        ],
        classDecl: [
                /(?:public|private|protected)?\s*(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/g,
                /(?:public|private|protected)?\s*interface\s+(\w+)/g
        ],
        interfaceDecl: [
                /(?:public\s+)?interface\s+(\w+)/g
        ],
        enumDecl: [
                /(?:public\s+)?enum\s+(\w+)/g
        ],
        typeDecl: [],
        importDecl: [
                /import\s+([\w.]+)/g
        ],
        exportDecl: [],
        constDecl: [
                /(?:public\s+)?static\s+final\s+\w+\s+(\w+)/g
        ],
        commentBlock: /\/\*\*[\s\S]*?\*\//g
};

const CSHARP_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:virtual\s+)?(?:override\s+)?[\w<>\[\]?]+\s+(\w+)\s*\(/g
        ],
        classDecl: [
                /(?:public|private|protected|internal)?\s*(?:abstract\s+)?(?:sealed\s+)?(?:static\s+)?class\s+(\w+)/g
        ],
        interfaceDecl: [
                /(?:public\s+)?interface\s+(\w+)/g
        ],
        enumDecl: [
                /(?:public\s+)?enum\s+(\w+)/g
        ],
        typeDecl: [],
        importDecl: [
                /using\s+([\w.]+)/g
        ],
        exportDecl: [],
        constDecl: [
                /(?:public\s+)?const\s+\w+\s+(\w+)/g
        ],
        commentBlock: /\/\*\*[\s\S]*?\*\//g
};

const RUBY_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /def\s+(?:self\.)?(\w+)/g
        ],
        classDecl: [
                /class\s+(\w+)/g
        ],
        interfaceDecl: [],
        enumDecl: [],
        typeDecl: [],
        importDecl: [
                /(?:require|require_relative)\s+['"]([^'"]+)['"]/g
        ],
        exportDecl: [],
        constDecl: [
                /([A-Z_][A-Z0-9_]*)\s*=/g
        ],
        commentBlock: /=begin[\s\S]*?=end/g
};

const PHP_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /function\s+(\w+)\s*\(/g
        ],
        classDecl: [
                /(?:abstract\s+)?class\s+(\w+)/g
        ],
        interfaceDecl: [
                /interface\s+(\w+)/g
        ],
        enumDecl: [
                /enum\s+(\w+)/g
        ],
        typeDecl: [],
        importDecl: [
                /(?:use|require|include)(?:_once)?\s+['"]?([^'";\s]+)['"]?/g
        ],
        exportDecl: [],
        constDecl: [
                /const\s+(\w+)/g
        ],
        commentBlock: /\/\*\*[\s\S]*?\*\//g
};

const CPP_PATTERNS: IRegexPatterns = {
        functionDecl: [
                /(?:[\w:*&<>]+\s+)+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:\{|$)/g
        ],
        classDecl: [
                /(?:class|struct)\s+(\w+)/g
        ],
        interfaceDecl: [],
        enumDecl: [
                /enum\s+(?:class\s+)?(\w+)/g
        ],
        typeDecl: [
                /typedef\s+[\w\s*]+\s+(\w+)\s*;/g,
                /using\s+(\w+)\s*=/g
        ],
        importDecl: [
                /#include\s*[<"]([^>"]+)[>"]/g
        ],
        exportDecl: [],
        constDecl: [
                /(?:const|constexpr)\s+\w+\s+(\w+)/g
        ],
        commentBlock: /\/\*[\s\S]*?\*\//g
};

// ─── Pattern Registry ─────────────────────────────────────────────────────

const LANGUAGE_PATTERNS: Record<string, IRegexPatterns> = {
        typescript: TYPESCRIPT_PATTERNS,
        javascript: TYPESCRIPT_PATTERNS,
        python: PYTHON_PATTERNS,
        rust: RUST_PATTERNS,
        go: GO_PATTERNS,
        java: JAVA_PATTERNS,
        csharp: CSHARP_PATTERNS,
        ruby: RUBY_PATTERNS,
        php: PHP_PATTERNS,
        cpp: CPP_PATTERNS
};

// ─── Parser Service ────────────────────────────────────────────────────────

export class TreeSitterParser {

        constructor(
                @ILogService private readonly logService: ILogService
        ) { }

        /**
         * Parse a file and extract its structure: symbols, imports, exports.
         */
        parseFile(content: string, filePath: string, language: string): IFileStructure {
                const patterns = LANGUAGE_PATTERNS[language];
                if (!patterns) {
                        this.logService.debug(`[IndexParser] No patterns for language: ${language}, file: ${filePath}`);
                        return {
                                file: filePath,
                                language,
                                symbols: [],
                                imports: [],
                                exports: [],
                                size: content.length,
                                lastModified: Date.now()
                        };
                }

                const symbols = this.extractSymbols(content, filePath, patterns);
                const imports = this.extractImports(content, patterns);
                const exports = this.extractExports(content, patterns);

                return {
                        file: filePath,
                        language,
                        symbols,
                        imports,
                        exports,
                        size: content.length,
                        lastModified: Date.now()
                };
        }

        /**
         * Extract all symbols from file content using regex patterns.
         */
        private extractSymbols(content: string, filePath: string, patterns: IRegexPatterns): ISymbol[] {
                const symbols: ISymbol[] = [];

                // Functions
                for (const pattern of patterns.functionDecl) {
                        this.extractMatches(content, pattern, filePath, SymbolType.Function, symbols);
                }

                // Classes
                for (const pattern of patterns.classDecl) {
                        this.extractMatches(content, pattern, filePath, SymbolType.Class, symbols);
                }

                // Interfaces
                for (const pattern of patterns.interfaceDecl) {
                        this.extractMatches(content, pattern, filePath, SymbolType.Interface, symbols);
                }

                // Enums
                for (const pattern of patterns.enumDecl) {
                        this.extractMatches(content, pattern, filePath, SymbolType.Enum, symbols);
                }

                // Types
                for (const pattern of patterns.typeDecl) {
                        this.extractMatches(content, pattern, filePath, SymbolType.Type, symbols);
                }

                // Constants
                for (const pattern of patterns.constDecl) {
                        this.extractMatches(content, pattern, filePath, SymbolType.Constant, symbols);
                }

                return symbols;
        }

        /**
         * Extract regex matches and convert to ISymbol objects.
         */
        private extractMatches(content: string, pattern: RegExp, filePath: string, type: SymbolType, symbols: ISymbol[]): void {
                const lines = content.split('\n');
                let match: RegExpExecArray | null;

                // Reset regex state
                pattern.lastIndex = 0;

                while ((match = pattern.exec(content)) !== null) {
                        const name = match[1];
                        if (!name || name.startsWith('_') && type === SymbolType.Constant) {
                                continue; // Skip private constants for cleanliness
                        }

                        // Calculate line number from character offset
                        const offset = match.index;
                        let line = 1;
                        let charCount = 0;
                        for (let i = 0; i < lines.length; i++) {
                                charCount += lines[i].length + 1; // +1 for newline
                                if (charCount > offset) {
                                        line = i + 1;
                                        break;
                                }
                        }

                        // Extract signature from the line
                        const lineContent = lines[line - 1]?.trim() ?? '';

                        symbols.push({
                                name,
                                type,
                                file: filePath,
                                line,
                                column: lineContent.indexOf(name) + 1,
                                signature: lineContent.substring(0, 120)
                        });
                }
        }

        /**
         * Extract import paths from file content.
         */
        private extractImports(content: string, patterns: IRegexPatterns): string[] {
                const imports: string[] = [];
                for (const pattern of patterns.importDecl) {
                        let match: RegExpExecArray | null;
                        pattern.lastIndex = 0;
                        while ((match = pattern.exec(content)) !== null) {
                                if (match[1]) {
                                        imports.push(match[1]);
                                }
                        }
                }
                return [...new Set(imports)]; // deduplicate
        }

        /**
         * Extract export names from file content.
         */
        private extractExports(content: string, patterns: IRegexPatterns): string[] {
                const exports: string[] = [];
                for (const pattern of patterns.exportDecl) {
                        let match: RegExpExecArray | null;
                        pattern.lastIndex = 0;
                        while ((match = pattern.exec(content)) !== null) {
                                if (match[1]) {
                                        exports.push(match[1]);
                                } else if (match[0]?.includes('{')) {
                                        // Handle export { foo, bar } syntax
                                        const braceMatch = match[0].match(/\{([^}]+)\}/);
                                        if (braceMatch) {
                                                const names = braceMatch[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()?.trim()).filter((n): n is string => !!n);
                                                exports.push(...names);
                                        }
                                }
                        }
                }
                return [...new Set(exports)];
        }

        /**
         * Chunk a file into semantic pieces for embedding.
         * Chunks at function and class boundaries where possible.
         */
        chunkFile(content: string, filePath: string, language: string, projectId: string): Array<{
                content: string;
                startLine: number;
                endLine: number;
                symbol?: string;
                chunkType: 'function' | 'class' | 'module' | 'block';
        }> {
                const lines = content.split('\n');
                const patterns = LANGUAGE_PATTERNS[language];
                const chunks: Array<{
                        content: string;
                        startLine: number;
                        endLine: number;
                        symbol?: string;
                        chunkType: 'function' | 'class' | 'module' | 'block';
                }> = [];

                if (!patterns || lines.length === 0) {
                        return chunks;
                }

                // Find function and class boundaries
                const boundaries: Array<{ line: number; name: string; type: 'function' | 'class' }> = [];

                for (const pattern of patterns.functionDecl) {
                        pattern.lastIndex = 0;
                        let match: RegExpExecArray | null;
                        while ((match = pattern.exec(content)) !== null) {
                                const line = this.getLineFromOffset(content, match.index);
                                boundaries.push({ line, name: match[1], type: 'function' });
                        }
                }

                for (const pattern of patterns.classDecl) {
                        pattern.lastIndex = 0;
                        let match: RegExpExecArray | null;
                        while ((match = pattern.exec(content)) !== null) {
                                const line = this.getLineFromOffset(content, match.index);
                                boundaries.push({ line, name: match[1], type: 'class' });
                        }
                }

                // Sort boundaries by line number
                boundaries.sort((a, b) => a.line - b.line);

                // Create chunks between boundaries
                if (boundaries.length === 0) {
                        // No boundaries found — chunk the whole file
                        if (content.trim().length > 0) {
                                chunks.push({
                                        content,
                                        startLine: 1,
                                        endLine: lines.length,
                                        chunkType: 'module'
                                });
                        }
                        return chunks;
                }

                // Chunk before first boundary (module-level code)
                const firstBoundaryLine = boundaries[0].line;
                if (firstBoundaryLine > 1) {
                        const preContent = lines.slice(0, firstBoundaryLine - 1).join('\n');
                        if (preContent.trim().length > 0) {
                                chunks.push({
                                        content: preContent,
                                        startLine: 1,
                                        endLine: firstBoundaryLine - 1,
                                        chunkType: 'module'
                                });
                        }
                }

                // Chunk each boundary
                for (let i = 0; i < boundaries.length; i++) {
                        const startLine = boundaries[i].line;
                        const endLine = i + 1 < boundaries.length ? boundaries[i + 1].line - 1 : lines.length;
                        const chunkLines = lines.slice(startLine - 1, endLine);

                        if (chunkLines.length > 0) {
                                chunks.push({
                                        content: chunkLines.join('\n'),
                                        startLine,
                                        endLine,
                                        symbol: boundaries[i].name,
                                        chunkType: boundaries[i].type
                                });
                        }
                }

                return chunks;
        }

        /**
         * Calculate a simple hash of content for incremental indexing.
         */
        contentHash(content: string): string {
                let hash = 0;
                for (let i = 0; i < content.length; i++) {
                        const char = content.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash |= 0; // Convert to 32-bit integer
                }
                return hash.toString(36);
        }

        /**
         * Get line number from character offset.
         */
        private getLineFromOffset(content: string, offset: number): number {
                let line = 1;
                for (let i = 0; i < offset && i < content.length; i++) {
                        if (content[i] === '\n') {
                                line++;
                        }
                }
                return line;
        }
}
