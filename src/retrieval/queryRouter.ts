import { RetrievalQuery, QueryIntent } from '../types';
import { ConceptExpander } from './conceptExpander';
import { ProjectIndex } from '../knowledge/projectIndex';

/**
 * Parses a raw natural language query into a structured RetrievalQuery.
 */
export class QueryRouter {
  constructor(private projectIndex?: ProjectIndex) {}

  /**
   * Parses a natural language query into a structured RetrievalQuery.
   * Extracts genuine code identifiers as targetSymbols, ordinary words as keywords.
   *
   * A token is classified as an identifier (targetSymbol) if it meets at least one of:
   *   1. It has internal capitalisation (camelCase / PascalCase with ≥2 capital runs),
   *      e.g. VoiceRequest, nonexistentFunction, HTTPClient.
   *   2. It exactly matches a known symbol in the project index,
   *      e.g. a project that happens to export a class called just "Voice" or "App".
   *
   * Pure single-capitalisation words like "Add", "Disable", "Explain", "Jarvis" fail
   * both tests and are demoted to keywords so concept matching can use them.
   */
  parseQuery(rawQuery: string): RetrievalQuery {
    const tokens = rawQuery.split(/\s+/);
    
    const keywords: string[] = [];
    const targetSymbols: string[] = [];
    const targetFiles: string[] = [];
    let sourceSymbols: string[] | undefined;

    const fileRegex = /[\w-]+\.(ts|js|tsx|jsx|json|md|py)/i;
    const symbolRegex = /^[A-Z][a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$|^[a-z]+[A-Z][a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/; // PascalCase or camelCase, optionally with .property

    for (const token of tokens) {
      const cleanToken = token.replace(/[^a-zA-Z0-9.\-_/]/g, ''); // strip punctuation at edges
      
      if (!cleanToken) { continue; }

      if (fileRegex.test(cleanToken) || cleanToken.includes('/')) {
        targetFiles.push(cleanToken);
      } else if (symbolRegex.test(cleanToken)) {
        // ── Distinguish code identifiers from ordinary English words ─────────
        // Signal 1 — internal capitalisation: the token contains at least one
        // uppercase letter that is not the very first character, e.g.:
        //   VoiceRequest → true (capital R after lowercase letters)
        //   nonexistentFunction → true (capital F)
        //   HTTPClient → true (multiple internals)
        //   Add / Disable / Voice / Jarvis → false (single initial capital only)
        const hasInternalCaps = /[A-Z]/.test(cleanToken.slice(1));

        // Signal 2 — exact project symbol: some projects export single-word
        // PascalCase names like "App", "Router", or "User".  If the index knows
        // this token as an actual symbol, honour the user's intent.
        const existsInProject = !!(this.projectIndex && this.projectIndex.getSymbol(cleanToken).length > 0);

        if (hasInternalCaps || existsInProject) {
          targetSymbols.push(cleanToken); // genuine identifier
        } else {
          // Ordinary capitalised English word — treat as a normal query term
          if (cleanToken.length > 3) {
            keywords.push(cleanToken.toLowerCase());
          }
        }
      } else if (cleanToken.length > 3) {
        keywords.push(cleanToken.toLowerCase());
      }
    }

    const { intent, sourceSymbols: traceSrc, targetSymbols: traceTgt } =
      this.detectIntentWithTrace(rawQuery, targetSymbols);

    // For TRACE, replace/augment targetSymbols with trace-specific ones
    if (intent === 'TRACE' && traceSrc && traceTgt) {
      sourceSymbols = traceSrc;
      // The "target endpoint" of the path becomes the primary targetSymbol
      targetSymbols.push(...traceTgt.filter(t => !targetSymbols.includes(t)));
    }

    const concepts = ConceptExpander.expand(keywords);

    return {
      rawQuery,
      keywords,
      targetSymbols,
      sourceSymbols,
      targetFiles,
      intent,
      concepts,
      maxResults: 100,
    };
  }

  private detectIntentWithTrace(query: string, extractedSymbols: string[]): {
    intent: QueryIntent;
    sourceSymbols?: string[];
    targetSymbols?: string[];
  } {
    const lower = query.toLowerCase();

    if (/(who|where).*calls|called by|where is.*called/.test(lower)) {
      return { intent: 'CALLERS' };
    }
    if (/(what|which|who).*does.*depend on|dependencies of/.test(lower)) {
      return { intent: 'DEPENDENCIES' };
    }
    if (/(what|which|who).*(depend|depends) on|who uses/.test(lower)) {
      return { intent: 'DEPENDENTS' };
    }
    if (/where is.*used|usage of/.test(lower)) {
      return { intent: 'USAGE' };
    }
    // TRACE: "how does X reach/call/connect to/get to Y"
    // Must be checked BEFORE EXPLAIN to take priority
    const traceMatch = lower.match(
      /how does.*?(reach|call|get to|connect to|go through|flow to|lead to)\s+(?:the\s+)?(.+?)(?:\?|$)/i
    );
    if (traceMatch) {
      // Extract PascalCase source from the query (what comes after "how does")
      const afterHowDoes = query.match(/how does\s+([A-Z][a-zA-Z0-9.]+)/i);
      const src = afterHowDoes ? [afterHowDoes[1]] : extractedSymbols.slice(0, 1);
      // Extract the destination concept from after the verb
      const destPhrase = traceMatch[2].trim();
      const destSymbol = destPhrase.match(/([A-Z][a-zA-Z0-9.]+|[a-z]+\.[a-zA-Z]+)/)?.[1];
      const tgt = destSymbol ? [destSymbol] : extractedSymbols.slice(1);
      return { intent: 'TRACE', sourceSymbols: src, targetSymbols: tgt };
    }
    if (/how does.*work|explain.*behavior|what is.*doing/.test(lower)) {
      return { intent: 'EXPLAIN' };
    }
    if (/(what happens when|why could|what if).*fail|throws|missing|error|validation|catch|exception/.test(lower)) {
      return { intent: 'ERROR_VALIDATION' };
    }
    // Structural intent for MODIFICATION: starts with an imperative verb or asks how to modify
    if (/^(add|fix|update|implement|change|refactor|remove|reject|support)\b/i.test(query.trim()) || 
        /how (would|do) i (modify|change|update)/.test(lower)) {
      return { intent: 'MODIFICATION' };
    }

    return { intent: 'GENERAL' };
  }
}

