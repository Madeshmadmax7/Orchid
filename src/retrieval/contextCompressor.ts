// ============================================================================
// Project Memory — Context Compressor
// ============================================================================
// Formats retrieved contexts into a compact string representation.
// ============================================================================

import { RetrievedContext, SymbolInfo, FileMetadata } from '../types';

export class ContextCompressor {
  /**
   * Compresses ranked contexts into a single markdown string
   * optimized for LLM token usage. Multi-level context representation (Phase 8).
   * Selection: Select contexts until a strict token budget is hit (Phase 9).
   */
  compress(contexts: RetrievedContext[], maxTokens: number = 5000): { 
    text: string; 
    tokenCount: number;
    candidateTokenCount: number;
    filesConsidered: number;
    symbolsRetrieved: number;
    symbolsIncluded: number;
    contextLevels: { L1: number; L2: number; L3: number };
  } {
    let filesConsidered = 0;
    let symbolsRetrieved = 0;
    for (const ctx of contexts) {
      if (ctx.type === 'file') filesConsidered++;
      else symbolsRetrieved++;
    }

    if (contexts.length === 0) {
      return { 
        text: 'No relevant project context found.', 
        tokenCount: 0,
        candidateTokenCount: 0,
        filesConsidered,
        symbolsRetrieved,
        symbolsIncluded: 0,
        contextLevels: { L1: 0, L2: 0, L3: 0 }
      };
    }

    const lines: string[] = [];
    lines.push('--- RELEVANT PROJECT CONTEXT ---');
    
    const baseFooter = '\n--- END PROJECT CONTEXT ---';
    const sectionsOverhead = '\n[Component Architecture]\n[Specific Symbols]';
    let currentTokens = this.estimateTokens(lines[0] + baseFooter + sectionsOverhead);
    let candidateTokens = currentTokens;

    const selectedFiles: string[] = [];
    const selectedSymbols: string[] = [];

    let symbolsIncluded = 0;
    const contextLevels = { L1: 0, L2: 0, L3: 0 };
    let stoppedByBudget = false;

    // First pass: calculate total candidate tokens if all were included
    for (const ctx of contexts) {
      let chunk = '';
      if (ctx.type === 'file') {
        const header = `\n## ${ctx.filePath}\n`;
        const body = ctx.fileMeta ? this.formatFile(ctx.fileMeta, ctx.relevanceScore) : ctx.content;
        chunk = header + body;
      } else {
        const header = ctx.filePath ? `\n## ${ctx.filePath} (Symbol)\n` : '';
        const body = ctx.symbolInfo ? this.formatSymbol(ctx.symbolInfo, ctx.relevanceScore, ctx.fileMeta) : ctx.content;
        chunk = header + body;
      }
      candidateTokens += this.estimateTokens(chunk);
    }

    // Second pass: actually select up to maxTokens
    for (const ctx of contexts) {
      let chunk = '';
      if (ctx.type === 'file') {
        const header = `\n## ${ctx.filePath}\n`;
        const body = ctx.fileMeta ? this.formatFile(ctx.fileMeta, ctx.relevanceScore) : ctx.content;
        chunk = header + body;
      } else {
        const header = ctx.filePath ? `\n## ${ctx.filePath} (Symbol)\n` : '';
        const body = ctx.symbolInfo ? this.formatSymbol(ctx.symbolInfo, ctx.relevanceScore, ctx.fileMeta) : ctx.content;
        chunk = header + body;
      }

      const chunkTokens = this.estimateTokens(chunk);
      
      // Do NOT expand context merely because token budget remains. If budget hits limit, STOP.
      if (currentTokens + chunkTokens > maxTokens) {
        stoppedByBudget = true;
        break; 
      }

      currentTokens += chunkTokens;
      
      if (ctx.type === 'file') {
        selectedFiles.push(chunk);
      } else {
        selectedSymbols.push(chunk);
        symbolsIncluded++;
      }

      // Track context levels based on relevance score
      if (ctx.type === 'file') {
        if (ctx.relevanceScore < 0.4) contextLevels.L1++;
        else if (ctx.relevanceScore < 0.8) contextLevels.L2++;
        else contextLevels.L3++;
      } else {
        if (ctx.relevanceScore < 0.5) contextLevels.L1++;
        else if (ctx.relevanceScore < 0.8) contextLevels.L2++;
        else contextLevels.L3++;
      }
    }

    if (selectedFiles.length === 0 && selectedSymbols.length === 0) {
      const fallbackText = 'No relevant project context found.';
      return {
        text: fallbackText,
        tokenCount: this.estimateTokens(fallbackText),
        candidateTokenCount: candidateTokens,
        filesConsidered,
        symbolsRetrieved,
        symbolsIncluded,
        contextLevels
      };
    }

    if (selectedFiles.length > 0) {
      lines.push('\n[Component Architecture]');
      lines.push(...selectedFiles);
    }

    if (selectedSymbols.length > 0) {
      lines.push('\n[Specific Symbols]');
      lines.push(...selectedSymbols);
    }

    lines.push('\n--- END PROJECT CONTEXT ---');
    const finalTokens = this.estimateTokens(lines.join('\n'));

    return { 
      text: lines.join('\n'), 
      tokenCount: finalTokens,
      candidateTokenCount: candidateTokens,
      filesConsidered,
      symbolsRetrieved,
      symbolsIncluded,
      contextLevels
    };
  }

