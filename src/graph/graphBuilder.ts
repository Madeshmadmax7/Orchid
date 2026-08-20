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

  // ── Phase 2: Add symbol nodes for exported classes/functions ───────
  for (const file of files) {
    const normalizedPath = normalizePath(file.filePath);
    for (const symbol of file.symbols) {
      if (
        symbol.isExported &&
        (symbol.kind === 'class' ||
          symbol.kind === 'function' ||
          symbol.kind === 'react-component' ||
          symbol.kind === 'interface')
      ) {
        const symbolNode: GraphNode = {
          id: `symbol:${symbol.name}`,
          label: symbol.name,
          kind: symbol.kind,
          filePath: normalizedPath,
          componentType: file.fileType,
        };
        graph.addNode(symbolNode);

        // Link symbol to its file
        graph.addEdge(
          `file:${normalizedPath}`,
          `symbol:${symbol.name}`,
          'EXPORTS'
        );
      }
    }
  }

  // ── Phase 3: Add import edges ──────────────────────────────────────
  for (const file of files) {
    const normalizedPath = normalizePath(file.filePath);
    const sourceFileId = `file:${normalizedPath}`;

    for (const imp of file.imports) {
      if (!imp.isLocal) {
        continue; // Skip external imports for now
      }

      // Try to resolve the import target
      const targetPath = resolveImportTarget(imp.resolvedPath, fileByPath);
      if (targetPath) {
        const targetFileId = `file:${targetPath}`;

        // File-level IMPORTS edge
        graph.addEdge(sourceFileId, targetFileId, 'IMPORTS');

        // Symbol-level USES edges for named imports
        for (const specifier of imp.specifiers) {
          if (exportToFile.has(specifier)) {
            graph.addEdge(sourceFileId, `symbol:${specifier}`, 'USES');
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
          if (exportToFile.has(parent)) {
            graph.addEdge(
              `symbol:${symbol.name}`,
              `symbol:${parent}`,
              'EXTENDS'
            );
          }
        }
      }
      if (symbol.heritage?.implements) {
        for (const iface of symbol.heritage.implements) {
          if (exportToFile.has(iface)) {
            graph.addEdge(
              `symbol:${symbol.name}`,
              `symbol:${iface}`,
              'IMPLEMENTS'
            );
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
