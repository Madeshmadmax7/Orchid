import { RetrievalQuery, RetrievedContext } from '../types';
import { SymbolRetriever } from './symbolRetriever';
import { GraphRetriever } from './graphRetriever';
import { SemanticRetriever } from './semanticRetriever';
import { SymbolResolver } from './symbolResolver';
import { ProjectIndex } from '../knowledge/projectIndex';
import { generateFileSummary } from '../analyzer/componentSummarizer';

export class HybridRetriever {
  private symbolResolver: SymbolResolver;
  private projectIndex: ProjectIndex;

  constructor(
    private symbolRetriever: SymbolRetriever,
    private graphRetriever: GraphRetriever,
    private semanticRetriever: SemanticRetriever = new SemanticRetriever(),
    projectIndex?: ProjectIndex
  ) {
    this.projectIndex = projectIndex || (symbolRetriever as any).projectIndex;
    // SymbolResolver is used to pre-resolve targets so ContextRanker can apply identity bonus
    this.symbolResolver = new SymbolResolver(this.projectIndex);
  }

  /**
   * Unifies retrieval pipelines into a single robust candidate set.
   * Pre-resolves targetSymbols using SymbolResolver and attaches resolved IDs to
   * the query for ContextRanker's identity bonus.
   */
  retrieve(query: RetrievalQuery): RetrievedContext[] {
    // ── Pre-resolve targets and attach IDs to query ──────────────────────
    query.resolvedTargetIds = new Set<string>();

    if (query.targetSymbols.length > 0) {
      const resolved = this.symbolResolver.resolve(query.targetSymbols, true);
      for (const r of resolved) query.resolvedTargetIds.add(r.graphNodeId);
    }
    
    // Also try to resolve keywords as exact names (fixes "database query" -> "db.query")
    if (query.keywords.length > 0) {
      const resolvedKw = this.symbolResolver.resolve(query.keywords, true);
      for (const r of resolvedKw) {
        // Only promote keywords to explicit targets if they match exactly (not just normalized substring)
        if (r.confidence === 'exact-qualified' || r.confidence === 'exact-name' || r.confidence === 'exact-kind') {
          query.resolvedTargetIds.add(r.graphNodeId);
        }
      }
    }

    const symbolContexts = this.symbolRetriever.retrieve(query);
    const graphContexts = this.graphRetriever.retrieve(query);
    const semanticContexts = this.semanticRetriever.retrieve(query);

    const merged = new Map<string, RetrievedContext>();

    // Merge symbol contexts (lexical & semantic)
    for (const ctx of symbolContexts) {
      this.mergeContext(merged, ctx);
    }

    // Merge graph contexts (dependencies)
    for (const ctx of graphContexts) {
      this.mergeContext(merged, ctx);
    }

    // Merge embeddings/semantic contexts
    for (const ctx of semanticContexts) {
      this.mergeContext(merged, ctx);
    }

    // Flatten array sorted by relevance score
    let results = Array.from(merged.values());

    // ── Broad Project Overview Fallback ──
    // Activates when retrieval produces zero candidates and one of:
    //   (a) The query has NO explicit targets (genuinely broad/project-level queries)
    //   (b) The query intent is MODIFICATION — even if QueryRouter extracted capitalised
    //       words like "Add"/"Jarvis" as targets, those are not real code symbols.
    //       A MODIFICATION request with no resolved symbols still needs architectural
    //       context (entry points, routing, module structure) to guide the LLM.
    //
    // NOT triggered for EXPLAIN/GENERAL queries with unresolved targets, e.g.:
    //   "explain nonexistentFunction"  → hasExplicitTarget=true, intent=GENERAL → blocked ✓
    const hasExplicitTarget = query.targetSymbols.length > 0 || query.targetFiles.length > 0;
    const allowFallback = !hasExplicitTarget || query.intent === 'MODIFICATION';
    if (results.length === 0 && allowFallback && this.projectIndex) {
      const allFiles = this.projectIndex.getAllFiles();
      let fallbackFiles = allFiles.filter(f => f.fileType === 'main');
      
      // If no entry points found, just pick up to 3 files to give some baseline context
      if (fallbackFiles.length === 0) {
        fallbackFiles = allFiles.slice(0, 3);
      }

      for (const file of fallbackFiles) {
        results.push({
          id: `file:${file.filePath}`,
          type: 'file',
          content: generateFileSummary(file),
          relevanceScore: 0.6,
          filePath: file.filePath,
          metadata: { fileType: file.fileType },
          fileMeta: file
        });
      }
    }

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private mergeContext(mergedMap: Map<string, RetrievedContext>, newCtx: RetrievedContext): void {
    const existing = mergedMap.get(newCtx.id);
    
    if (existing) {
      // If the context already exists (e.g. found by both symbol search and graph search)
      // Boost relevance score since it was discovered via multiple retrieval vectors
      existing.relevanceScore = Math.min(1.0, existing.relevanceScore + (newCtx.relevanceScore * 0.5));
      
      // Keep the most detailed content string
      if (newCtx.content.length > existing.content.length) {
        existing.content = newCtx.content;
      }
      
      // Merge metadata
      existing.metadata = { ...existing.metadata, ...newCtx.metadata };
    } else {
      mergedMap.set(newCtx.id, newCtx);
    }
  }
}
