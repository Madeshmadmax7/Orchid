// ============================================================================
// Project Memory — Graph Retriever
// ============================================================================
// Retrieves related context by traversing the dependency graph.
// ============================================================================

import { DependencyGraph } from '../graph/dependencyGraph';
import { ProjectIndex } from '../knowledge/projectIndex';
import { RetrievalQuery, RetrievedContext } from '../types';
import { generateFileSummary, generateSymbolSummary } from '../analyzer/componentSummarizer';
import { SymbolResolver } from './symbolResolver';

export class GraphRetriever {
  private symbolResolver: SymbolResolver;

  constructor(
    private graph: DependencyGraph,
    private projectIndex: ProjectIndex
  ) {
    this.symbolResolver = new SymbolResolver(projectIndex);
  }

  /**
   * Retrieves contexts via graph expansion.
   * For TRACE intent: finds the shortest path between source and target nodes.
   * For other intents: BFS expansion from seed symbols.
   */
  retrieve(query: RetrievalQuery): RetrievedContext[] {
    // ── TRACE: structural path retrieval ────────────────────────────────
    if (query.intent === 'TRACE') {
      return this.retrievePath(query);
    }

    const contexts: RetrievedContext[] = [];
    const seen = new Set<string>();

    // Map of seed node ID -> max depth to traverse
    const seedsWithDepth = new Map<string, number>();

    // 1. Explicitly targeted files (1 hop)
    for (const targetFile of query.targetFiles) {
      const allFiles = this.projectIndex.getAllFilePaths();
      for (const path of allFiles) {
        if (path.toLowerCase().endsWith(targetFile.toLowerCase())) {
          seedsWithDepth.set(`file:${path}`, 1);
        }
      }
    }

    // 2. Explicitly targeted symbols (2 hops)
    for (const targetSymbol of query.targetSymbols) {
      // Handle Class.method (e.g., PaymentService.verifyPayment)
      let searchName = targetSymbol;
      let parentFilter: string | undefined;
      
      if (targetSymbol.includes('.')) {
        const parts = targetSymbol.split('.');
        searchName = parts[parts.length - 1]; // last part is method name
        parentFilter = parts[parts.length - 2]; // second to last is parent
      }

      const matches = this.projectIndex.getSymbol(searchName);
      
      for (const match of matches) {
        // If we extracted a parent from Class.method, ensure the file or symbol context matches it
        if (parentFilter) {
          const fileMeta = this.projectIndex.getFile(match.filePath);
          const parentLower = parentFilter.toLowerCase();
          const hasParentContext = match.filePath.toLowerCase().includes(parentLower) || 
                                   (fileMeta && fileMeta.symbols.some(s => s.name.toLowerCase().includes(parentLower)));
          if (!hasParentContext) continue;
        }

        const symbolId = `symbol:${match.symbolInfo.id}`;
        seedsWithDepth.set(symbolId, 2);
        // For DEPENDENTS: traverse purely from the symbol — seeding the file would
        // also traverse its own dependencies, polluting the candidate pool with source files.
        // For other intents (including DEPENDENCIES): also seed the file for broader traversal.
        const skipFileSeed = (query.intent === 'DEPENDENTS');
        if (!skipFileSeed && !seedsWithDepth.has(`file:${match.filePath}`)) {
          seedsWithDepth.set(`file:${match.filePath}`, 1);
        }
      }
    }

    // 3. Keyword matches: moderately relevant symbols (1 hop)
    for (const keyword of query.keywords) {
      const matches = this.projectIndex.searchSymbols(keyword);
      for (const match of matches) {
        const symbolId = `symbol:${match.symbolInfo.id}`;
        if (!seedsWithDepth.has(symbolId)) {
          seedsWithDepth.set(symbolId, 1);
        }
      }
    }

    // Traverse from seeds
    for (const [seed, depth] of seedsWithDepth.entries()) {
      if (!this.graph.hasNode(seed)) {
        continue;
      }

      // Add the seed itself, unless we only care about its neighbors
      const skipSeedFile = (query.intent === 'DEPENDENTS' || query.intent === 'DEPENDENCIES');
      if (seed.startsWith('file:')) {
        if (!skipSeedFile) {
          this.addFileContext(seed.replace('file:', ''), 1.0, contexts, seen);
        }
      } else if (seed.startsWith('symbol:')) {
        // For DEPENDENTS/DEPENDENCIES, add the seed symbol itself at lower weight for context
        // but NOT its file (the file is the source, not a neighbor)
        this.addSymbolContext(seed.replace('symbol:', ''), skipSeedFile ? 0.5 : 1.0, contexts, seen);
      }

      // For most intents, we only traverse semantic/keyword matches (depth > 0).
      // Depth-0 seeds have already been added as seed context above; skip edge traversal.
      if (depth === 0) {
        continue;
      }

      // Intent-aware traversal
      if (query.intent === 'DEPENDENCIES' || query.intent === 'EXPLAIN' || query.intent === 'GENERAL' || query.intent === 'ERROR_VALIDATION') {
        const deps = this.graph.getTransitiveDependencies(seed, depth);
        for (const dep of deps) {
          const score = 0.8 - (0.1 * depth); // decay score
          if (dep.startsWith('file:')) {
            this.addFileContext(dep.replace('file:', ''), score, contexts, seen);
          } else if (dep.startsWith('symbol:')) {
            this.addSymbolContext(dep.replace('symbol:', ''), score, contexts, seen);
          }
        }
      }

      if (query.intent === 'DEPENDENTS' || query.intent === 'CALLERS' || query.intent === 'USAGE' || query.intent === 'EXPLAIN' || query.intent === 'GENERAL' || query.intent === 'ERROR_VALIDATION') {
        const dependents = this.graph.getTransitiveDependents(seed, depth);
        for (const dep of dependents) {
          const score = 0.6 - (0.1 * depth); // decay score
          if (dep.startsWith('file:')) {
            this.addFileContext(dep.replace('file:', ''), score, contexts, seen);
          } else if (dep.startsWith('symbol:')) {
            this.addSymbolContext(dep.replace('symbol:', ''), score, contexts, seen);
          }
        }
      }
    }

    return contexts;

  }

