/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Dependency Graph Builder
 *  Builds import/export graphs, detects cycles, finds orphans, impact analysis.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import {
        IFileStructure,
        IDependencyEdge,
        IDependencyGraph
} from '../../../../platform/construct/common/indexing/indexingTypes.js';

// ─── Graph Node ────────────────────────────────────────────────────────────

interface IGraphNode {
        file: string;
        imports: string[];
        exports: string[];
        inDegree: number;
        outDegree: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

export class DependencyGraphBuilder {
        private readonly graphs = new Map<string, IDependencyGraph>();
        private readonly fileStructures = new Map<string, Map<string, IFileStructure>>();

        constructor(
                @ILogService private readonly logService: ILogService
        ) { }

        /**
         * Build or update the dependency graph for a project.
         */
        buildGraph(projectId: string, structures: IFileStructure[]): IDependencyGraph {
                // Store structures for this project
                const structureMap = new Map<string, IFileStructure>();
                for (const s of structures) {
                        structureMap.set(s.file, s);
                }
                this.fileStructures.set(projectId, structureMap);

                const nodes: string[] = [];
                const edges: IDependencyEdge[] = [];
                const graphNodes = new Map<string, IGraphNode>();

                // Create nodes
                for (const structure of structures) {
                        const node: IGraphNode = {
                                file: structure.file,
                                imports: structure.imports,
                                exports: structure.exports,
                                inDegree: 0,
                                outDegree: 0
                        };
                        graphNodes.set(structure.file, node);
                        nodes.push(structure.file);
                }

                // Create edges from imports
                for (const structure of structures) {
                        for (const importPath of structure.imports) {
                                const resolvedPath = this.resolveImport(importPath, structure.file, structureMap);
                                if (resolvedPath && graphNodes.has(resolvedPath)) {
                                        const edge: IDependencyEdge = {
                                                from: structure.file,
                                                to: resolvedPath,
                                                importNames: this.getImportedNames(importPath, structure)
                                        };
                                        edges.push(edge);

                                        // Update degrees
                                        const fromNode = graphNodes.get(structure.file)!;
                                        const toNode = graphNodes.get(resolvedPath)!;
                                        fromNode.outDegree++;
                                        toNode.inDegree++;
                                }
                        }
                }

                // Detect cycles
                const cycles = this.detectCycles(nodes, edges);

                const graph: IDependencyGraph = { nodes, edges, cycles };
                this.graphs.set(projectId, graph);

                this.logService.info(`[DepGraph] Built graph for ${projectId}: ${nodes.length} nodes, ${edges.length} edges, ${cycles.length} cycles`);
                return graph;
        }

        /**
         * Get the cached dependency graph for a project.
         */
        getGraph(projectId: string): IDependencyGraph | undefined {
                return this.graphs.get(projectId);
        }

        /**
         * Find unused exports (exports that are never imported by any file).
         */
        findUnusedExports(projectId: string): Array<{ file: string; exportName: string }> {
                const structureMap = this.fileStructures.get(projectId);
                const graph = this.graphs.get(projectId);
                if (!structureMap || !graph) { return []; }

                // Build a set of all imported names
                const importedNames = new Set<string>();
                for (const edge of graph.edges) {
                        for (const name of edge.importNames) {
                                importedNames.add(name);
                        }
                }

                // Find exports not in imported names
                const unused: Array<{ file: string; exportName: string }> = [];
                for (const [file, structure] of structureMap) {
                        for (const exportName of structure.exports) {
                                if (!importedNames.has(exportName)) {
                                        unused.push({ file, exportName });
                                }
                        }
                }

                this.logService.info(`[DepGraph] Found ${unused.length} unused exports in ${projectId}`);
                return unused;
        }

        /**
         * Find orphaned files (files with no imports and no exports used by others).
         */
        findOrphanedFiles(projectId: string): string[] {
                const graph = this.graphs.get(projectId);
                if (!graph) { return []; }

                const orphans: string[] = [];
                const nodeMap = new Map<string, { inDegree: number; outDegree: number }>();

                for (const node of graph.nodes) {
                        nodeMap.set(node, { inDegree: 0, outDegree: 0 });
                }

                for (const edge of graph.edges) {
                        const from = nodeMap.get(edge.from);
                        const to = nodeMap.get(edge.to);
                        if (from) { from.outDegree++; }
                        if (to) { to.inDegree++; }
                }

                for (const [file, degrees] of nodeMap) {
                        // An orphan has no incoming edges and no outgoing edges
                        if (degrees.inDegree === 0 && degrees.outDegree === 0) {
                                orphans.push(file);
                        }
                }

                this.logService.info(`[DepGraph] Found ${orphans.length} orphaned files in ${projectId}`);
                return orphans;
        }

