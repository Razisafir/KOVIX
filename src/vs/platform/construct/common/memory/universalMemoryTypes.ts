// Copyright (c) 2025 Razisafir. All rights reserved. See CONSTRUCT_LICENSE.txt.

/**
 * KOVIX — Universal Memory Types
 *
 * Defines the data structures for the universal cross-project memory system.
 * Think of it like Obsidian — every project's learnings feed into a global
 * knowledge base you can search from any project.
 */

/**
 * A single memory entry in the universal cross-project memory store.
 *
 * Each entry captures a lesson, pattern, decision, fact, or error
 * learned from a specific project. Entries are stored in
 * ~/.kovix/universal-memory.db and are searchable from any project
 * via the {@link IUniversalMemoryService}.
 */
export interface IUniversalMemoryEntry {
        /** Unique identifier (uuid v4) */
        id: string;
        /** The actual memory content (a fact, lesson, pattern) */
        content: string;
        /** Type of memory */
        type: 'lesson' | 'pattern' | 'decision' | 'fact' | 'error';
        /** Which project this came from */
        projectId: string;
        /** Human-readable project name */
        projectName: string;
        /** Auto-extracted tags (tech stack, concepts) */
        tags: string[];
        /** Vector embedding for semantic search (optional — requires Ollama) */
        embedding?: number[];
        /** When this memory was created (unix timestamp ms) */
        createdAt: number;
        /** Relevance score (set at query time, not persisted) */
        relevanceScore?: number;
}

/**
 * Parameters for querying the universal memory store.
 * Supports text search, project/type filtering, and result limiting.
 */
export interface IUniversalMemoryQuery {
        /** Search query text */
        query: string;
        /** Filter to specific project (optional) */
        projectId?: string;
        /** Filter by memory types */
        types?: IUniversalMemoryEntry['type'][];
        /** Maximum results to return (default: 10) */
        limit?: number;
}
