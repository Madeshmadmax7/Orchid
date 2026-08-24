// ============================================================================
// Project Memory — Project Index
// ============================================================================
// In-memory index for fast lookups across the project knowledge base.
// Built from loaded file metadata for O(1) symbol, file, and type lookups.
// ============================================================================

import {
  FileMetadata,
  SymbolInfo,
  ComponentType,
  Language,
  ProjectMetadata,
  SCHEMA_VERSION,
} from '../types';
import { normalizePath } from '../utils/fileUtils';

/**
 * Location reference for a symbol.
 */
export interface SymbolLocation {
  symbolInfo: SymbolInfo;
  filePath: string;
}

/**
 * In-memory project index for fast lookups.
 */
export class ProjectIndex {
  /** All file metadata keyed by normalized path */
  private filesByPath: Map<string, FileMetadata> = new Map();
  /** Symbol name → locations */
  private symbolsByName: Map<string, SymbolLocation[]> = new Map();
  /** Symbol ID → location */
  private symbolById: Map<string, SymbolLocation> = new Map();
  /** Component type → file paths */
  private filesByType: Map<ComponentType, string[]> = new Map();
  /** File path → exported symbol names */
  private exportsByFile: Map<string, string[]> = new Map();
  /** Exported symbol name → file path */
  private exportToFile: Map<string, string> = new Map();
  /** Language → file count */
  private languageCounts: Map<Language, number> = new Map();
  /** Component type → count */
  private typeCounts: Map<ComponentType, number> = new Map();

  /**
   * Builds the index from an array of file metadata.
   */
  build(files: FileMetadata[]): void {
    this.clear();

    for (const file of files) {
      this.addFile(file);
    }
  }

  /**
   * Adds a single file to the index.
   */
  addFile(file: FileMetadata): void {
    const normalizedPath = normalizePath(file.filePath);
    this.filesByPath.set(normalizedPath, file);

    // Index symbols
    for (const symbol of file.symbols) {
      const loc = {
        symbolInfo: symbol,
        filePath: normalizedPath,
      };

      if (!this.symbolsByName.has(symbol.name)) {
        this.symbolsByName.set(symbol.name, []);
      }
      this.symbolsByName.get(symbol.name)!.push(loc);
      this.symbolById.set(symbol.id, loc);
    }

    // Index by type
    if (!this.filesByType.has(file.fileType)) {
      this.filesByType.set(file.fileType, []);
    }
    this.filesByType.get(file.fileType)!.push(normalizedPath);

    // Index exports
    const exportNames = file.exports
      .filter((e) => e.name !== '*')
      .map((e) => e.name);
    this.exportsByFile.set(normalizedPath, exportNames);
    for (const name of exportNames) {
      this.exportToFile.set(name, normalizedPath);
    }

    // Count languages
    const langCount = this.languageCounts.get(file.language) ?? 0;
    this.languageCounts.set(file.language, langCount + 1);

    // Count types
    const typeCount = this.typeCounts.get(file.fileType) ?? 0;
    this.typeCounts.set(file.fileType, typeCount + 1);
  }

  /**
   * Removes a file from the index.
   */
  removeFile(filePath: string): void {
    const normalizedPath = normalizePath(filePath);
    const file = this.filesByPath.get(normalizedPath);
    if (!file) {
      return;
    }

    // Remove from symbol index
    for (const symbol of file.symbols) {
      const locations = this.symbolsByName.get(symbol.name);
      if (locations) {
        const filtered = locations.filter(
          (loc) => loc.filePath !== normalizedPath
        );
        if (filtered.length === 0) {
          this.symbolsByName.delete(symbol.name);
        } else {
          this.symbolsByName.set(symbol.name, filtered);
        }
      }
      this.symbolById.delete(symbol.id);
    }

    // Remove from type index
    const typePaths = this.filesByType.get(file.fileType);
    if (typePaths) {
      this.filesByType.set(
        file.fileType,
        typePaths.filter((p) => p !== normalizedPath)
      );
    }

    // Remove from export index
    const exports = this.exportsByFile.get(normalizedPath) ?? [];
    for (const name of exports) {
      if (this.exportToFile.get(name) === normalizedPath) {
        this.exportToFile.delete(name);
      }
    }
    this.exportsByFile.delete(normalizedPath);

    // Update counts
    const langCount = this.languageCounts.get(file.language) ?? 0;
    if (langCount > 1) {
      this.languageCounts.set(file.language, langCount - 1);
    } else {
      this.languageCounts.delete(file.language);
    }

    const typeCount = this.typeCounts.get(file.fileType) ?? 0;
    if (typeCount > 1) {
      this.typeCounts.set(file.fileType, typeCount - 1);
    } else {
      this.typeCounts.delete(file.fileType);
    }

    this.filesByPath.delete(normalizedPath);
  }

