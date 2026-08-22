import { RetrievalQuery, RetrievedContext } from '../types';
import { SymbolRetriever } from './symbolRetriever';
import { GraphRetriever } from './graphRetriever';
import { SemanticRetriever } from './semanticRetriever';

export class HybridRetriever {
  constructor(
    private symbolRetriever: SymbolRetriever,
    private graphRetriever: GraphRetriever,
    private semanticRetriever: SemanticRetriever = new SemanticRetriever()
  ) {}

  /**
   * Unifies retrieval pipelines into a single robust candidate set.
   * Combines lexical matching, semantic matching, and graph neighborhood,
   * deduplicating contexts based on their stable IDs.
   */
  retrieve(query: RetrievalQuery): RetrievedContext[] {
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

    // Return flattened array sorted by relevance score
    return Array.from(merged.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
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
