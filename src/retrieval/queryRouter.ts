// ============================================================================
// Project Memory — Query Router
// ============================================================================
// Parses user queries and extracts keywords, target files, and target symbols.
// ============================================================================

import { RetrievalQuery } from '../types';

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
    const symbolRegex = /^[A-Z][a-zA-Z0-9]+$|^[a-z]+[A-Z][a-zA-Z0-9]+$/; // PascalCase or camelCase

    for (const token of tokens) {
      const cleanToken = token.replace(/[^a-zA-Z0-9.\-_/]/g, ''); // strip punctuation at edges
      
      if (!cleanToken) { continue; }

      if (fileRegex.test(cleanToken) || cleanToken.includes('/')) {
        targetFiles.push(cleanToken);
      } else if (symbolRegex.test(cleanToken)) {
        targetSymbols.push(cleanToken);
      } else if (cleanToken.length > 3) {
        keywords.push(cleanToken.toLowerCase());
      }
    }

    return {
      rawQuery,
      keywords,
      targetSymbols,
      targetFiles,
      maxResults: 15
    };
  }
}