  // ─── Lookups ────────────────────────────────────────────────────────

  /**
   * Searches for symbols matching a query string (case-insensitive substring match).
   */
  searchSymbols(query: string): SymbolLocation[] {
    const lowerQuery = query.toLowerCase();
    const results: SymbolLocation[] = [];

    for (const [name, locations] of this.symbolsByName) {
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push(...locations);
      }
    }

    return results;
  }

  /**
   * Gets exact symbol matches by name.
   */
  getSymbol(name: string): SymbolLocation[] {
    return this.symbolsByName.get(name) ?? [];
  }

  getSymbolById(id: string): SymbolLocation | undefined {
    return this.symbolById.get(id);
  }

  /**
   * Gets file metadata by path.
   */
  getFile(filePath: string): FileMetadata | undefined {
    return this.filesByPath.get(normalizePath(filePath));
  }

  /**
   * Gets all files of a specific component type.
   */
  getFilesByType(type: ComponentType): string[] {
    return this.filesByType.get(type) ?? [];
  }

  /**
   * Gets the file that exports a given symbol name.
   */
  getFileForExport(symbolName: string): string | undefined {
    return this.exportToFile.get(symbolName);
  }

  /**
   * Gets all file paths in the index.
   */
  getAllFilePaths(): string[] {
    return Array.from(this.filesByPath.keys());
  }

  /**
   * Gets all file metadata entries.
   */
  getAllFiles(): FileMetadata[] {
    return Array.from(this.filesByPath.values());
  }

  // ─── Statistics ─────────────────────────────────────────────────────

  get totalFiles(): number {
    return this.filesByPath.size;
  }

  get totalSymbols(): number {
    let count = 0;
    for (const locations of this.symbolsByName.values()) {
      count += locations.length;
    }
    return count;
  }

  getLanguageDistribution(): Partial<Record<Language, number>> {
    const result: Partial<Record<Language, number>> = {};
    for (const [lang, count] of this.languageCounts) {
      result[lang] = count;
    }
    return result;
  }

  getComponentTypeDistribution(): Partial<Record<ComponentType, number>> {
    const result: Partial<Record<ComponentType, number>> = {};
    for (const [type, count] of this.typeCounts) {
      result[type] = count;
    }
    return result;
  }

  /**
   * Generates project metadata from the current index state.
   */
  toProjectMetadata(
    projectName: string,
    rootPath: string,
    dependencyCount: number
  ): ProjectMetadata {
    return {
      projectName,
      rootPath,
      languages: this.getLanguageDistribution(),
      totalFiles: this.totalFiles,
      totalSymbols: this.totalSymbols,
      totalDependencies: dependencyCount,
      lastFullAnalysis: Date.now(),
      lastIncrementalUpdate: Date.now(),
      componentTypes: this.getComponentTypeDistribution(),
      version: SCHEMA_VERSION,
    };
  }

  /**
   * Clears the entire index.
   */
  clear(): void {
    this.filesByPath.clear();
    this.symbolsByName.clear();
    this.filesByType.clear();
    this.exportsByFile.clear();
    this.exportToFile.clear();
    this.languageCounts.clear();
    this.typeCounts.clear();
  }
}