  /**
   * TRACE path retrieval: finds the shortest structural path between source and target.
   * Returns path nodes in order (source → ... → target) with decaying relevance scores.
   * Falls back to BFS expansion from source if no direct path found.
   */
  private retrievePath(query: RetrievalQuery): RetrievedContext[] {
    const contexts: RetrievedContext[] = [];
    const seen = new Set<string>();

    const sourceSymbols = query.sourceSymbols ?? [];
    const targetSymbols = query.targetSymbols ?? [];

    // Resolve source and target nodes
    const resolvedSources = this.symbolResolver.resolve(sourceSymbols, true);
    const resolvedTargets = this.symbolResolver.resolve(targetSymbols, true);

    // If we have both endpoints, try graph path finding
    if (resolvedSources.length > 0 && resolvedTargets.length > 0) {
      const sourceId = resolvedSources[0].graphNodeId;
      const targetId = resolvedTargets[0].graphNodeId;

      // Try exact symbol-to-symbol path
      let path = this.graph.findPath(sourceId, targetId, 4);

      // If not found, try via file nodes (file:source → file:target)
      if (!path) {
        const srcFilePath = resolvedSources[0].location.filePath;
        const tgtFilePath = resolvedTargets[0].location.filePath;
        path = this.graph.findPath(`file:${srcFilePath}`, `file:${tgtFilePath}`, 4);
      }

      if (path) {
        // Return all nodes on the path with scores decaying from 1.0
        const stepScore = 1.0 / path.length;
        for (let i = 0; i < path.length; i++) {
          const nodeId = path[i];
          const score = 1.0 - (i * stepScore * 0.5); // gentle decay
          if (nodeId.startsWith('symbol:')) {
            this.addSymbolContext(nodeId.replace('symbol:', ''), score, contexts, seen);
          } else if (nodeId.startsWith('file:')) {
            this.addFileContext(nodeId.replace('file:', ''), score, contexts, seen);
          }
        }
        return contexts;
      }
    }

    // Fallback: standard expansion from source symbols
    const fallbackQuery = { ...query, intent: 'GENERAL' as const };
    const sources = resolvedSources.length > 0
      ? resolvedSources
      : this.symbolResolver.resolve(query.targetSymbols, true);

    for (const resolved of sources) {
      this.addSymbolContext(resolved.location.symbolInfo.id, 0.8, contexts, seen);
      const deps = this.graph.getTransitiveDependencies(resolved.graphNodeId, 2);
      for (const dep of deps) {
        if (dep.startsWith('symbol:')) {
          this.addSymbolContext(dep.replace('symbol:', ''), 0.6, contexts, seen);
        } else if (dep.startsWith('file:')) {
          this.addFileContext(dep.replace('file:', ''), 0.5, contexts, seen);
        }
      }
    }

    return contexts;
  }

  private addSymbolContext(symbolId: string, score: number, contexts: RetrievedContext[], seen: Set<string>): void {
    const match = this.projectIndex.getSymbolById(symbolId);
    if (!match) return;
    
    const id = `symbol:${match.symbolInfo.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    
    const fileMeta = this.projectIndex.getFile(match.filePath);
    contexts.push({
      id,
      type: 'symbol',
      content: fileMeta ? generateSymbolSummary(match.symbolInfo, fileMeta.symbols) : match.symbolInfo.name, // Will be overridden by hybrid retriever if more detailed
      relevanceScore: score,
      filePath: match.filePath,
      metadata: { kind: match.symbolInfo.kind },
      symbolInfo: match.symbolInfo,
      fileMeta: fileMeta
    });
  }

  private addFileContext(filePath: string, score: number, contexts: RetrievedContext[], seen: Set<string>): void {
    if (seen.has(filePath)) return;
    
    const fileMeta = this.projectIndex.getFile(filePath);
    if (!fileMeta) return;

    seen.add(filePath);
    contexts.push({
      id: `file:${filePath}`,
      type: 'file',
      content: generateFileSummary(fileMeta),
      relevanceScore: score,
      filePath,
      metadata: { fileType: fileMeta.fileType },
      fileMeta: fileMeta
    });
  }
}
