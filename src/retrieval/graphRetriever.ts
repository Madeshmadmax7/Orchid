// ============================================================================
// Project Memory — Graph Retriever
// ============================================================================
// Retrieves related context by traversing the dependency graph.
// ============================================================================

import { DependencyGraph } from '../graph/dependencyGraph';
import { ProjectIndex } from '../knowledge/projectIndex';
import { RetrievalQuery, RetrievedContext } from '../types';
import { generateFileSummary } from '../analyzer/componentSummarizer';

export class GraphRetriever {
  constructor(
    private graph: DependencyGraph,
    private projectIndex: ProjectIndex
  ) {}

  /**
   * Retrieves contexts via graph expansion.
   * Limits expansion: 2 hops for highly relevant symbols, 1 hop for moderately relevant.
   */
  retrieve(query: RetrievalQuery): RetrievedContext[] {
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
        // Also seed the file with 1 hop
        if (!seedsWithDepth.has(`file:${match.filePath}`)) {
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
    // DEBUG
    console.log("DEBUG: All Graph Nodes:", this.graph.getAllNodes().map(n => n.id));
    console.log("DEBUG: GraphRetriever built seeds:", Array.from(seedsWithDepth.entries()));
    
    for (const [seed, depth] of seedsWithDepth.entries()) {
      if (!this.graph.hasNode(seed)) {
        console.log("DEBUG: Graph is missing seed node:", seed);
        continue;
      }

      // Add the seed itself
      if (seed.startsWith('file:')) {
        this.addFileContext(seed.replace('file:', ''), 1.0, contexts, seen);
      } else if (seed.startsWith('symbol:')) {
        this.addSymbolContext(seed.replace('symbol:', ''), 1.0, contexts, seen);
      }

      if (depth === 0) continue;

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
      content: fileMeta ? generateFileSummary(fileMeta) : match.symbolInfo.name, // Will be overridden by hybrid retriever if more detailed
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
