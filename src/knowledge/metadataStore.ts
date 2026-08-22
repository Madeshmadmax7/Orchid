// ============================================================================
// Project Memory — Metadata Store
// ============================================================================
// Persists analysis results to the .project-memory/ directory.
// Handles reading, writing, and change detection for file metadata,
// project metadata, and the serialized dependency graph.
// ============================================================================

import * as vscode from 'vscode';
import * as path from 'path';
import {
  FileMetadata,
  ProjectMetadata,
  SerializedGraph,
  STORAGE_DIR,
  FILES_DIR,
  PROJECT_FILE,
  GRAPH_FILE,
} from '../types';
import { pathToStorageKey, normalizePath } from '../utils/fileUtils';

/**
 * Manages persistent storage of project analysis data.
 */
export class MetadataStore {
  private storageUri: vscode.Uri;
  private filesUri: vscode.Uri;

  constructor(workspaceRoot: vscode.Uri) {
    this.storageUri = vscode.Uri.joinPath(workspaceRoot, STORAGE_DIR);
    this.filesUri = vscode.Uri.joinPath(this.storageUri, FILES_DIR);
  }

  // ─── Initialization ─────────────────────────────────────────────────

  /**
   * Ensures the storage directories exist.
   */
  async initialize(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.storageUri);
      await vscode.workspace.fs.createDirectory(this.filesUri);
    } catch {
      // Directories may already exist
    }
  }

  // ─── File Metadata ──────────────────────────────────────────────────

  /**
   * Saves metadata for a single file.
   */
  async saveFileMetadata(metadata: FileMetadata): Promise<void> {
    const key = pathToStorageKey(metadata.filePath);
    const fileUri = vscode.Uri.joinPath(this.filesUri, `${key}.json`);
    const content = JSON.stringify(metadata, null, 2);
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(content, 'utf-8')
    );
  }

  /**
   * Loads metadata for a single file.
   */
  async loadFileMetadata(filePath: string): Promise<FileMetadata | null> {
    const key = pathToStorageKey(filePath);
    const fileUri = vscode.Uri.joinPath(this.filesUri, `${key}.json`);
    try {
      const data = await vscode.workspace.fs.readFile(fileUri);
      const metadata = JSON.parse(Buffer.from(data).toString('utf-8')) as FileMetadata;
      return this.migrateFileMetadata(metadata);
    } catch {
      return null;
    }
  }

  /**
   * Loads all stored file metadata.
   */
  async loadAllFileMetadata(): Promise<FileMetadata[]> {
    const results: FileMetadata[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.filesUri);
      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.endsWith('.json')) {
          const fileUri = vscode.Uri.joinPath(this.filesUri, name);
          try {
            const data = await vscode.workspace.fs.readFile(fileUri);
            const metadata = JSON.parse(
              Buffer.from(data).toString('utf-8')
            ) as FileMetadata;
            results.push(this.migrateFileMetadata(metadata));
          } catch {
            // Skip corrupted files
          }
        }
      }
    } catch {
      // Directory may not exist yet
    }
    return results;
  }

  /**
   * Safely migrates older FileMetadata versions to ensure required fields exist.
   */
  private migrateFileMetadata(metadata: FileMetadata): FileMetadata {
    if (!metadata) return metadata;

    const normalizedPath = normalizePath(metadata.filePath);

    // If symbols exist but lack an ID, backfill them.
    if (metadata.symbols && metadata.symbols.length > 0) {
      if (!metadata.symbols[0].id) {
        for (const symbol of metadata.symbols) {
          const parentPart = symbol.parentSymbol ? `${symbol.parentSymbol}.` : '';
          symbol.id = `${normalizedPath}#${parentPart}${symbol.name}:${symbol.kind}`;
          // Hash will just remain undefined if missing, which is safe.
        }
      }
    }

    return metadata;
  }

  /**
   * Checks if a file needs re-analysis by comparing hashes.
   */
  async isStale(filePath: string, currentHash: string): Promise<boolean> {
    const existing = await this.loadFileMetadata(filePath);
    if (!existing) {
      return true; // Never analyzed
    }
    return existing.hash !== currentHash;
  }

  /**
   * Removes metadata for a file that no longer exists.
   */
  async removeFileMetadata(filePath: string): Promise<void> {
    const key = pathToStorageKey(filePath);
    const fileUri = vscode.Uri.joinPath(this.filesUri, `${key}.json`);
    try {
      await vscode.workspace.fs.delete(fileUri);
    } catch {
      // File may not exist
    }
  }

  // ─── Project Metadata ───────────────────────────────────────────────

  /**
   * Saves project-level metadata.
   */
  async saveProjectMetadata(metadata: ProjectMetadata): Promise<void> {
    const fileUri = vscode.Uri.joinPath(this.storageUri, PROJECT_FILE);
    const content = JSON.stringify(metadata, null, 2);
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(content, 'utf-8')
    );
  }

  /**
   * Loads project-level metadata.
   */
  async loadProjectMetadata(): Promise<ProjectMetadata | null> {
    const fileUri = vscode.Uri.joinPath(this.storageUri, PROJECT_FILE);
    try {
      const data = await vscode.workspace.fs.readFile(fileUri);
      return JSON.parse(
        Buffer.from(data).toString('utf-8')
      ) as ProjectMetadata;
    } catch {
      return null;
    }
  }

  // ─── Dependency Graph ───────────────────────────────────────────────

  /**
   * Saves the serialized dependency graph.
   */
  async saveGraph(graph: SerializedGraph): Promise<void> {
    const fileUri = vscode.Uri.joinPath(this.storageUri, GRAPH_FILE);
    const content = JSON.stringify(graph, null, 2);
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(content, 'utf-8')
    );
  }

  /**
   * Loads the serialized dependency graph.
   */
  async loadGraph(): Promise<SerializedGraph | null> {
    const fileUri = vscode.Uri.joinPath(this.storageUri, GRAPH_FILE);
    try {
      const data = await vscode.workspace.fs.readFile(fileUri);
      return JSON.parse(
        Buffer.from(data).toString('utf-8')
      ) as SerializedGraph;
    } catch {
      return null;
    }
  }

  // ─── Storage Management ─────────────────────────────────────────────

  /**
   * Clears all stored data.
   */
  async clear(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.storageUri, { recursive: true });
    } catch {
      // Already cleaned
    }
  }

  /**
   * Checks if analysis data exists.
   */
  async hasData(): Promise<boolean> {
    const projectMeta = await this.loadProjectMetadata();
    return projectMeta !== null;
  }

  /**
   * Gets the storage directory path for display purposes.
   */
  getStoragePath(): string {
    return this.storageUri.fsPath;
  }
}