  /**
   * Extremely lightweight token estimation (approx 4 chars per token).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private formatFile(file: FileMetadata, score: number): string {
    if (score < 0.4) {
      // Level 1: Basic summary
      return `Purpose: ${file.summary || 'Unknown'}\nExports: ${file.exports.map(e => e.name).join(', ')}`;
    } else if (score < 0.8) {
      // Level 2: Compact behavior
      const deps = file.imports.filter(i => !i.isUnused).map(i => i.source).join(', ');
      return `Purpose: ${file.summary || 'Unknown'}\nExports: ${file.exports.map(e => e.name).join(', ')}\nActive Dependencies: ${deps}`;
    } else {
      // Level 3: Full structural representation
      const deps = file.imports.filter(i => !i.isUnused).map(i => i.source).join(', ');
      const symbols = file.symbols.filter(s => !s.parentSymbol).map(s => s.name).join(', ');
      return `Purpose: ${file.summary || 'Unknown'}\nExports: ${file.exports.map(e => e.name).join(', ')}\nActive Dependencies: ${deps}\nTop-level Symbols: ${symbols}`;
    }
  }

  private formatSymbol(symbol: SymbolInfo, score: number, fileMeta?: FileMetadata): string {
    if (score < 0.5) {
      // Level 1: Signature + summary
      return `- ${symbol.kind} ${symbol.name}: ${symbol.summary || 'No summary'}`;
    } else if (score < 0.8) {
      // Level 2: Compact behavior (includes methods/params)
      let out = `- ${symbol.kind} ${symbol.name}: ${symbol.summary || 'No summary'}`;
      if (symbol.parameters && symbol.parameters.length > 0) {
        out += `\n  Params: ${symbol.parameters.join(', ')}`;
      }
      if (symbol.calls && symbol.calls.length > 0) {
        out += `\n  Calls out to: ${symbol.calls.join(', ')}`;
      }
      return out;
    } else {
      // Level 3: Relevant implementation context
      let out = `- ${symbol.kind} ${symbol.name}: ${symbol.summary || 'No summary'}`;
      if (symbol.parameters && symbol.parameters.length > 0) {
        out += `\n  Params: ${symbol.parameters.join(', ')}`;
      }
      if (symbol.returnType) {
        out += `\n  Returns: ${symbol.returnType}`;
      }
      if (symbol.calls && symbol.calls.length > 0) {
        out += `\n  Calls out to: ${symbol.calls.join(', ')}`;
      }
      if (fileMeta) {
        const children = fileMeta.symbols.filter(s => s.parentSymbol === symbol.name);
        if (children.length > 0) {
          out += `\n  Members:\n    ` + children.map(c => `${c.kind} ${c.name}`).join('\n    ');
        }
      }
      return out;
    }
  }
}
