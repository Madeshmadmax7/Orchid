// ============================================================================
// Project Memory — Context Ranker
// ============================================================================
// Sorts and limits retrieved context based on relevance score.
// ============================================================================

import { RetrievedContext, RetrievalQuery } from '../types';
import { ProjectIndex } from '../knowledge/projectIndex';

export class ContextRanker {
  constructor(private projectIndex?: ProjectIndex) {}

  /**
   * Ranks and deduplicates contexts based on relevance.
   * Priority:
   * 1. Exact symbol matches
   * 2. Concept/Intent relevance
   * 3. Files with many used dependencies
   * 4. Transitive dependencies
   */
  rank(contexts: RetrievedContext[], query: RetrievalQuery): RetrievedContext[] {
    // Deduplicate by ID, keeping the highest score
    const bestScores = new Map<string, RetrievedContext>();
    
    for (const ctx of contexts) {
      let boostedScore = ctx.relevanceScore;

      // Boost exact symbol matches, UNLESS the intent is seeking relatives (CALLERS/DEPENDENCIES/USAGE),
      // in which case we want the relatives to outrank the target itself.
      if (ctx.type === 'symbol') {
        const isTargetSeeking = ['CALLERS', 'DEPENDENCIES', 'USAGE'].includes(query.intent);
        if (!isTargetSeeking) {
          boostedScore += 0.2;
        }

        // Fix 6: Class/Parent Context - searchable representation
        if (ctx.symbolInfo) {
          const fullContext = [
            ctx.symbolInfo.parentSymbol,
            ctx.symbolInfo.name,
            ctx.symbolInfo.summary,
            ...(ctx.symbolInfo.calls || [])
          ].filter(Boolean).join(' ').toLowerCase();

          const matchedConcepts = query.concepts.filter(c => fullContext.includes(c));
          // Reward multi-concept matches heavily (e.g. payment + validation)
          boostedScore += (matchedConcepts.length * 0.25);
        }
      }

      // Boost files heavily utilizing dependencies
      if (ctx.type === 'file' && this.projectIndex) {
        const fileMeta = this.projectIndex.getFile(ctx.filePath);
        if (fileMeta) {
          // Count actively used imports
          const activeImports = fileMeta.imports.filter(imp => !imp.isUnused).length;
          // Apply a logarithmic boost based on dependency count (max 0.2 boost)
          const depBoost = Math.min(0.2, Math.log10(activeImports + 1) * 0.1);
          boostedScore += depBoost;

          // Multi-concept overlap for files
          if (fileMeta.summary) {
            const summaryLower = fileMeta.summary.toLowerCase();
            const matchedConcepts = query.concepts.filter(c => summaryLower.includes(c));
            boostedScore += matchedConcepts.length * 0.1;
          }
        }
      }

      // Cap at 1.0
      boostedScore = Math.min(1.0, boostedScore);

      const existing = bestScores.get(ctx.id);
      if (!existing || boostedScore > existing.relevanceScore) {
        // Clone to avoid mutating original objects unpredictably
        bestScores.set(ctx.id, { ...ctx, relevanceScore: boostedScore });
      }
    }

    // Sort descending by score
    const sorted = Array.from(bestScores.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    // Truncate
    return sorted.slice(0, query.maxResults || 15);
  }
}
