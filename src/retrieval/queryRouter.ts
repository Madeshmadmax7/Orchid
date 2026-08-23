// ============================================================================
// Project Memory — Query Router
// ============================================================================
// Parses user queries and extracts keywords, target files, and target symbols.
// ============================================================================

import { RetrievalQuery, QueryIntent } from '../types';
import { ConceptExpander } from './conceptExpander';

/**
 * Parses a raw natural language query into a structured RetrievalQuery.
 */
export class QueryRouter {
  /**
   * Extremely simple regex-based NLP parsing for MVP.
   * Extracts PascalCase/camelCase words as potential symbols,
   * and strings with slashes or dots as potential files.
   */
  parseQuery(rawQuery: string): RetrievalQuery {
    const tokens = rawQuery.split(/\s+/);
    
    const keywords: string[] = [];
    const targetSymbols: string[] = [];
    const targetFiles: string[] = [];

    const fileRegex = /[\w-]+\.(ts|js|tsx|jsx|json|md)/i;
    const symbolRegex = /^[A-Z][a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$|^[a-z]+[A-Z][a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/; // PascalCase or camelCase, optionally with .property

    for (const token of tokens) {
      const cleanToken = token.replace(/[^a-zA-Z0-9.\-_/]/g, ''); // strip punctuation at edges
      
      if (!cleanToken) { continue; }

      if (fileRegex.test(cleanToken) || cleanToken.includes('/')) {
        targetFiles.push(cleanToken);
      } else if (symbolRegex.test(cleanToken)) {
        targetSymbols.push(cleanToken); // E.g., PaymentService.verifyPayment
      } else if (cleanToken.length > 3) {
        keywords.push(cleanToken.toLowerCase());
      }
    }

    const intent = this.detectIntent(rawQuery);
    const concepts = ConceptExpander.expand(keywords);

    return {
      rawQuery,
      keywords,
      targetSymbols,
      targetFiles,
      intent,
      concepts,
      maxResults: 15
    };
  }

  private detectIntent(query: string): QueryIntent {
    const lower = query.toLowerCase();
    
    if (/(who|where).*calls|called by|where is.*called/.test(lower)) {
      return 'CALLERS';
    }
    // "What does X depend on" vs "Which files depend on X"
    if (/(what|which|who).*does.*depend on|dependencies of/.test(lower)) {
      return 'DEPENDENCIES';
    }
    if (/(what|which|who).*(depend|depends) on|who uses/.test(lower)) {
      return 'DEPENDENTS';
    }
    if (/where is.*used|usage of/.test(lower)) {
      return 'USAGE';
    }
    if (/how does.*work|explain.*behavior|what is.*doing/.test(lower)) {
      return 'EXPLAIN';
    }
    if (/(what happens when|why could|what if).*fail|throws|missing|error|validation|catch|exception/.test(lower)) {
      return 'ERROR_VALIDATION';
    }
    if (/how (would|do) i (modify|change|update)/.test(lower)) {
      return 'MODIFICATION';
    }

    return 'GENERAL';
  }
}
