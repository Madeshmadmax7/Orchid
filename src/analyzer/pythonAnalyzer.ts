import { SymbolInfo, ImportInfo, ExportInfo } from '../types';
import * as path from 'path';
import { normalizePath } from '../utils/fileUtils';

export function extractPythonSymbols(content: string, filePath: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const lines = content.split('\n');
  const normalizedPath = normalizePath(filePath);

  let currentClass: { name: string; id: string; indent: number } | null = null;
  let currentMethodIndent: number | null = null;
  
  const openSymbols: { symbol: SymbolInfo; indent: number }[] = [];
  let lastNonEmptyLine = 0;

  function generateSymbolId(name: string, kind: string, parentName?: string): string {
    const parentPart = parentName ? `${parentName}.` : '';
    return `${normalizedPath}#${parentPart}${name}:${kind}`;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    if (trimmed.length > 0) {
      while (openSymbols.length > 0 && indent <= openSymbols[openSymbols.length - 1].indent) {
        openSymbols.pop()!.symbol.endLine = lastNonEmptyLine;
      }
      lastNonEmptyLine = i + 1;
    }

    if (currentMethodIndent !== null && indent <= currentMethodIndent) {
      if (trimmed.length > 0) {
        currentMethodIndent = null;
      }
    }

    if (currentClass && indent <= currentClass.indent) {
      if (trimmed.length > 0) {
        currentClass = null;
        currentMethodIndent = null;
      }
    }

    const classMatch = line.match(/^\s*class\s+([A-Za-z0-9_]+)(?:\((.*?)\))?:/);
    if (classMatch) {
      const name = classMatch[1];
      const extendsStr = classMatch[2] ? classMatch[2].split(',').map(s => s.trim()) : undefined;
      const id = generateSymbolId(name, 'class');

      const sym: SymbolInfo = {
        id,
        name,
        kind: 'class',
        startLine: i + 1,
        endLine: i + 1, // Will be updated by dedent logic
        isExported: true,
        heritage: extendsStr ? { extends: extendsStr } : undefined,
      };
      symbols.push(sym);
      openSymbols.push({ symbol: sym, indent });

      currentClass = { name, id, indent };
      continue;
    }

    const defMatch = line.match(/^\s*(async\s+)?def\s+([A-Za-z0-9_]+)\s*\((.*?)\)(?:\s*->\s*(.*?))?:/);
    if (defMatch) {
      const isAsync = !!defMatch[1];
      const name = defMatch[2];
      const params = defMatch[3] ? defMatch[3].split(',').map(s => s.trim()) : [];
      const returnType = defMatch[4]?.trim();

      const isMethod = currentClass !== null && indent > currentClass.indent;
      const kind = isMethod ? 'method' : 'function';
      const parentSymbol = isMethod ? currentClass!.name : undefined;
      const parentId = isMethod ? currentClass!.name : undefined;
      
      if (isMethod) {
        currentMethodIndent = indent;
      }
      
      const id = generateSymbolId(name, kind, parentId);

      const decorators = [];
      let decLineIdx = i - 1;
      while (decLineIdx >= 0) {
        const decLine = lines[decLineIdx].trim();
        if (decLine.startsWith('@')) {
          decorators.push(decLine.substring(1));
          decLineIdx--;
        } else {
          break;
        }
      }

      const sym: SymbolInfo = {
        id,
        name,
        kind,
        startLine: decorators.length > 0 ? (i + 1 - decorators.length) : i + 1,
        endLine: i + 1, // Will be updated
        parameters: params,
        returnType,
        isExported: true,
        isAsync,
        parentSymbol,
        decorators: decorators.length > 0 ? decorators : undefined,
      };
      symbols.push(sym);
      openSymbols.push({ symbol: sym, indent });
      continue;
    }

    if (currentClass && currentMethodIndent === null && indent > currentClass.indent) {
      const propMatch = line.match(/^\s*([A-Za-z0-9_]+)\s*(?::\s*([^=]+))?(?:\s*=\s*(.*))?$/);
      if (propMatch) {
        const propName = propMatch[1];
        const propType = propMatch[2] ? propMatch[2].trim() : undefined;
        const propValue = propMatch[3] ? propMatch[3].trim() : undefined;
        const keywords = ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except', 'finally', 'pass', 'break', 'continue', 'import', 'from', 'global', 'nonlocal', 'assert', 'yield', 'raise', 'del', 'async', 'await'];
        
        if (!keywords.includes(propName) && (propType || propValue)) {
          const id = generateSymbolId(propName, 'property', currentClass.name);
          let summary = undefined;
          if (propType && propValue) summary = `${propName}: ${propType} = ${propValue}`;
          else if (propType) summary = `${propName}: ${propType}`;
          else if (propValue) summary = `${propName} = ${propValue}`;

          symbols.push({
            id,
            name: propName,
            kind: 'property',
            startLine: i + 1,
            endLine: i + 1,
            isExported: true,
            parentSymbol: currentClass.name,
            returnType: propType,
            summary: summary
          });
          continue;
        }
      }
    }

    const assignMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)/);
    if (assignMatch && indent === 0) {
      const name = assignMatch[1];
      const id = generateSymbolId(name, 'constant');
      symbols.push({
        id,
        name,
        kind: 'constant',
        startLine: i + 1,
        endLine: i + 1,
        isExported: true,
      });
    }
  }

  while (openSymbols.length > 0) {
    openSymbols.pop()!.symbol.endLine = lastNonEmptyLine || 1;
  }

  return symbols;
}

export function extractPythonImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    
    const fromMatch = trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.*)/);
    if (fromMatch) {
      const source = fromMatch[1];
      const specifiersStr = fromMatch[2];
      const specifiers = specifiersStr.split(',').map(s => s.trim().replace(/as\s+.*$/, '').trim());
      
      imports.push({
        source,
        specifiers,
        isDefault: false,
        isNamespace: false,
        isLocal: false,
      });
      continue;
    }

    const importMatch = trimmed.match(/^import\s+(.*)/);
    if (importMatch && !trimmed.startsWith('from ')) {
      const specifiersStr = importMatch[1];
      const specifiers = specifiersStr.split(',').map(s => s.trim().replace(/as\s+.*$/, '').trim());
      
      imports.push({
        source: specifiers[0],
        specifiers: [],
        isDefault: true,
        isNamespace: true,
        defaultOrNamespaceName: specifiers[0],
        isLocal: false,
      });
    }
  }

  return imports;
}

export function extractPythonExports(content: string): ExportInfo[] {
  return [];
}
