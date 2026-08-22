// ============================================================================
// Project Memory — Repository Analyzer
// ============================================================================
// Orchestrates full-project analysis:
// 1. Discovers workspace files using vscode.workspace.findFiles
// 2. Filters by supported languages
// 3. Analyzes each file via fileAnalyzer
// 4. Builds dependency graph
// 5. Persists all data via metadataStore
// 6. Reports progress via vscode.window.withProgress
// ============================================================================

import * as vscode from 'vscode';
import * as path from 'path';
import {
  FileMetadata,
  AnalysisResult,
  AnalysisError,
  SCHEMA_VERSION,
} from '../types';
import { analyzeFile } from './fileAnalyzer';
import { MetadataStore } from '../knowledge/metadataStore';
import { ProjectIndex } from '../knowledge/projectIndex';
import { DependencyGraph } from '../graph/dependencyGraph';
import { buildGraph } from '../graph/graphBuilder';
import { buildExcludeGlob, buildIncludeGlob } from '../utils/ignorePatterns';
import { detectLanguage, isSupportedFile } from '../utils/languageDetector';
import { normalizePath, computeHash } from '../utils/fileUtils';

import { SemanticIndexer } from '../knowledge/semanticIndexer';

/** Batch size for processing files (avoid blocking the event loop) */
const BATCH_SIZE = 50;

/**
 * Orchestrates full project analysis.
 */
export class RepositoryAnalyzer {
  constructor(
    private metadataStore: MetadataStore,
    private projectIndex: ProjectIndex,
    private graph: DependencyGraph,
    private semanticIndexer?: SemanticIndexer
  ) {}

