// ============================================================================
// Project Memory — Dependency Analyzer
// ============================================================================
// Extracts import declarations, export declarations, dynamic imports, and
// require() calls from TypeScript/JavaScript AST. Resolves local imports
// to workspace-relative paths.
// ============================================================================

import * as ts from 'typescript';
import * as path from 'path';
import { ImportInfo, ExportInfo, SymbolKind } from '../types';

/**
 * Extracts all import declarations from a source file AST.
 *
 * @param sourceFile - Parsed AST
 * @param filePath - Relative path of this file (for resolving relative imports)
 * @returns Array of import information
 */
export function extractImports(
  sourceFile: ts.SourceFile,
  filePath: string
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const usedIdentifiers = new Set<string>();

  function visit(node: ts.Node): void {
    // ── Static imports: import { X } from './module' ─────────────────
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      const source = stripQuotes(node.moduleSpecifier.getText(sourceFile));
      const isLocal = isLocalImport(source);
      const resolvedPath = isLocal
        ? resolveLocalImport(source, filePath)
        : undefined;

      const importInfo: ImportInfo = {
        source,
        specifiers: [],
        isDefault: false,
        isNamespace: false,
        isLocal,
        resolvedPath,
      };

      if (node.importClause) {
        // Default import: import X from './module'
        if (node.importClause.name) {
          importInfo.isDefault = true;
          importInfo.defaultOrNamespaceName =
            node.importClause.name.getText(sourceFile);
          importInfo.specifiers.push(importInfo.defaultOrNamespaceName);
        }

        // Named bindings
        const bindings = node.importClause.namedBindings;
        if (bindings) {
          if (ts.isNamespaceImport(bindings)) {
            // import * as X from './module'
            importInfo.isNamespace = true;
            importInfo.defaultOrNamespaceName =
              bindings.name.getText(sourceFile);
            importInfo.specifiers.push(importInfo.defaultOrNamespaceName);
          } else if (ts.isNamedImports(bindings)) {
            // import { A, B, C } from './module'
            for (const element of bindings.elements) {
              importInfo.specifiers.push(element.name.getText(sourceFile));
            }
          }
        }
      }

      imports.push(importInfo);
      return; // Do NOT recurse into import declaration, so its identifiers aren't marked as "used"
    }

    if (ts.isIdentifier(node)) {
      usedIdentifiers.add(node.text);
    }

    // ── Dynamic imports: import('./module') ──────────────────────────
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        const source = arg.text;
        const isLocal = isLocalImport(source);
        imports.push({
          source,
          specifiers: [],
          isDefault: false,
          isNamespace: false,
          isLocal,
          resolvedPath: isLocal
            ? resolveLocalImport(source, filePath)
            : undefined,
        });
      }
    }

    // ── require() calls: const X = require('./module') ───────────────
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        const source = arg.text;
        const isLocal = isLocalImport(source);
        imports.push({
          source,
          specifiers: [],
          isDefault: true,
          isNamespace: false,
          isLocal,
          resolvedPath: isLocal
            ? resolveLocalImport(source, filePath)
            : undefined,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Mark unused imports
  for (const imp of imports) {
    if (imp.specifiers.length > 0) {
      const isUsed = imp.specifiers.some(s => usedIdentifiers.has(s));
      imp.isUnused = !isUsed;
    } else if (imp.source) {
      // Dynamic import / require with no specifiers assigned to a variable we can track
      // We assume it's used for its side effects unless we have specifiers.
      imp.isUnused = false;
    }
  }

  return imports;
}

/**
 * Extracts all export declarations from a source file AST.
 *
 * @param sourceFile - Parsed AST
 * @returns Array of export information
 */
export function extractExports(sourceFile: ts.SourceFile): ExportInfo[] {
  const exports: ExportInfo[] = [];

  function visit(node: ts.Node): void {
    // ── Export declaration: export { X, Y } from './module' ──────────
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const reExportSource = node.moduleSpecifier
          ? stripQuotes(node.moduleSpecifier.getText(sourceFile))
          : undefined;
        const isReExport = !!reExportSource;

        for (const element of node.exportClause.elements) {
          exports.push({
            name: element.name.getText(sourceFile),
            kind: 'variable', // Can't determine kind from re-exports
            isDefault: false,
            isReExport,
            reExportSource,
          });
        }
      }
      // export * from './module' — barrel export
      if (!node.exportClause && node.moduleSpecifier) {
        exports.push({
          name: '*',
          kind: 'namespace',
          isDefault: false,
          isReExport: true,
          reExportSource: stripQuotes(
            node.moduleSpecifier.getText(sourceFile)
          ),
        });
      }
      return;
    }

    // ── Default export: export default ... ───────────────────────────
    if (ts.isExportAssignment(node)) {
      let name = '<default>';
      if (ts.isIdentifier(node.expression)) {
        name = node.expression.getText(sourceFile);
      }
      exports.push({
        name,
        kind: 'variable',
        isDefault: true,
        isReExport: false,
      });
      return;
    }

    // ── Exported declarations: export class X, export function Y ─────
    if (hasExportKeyword(node)) {
      if (ts.isClassDeclaration(node) && node.name) {
        exports.push({
          name: node.name.getText(sourceFile),
          kind: 'class',
          isDefault: hasDefaultKeyword(node),
          isReExport: false,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        exports.push({
          name: node.name.getText(sourceFile),
          kind: 'function',
          isDefault: hasDefaultKeyword(node),
          isReExport: false,
        });
      } else if (ts.isInterfaceDeclaration(node)) {
        exports.push({
          name: node.name.getText(sourceFile),
          kind: 'interface',
          isDefault: false,
          isReExport: false,
        });
      } else if (ts.isTypeAliasDeclaration(node)) {
        exports.push({
          name: node.name.getText(sourceFile),
          kind: 'type',
          isDefault: false,
          isReExport: false,
        });
      } else if (ts.isEnumDeclaration(node)) {
        exports.push({
          name: node.name.getText(sourceFile),
          kind: 'enum',
          isDefault: false,
          isReExport: false,
        });
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const kind: SymbolKind =
              decl.initializer &&
              (ts.isArrowFunction(decl.initializer) ||
                ts.isFunctionExpression(decl.initializer))
                ? 'function'
                : 'variable';
            exports.push({
              name: decl.name.getText(sourceFile),
              kind,
              isDefault: false,
              isReExport: false,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return exports;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if an import source is a local (relative) import vs external package.
 */
export function isLocalImport(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/');
}

/**
 * Resolves a relative import to a workspace-relative path.
 * Does not verify the file exists — just computes the path.
 */
export function resolveLocalImport(
  importSource: string,
  currentFilePath: string
): string {
  const currentDir = path.dirname(currentFilePath);
  const resolved = path.posix.join(
    currentDir.replace(/\\/g, '/'),
    importSource.replace(/\\/g, '/')
  );
  // Normalize by removing leading ./
  return resolved.replace(/^\.\//, '');
}

function stripQuotes(text: string): string {
  return text.replace(/^['"]|['"]$/g, '');
}

function hasExportKeyword(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultKeyword(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false
  );
}
