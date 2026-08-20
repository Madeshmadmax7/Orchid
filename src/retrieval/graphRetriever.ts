// ============================================================================
// Project Memory — Graph Retriever
// ============================================================================
// Retrieves related context by traversing the dependency graph.
// ============================================================================

import { DependencyGraph } from '../graph/dependencyGraph';
import { ProjectIndex } from '../knowledge/projectIndex';
import { RetrievalQuery, RetrievedContext } from '../types';
import { generateFileSummary } from '../analyzer/componentSummarizer';

export class GraphRetriever {
  constructor(
    private graph: DependencyGraph,
    private projectIndex: ProjectIndex
  ) {}

  /**
   * Uses target files/symbols from the query to find related components
   * up to a certain depth in the dependency graph.
   */
  retrieve(query: RetrievalQuery, depth: number = 1): RetrievedContext[] {
    const contexts: RetrievedContext[] = [];
    const seen = new Set<string>();

    const seedNodes: string[] = [];

    // Find seed nodes from target files
    for (const targetFile of query.targetFiles) {
      // Find files ending with targetFile
      const allFiles = this.projectIndex.getAllFilePaths();
      for (const path of allFiles) {
        if (path.toLowerCase().endsWith(targetFile.toLowerCase())) {
          seedNodes.push(`file:${path}`);
        }
      }
    }

    // Find seed nodes from target symbols
    for (const targetSymbol of query.targetSymbols) {
      const matches = this.projectIndex.getSymbol(targetSymbol);
      for (const match of matches) {
        seedNodes.push(`file:${match.filePath}`);
      }
    }

    // Traverse from seeds
    for (const seed of seedNodes) {
      if (!this.graph.hasNode(seed)) continue;

      // Add the seed file itself
      this.addFileContext(seed.replace('file:', ''), 1.0, contexts, seen);

      // Add dependencies
      const deps = this.graph.getTransitiveDependencies(seed, depth);
      for (const dep of deps) {
        if (dep.startsWith('file:')) {
          this.addFileContext(dep.replace('file:', ''), 0.8, contexts, seen);
        }
      }

      // Add dependents
      const dependents = this.graph.getTransitiveDependents(seed, depth);
      for (const dep of dependents) {
        if (dep.startsWith('file:')) {
          this.addFileContext(dep.replace('file:', ''), 0.6, contexts, seen);
        }
      }
    }

    return contexts;
  }

  private addFileContext(filePath: string, score: number, contexts: RetrievedContext[], seen: Set<string>): void {
    if (seen.has(filePath)) return;
    
    const fileMeta = this.projectIndex.getFile(filePath);
    if (!fileMeta) return;

    seen.add(filePath);
    contexts.push({
      id: `file:${filePath}`,
      type: 'file',
      content: generateFileSummary(fileMeta),
      relevanceScore: score,
      filePath,
      metadata: { fileType: fileMeta.fileType }
    });
  }
}
