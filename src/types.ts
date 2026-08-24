// ============================================================================
// Project Memory — Shared Types
// ============================================================================

/**
 * Supported programming languages.
 * Architected for extensibility — add new languages here.
 */
export type Language =
  | 'typescript'
  | 'javascript'
  | 'typescriptreact'
  | 'javascriptreact'
  | 'python'
  | 'unknown';

/**
 * Component classification for files.
 */
export type ComponentType =
  | 'service'
  | 'controller'
  | 'repository'
  | 'component'
  | 'utility'
  | 'middleware'
  | 'hook'
  | 'module'
  | 'model'
  | 'gateway'
  | 'handler'
  | 'test'
  | 'config'
  | 'decorator'
  | 'guard'
  | 'pipe'
  | 'interceptor'
  | 'interface'
  | 'enum'
  | 'type'
  | 'constant'
  | 'main'
  | 'unknown';

/**
 * Symbol kinds extracted from AST.
 */
export type SymbolKind =
  | 'class'
  | 'function'
  | 'method'
  | 'property'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'constructor'
  | 'getter'
  | 'setter'
  | 'namespace'
  | 'react-component';

/**
 * Relationship types for the dependency graph.
 */
export type RelationshipType =
  | 'IMPORTS'
  | 'EXPORTS'
  | 'CALLS'
  | 'USES'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'DEPENDS_ON'
  | 'QUERIES'
  | 'CALLS_API'
  | 'RENDERS'
  | 'COMPOSES'
  | 'CONTAINS';

// ============================================================================
// Symbol Information
// ============================================================================

export interface SymbolInfo {
  /** Stable unique identifier (fileId#parentId.name:kind) */
  id: string;
  /** Content hash of the symbol's AST body for incremental indexing */
  hash?: string;
  /** Symbol name */
  name: string;
  /** Kind of symbol */
  kind: SymbolKind;
  /** Start line (1-indexed) */
  startLine: number;
  /** End line (1-indexed) */
  endLine: number;
  /** Parameter names (for functions/methods) */
  parameters?: string[];
  /** Return type as string */
  returnType?: string;
  /** Whether the symbol is exported */
  isExported: boolean;
  /** Whether the symbol is async */
  isAsync?: boolean;
  /** Whether the symbol is static (for methods) */
  isStatic?: boolean;
  /** Parent symbol name (e.g., class name for methods) */
  parentSymbol?: string;
  /** Decorators applied to this symbol */
  decorators?: string[];
  /** Heritage clauses (extends/implements) */
  heritage?: {
    extends?: string[];
    implements?: string[];
  };
  /** Outgoing calls from this symbol (e.g., 'PaymentService.verify') */
  calls?: string[];
  /** Error signals (e.g. string literals from throw statements) */
  throws?: string[];
  /** AI generated description of this specific symbol */
  summary?: string;
}

// ============================================================================
// Import / Export Information
// ============================================================================

export interface ImportInfo {
  /** Module specifier (e.g., './payment.service' or 'express') */
  source: string;
  /** Named import specifiers */
  specifiers: string[];
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean;
  /** The namespace/default name if applicable */
  defaultOrNamespaceName?: string;
  /** Resolved path within workspace (null if external) */
  resolvedPath?: string;
  /** Whether the import is from a local file (vs node_modules) */
  isLocal: boolean;
  /** True if none of the specifiers appear to be used in the file */
  isUnused?: boolean;
}

export interface ExportInfo {
  /** Exported name */
  name: string;
  /** Kind of exported symbol */
  kind: SymbolKind;
  /** Whether this is the default export */
  isDefault: boolean;
  /** Whether this is a re-export */
  isReExport: boolean;
  /** Source module for re-exports */
  reExportSource?: string;
}

// ============================================================================
// File Metadata
// ============================================================================

