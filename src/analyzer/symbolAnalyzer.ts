// ============================================================================
// Project Memory — Symbol Analyzer
// ============================================================================
// Extracts classes, functions, methods, interfaces, types, enums, and
// React components from a TypeScript/JavaScript AST.
// Uses the TypeScript Compiler API directly for zero-dependency parsing.
// ============================================================================

import * as ts from 'typescript';
import { SymbolInfo, SymbolKind } from '../types';

/**
 * Extracts all symbols from a TypeScript/JavaScript source file AST.
 *
 * @param sourceFile - Parsed AST from ts.createSourceFile
 * @returns Array of extracted symbol information
 */
export function extractSymbols(sourceFile: ts.SourceFile): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];

  function visit(node: ts.Node, parentName?: string): void {
    // ── Classes ──────────────────────────────────────────────────────────
    if (ts.isClassDeclaration(node)) {
      const name = node.name?.getText(sourceFile) ?? '<anonymous>';
      const heritage = extractHeritage(node, sourceFile);
      const decorators = extractDecorators(node, sourceFile);

      symbols.push({
        name,
        kind: 'class',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
        decorators,
        heritage,
      });

      // Extract class members
      node.members.forEach((member) => {
        extractClassMember(member, name, sourceFile, symbols);
      });
      return; // Don't recurse further inside class body
    }

    // ── Function declarations ────────────────────────────────────────────
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile);
      const isReactComponent = hasJsxReturn(node, sourceFile);

      symbols.push({
        name,
        kind: isReactComponent ? 'react-component' : 'function',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        parameters: extractParameters(node, sourceFile),
        returnType: extractReturnType(node, sourceFile),
        isExported: hasExportModifier(node),
        isAsync: hasAsyncModifier(node),
        decorators: extractDecorators(node, sourceFile),
        parentSymbol: parentName,
      });
      return;
    }

    // ── Variable statements with arrow functions / function expressions ──
    if (ts.isVariableStatement(node)) {
      const isExported = hasExportModifier(node);
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isVariableDeclaration(decl) &&
          decl.name &&
          ts.isIdentifier(decl.name) &&
          decl.initializer
        ) {
          const name = decl.name.getText(sourceFile);
          const init = decl.initializer;

          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
            const isReactComponent = hasJsxReturn(init, sourceFile);
            const isConst =
              (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

            symbols.push({
              name,
              kind: isReactComponent
                ? 'react-component'
                : isConst
                  ? 'constant'
                  : 'function',
              startLine: getStartLine(node, sourceFile),
              endLine: getEndLine(node, sourceFile),
              parameters: extractParameters(init, sourceFile),
              returnType: extractReturnType(init, sourceFile),
              isExported,
              isAsync: hasAsyncModifier(init),
              parentSymbol: parentName,
            });
          } else {
            // Regular variable/constant declaration
            const isConst =
              (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
            symbols.push({
              name,
              kind: isConst ? 'constant' : 'variable',
              startLine: getStartLine(decl, sourceFile),
              endLine: getEndLine(decl, sourceFile),
              isExported,
              parentSymbol: parentName,
            });
          }
        }
      }
      return;
    }

    // ── Interface declarations ───────────────────────────────────────────
    if (ts.isInterfaceDeclaration(node)) {
      symbols.push({
        name: node.name.getText(sourceFile),
        kind: 'interface',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
        heritage: extractInterfaceHeritage(node, sourceFile),
      });
      return;
    }

    // ── Type alias declarations ──────────────────────────────────────────
    if (ts.isTypeAliasDeclaration(node)) {
      symbols.push({
        name: node.name.getText(sourceFile),
        kind: 'type',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
      });
      return;
    }

    // ── Enum declarations ────────────────────────────────────────────────
    if (ts.isEnumDeclaration(node)) {
      symbols.push({
        name: node.name.getText(sourceFile),
        kind: 'enum',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
      });
      return;
    }

    // ── Module/Namespace declarations ────────────────────────────────────
    if (ts.isModuleDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.getText(sourceFile),
        kind: 'namespace',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
      });
    }

    // Recurse into children
    ts.forEachChild(node, (child) => visit(child, parentName));
  }

  visit(sourceFile);
  return symbols;
}

// ============================================================================
// Class Member Extraction
// ============================================================================

