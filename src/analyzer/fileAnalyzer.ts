// ============================================================================
// Project Memory — File Analyzer
// ============================================================================
// Orchestrates analysis of a single source file:
// 1. Parse to AST using TypeScript Compiler API
// 2. Extract symbols via symbolAnalyzer
// 3. Extract imports/exports via dependencyAnalyzer
// 4. Classify component type
// 5. Compute content hash
// 6. Return FileMetadata
// ============================================================================

import * as ts from 'typescript';
import { FileMetadata, Language } from '../types';
import { extractSymbols } from './symbolAnalyzer';
import { extractImports, extractExports } from './dependencyAnalyzer';
import { classifyComponent } from './componentClassifier';
import { computeHash, countLinesOfCode } from '../utils/fileUtils';
import { getScriptKind } from '../utils/languageDetector';

/**
 * Analyzes a single source file and returns structured metadata.
 *
 * @param filePath - Workspace-relative file path
 * @param content - File content as string
 * @param language - Detected programming language
 * @returns FileMetadata with all extracted information
 */
export function analyzeFile(
  filePath: string,
  content: string,
  language: Language
): FileMetadata {
  // Parse the source file into an AST
  const scriptKind = getScriptKind(language);
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind as ts.ScriptKind
  );

  // Extract symbols (classes, functions, methods, etc.)
  const symbols = extractSymbols(sourceFile, filePath);

  // Extract imports and exports
  const imports = extractImports(sourceFile, filePath);
  const exports = extractExports(sourceFile);

  // Classify the component type
  const fileType = classifyComponent(filePath, symbols);

  // Compute content hash for change detection
  const hash = computeHash(content);

  // Count lines of code
  const loc = countLinesOfCode(content);

  return {
    filePath,
    language,
    fileType,
    symbols,
    imports,
    exports,
    hash,
    lastAnalyzed: Date.now(),
    loc,
  };
}

/**
 * Checks if the file content has changed by comparing hashes.
 */
export function hasFileChanged(
  content: string,
  existingHash: string
): boolean {
  return computeHash(content) !== existingHash;
}
