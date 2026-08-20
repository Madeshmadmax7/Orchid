// ============================================================================
// Project Memory — Context Ranker
// ============================================================================
// Sorts and limits retrieved context based on relevance score.
// ============================================================================

import { RetrievedContext } from '../types';

export class ContextRanker {
  /**
   * Ranks and deduplicates contexts.
   */
  rank(contexts: RetrievedContext[], maxResults: number = 15): RetrievedContext[] {
    // Deduplicate by ID, keeping the highest score
    const bestScores = new Map<string, RetrievedContext>();
    
    for (const ctx of contexts) {
      const existing = bestScores.get(ctx.id);
      if (!existing || ctx.relevanceScore > existing.relevanceScore) {
        bestScores.set(ctx.id, ctx);
      }
    }

    // Sort descending by score
    const sorted = Array.from(bestScores.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    // Truncate
    return sorted.slice(0, maxResults);
  }
}
