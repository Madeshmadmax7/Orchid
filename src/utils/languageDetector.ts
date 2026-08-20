// ============================================================================
// Project Memory — Language Detector
// ============================================================================

import * as path from 'path';
import { Language, LANGUAGE_MAP, SUPPORTED_EXTENSIONS } from '../types';

/**
 * Detects the programming language of a file based on its extension.
 */
export function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] ?? 'unknown';
}

/**
 * Checks if a file is a supported language for analysis.
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Returns the VS Code language ID for a given Language type.
 */
export function toVSCodeLanguageId(language: Language): string {
  switch (language) {
    case 'typescript':
      return 'typescript';
    case 'javascript':
      return 'javascript';
    case 'typescriptreact':
      return 'typescriptreact';
    case 'javascriptreact':
      return 'javascriptreact';
    default:
      return 'plaintext';
  }
}

/**
 * Returns the TypeScript ScriptKind for proper parsing.
 */
export function getScriptKind(language: Language): number {
  // ts.ScriptKind values: Unknown=0, JS=1, JSX=2, TS=3, TSX=4
  switch (language) {
    case 'typescript':
      return 3; // TS
    case 'typescriptreact':
      return 4; // TSX
    case 'javascript':
      return 1; // JS
    case 'javascriptreact':
      return 2; // JSX
    default:
      return 0; // Unknown
  }
}
