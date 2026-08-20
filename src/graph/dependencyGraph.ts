// ============================================================================
// Project Memory — Dependency Graph
// ============================================================================
// Directed graph data structure for representing code relationships.
// Uses adjacency lists for efficient traversal. Supports serialization
// for persistent storage.
// ============================================================================

import {
  DependencyEdge,
  GraphNode,
  RelationshipType,
  SerializedGraph,
  SCHEMA_VERSION,
} from '../types';

/**
 * Directed graph for modeling code dependencies and relationships.
 */
export class DependencyGraph {
  /** All nodes in the graph, keyed by ID */
  private nodes: Map<string, GraphNode> = new Map();
  /** Forward edges: source → [edges] */
  private forwardEdges: Map<string, DependencyEdge[]> = new Map();
  /** Reverse edges: target → [edges] (for finding dependents) */
  private reverseEdges: Map<string, DependencyEdge[]> = new Map();

  // ─── Node Operations ────────────────────────────────────────────────

  /**
   * Adds a node to the graph. Updates if already exists.
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  /**
   * Gets a node by ID.
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Checks if a node exists.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Removes a node and all its edges.
   */
  removeNode(id: string): void {
    this.nodes.delete(id);

    // Remove forward edges from this node
    const forward = this.forwardEdges.get(id) ?? [];
    for (const edge of forward) {
      const reverse = this.reverseEdges.get(edge.target);
      if (reverse) {
        this.reverseEdges.set(
          edge.target,
          reverse.filter((e) => e.source !== id)
        );
      }
    }
    this.forwardEdges.delete(id);

    // Remove reverse edges to this node
    const reverse = this.reverseEdges.get(id) ?? [];
    for (const edge of reverse) {
      const forward2 = this.forwardEdges.get(edge.source);
      if (forward2) {
        this.forwardEdges.set(
          edge.source,
          forward2.filter((e) => e.target !== id)
        );
      }
    }
    this.reverseEdges.delete(id);
  }

  // ─── Edge Operations ────────────────────────────────────────────────

  /**
   * Adds a directed edge between two nodes.
   */
  addEdge(
    source: string,
    target: string,
    type: RelationshipType,
    metadata?: Record<string, string>
  ): void {
    const edge: DependencyEdge = { source, target, type, metadata };

    // Check for duplicate edges
    const existing = this.forwardEdges.get(source) ?? [];
    const isDuplicate = existing.some(
      (e) => e.target === target && e.type === type
    );
    if (isDuplicate) {
      return;
    }

    // Add forward edge
    if (!this.forwardEdges.has(source)) {
      this.forwardEdges.set(source, []);
    }
    this.forwardEdges.get(source)!.push(edge);

    // Add reverse edge
    if (!this.reverseEdges.has(target)) {
      this.reverseEdges.set(target, []);
    }
    this.reverseEdges.get(target)!.push(edge);
  }

  /**
   * Gets all outgoing edges from a node (what does this node depend on?).
   */
  getOutgoingEdges(nodeId: string): DependencyEdge[] {
    return this.forwardEdges.get(nodeId) ?? [];
  }

  /**
   * Gets all incoming edges to a node (what depends on this node?).
   */
  getIncomingEdges(nodeId: string): DependencyEdge[] {
    return this.reverseEdges.get(nodeId) ?? [];
  }

  // ─── Dependency Queries ─────────────────────────────────────────────

  /**
   * Gets direct dependencies of a node (outgoing edges).
   */
  getDirectDependencies(nodeId: string): string[] {
    return (this.forwardEdges.get(nodeId) ?? []).map((e) => e.target);
  }

  /**
   * Gets direct dependents of a node (incoming edges).
   */
  getDirectDependents(nodeId: string): string[] {
    return (this.reverseEdges.get(nodeId) ?? []).map((e) => e.source);
  }

  /**
   * Gets dependencies filtered by relationship type.
   */
  getDependenciesByType(
    nodeId: string,
    type: RelationshipType
  ): string[] {
    return (this.forwardEdges.get(nodeId) ?? [])
      .filter((e) => e.type === type)
      .map((e) => e.target);
  }

  /**
   * Gets dependents filtered by relationship type.
   */
  getDependentsByType(
    nodeId: string,
    type: RelationshipType
  ): string[] {
    return (this.reverseEdges.get(nodeId) ?? [])
      .filter((e) => e.type === type)
      .map((e) => e.source);
  }

  /**
   * Traverses transitive dependencies up to a maximum depth.
   * Uses BFS to find all nodes reachable from the given node.
   */
  getTransitiveDependencies(nodeId: string, maxDepth: number = 5): string[] {
    return this.bfsTraversal(nodeId, 'forward', maxDepth);
  }

  /**
   * Traverses transitive dependents up to a maximum depth.
   * Uses BFS to find all nodes that directly or indirectly depend on this node.
   */
  getTransitiveDependents(nodeId: string, maxDepth: number = 5): string[] {
    return this.bfsTraversal(nodeId, 'reverse', maxDepth);
  }

  /**
   * BFS traversal in either direction.
   */
  private bfsTraversal(
    startId: string,
    direction: 'forward' | 'reverse',
    maxDepth: number
  ): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const queue: Array<{ id: string; depth: number }> = [
      { id: startId, depth: 0 },
    ];

    visited.add(startId);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (depth >= maxDepth) {
        continue;
      }

      const edges =
        direction === 'forward'
          ? this.forwardEdges.get(id) ?? []
          : this.reverseEdges.get(id) ?? [];

      for (const edge of edges) {
        const nextId = direction === 'forward' ? edge.target : edge.source;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          result.push(nextId);
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  // ─── Graph Statistics ───────────────────────────────────────────────

  /**
   * Returns the total number of nodes.
   */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Returns the total number of edges.
   */
  get edgeCount(): number {
    let count = 0;
    for (const edges of this.forwardEdges.values()) {
      count += edges.length;
    }
    return count;
  }

  /**
   * Returns all node IDs.
   */
  getAllNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Returns all nodes.
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Returns all edges.
   */
  getAllEdges(): DependencyEdge[] {
    const edges: DependencyEdge[] = [];
    for (const edgeList of this.forwardEdges.values()) {
      edges.push(...edgeList);
    }
    return edges;
  }

  // ─── Serialization ──────────────────────────────────────────────────

  /**
   * Serializes the graph for persistent storage.
   */
  serialize(): SerializedGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.getAllEdges(),
      version: SCHEMA_VERSION,
    };
  }

  /**
   * Deserializes a graph from persistent storage.
   */
  static deserialize(data: SerializedGraph): DependencyGraph {
    const graph = new DependencyGraph();

    for (const node of data.nodes) {
      graph.addNode(node);
    }

    for (const edge of data.edges) {
      graph.addEdge(edge.source, edge.target, edge.type, edge.metadata);
    }

    return graph;
  }

  /**
   * Clears all nodes and edges.
   */
  clear(): void {
    this.nodes.clear();
    this.forwardEdges.clear();
    this.reverseEdges.clear();
  }
}
