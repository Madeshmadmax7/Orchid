// ============================================================================
// Project Memory — Context Compressor
// ============================================================================
// Formats retrieved contexts into a compact string representation optimised
// for LLM token consumption:
//
//   1. stripMeta()        — removes backend-only fields before stringifying
//   2. formatGraphEdges() — emits compact DOT-like call-graph notation
//   3. compress()         — budget-aware selection + graph section injection
// ============================================================================

import { RetrievedContext, SymbolInfo, FileMetadata, QueryIntent } from '../types';

// ── Intents that benefit from a call-graph preamble ─────────────────────────
const GRAPH_INTENTS = new Set<QueryIntent>([
  'TRACE', 'MODIFICATION', 'EXPLAIN', 'DEPENDENCIES', 'DEPENDENTS',
]);

// ── Noise calls to omit from graph edges (React primitives, utilities) ───────
const GRAPH_NOISE = new Set([
  'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext',
  'useReducer', 'useLayoutEffect', 'console.log', 'console.error', 'console.warn',
  'e.preventDefault', 'e.stopPropagation', 'JSON.stringify', 'JSON.parse',
  'Math.min', 'Math.max', 'Object.keys', 'Object.values', 'Array.from',
  'Promise.all', 'super',
]);

export class ContextCompressor {
  /**
   * Compresses ranked contexts into a single markdown string
   * optimised for LLM token usage. Multi-level context representation (Phase 8).
   * Selection: select contexts until a strict token budget is hit (Phase 9).
   *
   * @param intent - Optional query intent for graph-section gating
   */
  compress(
    contexts: RetrievedContext[],
    maxTokens: number = 5000,
    intent?: QueryIntent
  ): {
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
        contextLevels: { L1: 0, L2: 0, L3: 0 },
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
    const includedContexts: RetrievedContext[] = [];

    let symbolsIncluded = 0;
    const contextLevels = { L1: 0, L2: 0, L3: 0 };

    // First pass: calculate total candidate tokens if all were included
    for (const ctx of contexts) {
      const chunk = this.formatContext(ctx);
      candidateTokens += this.estimateTokens(chunk);
    }

    // Second pass: select up to maxTokens
    for (const ctx of contexts) {
      const chunk = this.formatContext(ctx);
      const chunkTokens = this.estimateTokens(chunk);

      if (currentTokens + chunkTokens > maxTokens) {
        break;
      }

      currentTokens += chunkTokens;
      includedContexts.push(ctx);

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
        contextLevels,
      };
    }

    // ── Graph section (intent-gated) ─────────────────────────────────────────
    // Prepend a compact call-graph before component details. This gives the LLM
    // a high-level structural view of data flow before reading individual symbols.
    const shouldEmitGraph = intent && GRAPH_INTENTS.has(intent);
    if (shouldEmitGraph) {
      const graphSection = this.formatGraphEdges(includedContexts);
      if (graphSection) {
        const graphTokens = this.estimateTokens(graphSection);
        // Only include graph if there is budget for it (soft guard)
        if (currentTokens + graphTokens <= maxTokens * 1.05) {
          lines.push('\n[Call Graph]');
          lines.push(graphSection);
        }
      }
    }

    // ── Component architecture ───────────────────────────────────────────────
    if (selectedFiles.length > 0) {
      lines.push('\n[Component Architecture]');
      lines.push(...selectedFiles);
    }

    // ── Symbol detail ────────────────────────────────────────────────────────
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
      contextLevels,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Extremely lightweight token estimation (approx 4 chars per token).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Unified context formatter — dispatches to file or symbol formatter.
   */
  private formatContext(ctx: RetrievedContext): string {
    if (ctx.type === 'file') {
      const header = `\n## ${ctx.filePath}\n`;
      const body = ctx.fileMeta
        ? this.formatFile(this.stripFileMeta(ctx.fileMeta), ctx.relevanceScore)
        : ctx.content;
      return header + body;
    } else {
      const header = ctx.filePath ? `\n## ${ctx.filePath} (Symbol)\n` : '';
      const body = ctx.symbolInfo
        ? this.formatSymbol(this.stripSymbolMeta(ctx.symbolInfo), ctx.relevanceScore, ctx.fileMeta)
        : ctx.content;
      return header + body;
    }
  }

  /**
   * Strips backend-only fields from FileMetadata before LLM sees it.
   * Removes: hash, lastAnalyzed, isUnused imports, default-false booleans.
   * Flattens imports to code-style strings.
   */
  private stripFileMeta(file: FileMetadata): FileMetadata {
    return {
      ...file,
      hash: '',           // clear — LLM doesn't need content fingerprint
      lastAnalyzed: 0,    // clear — LLM doesn't need timestamps
      imports: file.imports
        .filter(i => !i.isUnused)
        .map(i => ({
          ...i,
          // Only keep fields the compressor actually uses for formatting
        })),
      symbols: file.symbols.map(s => this.stripSymbolMeta(s)),
    };
  }

  /**
   * Strips backend-only fields from SymbolInfo before LLM sees it.
   * Removes: hash, id (internal graph key).
   */
  private stripSymbolMeta(sym: SymbolInfo): SymbolInfo {
    const { hash, id, ...rest } = sym as any;
    return rest as SymbolInfo;
  }

