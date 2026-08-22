// ============================================================================
// Project Memory — Symbol Analyzer
// ============================================================================
// Extracts classes, functions, methods, interfaces, types, enums, and
// React components from a TypeScript/JavaScript AST.
// Uses the TypeScript Compiler API directly for zero-dependency parsing.
// ============================================================================

import * as ts from 'typescript';
import { SymbolInfo, SymbolKind } from '../types';
import { computeHash, normalizePath } from '../utils/fileUtils';

/**
 * Extracts all symbols from a TypeScript/JavaScript source file AST.
 *
 * @param sourceFile - Parsed AST from ts.createSourceFile
 * @returns Array of extracted symbol information
 */
export function extractSymbols(sourceFile: ts.SourceFile, filePath: string = ''): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const normalizedPath = filePath ? normalizePath(filePath) : '';

  function generateSymbolId(name: string, kind: string, parentName?: string): string {
    const parentPart = parentName ? `${parentName}.` : '';
    return `${normalizedPath}#${parentPart}${name}:${kind}`;
  }

  function extractJSDocSummary(node: ts.Node): string | undefined {
    // For variable declarations, JSDoc is typically attached to the VariableStatement (node.parent.parent)
    const targetNode = ts.isVariableDeclaration(node) ? node.parent.parent : node;
    const jsDocArray = (targetNode as any).jsDoc;
    
    if (jsDocArray && Array.isArray(jsDocArray) && jsDocArray.length > 0) {
      const lastDoc = jsDocArray[jsDocArray.length - 1];
      let comment = '';
      if (typeof lastDoc.comment === 'string') {
        comment = lastDoc.comment;
      } else if (Array.isArray(lastDoc.comment)) {
        comment = lastDoc.comment.map((c: any) => c.text).join('');
      }
      
      if (comment) {
        comment = comment.replace(/\r?\n/g, ' ').trim();
        // Extract the first sentence for a concise behavior-focused summary
        const sentenceMatch = comment.match(/^.*?[.?!](?:\s|$)/);
        return sentenceMatch ? sentenceMatch[0].trim() : comment;
      }
    }
    return undefined;
  }

  function extractCalls(node: ts.Node, sourceFile: ts.SourceFile): string[] {
    const calls = new Set<string>();

    function visit(child: ts.Node): void {
      if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
        const expr = child.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          const obj = expr.expression.getText(sourceFile);
          const prop = expr.name.getText(sourceFile);
          calls.add(obj === 'this' ? `this.${prop}` : `${obj}.${prop}`);
        } else if (ts.isIdentifier(expr)) {
          calls.add(expr.text);
        }
      }
      ts.forEachChild(child, visit);
    }
    
    ts.forEachChild(node, visit);
    return Array.from(calls);
  }

  function extractThrows(node: ts.Node, sourceFile: ts.SourceFile): string[] {
    const throwsList = new Set<string>();

    function visit(child: ts.Node): void {
      if (ts.isThrowStatement(child)) {
        if (child.expression && ts.isNewExpression(child.expression) && child.expression.arguments && child.expression.arguments.length > 0) {
          const arg = child.expression.arguments[0];
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            throwsList.add(arg.text);
          }
        }
      }
      ts.forEachChild(child, visit);
    }
    
    ts.forEachChild(node, visit);
    return Array.from(throwsList);
  }

  function pushSymbol(base: Omit<SymbolInfo, 'id' | 'hash' | 'calls' | 'throws'>, node: ts.Node): void {
    const id = generateSymbolId(base.name, base.kind, base.parentSymbol);
    const hash = computeHash(node.getText(sourceFile));
    const jsDocSummary = extractJSDocSummary(node);
    
    const calls = ['function', 'method', 'constructor', 'getter', 'setter', 'react-component'].includes(base.kind) 
      ? extractCalls(node, sourceFile) 
      : undefined;

    const rawThrows = ['function', 'method', 'constructor', 'getter', 'setter', 'react-component'].includes(base.kind) 
      ? extractThrows(node, sourceFile) 
      : undefined;
    const throwsArray = rawThrows && rawThrows.length > 0 ? rawThrows : undefined;
    
    const symbolInfo: SymbolInfo = { ...base, id, hash, calls, throws: throwsArray };
    if (jsDocSummary) {
      symbolInfo.summary = jsDocSummary;
    }
    symbols.push(symbolInfo);
  }

  function visit(node: ts.Node, parentName?: string): void {
    // ── Classes ──────────────────────────────────────────────────────────
    if (ts.isClassDeclaration(node)) {
      const name = node.name?.getText(sourceFile) ?? '<anonymous>';
      const heritage = extractHeritage(node, sourceFile);
      const decorators = extractDecorators(node, sourceFile);

      pushSymbol({
        name,
        kind: 'class',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
        decorators,
        heritage,
      }, node);

      // Extract class members
      node.members.forEach((member) => {
        extractClassMember(member, name, sourceFile, symbols, normalizedPath);
      });
      return; // Don't recurse further inside class body
    }

    // ── Function declarations ────────────────────────────────────────────
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.getText(sourceFile);
      const isReactComponent = hasJsxReturn(node, sourceFile);

      pushSymbol({
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
      }, node);
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

            pushSymbol({
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
            }, decl);
          } else {
            // Regular variable/constant declaration
            const isConst =
              (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
            pushSymbol({
              name,
              kind: isConst ? 'constant' : 'variable',
              startLine: getStartLine(decl, sourceFile),
              endLine: getEndLine(decl, sourceFile),
              isExported,
              parentSymbol: parentName,
            }, decl);
          }
        }
      }
      return;
    }

    // ── Interface declarations ───────────────────────────────────────────
    if (ts.isInterfaceDeclaration(node)) {
      pushSymbol({
        name: node.name.getText(sourceFile),
        kind: 'interface',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
        heritage: extractInterfaceHeritage(node, sourceFile),
      }, node);
      return;
    }

    // ── Type alias declarations ──────────────────────────────────────────
    if (ts.isTypeAliasDeclaration(node)) {
      pushSymbol({
        name: node.name.getText(sourceFile),
        kind: 'type',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
      }, node);
      return;
    }

    // ── Enum declarations ────────────────────────────────────────────────
    if (ts.isEnumDeclaration(node)) {
      pushSymbol({
        name: node.name.getText(sourceFile),
        kind: 'enum',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
      }, node);
      return;
    }

    // ── Module/Namespace declarations ────────────────────────────────────
    if (ts.isModuleDeclaration(node) && node.name) {
      pushSymbol({
        name: node.name.getText(sourceFile),
        kind: 'namespace',
        startLine: getStartLine(node, sourceFile),
        endLine: getEndLine(node, sourceFile),
        isExported: hasExportModifier(node),
      }, node);
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
  symbols: SymbolInfo[],
  normalizedPath: string
): void {
  function generateSymbolId(name: string, kind: string, parentName?: string): string {
    const parentPart = parentName ? `${parentName}.` : '';
    return `${normalizedPath}#${parentPart}${name}:${kind}`;
  }

  function extractJSDocSummary(node: ts.Node): string | undefined {
    const jsDocArray = (node as any).jsDoc;
    if (jsDocArray && Array.isArray(jsDocArray) && jsDocArray.length > 0) {
      const lastDoc = jsDocArray[jsDocArray.length - 1];
      let comment = '';
      if (typeof lastDoc.comment === 'string') {
        comment = lastDoc.comment;
      } else if (Array.isArray(lastDoc.comment)) {
        comment = lastDoc.comment.map((c: any) => c.text).join('');
      }
      
      if (comment) {
        comment = comment.replace(/\r?\n/g, ' ').trim();
        const sentenceMatch = comment.match(/^.*?[.?!](?:\s|$)/);
        return sentenceMatch ? sentenceMatch[0].trim() : comment;
      }
    }
    return undefined;
  }

  function extractCalls(node: ts.Node, sourceFile: ts.SourceFile): string[] {
    const calls = new Set<string>();

    function visit(child: ts.Node): void {
      if (ts.isCallExpression(child) || ts.isNewExpression(child)) {
        const expr = child.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          const obj = expr.expression.getText(sourceFile);
          const prop = expr.name.getText(sourceFile);
          calls.add(obj === 'this' ? `this.${prop}` : `${obj}.${prop}`);
        } else if (ts.isIdentifier(expr)) {
          calls.add(expr.text);
        }
      }
      ts.forEachChild(child, visit);
    }
    
    ts.forEachChild(node, visit);
    return Array.from(calls);
  }

  function extractThrows(node: ts.Node, sourceFile: ts.SourceFile): string[] {
    const throwsList = new Set<string>();

    function visit(child: ts.Node): void {
      if (ts.isThrowStatement(child)) {
        if (child.expression && ts.isNewExpression(child.expression) && child.expression.arguments && child.expression.arguments.length > 0) {
          const arg = child.expression.arguments[0];
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
            throwsList.add(arg.text);
          }
        }
      }
      ts.forEachChild(child, visit);
    }
    
    ts.forEachChild(node, visit);
    return Array.from(throwsList);
  }

  function pushSymbol(base: Omit<SymbolInfo, 'id' | 'hash' | 'calls' | 'throws'>, node: ts.Node): void {
    const id = generateSymbolId(base.name, base.kind, base.parentSymbol);
    const hash = computeHash(node.getText(sourceFile));
    const jsDocSummary = extractJSDocSummary(node);
    const calls = ['method', 'constructor', 'getter', 'setter'].includes(base.kind) 
      ? extractCalls(node, sourceFile) 
      : undefined;

    const rawThrows = ['method', 'constructor', 'getter', 'setter'].includes(base.kind) 
      ? extractThrows(node, sourceFile) 
      : undefined;
    const throwsArray = rawThrows && rawThrows.length > 0 ? rawThrows : undefined;
    
    const symbolInfo: SymbolInfo = { ...base, id, hash, calls, throws: throwsArray };
    if (jsDocSummary) {
      symbolInfo.summary = jsDocSummary;
    }
    symbols.push(symbolInfo);
  }

  // Constructor
  if (ts.isConstructorDeclaration(member)) {
    pushSymbol({
      name: 'constructor',
      kind: 'constructor',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      parameters: extractParameters(member, sourceFile),
      isExported: false,
      parentSymbol: className,
    }, member);
    return;
  }

  // Methods
  if (ts.isMethodDeclaration(member) && member.name) {
    const name = member.name.getText(sourceFile);
    pushSymbol({
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
    }, member);
    return;
  }

  // Properties
  if (ts.isPropertyDeclaration(member) && member.name) {
    const name = member.name.getText(sourceFile);
    let propertyType = member.type?.getText(sourceFile);
    if (!propertyType && member.initializer) {
      if (ts.isNewExpression(member.initializer)) {
        propertyType = member.initializer.expression.getText(sourceFile);
      }
    }
    pushSymbol({
      name,
      kind: 'property',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      returnType: propertyType,
      isExported: false,
      isStatic: hasStaticModifier(member),
      parentSymbol: className,
      decorators: extractDecorators(member, sourceFile),
    }, member);
    return;
  }

  // Getters
  if (ts.isGetAccessorDeclaration(member) && member.name) {
    pushSymbol({
      name: member.name.getText(sourceFile),
      kind: 'getter',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      isExported: false,
      parentSymbol: className,
    }, member);
    return;
  }

  // Setters
  if (ts.isSetAccessorDeclaration(member) && member.name) {
    pushSymbol({
      name: member.name.getText(sourceFile),
      kind: 'setter',
      startLine: getStartLine(member, sourceFile),
      endLine: getEndLine(member, sourceFile),
      isExported: false,
      parentSymbol: className,
    }, member);
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