        /**
         * Impact analysis: find all files affected by a change to the given file.
         */
        getImpactAnalysis(projectId: string, filePath: string): string[] {
                const graph = this.graphs.get(projectId);
                if (!graph) { return []; }

                // BFS from the changed file, following reverse edges (who depends on me)
                const affected = new Set<string>();
                const queue = [filePath];

                while (queue.length > 0) {
                        const current = queue.shift()!;
                        if (affected.has(current)) { continue; }
                        affected.add(current);

                        // Find all files that import the current file
                        for (const edge of graph.edges) {
                                if (edge.to === current && !affected.has(edge.from)) {
                                        queue.push(edge.from);
                                }
                        }
                }

                // Remove the starting file from the affected set
                affected.delete(filePath);

                const result = Array.from(affected);
                this.logService.info(`[DepGraph] Impact analysis for ${filePath}: ${result.length} files affected`);
                return result;
        }

        /**
         * Get visualization data for the dependency graph (nodes/edges for D3/Cytoscape).
         */
        getVisualizationData(projectId: string): {
                nodes: Array<{ id: string; label: string; group: string }>;
                edges: Array<{ source: string; target: string; label?: string }>;
        } {
                const graph = this.graphs.get(projectId);
                if (!graph) { return { nodes: [], edges: [] }; }

                const vizNodes = graph.nodes.map((file: string) => ({
                        id: file,
                        label: file.split('/').pop() ?? file,
                        group: file.split('.').pop() ?? 'unknown'
                }));

                const vizEdges = graph.edges.map((edge: { from: string; to: string; importNames: string[] }) => ({
                        source: edge.from,
                        target: edge.to,
                        label: edge.importNames.length > 0 ? edge.importNames.join(', ') : undefined
                }));

                return { nodes: vizNodes, edges: vizEdges };
        }

        // =======================================================================
        // Private Helpers
        // =======================================================================

        /**
         * Resolve an import path to a file path.
         * Handles relative imports (./foo), absolute imports, and bare specifiers.
         */
        private resolveImport(importPath: string, fromFile: string, structureMap: Map<string, IFileStructure>): string | undefined {
                // Skip node_modules and non-relative imports for now
                if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
                        // Try to match against known files (bare specifier like 'lodash' → skip)
                        return undefined;
                }

                // Resolve relative imports
                const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
                let resolved: string;

                if (importPath.startsWith('./') || importPath.startsWith('../')) {
                        // Normalize path
                        const parts = dir.split('/');
                        const importParts = importPath.split('/');

                        for (const part of importParts) {
                                if (part === '..') {
                                        parts.pop();
                                } else if (part !== '.') {
                                        parts.push(part);
                                }
                        }
                        resolved = parts.join('/');
                } else {
                        resolved = importPath;
                }

                // Try with common extensions
                const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
                for (const ext of extensions) {
                        const candidate = resolved + ext;
                        if (structureMap.has(candidate)) {
                                return candidate;
                        }
                }

                return undefined;
        }

        /**
         * Extract imported names from an import statement.
         */
        private getImportedNames(importPath: string, structure: IFileStructure): string[] {
                // Simplified — in production, parse the actual import statement
                // For now, return exports from the target file if it matches
                return [];
        }

        /**
         * Detect cycles in the dependency graph using DFS.
         */
        private detectCycles(nodes: string[], edges: IDependencyEdge[]): string[][] {
                const adjacency = new Map<string, string[]>();
                for (const node of nodes) {
                        adjacency.set(node, []);
                }
                for (const edge of edges) {
                        adjacency.get(edge.from)?.push(edge.to);
                }

                const cycles: string[][] = [];
                const visited = new Set<string>();
                const recursionStack = new Set<string>();
                const path: string[] = [];

                const dfs = (node: string): void => {
                        visited.add(node);
                        recursionStack.add(node);
                        path.push(node);

                        const neighbors = adjacency.get(node) ?? [];
                        for (const neighbor of neighbors) {
                                if (!visited.has(neighbor)) {
                                        dfs(neighbor);
                                } else if (recursionStack.has(neighbor)) {
                                        // Found a cycle
                                        const cycleStart = path.indexOf(neighbor);
                                        if (cycleStart !== -1) {
                                                const cycle = path.slice(cycleStart);
                                                cycles.push([...cycle, neighbor]); // Close the cycle
                                        }
                                }
                        }

                        path.pop();
                        recursionStack.delete(node);
                };

                for (const node of nodes) {
                        if (!visited.has(node)) {
                                dfs(node);
                        }
                }

                return cycles;
        }
}
