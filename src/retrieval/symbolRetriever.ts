// ============================================================================
// Project Memory — Symbol Retriever
// ============================================================================
// Retrieves symbols from the in-memory project index based on queries.
// ============================================================================

import { ProjectIndex } from '../knowledge/projectIndex';
import { RetrievalQuery, RetrievedContext } from '../types';
import { generateSymbolSummary } from '../analyzer/componentSummarizer';

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
            metadata: { kind: match.symbolInfo.kind }
          });
        }
      }
    }

    // 2. Keyword-based substring matches against Symbol Names
    for (const keyword of query.keywords) {
      const matches = this.projectIndex.searchSymbols(keyword);
      for (const match of matches) {
        const id = `symbol:${match.filePath}:${match.symbolInfo.name}`;
        if (!seen.has(id)) {
          seen.add(id);
          const fileMeta = this.projectIndex.getFile(match.filePath);
          contexts.push({
            id,
            type: 'symbol',
            content: fileMeta ? generateSymbolSummary(match.symbolInfo, fileMeta.symbols) : match.symbolInfo.name,
            relevanceScore: 0.5, // partial match
            filePath: match.filePath,
            metadata: { kind: match.symbolInfo.kind }
          });
        }
      }
    }

    // 3. Keyword-based substring matches against AI Semantic Summaries
    for (const keyword of query.keywords) {
      const lowerKeyword = keyword.toLowerCase();
      const allFiles = this.projectIndex.getAllFiles();
      
      for (const file of allFiles) {
        // Match against File summary
        if (file.summary && file.summary.toLowerCase().includes(lowerKeyword)) {
          const id = `file_summary:${file.filePath}`;
          if (!seen.has(id)) {
            seen.add(id);
            contexts.push({
              id,
              type: 'file',
              content: `File: ${file.filePath}\nPurpose: ${file.summary}`,
              relevanceScore: 0.7,
              filePath: file.filePath,
              metadata: { fileType: file.fileType }
            });
          }
        }

        // Match against specific Symbol summaries
        for (const symbol of file.symbols) {
          if (symbol.summary && symbol.summary.toLowerCase().includes(lowerKeyword)) {
            const id = `symbol_summary:${file.filePath}:${symbol.name}`;
            if (!seen.has(id)) {
              seen.add(id);
              contexts.push({
                id,
                type: 'symbol',
                content: `Symbol: ${symbol.name}\nKind: ${symbol.kind}\nPurpose: ${symbol.summary}`,
                relevanceScore: 0.75, // Highly relevant
                filePath: file.filePath,
                metadata: { kind: symbol.kind }
              });
            }
          }
        }
      }
    }

    return contexts;
  }
}
