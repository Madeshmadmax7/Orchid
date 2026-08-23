// ============================================================================
// Project Memory — Symbol Retriever
// ============================================================================
// Retrieves symbols from the in-memory project index based on queries.
// ============================================================================

import { ProjectIndex } from '../knowledge/projectIndex';
import { RetrievalQuery, RetrievedContext } from '../types';
import { generateSymbolSummary } from '../analyzer/componentSummarizer';

function normalizeWord(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4) {
    if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.endsWith('es') && !w.endsWith('ss') && !w.endsWith('ces')) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
    if (w.endsWith('ing')) return w.slice(0, -3);
    if (w.endsWith('ed')) return w.slice(0, -2);
    if (w.endsWith('tion')) return w.slice(0, -4) + 'te';
  }
  return w;
}

function tokenizeAndNormalize(text: string): Set<string> {
  const words = text.split(/[\s.()_]+/);
  const normalized = new Set<string>();
  for (const w of words) {
    if (w) normalized.add(normalizeWord(w));
  }
  return normalized;
}

export class SymbolRetriever {
  constructor(private projectIndex: ProjectIndex) {}

  /**
   * Retrieves contexts based on extracted symbols and keywords.
   */
  retrieve(query: RetrievalQuery): RetrievedContext[] {
    const contexts: RetrievedContext[] = [];
    const seen = new Set<string>();

    // 1. Direct symbol matches
    for (const targetSymbol of query.targetSymbols) {
      const matches = this.projectIndex.getSymbol(targetSymbol);
      for (const match of matches) {
        const id = `symbol:${match.filePath}:${match.symbolInfo.name}`;
        if (!seen.has(id)) {
          seen.add(id);
          const fileMeta = this.projectIndex.getFile(match.filePath);
          contexts.push({
            id,
            type: 'symbol',
            content: fileMeta ? generateSymbolSummary(match.symbolInfo, fileMeta.symbols) : match.symbolInfo.name,
            relevanceScore: 1.0, // exact match
            filePath: match.filePath,
            metadata: { kind: match.symbolInfo.kind },
            symbolInfo: match.symbolInfo,
            fileMeta: fileMeta
          });
        }
      }
    }

    // 2 & 3. Concept-based substring matches against full symbol context
    const conceptContexts = new Map<string, RetrievedContext>();

    for (const concept of query.concepts) {
      const lowerKeyword = concept.toLowerCase();
      const normKeyword = normalizeWord(lowerKeyword);
      const allFiles = this.projectIndex.getAllFiles();
      
      for (const file of allFiles) {
        // For directional graph queries, skip file-level lexical matches —
        // the source file being searched is not a "dependent" of itself
        const skipFileLexical = (query.intent === 'DEPENDENTS' || query.intent === 'DEPENDENCIES');

        if (!skipFileLexical && file.summary) {
          const fileSummaryLower = file.summary.toLowerCase();
          const exactFileMatch = fileSummaryLower.includes(lowerKeyword);
          
          let fileScore = 0;
          if (exactFileMatch) {
            fileScore = 0.7;
          } else {
            const contextTokens = tokenizeAndNormalize(fileSummaryLower);
            for (const token of contextTokens) {
              if (token.includes(normKeyword)) {
                fileScore = 0.5;
                break;
              }
            }
          }

          if (fileScore > 0) {
            const id = `file_summary:${file.filePath}`;
            const existing = conceptContexts.get(id);
            if (existing) {
              existing.relevanceScore += fileScore * 0.5;
            } else {
              conceptContexts.set(id, {
                id,
                type: 'file',
                content: `File: ${file.filePath}\nPurpose: ${file.summary}`,
                relevanceScore: fileScore,
                filePath: file.filePath,
                metadata: { fileType: file.fileType },
                fileMeta: file
              });
            }
          }
        }

        // Match against specific Symbol context
        for (const symbol of file.symbols) {
          const fullContext = [
            symbol.parentSymbol,
            symbol.name,
            symbol.summary,
            ...(symbol.calls || []),
            ...(symbol.throws || [])
          ].filter(Boolean).join(' ').toLowerCase();

          const exactMatch = fullContext.includes(lowerKeyword);
          let score = 0;
          
          if (exactMatch) {
            score = 0.6;
          } else {
            const contextTokens = tokenizeAndNormalize(fullContext);
            for (const token of contextTokens) {
              if (token.includes(normKeyword)) {
                score = 0.4;
                break;
              }
            }
          }

          if (score > 0) {
            const id = `symbol_summary:${file.filePath}:${symbol.name}`;
            const existing = conceptContexts.get(id);
            if (existing) {
              existing.relevanceScore += score * 0.5;
            } else {
              conceptContexts.set(id, {
                id,
                type: 'symbol',
                content: generateSymbolSummary(symbol, file.symbols),
                relevanceScore: score, // Concept match relevance
                filePath: file.filePath,
                metadata: { kind: symbol.kind },
                symbolInfo: symbol,
                fileMeta: file
              });
            }
          }
        }
      }
    }

    contexts.push(...conceptContexts.values());
    return contexts;
  }
}
