// ============================================================================
// Project Memory — Component Summarizer
// ============================================================================
// Generates deterministic, dense, pipe-delimited text summaries of files and
// symbols based on AST metadata — without requiring an LLM.
//
// Format philosophy:
//   File:   <fileType> | Exports: <names> | Deps: <local-deps> | Symbols: <names>
//   Symbol: <kind> <Name>(<params>) → <returnType> | <core purpose> | State: <vars> | Effects: <calls>
//
// This format packs maximum signal per token for LLM context consumption.
// ============================================================================

import { FileMetadata, SymbolInfo } from '../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Infers state variables from a symbol's calls list.
 * Heuristic: calls to setState-style patterns or useState destructure assignments.
 */
function inferStateVars(symbol: SymbolInfo): string[] {
  if (!symbol.calls) return [];
  // Detect: setFoo, setState, dispatch, useReducer results
  const stateSetters = symbol.calls.filter(c =>
    /^set[A-Z]/.test(c) || c === 'setState' || c === 'dispatch'
  );
  // Convert setMessage → message
  return stateSetters.map(s => s.replace(/^set([A-Z])/, (_, ch) => ch.toLowerCase()));
}

/**
 * Extracts meaningful side-effect calls, excluding React primitives and utility noise.
 */
function extractEffectCalls(symbol: SymbolInfo): string[] {
  if (!symbol.calls) return [];
  const NOISE = new Set([
    'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext',
    'useReducer', 'useLayoutEffect', 'console.log', 'console.error', 'console.warn',
    'Math.min', 'Math.max', 'Math.ceil', 'Math.floor', 'Object.keys', 'Object.values',
    'Array.from', 'Promise.all', 'JSON.stringify', 'JSON.parse',
    'e.preventDefault', 'e.stopPropagation',
  ]);
  return symbol.calls.filter(c => !NOISE.has(c) && !c.startsWith('set[A-Z]'));
}

/**
 * Formats a compact parameter string, trimming destructure noise.
 */
function formatParams(params: string[] | undefined): string {
  if (!params || params.length === 0) return '';
  // If a single param looks like a destructure object, keep it compact
  const joined = params.join(', ');
  return joined.length > 60 ? joined.slice(0, 57) + '…' : joined;
}

// ── File Summary ─────────────────────────────────────────────────────────────

/**
 * Generates a dense, pipe-delimited summary of a file for LLM context.
 *
 * Format:
 *   <fileType> | Exports: <names> | LocalDeps: <paths> | Symbols: <top-level-names>
 *
 * Example:
 *   component | Exports: default ChatInput | LocalDeps: ./hooks/useChat | Symbols: ChatInput, handleSubmit
 */
export function generateFileSummary(metadata: FileMetadata): string {
  const parts: string[] = [];

  // Core type
  parts.push(metadata.fileType);

  // Exports — compact
  if (metadata.exports.length > 0) {
    const exportStr = metadata.exports
      .map(e => `${e.isDefault ? 'default ' : ''}${e.name}`)
      .join(', ');
    parts.push(`Exports: ${exportStr}`);
  }

  // Local deps only (external packages are noise for navigation)
  const localDeps = metadata.imports.filter(i => i.isLocal && !i.isUnused);
  if (localDeps.length > 0) {
    const depStr = localDeps.map(d => d.source).join(', ');
    parts.push(`LocalDeps: ${depStr}`);
  }

  // Top-level symbol names
  const topSymbols = metadata.symbols
    .filter(s => !s.parentSymbol && ['class', 'function', 'react-component', 'interface', 'type', 'enum'].includes(s.kind))
    .map(s => s.name);
  if (topSymbols.length > 0) {
    parts.push(`Symbols: ${topSymbols.join(', ')}`);
  }

  // Line count hint (helps agent understand file weight)
  parts.push(`LOC: ${metadata.loc}`);

  return parts.join(' | ');
}

// ── Symbol Summary ───────────────────────────────────────────────────────────

/**
 * Generates a dense, pipe-delimited summary of a symbol.
 *
 * Format:
 *   <kind> <Name>(<params>) → <returnType> | <purpose-from-jsdoc> | State: <vars> | Effects: <calls> | Members: <child-names>
 *
 * Examples:
 *   react-component ChatInput({ onSend, isLoading, isDarkMode }) | Chat text input form | State: message | Effects: onSend, inputRef.current.focus
 *   method sendRequest(url, options) → Promise<Response> | Sends authenticated HTTP request | Effects: this.http.post, this.authService.getToken
 *   class PaymentService | Orchestrates payment flow | Members: verify, charge, refund
 */
export function generateSymbolSummary(symbol: SymbolInfo, allSymbols: SymbolInfo[]): string {
  const parts: string[] = [];

  // Signature: kind Name(params) → returnType
  const params = formatParams(symbol.parameters);
  const sig = params
    ? `${symbol.kind} ${symbol.name}(${params})`
    : `${symbol.kind} ${symbol.name}`;

  const sigWithReturn = symbol.returnType
    ? `${sig} → ${symbol.returnType}`
    : sig;

  // Heritage
  let heritage = '';
  if (symbol.heritage?.extends?.length) {
    heritage += ` extends ${symbol.heritage.extends.join(', ')}`;
  }
  if (symbol.heritage?.implements?.length) {
    heritage += ` implements ${symbol.heritage.implements.join(', ')}`;
  }

  parts.push(sigWithReturn + heritage);

  // Core purpose (from JSDoc / existing summary)
  if (symbol.summary) {
    parts.push(symbol.summary);
  }

  // State vars (inferred from setXxx calls)
  const stateVars = inferStateVars(symbol);
  if (stateVars.length > 0) {
    parts.push(`State: ${stateVars.join(', ')}`);
  }

  // Side-effect calls (props called, services invoked, etc.)
  const effects = extractEffectCalls(symbol);
  if (effects.length > 0) {
    // Cap at 6 to avoid noise
    const effectStr = effects.slice(0, 6).join(', ');
    parts.push(`Effects: ${effectStr}`);
  }

  // Throws
  if (symbol.throws && symbol.throws.length > 0) {
    parts.push(`Throws: ${symbol.throws.join(', ')}`);
  }

  // Members (for classes/components — child symbol names only)
  const children = allSymbols.filter(s => s.parentSymbol === symbol.name);
  if (children.length > 0) {
    const memberNames = children
      .filter(c => ['method', 'function', 'getter', 'setter'].includes(c.kind))
      .map(c => (c.isAsync ? `async ${c.name}` : c.name));
    if (memberNames.length > 0) {
      parts.push(`Members: ${memberNames.join(', ')}`);
    }
  }

  return parts.join(' | ');
}
