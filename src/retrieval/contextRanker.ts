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
   *
   * Scoring hierarchy:
   * 1. Exact symbol matches (from SymbolRetriever) - base score 1.0
   * 2. Structural graph relationship - base 0.6-0.8
   * 3. Strong semantic/name match + multiple raw concepts
   * 4. Single normalized concept match - weak score 0.4
   * 5. Properties and parent classes are penalized for behavioral intents
   */
  rank(contexts: RetrievedContext[], query: RetrievalQuery): RetrievedContext[] {
    const bestScores = new Map<string, RetrievedContext>();

    // Use raw keywords (not expanded concepts) for specificity bonuses
    const rawKeywordsLower = (query.keywords || []).map(k => k.toLowerCase());

    // Resolved target IDs from SymbolResolver (pre-computed by HybridRetriever)
    const resolvedTargetIds = query.resolvedTargetIds ?? new Set<string>();

    for (const ctx of contexts) {
      let boostedScore = ctx.relevanceScore;

      // ── Identity bonus: explicitly resolved targets always win ─────────
      // Priority: exact target > structural evidence (throws) > lexical match.
      // This ensures db.query beats verifyPayment even when verifyPayment has `throws`.
      const ctxGraphId = ctx.type === 'symbol' && ctx.symbolInfo
        ? `symbol:${ctx.symbolInfo.id}`
        : `file:${ctx.filePath}`;
      if (resolvedTargetIds.has(ctxGraphId)) {
        boostedScore = Math.min(1.0, boostedScore + 0.5);
        // Short-circuit further scoring for resolved targets — identity wins
        const existing = bestScores.get(ctx.id);
        if (!existing || boostedScore > existing.relevanceScore) {
          bestScores.set(ctx.id, { ...ctx, relevanceScore: boostedScore });
        }
        continue;
      }

      if (ctx.type === 'symbol' && ctx.symbolInfo) {
        const sym = ctx.symbolInfo;
        const kind = sym.kind;
        const nameLower = sym.name.toLowerCase();
        const parentLower = (sym.parentSymbol || '').toLowerCase();
        const fullNameLower = parentLower ? `${parentLower}.${nameLower}` : nameLower;

        // ── Behavioral intent: penalize structural holders ─────────────────
        const isBehavioralIntent = !['DEPENDENCIES', 'DEPENDENTS'].includes(query.intent);

        // Properties are structural holders — penalize for behavioral queries
        if (kind === 'property' && isBehavioralIntent) {
          boostedScore -= 0.3;
        }

        // For CALLERS: penalize class-kind unless it is the query's target
        if (query.intent === 'CALLERS' && kind === 'class') {
          const isTarget = query.targetSymbols.some(t =>
            t.toLowerCase() === nameLower || t.toLowerCase() === fullNameLower
          );
          if (!isTarget) {
            boostedScore -= 0.2;
          }
        }

        // ── ERROR_VALIDATION: boost structural throws evidence ─────────────
        if (query.intent === 'ERROR_VALIDATION') {
          if (sym.throws && sym.throws.length > 0) {
            boostedScore += 0.3;
          }
          // Classes don't throw; methods do — penalize classes
          if (kind === 'class') {
            boostedScore -= 0.15;
          }
        }


        // ── Direct name-match specificity bonus ────────────────────────────
        // Rewards the symbol that IS the named thing (e.g. db.query for "database query")
        let nameMatchApplied = false;
        for (const kw of rawKeywordsLower) {
          if (kw.length > 2 && (nameLower.includes(kw) || fullNameLower.includes(kw))) {
            boostedScore += 0.15;
            nameMatchApplied = true;
            break;
          }
        }
        // Secondary: check if the file basename also matches a raw keyword (e.g. 'db' in 'db.ts')
        if (!nameMatchApplied && ctx.filePath) {
          const fileBase = ctx.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.\w+$/, '').toLowerCase() || '';
          for (const kw of rawKeywordsLower) {
            if (kw.length > 2 && fileBase.includes(kw)) {
              boostedScore += 0.1;
              break;
            }
          }
        }

        // ── ERROR_VALIDATION: summary-level failure signal ─────────────────
        // Rewards symbols whose JSDoc mentions failure/error even without a throw
        if (query.intent === 'ERROR_VALIDATION' && sym.summary) {
          const summaryLower = sym.summary.toLowerCase();
          if (/fail|error|null|exception|drop|unavailable/.test(summaryLower)) {
            boostedScore += 0.2;
          }
        }

        // ── Multi-concept match using RAW keywords ─────────────────────────
        // Prevents expanded synonyms from inflating scores of unrelated symbols
        const fullContext = [
          sym.parentSymbol,
          sym.name,
          sym.summary,
          ...(sym.calls || []),
          ...(sym.throws || [])
        ].filter(Boolean).join(' ').toLowerCase();

        const matchedRawConcepts = rawKeywordsLower.filter(k => k.length > 2 && fullContext.includes(k));
        if (matchedRawConcepts.length >= 2) {
          boostedScore += matchedRawConcepts.length * 0.1;
        }

        // ── Non-target-seeking intents: boost exact symbol matches ─────────
        const isTargetSeeking = ['CALLERS', 'DEPENDENCIES', 'DEPENDENTS', 'USAGE'].includes(query.intent);
        if (!isTargetSeeking) {
          boostedScore += 0.2;
        }
      }

      // ── File-level scoring ──────────────────────────────────────────────
      if (ctx.type === 'file' && this.projectIndex) {
        const fileMeta = this.projectIndex.getFile(ctx.filePath);
        if (fileMeta) {
          const activeImports = fileMeta.imports.filter(imp => !imp.isUnused).length;
          const depBoost = Math.min(0.15, Math.log10(activeImports + 1) * 0.08);
          boostedScore += depBoost;

          if (fileMeta.summary) {
            const summaryLower = fileMeta.summary.toLowerCase();
            const matchedRaw = rawKeywordsLower.filter(k => k.length > 2 && summaryLower.includes(k));
            if (matchedRaw.length >= 2) {
              boostedScore += matchedRaw.length * 0.08;
            }
          }
        }
      }

      boostedScore = Math.min(1.0, Math.max(0.0, boostedScore));

      const existing = bestScores.get(ctx.id);
      if (!existing || boostedScore > existing.relevanceScore) {
        bestScores.set(ctx.id, { ...ctx, relevanceScore: boostedScore });
      }
    }

    let result = Array.from(bestScores.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    // ── Post-filter: remove source files from directional query results ──────
    // For DEPENDENTS/DEPENDENCIES, the target's own file is never a relevant answer.
    // We identify it by finding file candidates whose path matches a target symbol's file.
    if ((query.intent === 'DEPENDENTS' || query.intent === 'DEPENDENCIES') && this.projectIndex) {
      const targetFilePaths = new Set<string>();
      for (const sym of query.targetSymbols) {
        const parts = sym.includes('.') ? sym.split('.') : [sym];
        const symName = parts[parts.length - 1];
        const matches = this.projectIndex.getSymbol(symName);
        for (const m of matches) {
          targetFilePaths.add(m.filePath);
        }
      }
      if (targetFilePaths.size > 0) {
        result = result.filter(ctx => {
          if (ctx.type !== 'file') return true;
          return !targetFilePaths.has(ctx.filePath);
        });
      }
    }
    return result.slice(0, query.maxResults || 100);
  }
}
