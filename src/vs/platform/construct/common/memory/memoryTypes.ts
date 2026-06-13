// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

// --- Memory Layer Enum --------------------------------------------------------

export const enum MemoryLayer {
	Working = 'working',
	Episodic = 'episodic',
	Semantic = 'semantic',
	Procedural = 'procedural'
}

// --- Base Memory Entry -------------------------------------------------------

export interface IMemoryEntry {
	readonly id: string;
	readonly layer: MemoryLayer;
	readonly content: string;
	readonly timestamp: number;
	readonly projectId: string;
	readonly relevanceScore?: number;
	readonly metadata?: Record<string, any>;
}

// --- Working Memory -----------------------------------------------------------

export interface IWorkingMemoryEntry extends IMemoryEntry {
	readonly contextWindow: string[];
	readonly activeFiles: string[];
	readonly cursorPositions: Array<{ file: string; line: number; column: number }>;
	readonly conversationHistory: string[];
	readonly tokenBudget: number;
	readonly tokensUsed: number;
}

// --- Episodic Memory ----------------------------------------------------------

export interface IEpisodicMemoryEntry extends IMemoryEntry {
	readonly action: string;
	readonly outcome: string;
	readonly durationMs: number;
	readonly agentType?: string;
	readonly taskId?: string;
	readonly filesAffected: string[];
	readonly errorMessage?: string;
	readonly success: boolean;
}

// --- Semantic Memory ----------------------------------------------------------

export interface ISemanticMemoryEntry extends IMemoryEntry {
	readonly embedding: number[];
	readonly tags: string[];
	readonly sourceFile?: string;
	readonly sourceLine?: number;
	readonly sourceColumn?: number;
	readonly chunkType?: 'function' | 'class' | 'variable' | 'comment' | 'doc' | 'other';
}

// --- Procedural Memory --------------------------------------------------------

export interface IProceduralMemoryEntry extends IMemoryEntry {
	readonly pattern: string;
	readonly context: string;
	readonly successCount: number;
	readonly failureCount: number;
	readonly totalAttempts: number;
	readonly lastUsed: number;
	readonly createdAt: number;
	readonly examples: string[];
}

// --- Query & Search -----------------------------------------------------------

export interface IMemoryQuery {
	readonly layer?: MemoryLayer;
	readonly projectId?: string;
	readonly tags?: string[];
	readonly timeRange?: { start: number; end: number };
	readonly semanticQuery?: string;
	readonly embedding?: number[];
	readonly topK?: number;
	readonly minRelevance?: number;
}

export interface IMemorySearchResult {
	readonly entries: IMemoryEntry[];
	readonly total: number;
	readonly relevanceScores: number[];
	readonly queryTimeMs: number;
}

// --- Stats & Config -----------------------------------------------------------

export interface IMemoryStats {
	readonly totalEntries: number;
	readonly entriesByLayer: Record<MemoryLayer, number>;
	readonly storageUsedBytes: number;
	readonly lastConsolidation: number;
	readonly avgQueryTimeMs: number;
}

export interface IEmbeddingConfig {
	readonly dimension: number;
	readonly model: string;
	readonly local: boolean;
	readonly batchSize: number;
}