function extractClassMember(
  member: ts.ClassElement,
  className: string,
  sourceFile: ts.SourceFile,
  symbols: SymbolInfo[]
): void {
  // Constructor
  if (ts.isConstructorDeclaration(member)) {
    symbols.push({
      name: 'constructor',
      kind: 'constructor',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      parameters: extractParameters(member, sourceFile),
      isExported: false,
      parentSymbol: className,
    });
    return;
  }

  // Methods
  if (ts.isMethodDeclaration(member) && member.name) {
    const name = member.name.getText(sourceFile);
    symbols.push({
      name,
      kind: 'method',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      parameters: extractParameters(member, sourceFile),
      returnType: extractReturnType(member, sourceFile),
      isExported: false,
      isAsync: hasAsyncModifier(member),
      isStatic: hasStaticModifier(member),
      parentSymbol: className,
      decorators: extractDecorators(member, sourceFile),
    });
    return;
  }

  // Properties
  if (ts.isPropertyDeclaration(member) && member.name) {
    const name = member.name.getText(sourceFile);
    symbols.push({
      name,
      kind: 'property',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      isExported: false,
      isStatic: hasStaticModifier(member),
      parentSymbol: className,
      decorators: extractDecorators(member, sourceFile),
    });
    return;
  }

  // Getters
  if (ts.isGetAccessorDeclaration(member) && member.name) {
    symbols.push({
      name: member.name.getText(sourceFile),
      kind: 'getter',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      isExported: false,
      parentSymbol: className,
    });
    return;
  }

  // Setters
  if (ts.isSetAccessorDeclaration(member) && member.name) {
    symbols.push({
      name: member.name.getText(sourceFile),
      kind: 'setter',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      isExported: false,
      parentSymbol: className,
    });
  }
}

// ============================================================================
// AST Helper Functions
// ============================================================================

function getStartLine(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function getEndLine(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasAsyncModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

function hasStaticModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
}

function extractParameters(
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile
): string[] {
  return node.parameters.map((p) => {
    const name = p.name.getText(sourceFile);
    const type = p.type ? `: ${p.type.getText(sourceFile)}` : '';
    return `${name}${type}`;
  });
}

function extractReturnType(
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile
): string | undefined {
  if (node.type) {
    return node.type.getText(sourceFile);
  }
  return undefined;
}

function extractDecorators(
  node: ts.Node,
  sourceFile: ts.SourceFile
): string[] | undefined {
  if (!ts.canHaveDecorators(node)) {
    return undefined;
  }
  const decorators = ts.getDecorators(node);
  if (!decorators || decorators.length === 0) {
    return undefined;
  }
  return decorators.map((d) => {
    if (ts.isCallExpression(d.expression)) {
      return d.expression.expression.getText(sourceFile);
    }
    return d.expression.getText(sourceFile);
  });
}

function extractHeritage(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): SymbolInfo['heritage'] | undefined {
  if (!node.heritageClauses || node.heritageClauses.length === 0) {
    return undefined;
  }

  const heritage: SymbolInfo['heritage'] = {};

  for (const clause of node.heritageClauses) {
    const names = clause.types.map((t) => t.expression.getText(sourceFile));
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      heritage.extends = names;
    } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
      heritage.implements = names;
    }
  }

  return Object.keys(heritage).length > 0 ? heritage : undefined;
}

function extractInterfaceHeritage(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile
): SymbolInfo['heritage'] | undefined {
  if (!node.heritageClauses || node.heritageClauses.length === 0) {
    return undefined;
  }

  const heritage: SymbolInfo['heritage'] = {};
  for (const clause of node.heritageClauses) {
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      heritage.extends = clause.types.map((t) =>
        t.expression.getText(sourceFile)
      );
    }
  }

  return Object.keys(heritage).length > 0 ? heritage : undefined;
}

/**
 * Checks if a function-like declaration returns JSX (React component heuristic).
 */
function hasJsxReturn(node: ts.Node, _sourceFile: ts.SourceFile): boolean {
  let foundJsx = false;

  function checkNode(n: ts.Node): void {
    if (foundJsx) {
      return;
    }
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      foundJsx = true;
      return;
    }
    // Check parenthesized JSX (common pattern: return (<div>...</div>))
    if (ts.isParenthesizedExpression(n)) {
      ts.forEachChild(n, checkNode);
      return;
    }
    // Check return statements
    if (ts.isReturnStatement(n) && n.expression) {
      checkNode(n.expression);
      return;
    }
    ts.forEachChild(n, checkNode);
  }

  // For arrow functions with expression body (no block)
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.body &&
    !ts.isBlock(node.body)
  ) {
    checkNode(node.body);
  } else {
    ts.forEachChild(node, checkNode);
  }

  return foundJsx;
}
