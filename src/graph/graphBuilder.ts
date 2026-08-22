// ============================================================================
// Project Memory — Graph Builder
// ============================================================================
// Constructs the dependency graph from file metadata.
// Creates nodes for files and exported symbols, then edges for
// imports, extends, implements, and inferred relationships.
// ============================================================================

import { FileMetadata, GraphNode } from '../types';
import { DependencyGraph } from './dependencyGraph';
import { normalizePath } from '../utils/fileUtils';

/**
 * Builds a dependency graph from analyzed file metadata.
 *
 * @param files - All analyzed file metadata
 * @returns Constructed dependency graph
 */
export function buildGraph(files: FileMetadata[]): DependencyGraph {
  const graph = new DependencyGraph();

  // Build lookup maps
  const fileByPath = new Map<string, FileMetadata>();
  const exportToFile = new Map<string, string>(); // symbol name → file path

  for (const file of files) {
    const normalizedPath = normalizePath(file.filePath);
    fileByPath.set(normalizedPath, file);

    // Register exported symbols
    for (const exp of file.exports) {
      if (exp.name !== '*') {
        exportToFile.set(exp.name, normalizedPath);
      }
    }
  }

  // ── Phase 1: Add file nodes ────────────────────────────────────────
  for (const file of files) {
    const normalizedPath = normalizePath(file.filePath);
    const fileNode: GraphNode = {
      id: `file:${normalizedPath}`,
      label: normalizedPath.split('/').pop() ?? normalizedPath,
      kind: 'file',
      filePath: normalizedPath,
      componentType: file.fileType,
    };
    graph.addNode(fileNode);
  }

  // ── Phase 2: Add symbol nodes ───────
  for (const file of files) {
    const normalizedPath = normalizePath(file.filePath);
    for (const symbol of file.symbols) {
      const isTopLevelExport = symbol.isExported && ['class', 'function', 'react-component', 'interface'].includes(symbol.kind);
      const isMethod = ['method', 'property', 'getter', 'setter'].includes(symbol.kind);
      
      if (isTopLevelExport || isMethod) {
        const symbolNode: GraphNode = {
          id: `symbol:${symbol.id}`,
          label: symbol.parentSymbol ? `${symbol.parentSymbol}.${symbol.name}` : symbol.name,
          kind: symbol.kind,
          filePath: normalizedPath,
          componentType: file.fileType,
        };
        graph.addNode(symbolNode);

        // Link symbol to its file or parent
        if (isTopLevelExport) {
          graph.addEdge(`file:${normalizedPath}`, `symbol:${symbol.id}`, 'EXPORTS');
        } else if (isMethod && symbol.parentSymbol) {
          // Find the parent class id in the same file
          const parentSymbol = file.symbols.find(s => s.name === symbol.parentSymbol);
          if (parentSymbol) {
            graph.addEdge(`symbol:${parentSymbol.id}`, `symbol:${symbol.id}`, 'CONTAINS');
          }
        }
      }
    }
  }

  // Build lookup maps for fast resolution
  const topLevelExportByName = new Map<string, string>(); // name -> id
  
  for (const file of files) {
    for (const symbol of file.symbols) {
      if (symbol.isExported) {
        topLevelExportByName.set(symbol.name, `symbol:${symbol.id}`);
      }
    }
  }

  // ── Phase 3: Add import edges ──────────────────────────────────────
  for (const file of files) {
    const normalizedPath = normalizePath(file.filePath);
    const sourceFileId = `file:${normalizedPath}`;

    for (const imp of file.imports) {
      if (!imp.isLocal) continue;

      const targetPath = resolveImportTarget(imp.resolvedPath, fileByPath);
      if (targetPath) {
        const targetFileId = `file:${targetPath}`;
        graph.addEdge(sourceFileId, targetFileId, 'IMPORTS');

        for (const specifier of imp.specifiers) {
          const targetId = topLevelExportByName.get(specifier);
          if (targetId) {
            graph.addEdge(sourceFileId, targetId, 'USES');
          }
        }
      }
    }
  }

  // ── Phase 4: Add inheritance edges ─────────────────────────────────
  for (const file of files) {
    for (const symbol of file.symbols) {
      if (symbol.heritage?.extends) {
        for (const parent of symbol.heritage.extends) {
          const parentId = topLevelExportByName.get(parent);
          if (parentId) graph.addEdge(`symbol:${symbol.id}`, parentId, 'EXTENDS');
        }
      }
      if (symbol.heritage?.implements) {
        for (const iface of symbol.heritage.implements) {
          const ifaceId = topLevelExportByName.get(iface);
          if (ifaceId) graph.addEdge(`symbol:${symbol.id}`, ifaceId, 'IMPLEMENTS');
        }
      }
    }
  }

  // ── Phase 5: Add calls edges (AST static resolution) ────────────────────────
  for (const file of files) {
    for (const symbol of file.symbols) {
      if (!symbol.calls) continue;

      for (const call of symbol.calls) {
        // High confidence direct match to top-level export
        if (topLevelExportByName.has(call)) {
          graph.addEdge(`symbol:${symbol.id}`, topLevelExportByName.get(call)!, 'CALLS');
        } 
        // Resolve Class Property Method Call: e.g. "this.paymentService.verifyPayment"
        else if (call.startsWith('this.')) {
          const parts = call.substring(5).split('.');
          if (parts.length === 2 && symbol.parentSymbol) {
            const [propName, methodName] = parts;
            // 1. Find the property on the current class to get its type
            const prop = file.symbols.find(s => s.parentSymbol === symbol.parentSymbol && s.name === propName && s.kind === 'property');
            if (prop && prop.returnType) {
              const targetClassType = prop.returnType.replace(/[^a-zA-Z0-9_]/g, ''); // strip arrays/generics loosely
              // 2. Find the target class in exported symbols
              const targetClassId = topLevelExportByName.get(targetClassType);
              if (targetClassId) {
                // 3. Find the target method in the target class's file
                const targetFile = files.find(f => normalizePath(f.filePath) === normalizePath(targetClassId.split('#')[0].replace('symbol:', '')));
                if (targetFile) {
                  const targetMethod = targetFile.symbols.find(s => s.parentSymbol === targetClassType && s.name === methodName);
                  if (targetMethod) {
                    graph.addEdge(`symbol:${symbol.id}`, `symbol:${targetMethod.id}`, 'CALLS');
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return graph;
}

/**
 * Tries to resolve an import path to a known file path.
 * Handles missing extensions by trying common suffixes.
 */
function resolveImportTarget(
  resolvedPath: string | undefined,
  fileByPath: Map<string, FileMetadata>
): string | undefined {
  if (!resolvedPath) {
    return undefined;
  }

  const normalized = normalizePath(resolvedPath);

  // Direct match
  if (fileByPath.has(normalized)) {
    return normalized;
  }

  // Try with extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensions) {
    const withExt = normalized + ext;
    if (fileByPath.has(withExt)) {
      return withExt;
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = `${normalized}/index${ext}`;
    if (fileByPath.has(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}