  /**
   * Emits a compact call-graph section from the included contexts.
   *
   * Format (DOT-like, human-readable):
   *   symbolName → call1, call2, call3
   *
   * Only non-trivial edges (filtered by GRAPH_NOISE) are shown.
   * Symbols with no meaningful outgoing calls are omitted.
   */
  private formatGraphEdges(contexts: RetrievedContext[]): string {
    const edges: string[] = [];
    const seen = new Set<string>();

    for (const ctx of contexts) {
      const sym = ctx.symbolInfo;
      if (!sym || !sym.calls || sym.calls.length === 0) continue;

      // Deduplicate by symbol name
      if (seen.has(sym.name)) continue;
      seen.add(sym.name);

      const meaningfulCalls = sym.calls.filter(c => !GRAPH_NOISE.has(c));
      if (meaningfulCalls.length === 0) continue;

      // Cap at 8 targets per symbol for readability
      const targets = meaningfulCalls.slice(0, 8).join(', ');
      edges.push(`${sym.name} → ${targets}`);
    }

    // Also pull file-level symbol calls from fileMeta when ctx is a file
    for (const ctx of contexts) {
      if (ctx.type !== 'file' || !ctx.fileMeta) continue;
      for (const sym of ctx.fileMeta.symbols) {
        if (seen.has(sym.name) || !sym.calls || sym.calls.length === 0) continue;
        seen.add(sym.name);
        const meaningfulCalls = sym.calls.filter(c => !GRAPH_NOISE.has(c));
        if (meaningfulCalls.length === 0) continue;
        const targets = meaningfulCalls.slice(0, 8).join(', ');
        edges.push(`${sym.name} → ${targets}`);
      }
    }

    return edges.join('\n');
  }

  // ── Level-based formatters ─────────────────────────────────────────────────

  private formatFile(file: FileMetadata, score: number): string {
    if (score < 0.4) {
      // L1: summary + exports only
      const exports = file.exports.map(e => `${e.isDefault ? 'default ' : ''}${e.name}`).join(', ');
      return `${file.summary || file.fileType} | Exports: ${exports}`;
    } else if (score < 0.8) {
      // L2: summary + exports + local deps
      const exports = file.exports.map(e => `${e.isDefault ? 'default ' : ''}${e.name}`).join(', ');
      const localDeps = file.imports.filter(i => i.isLocal).map(i => i.source).join(', ');
      let out = `${file.summary || file.fileType} | Exports: ${exports}`;
      if (localDeps) out += ` | LocalDeps: ${localDeps}`;
      return out;
    } else {
      // L3: full structural representation
      const exports = file.exports.map(e => `${e.isDefault ? 'default ' : ''}${e.name}`).join(', ');
      const localDeps = file.imports.filter(i => i.isLocal).map(i => i.source).join(', ');
      const externalDeps = file.imports.filter(i => !i.isLocal).map(i => i.source).join(', ');
      const topSymbols = file.symbols
        .filter(s => !s.parentSymbol && ['class', 'function', 'react-component', 'interface'].includes(s.kind))
        .map(s => s.name)
        .join(', ');

      let out = `${file.summary || file.fileType} | Exports: ${exports}`;
      if (localDeps) out += ` | LocalDeps: ${localDeps}`;
      if (externalDeps) out += ` | Ext: ${externalDeps}`;
      if (topSymbols) out += ` | Symbols: ${topSymbols}`;
      return out;
    }
  }

  private formatSymbol(symbol: SymbolInfo, score: number, fileMeta?: FileMetadata): string {
    // Build signature
    const params = symbol.parameters?.join(', ') || '';
    const sig = params
      ? `${symbol.kind} ${symbol.name}(${params})`
      : `${symbol.kind} ${symbol.name}`;
    const sigWithReturn = symbol.returnType ? `${sig} → ${symbol.returnType}` : sig;

    if (score < 0.5) {
      // L1: signature + summary
      return `- ${sigWithReturn}: ${symbol.summary || 'No summary'}`;
    } else if (score < 0.8) {
      // L2: signature + summary + meaningful calls
      let out = `- ${sigWithReturn} (L${symbol.startLine}-${symbol.endLine}): ${symbol.summary || 'No summary'}`;
      const meaningfulCalls = (symbol.calls || []).filter(c => !GRAPH_NOISE.has(c));
      if (meaningfulCalls.length > 0) {
        out += `\n  Effects: ${meaningfulCalls.slice(0, 6).join(', ')}`;
      }
      return out;
    } else {
      // L3: full detail — signature + summary + effects + throws + members
      let out = `- ${sigWithReturn} (L${symbol.startLine}-${symbol.endLine}): ${symbol.summary || 'No summary'}`;
      const meaningfulCalls = (symbol.calls || []).filter(c => !GRAPH_NOISE.has(c));
      if (meaningfulCalls.length > 0) {
        out += `\n  Effects: ${meaningfulCalls.slice(0, 8).join(', ')}`;
      }
      if (symbol.throws && symbol.throws.length > 0) {
        out += `\n  Throws: ${symbol.throws.join(', ')}`;
      }
      if (fileMeta) {
        const children = fileMeta.symbols.filter(s => s.parentSymbol === symbol.name);
        if (children.length > 0) {
          const memberStr = children
            .map(c => `${c.isAsync ? 'async ' : ''}${c.kind} ${c.name}`)
            .join(', ');
          out += `\n  Members: ${memberStr}`;
        }
      }
      return out;
    }
  }
}
