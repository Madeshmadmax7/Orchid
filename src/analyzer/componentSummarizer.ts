// ============================================================================
// Project Memory — Component Summarizer
// ============================================================================
// Generates deterministic text summaries of files and components based on
// AST metadata, without requiring an LLM.
// ============================================================================

import { FileMetadata, SymbolInfo, ExportInfo } from '../types';

/**
 * Generates a deterministic summary of a file's metadata.
 */
export function generateFileSummary(metadata: FileMetadata): string {
  const lines: string[] = [];
  
  lines.push(`File: ${metadata.filePath}`);
  lines.push(`Type: ${metadata.fileType}`);
  lines.push(`Language: ${metadata.language}`);
  lines.push('');

  // Exports
  if (metadata.exports.length > 0) {
    lines.push('Exports:');
    metadata.exports.forEach((e) => {
      lines.push(`  - ${e.name} (${e.kind}${e.isDefault ? ', default' : ''})`);
    });
    lines.push('');
  }

  // Major Symbols (Classes, Interfaces, Functions, React Components)
  const majorSymbols = metadata.symbols.filter(
    (s) => !s.parentSymbol && ['class', 'function', 'interface', 'react-component', 'type', 'enum'].includes(s.kind)
  );

  if (majorSymbols.length > 0) {
    lines.push('Key Definitions:');
    majorSymbols.forEach((s) => {
      lines.push(generateSymbolSummary(s, metadata.symbols));
    });
  }

  // Dependencies
  const externalDeps = metadata.imports.filter((i) => !i.isLocal);
  const localDeps = metadata.imports.filter((i) => i.isLocal);

  if (externalDeps.length > 0) {
    lines.push('External Dependencies:');
    externalDeps.forEach((d) => {
      lines.push(`  - ${d.source}`);
    });
    lines.push('');
  }

  if (localDeps.length > 0) {
    lines.push('Local Dependencies:');
    localDeps.forEach((d) => {
      lines.push(`  - ${d.source}`);
    });
  }

  return lines.join('\n').trim();
}

/**
 * Generates a summary for a specific symbol and its children.
 */
export function generateSymbolSummary(symbol: SymbolInfo, allSymbols: SymbolInfo[]): string {
  let summary = `  - [${symbol.kind}] ${symbol.name}`;
  
  if (symbol.heritage?.extends?.length) {
    summary += ` extends ${symbol.heritage.extends.join(', ')}`;
  }
  if (symbol.heritage?.implements?.length) {
    summary += ` implements ${symbol.heritage.implements.join(', ')}`;
  }

  const children = allSymbols.filter((s) => s.parentSymbol === symbol.name);
  if (children.length > 0) {
    summary += '\n    Members:\n';
    children.forEach((child) => {
      const isStatic = child.isStatic ? 'static ' : '';
      const isAsync = child.isAsync ? 'async ' : '';
      const params = child.parameters ? `(${child.parameters.join(', ')})` : '';
      summary += `      * ${isStatic}${isAsync}${child.name}${params}\n`;
      if (child.summary) summary += `        Summary: ${child.summary}\n`;
      if (child.throws && child.throws.length > 0) summary += `        Throws: ${child.throws.join(', ')}\n`;
      if (child.calls && child.calls.length > 0) summary += `        Calls: ${child.calls.join(', ')}\n`;
    });
  } else {
    if (symbol.summary) summary += `\n    Summary: ${symbol.summary}`;
    if (symbol.throws && symbol.throws.length > 0) summary += `\n    Throws: ${symbol.throws.join(', ')}`;
    if (symbol.calls && symbol.calls.length > 0) summary += `\n    Calls: ${symbol.calls.join(', ')}`;
  }
  
  return summary.trimEnd();
}