export interface FileMetadata {
  /** Path relative to workspace root */
  filePath: string;
  /** Detected programming language */
  language: Language;
  /** Classified component type */
  fileType: ComponentType;
  /** Extracted symbols */
  symbols: SymbolInfo[];
  /** Import declarations */
  imports: ImportInfo[];
  /** Export declarations */
  exports: ExportInfo[];
  /** Content hash (SHA-256) for change detection */
  hash: string;
  /** Timestamp of last analysis */
  lastAnalyzed: number;
  /** Lines of code */
  loc: number;
  /** AI-generated summary (Phase 2+) */
  summary?: string;
}

// ============================================================================
// Dependency Graph
// ============================================================================

export interface DependencyEdge {
  /** Source node ID (file path or symbol name) */
  source: string;
  /** Target node ID (file path or symbol name) */
  target: string;
  /** Relationship type */
  type: RelationshipType;
  /** Optional metadata about the edge */
  metadata?: Record<string, string>;
}

export interface GraphNode {
  /** Unique node identifier */
  id: string;
  /** Display label */
  label: string;
  /** Node type (file, class, function, etc.) */
  kind: 'file' | SymbolKind;
  /** File path (for file nodes or symbol location) */
  filePath?: string;
  /** Component type if applicable */
  componentType?: ComponentType;
}

export interface SerializedGraph {
  nodes: GraphNode[];
  edges: DependencyEdge[];
  version: string;
}

// ============================================================================
// Project Metadata
// ============================================================================

export interface ProjectMetadata {
  /** Project name (workspace folder name) */
  projectName: string;
  /** Absolute path to workspace root */
  rootPath: string;
  /** Language distribution (language → file count) */
  languages: Partial<Record<Language, number>>;
  /** Total number of indexed files */
  totalFiles: number;
  /** Total number of extracted symbols */
  totalSymbols: number;
  /** Total number of dependency edges */
  totalDependencies: number;
  /** Timestamp of last full analysis */
  lastFullAnalysis: number;
  /** Timestamp of last incremental update */
  lastIncrementalUpdate: number;
  /** Component type distribution */
  componentTypes: Partial<Record<ComponentType, number>>;
  /** Schema version for migration support */
  version: string;
}

// ============================================================================
// Analysis Result
// ============================================================================

export interface AnalysisResult {
  projectMetadata: ProjectMetadata;
  fileCount: number;
  symbolCount: number;
  dependencyCount: number;
  durationMs: number;
  errors: AnalysisError[];
}

export interface AnalysisError {
  filePath: string;
  error: string;
  phase: 'parse' | 'analyze' | 'classify' | 'store';
}

// ============================================================================
// Constants
// ============================================================================

export const SCHEMA_VERSION = '2.0.0';
export const STORAGE_DIR = '.project-memory';
export const FILES_DIR = 'files';
export const PROJECT_FILE = 'project.json';
export const GRAPH_FILE = 'graph.json';

/** Extension file mappings */
export const LANGUAGE_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
};

/** Supported file extensions for analysis */
export const SUPPORTED_EXTENSIONS = Object.keys(LANGUAGE_MAP);

// ============================================================================
// Retrieval & Query Types (Phase 3)
// ============================================================================

export interface RetrievedContext {
  id: string;
  type: 'symbol' | 'file';
  content: string;
  relevanceScore: number;
  filePath: string;
  metadata?: Record<string, any>;
  
  // Optional raw objects for dynamic multi-level context representation
  symbolInfo?: SymbolInfo;
  fileMeta?: FileMetadata;
}

export type QueryIntent =
  | 'CALLERS'
  | 'DEPENDENCIES'
  | 'DEPENDENTS'
  | 'USAGE'
  | 'EXPLAIN'
  | 'ERROR_VALIDATION'
  | 'MODIFICATION'
  | 'TRACE'
  | 'GENERAL';

export interface RetrievalQuery {
  rawQuery: string;
  keywords: string[];
  targetSymbols: string[];
  /** Source symbols for TRACE queries (e.g. the API endpoint in "how does X reach Y") */
  sourceSymbols?: string[];
  targetFiles: string[];
  intent: QueryIntent;
  concepts: string[];
  maxResults?: number;
  /** Graph node IDs of explicitly resolved targets (set by HybridRetriever after resolution) */
  resolvedTargetIds?: Set<string>;
}

