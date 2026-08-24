// ============================================================================
// Project Memory — Symbol Resolver
// ============================================================================
// Provides tiered qualified symbol resolution from raw query tokens.
// Resolution order:
//   1. Exact qualified (parent.name) — e.g. "db.query" → query where parent="db"
//   2. Exact name + kind-filtered — "RefundService" preferring class over property
//   3. Exact name (any kind)
//   4. Normalized case-insensitive name match
// ============================================================================

import { SymbolKind } from '../types';
import { ProjectIndex, SymbolLocation } from '../knowledge/projectIndex';

/** Confidence tier of a resolved target. */
export type ResolutionConfidence =
  | 'exact-qualified'   // parent.name matched exactly
  | 'exact-kind'        // name matched and kind is preferred for the intent
  | 'exact-name'        // name matched exactly, kind not filtered
  | 'normalized';       // case-insensitive name match

export interface ResolvedTarget {
  location: SymbolLocation;
  /** The graph node ID (e.g. "symbol:...") */
  graphNodeId: string;
  confidence: ResolutionConfidence;
}

/**
 * Intent-appropriate preferred symbol kinds.
 * For IMPLEMENTATION/EXPLAIN/GENERAL → prefer class/function/method.
 * For CALLERS → prefer method/function (callers of a method).
 * For structural → prefer class.
 */
const BEHAVIORAL_KINDS: SymbolKind[] = ['class', 'function', 'method', 'react-component'];
const PROPERTY_KINDS: SymbolKind[] = ['property', 'getter', 'setter'];

export class SymbolResolver {
  constructor(private projectIndex: ProjectIndex) {}

  /**
   * Resolves a list of raw symbol strings (from query tokens) into
   * concrete, ranked SymbolLocations using a tiered lookup strategy.
   *
   * Returns one ResolvedTarget per input symbol (best match),
   * or nothing if no match found.
   */
  resolve(rawSymbols: string[], preferBehavioral = true): ResolvedTarget[] {
    const results: ResolvedTarget[] = [];

    for (const raw of rawSymbols) {
      const resolved = this.resolveSingle(raw, preferBehavioral);
      if (resolved) {
        results.push(resolved);
      }
    }

    return results;
  }

  private resolveSingle(raw: string, preferBehavioral: boolean): ResolvedTarget | null {
    // ── Tier 1: Qualified parent.name lookup ──────────────────────────────
    // Handles "db.query", "PaymentService.verifyPayment", "this.service.method"
    if (raw.includes('.')) {
      const parts = raw.split('.');
      // Try from most specific (last two parts) to least
      for (let i = parts.length - 1; i >= 1; i--) {
        const methodName = parts[i];
        const parentName = parts[i - 1];

        const candidates = this.projectIndex.getSymbol(methodName);
        for (const loc of candidates) {
          const sym = loc.symbolInfo;
          // Match parent symbol name OR containing file base name
          const fileBase = loc.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.\w+$/, '') ?? '';
          if (
            sym.parentSymbol?.toLowerCase() === parentName.toLowerCase() ||
            fileBase.toLowerCase() === parentName.toLowerCase()
          ) {
            return {
              location: loc,
              graphNodeId: `symbol:${sym.id}`,
              confidence: 'exact-qualified',
            };
          }
        }
      }
    }

    // ── Tier 2: Exact name with kind preference ───────────────────────────
    // "RefundService" → prefer class over property
    const exactMatches = this.projectIndex.getSymbol(raw);
    if (exactMatches.length > 0) {
      const preferredKinds = preferBehavioral ? BEHAVIORAL_KINDS : PROPERTY_KINDS;

      // First pass: preferred kind
      for (const loc of exactMatches) {
        if (preferredKinds.includes(loc.symbolInfo.kind as SymbolKind)) {
          return {
            location: loc,
            graphNodeId: `symbol:${loc.symbolInfo.id}`,
            confidence: 'exact-kind',
          };
        }
      }

      // Second pass: any kind (exact name match)
      return {
        location: exactMatches[0],
        graphNodeId: `symbol:${exactMatches[0].symbolInfo.id}`,
        confidence: 'exact-name',
      };
    }

    // ── Tier 3: Normalized case-insensitive match ─────────────────────────
    const normalizedRaw = raw.toLowerCase();
    const allMatches = this.projectIndex.searchSymbols(normalizedRaw);

    // Filter to only symbols whose name exactly matches (case-insensitive)
    const nameMatches = allMatches.filter(
      loc => loc.symbolInfo.name.toLowerCase() === normalizedRaw
    );

    if (nameMatches.length > 0) {
      // Prefer behavioral kinds
      if (preferBehavioral) {
        const behavioral = nameMatches.find(loc =>
          BEHAVIORAL_KINDS.includes(loc.symbolInfo.kind as SymbolKind)
        );
        if (behavioral) {
          return {
            location: behavioral,
            graphNodeId: `symbol:${behavioral.symbolInfo.id}`,
            confidence: 'normalized',
          };
        }
      }
      return {
        location: nameMatches[0],
        graphNodeId: `symbol:${nameMatches[0].symbolInfo.id}`,
        confidence: 'normalized',
      };
    }

    return null;
  }
}