  /**
   * Runs a full project analysis with progress reporting.
   *
   * @param workspaceFolder - The workspace folder to analyze
   * @param token - Cancellation token
   * @returns Analysis result summary
   */
  async analyzeProject(
    workspaceFolder: vscode.WorkspaceFolder,
    token: vscode.CancellationToken
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const errors: AnalysisError[] = [];

    // Initialize storage
    await this.metadataStore.initialize();

    // Discover files
    const includeGlob = buildIncludeGlob();
    const excludeGlob = buildExcludeGlob();

    const fileUris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, includeGlob),
      new vscode.RelativePattern(workspaceFolder, excludeGlob)
    );

    if (token.isCancellationRequested) {
      return this.createCancelledResult(startTime);
    }

    // Filter to supported files
    const supportedFiles = fileUris.filter((uri) =>
      isSupportedFile(uri.fsPath)
    );

    // Analyze files in batches
    const allMetadata: FileMetadata[] = [];
    const totalFiles = supportedFiles.length;

    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
      if (token.isCancellationRequested) {
        return this.createCancelledResult(startTime);
      }

      const batch = supportedFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (uri) => {
          try {
            return await this.analyzeFileUri(uri, workspaceFolder);
          } catch (err) {
            const relativePath = normalizePath(
              path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
            );
            errors.push({
              filePath: relativePath,
              error: err instanceof Error ? err.message : String(err),
              phase: 'analyze',
            });
            return null;
          }
        })
      );

      for (const metadata of batchResults) {
        if (metadata) {
          allMetadata.push(metadata);
        }
      }

      // Yield to the event loop between batches
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (token.isCancellationRequested) {
      return this.createCancelledResult(startTime);
    }

    // Build dependency graph
    this.graph.clear();
    const newGraph = buildGraph(allMetadata);

    // Copy nodes and edges to our graph instance
    for (const node of newGraph.getAllNodes()) {
      this.graph.addNode(node);
    }
    for (const edge of newGraph.getAllEdges()) {
      this.graph.addEdge(edge.source, edge.target, edge.type, edge.metadata);
    }

    // Build in-memory index
    this.projectIndex.build(allMetadata);

    // Persist all data
    await this.persistAll(allMetadata, workspaceFolder);

    // Queue for semantic indexing
    if (this.semanticIndexer) {
      this.semanticIndexer.queueFiles(allMetadata);
    }

    const durationMs = Date.now() - startTime;

    return {
      projectMetadata: this.projectIndex.toProjectMetadata(
        workspaceFolder.name,
        workspaceFolder.uri.fsPath,
        this.graph.edgeCount
      ),
      fileCount: allMetadata.length,
      symbolCount: this.projectIndex.totalSymbols,
      dependencyCount: this.graph.edgeCount,
      durationMs,
      errors,
    };
  }

  /**
   * Analyzes a single file URI and returns metadata.
   */
  private async analyzeFileUri(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<FileMetadata> {
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(contentBytes).toString('utf-8');
    const relativePath = normalizePath(
      path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
    );
    const language = detectLanguage(uri.fsPath);

    const metadata = analyzeFile(relativePath, content, language);
    
    // Preserve existing semantic summaries for unchanged symbols
    const oldMetadata = await this.metadataStore.loadFileMetadata(relativePath);
    if (oldMetadata) {
      if (!metadata.summary && oldMetadata.summary && metadata.hash === oldMetadata.hash) {
        metadata.summary = oldMetadata.summary;
      }
      
      const oldSymbolMap = new Map(oldMetadata.symbols.map(s => [s.id, s]));
      for (const newSymbol of metadata.symbols) {
        const oldSymbol = oldSymbolMap.get(newSymbol.id);
        if (!newSymbol.summary && oldSymbol && oldSymbol.summary && newSymbol.hash === oldSymbol.hash) {
          newSymbol.summary = oldSymbol.summary;
        }
      }
    }

    return metadata;
  }

  /**
   * Re-analyzes only files that have changed since last analysis.
   */
  async incrementalReindex(
    workspaceFolder: vscode.WorkspaceFolder,
    token: vscode.CancellationToken
  ): Promise<{ updated: number; unchanged: number; removed: number }> {
    const includeGlob = buildIncludeGlob();
    const excludeGlob = buildExcludeGlob();

    const fileUris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, includeGlob),
      new vscode.RelativePattern(workspaceFolder, excludeGlob)
    );

    const supportedFiles = fileUris.filter((uri) =>
      isSupportedFile(uri.fsPath)
    );

    let updated = 0;
    let unchanged = 0;
    let removed = 0;

    const currentPaths = new Set<string>();

    for (const uri of supportedFiles) {
      if (token.isCancellationRequested) {
        break;
      }

      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf-8');
      const relativePath = normalizePath(
        path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
      );
      currentPaths.add(relativePath);

      const currentHash = computeHash(content);
      const isStale = await this.metadataStore.isStale(
        relativePath,
        currentHash
      );

      if (isStale) {
        const language = detectLanguage(uri.fsPath);
        const metadata = analyzeFile(relativePath, content, language);

        // Preserve existing semantic summaries for unchanged symbols
        const oldMetadata = await this.metadataStore.loadFileMetadata(relativePath);
        if (oldMetadata) {
          if (!metadata.summary && oldMetadata.summary && metadata.hash === oldMetadata.hash) {
            metadata.summary = oldMetadata.summary;
          }
          
          const oldSymbolMap = new Map(oldMetadata.symbols.map(s => [s.id, s]));
          for (const newSymbol of metadata.symbols) {
            const oldSymbol = oldSymbolMap.get(newSymbol.id);
            if (!newSymbol.summary && oldSymbol && oldSymbol.summary && newSymbol.hash === oldSymbol.hash) {
              newSymbol.summary = oldSymbol.summary;
            }
          }
        }

        // Update index
        this.projectIndex.removeFile(relativePath);
        this.projectIndex.addFile(metadata);

        // Persist
        await this.metadataStore.saveFileMetadata(metadata);
        
        // Queue for semantic indexing (if needed)
        if (this.semanticIndexer) {
          this.semanticIndexer.queueFiles([metadata]);
        }
        
        updated++;
      } else {
        unchanged++;
      }
    }

    // Check for deleted files
    const indexedPaths = this.projectIndex.getAllFilePaths();
    for (const indexedPath of indexedPaths) {
      if (!currentPaths.has(indexedPath)) {
        this.projectIndex.removeFile(indexedPath);
        await this.metadataStore.removeFileMetadata(indexedPath);
        removed++;
      }
    }

    // Rebuild graph if any changes
    if (updated > 0 || removed > 0) {
      this.graph.clear();
      const allFiles = this.projectIndex.getAllFiles();
      const newGraph = buildGraph(allFiles);
      for (const node of newGraph.getAllNodes()) {
        this.graph.addNode(node);
      }
      for (const edge of newGraph.getAllEdges()) {
        this.graph.addEdge(
          edge.source,
          edge.target,
          edge.type,
          edge.metadata
        );
      }

      // Persist updated project metadata and graph
      const projectMeta = this.projectIndex.toProjectMetadata(
        workspaceFolder.name,
        workspaceFolder.uri.fsPath,
        this.graph.edgeCount
      );
      projectMeta.lastIncrementalUpdate = Date.now();
      await this.metadataStore.saveProjectMetadata(projectMeta);
      await this.metadataStore.saveGraph(this.graph.serialize());

      // Queue newly updated files for semantic indexing
      if (this.semanticIndexer) {
        const updatedFiles = currentPaths
          ? Array.from(currentPaths)
              .map(p => this.projectIndex.getFile(p))
              .filter((f): f is FileMetadata => f !== undefined && f.summary === undefined)
          : [];
        if (updatedFiles.length > 0) {
          this.semanticIndexer.queueFiles(updatedFiles);
        }
      }
    }

    return { updated, unchanged, removed };
  }

  /**
   * Persists all analysis data to storage.
   */
  private async persistAll(
    files: FileMetadata[],
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<void> {
    // Save file metadata
    for (const file of files) {
      await this.metadataStore.saveFileMetadata(file);
    }

    // Save project metadata
    const projectMeta = this.projectIndex.toProjectMetadata(
      workspaceFolder.name,
      workspaceFolder.uri.fsPath,
      this.graph.edgeCount
    );
    await this.metadataStore.saveProjectMetadata(projectMeta);

    // Save graph
    await this.metadataStore.saveGraph(this.graph.serialize());
  }

  /**
   * Loads existing analysis data from storage.
   */
  async loadExistingData(): Promise<boolean> {
    const projectMeta = await this.metadataStore.loadProjectMetadata();
    if (!projectMeta) {
      return false;
    }

    // Load file metadata
    const files = await this.metadataStore.loadAllFileMetadata();
    if (files.length === 0) {
      return false;
    }

    // Build index
    this.projectIndex.build(files);

    // Load graph
    const graphData = await this.metadataStore.loadGraph();
    if (graphData) {
      this.graph.clear();
      const loaded = DependencyGraph.deserialize(graphData);
      for (const node of loaded.getAllNodes()) {
        this.graph.addNode(node);
      }
      for (const edge of loaded.getAllEdges()) {
        this.graph.addEdge(
          edge.source,
          edge.target,
          edge.type,
          edge.metadata
        );
      }
    }

    return true;
  }

  private createCancelledResult(startTime: number): AnalysisResult {
    return {
      projectMetadata: {
        projectName: '',
        rootPath: '',
        languages: {},
        totalFiles: 0,
        totalSymbols: 0,
        totalDependencies: 0,
        lastFullAnalysis: 0,
        lastIncrementalUpdate: 0,
        componentTypes: {},
        version: SCHEMA_VERSION,
      },
      fileCount: 0,
      symbolCount: 0,
      dependencyCount: 0,
      durationMs: Date.now() - startTime,
      errors: [
        {
          filePath: '',
          error: 'Analysis cancelled by user',
          phase: 'analyze',
        },
      ],
    };
  }
}
