// ============================================================================
// Project Memory — Context Compressor
// ============================================================================
// Formats retrieved contexts into a compact string representation.
// ============================================================================

import { RetrievedContext } from '../types';

export class ContextCompressor {
  /**
   * Compresses ranked contexts into a single markdown string
   * optimized for LLM token usage.
   */
  compress(contexts: RetrievedContext[]): string {
    if (contexts.length === 0) {
      return 'No relevant project context found.';
    }

    const lines: string[] = [];
    lines.push('--- RELEVANT PROJECT CONTEXT ---');
    
    // Group by type
    const files = contexts.filter(c => c.type === 'file');
    const symbols = contexts.filter(c => c.type === 'symbol');

    if (files.length > 0) {
      lines.push('\n[Component Architecture]');
      for (const f of files) {
        lines.push(`\n## ${f.filePath}`);
        lines.push(f.content);
      }
    }

    if (symbols.length > 0) {
      lines.push('\n[Specific Symbols]');
      for (const s of symbols) {
        lines.push(s.content);
      }
    }

    lines.push('\n--- END PROJECT CONTEXT ---');
    return lines.join('\n');
  }
}
