// ============================================================================
// Tests — Dependency Graph
// ============================================================================

import * as assert from 'assert';
import { DependencyGraph } from '../../graph/dependencyGraph';

suite('DependencyGraph', () => {
  let graph: DependencyGraph;

  setup(() => {
    graph = new DependencyGraph();
  });

  test('adds and retrieves nodes', () => {
    graph.addNode({
      id: 'file:src/main.ts',
      label: 'main.ts',
      kind: 'file',
      filePath: 'src/main.ts',
    });

    assert.ok(graph.hasNode('file:src/main.ts'));
    assert.strictEqual(graph.getNode('file:src/main.ts')?.label, 'main.ts');
    assert.strictEqual(graph.nodeCount, 1);
  });

  test('adds edges and queries dependencies', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });
    graph.addNode({ id: 'C', label: 'C', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('A', 'C', 'IMPORTS');

    const deps = graph.getDirectDependencies('A');
    assert.deepStrictEqual(deps.sort(), ['B', 'C']);
    assert.strictEqual(graph.edgeCount, 2);
  });

  test('queries dependents (reverse)', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });
    graph.addNode({ id: 'C', label: 'C', kind: 'file' });

    graph.addEdge('A', 'C', 'IMPORTS');
    graph.addEdge('B', 'C', 'IMPORTS');

    const dependents = graph.getDirectDependents('C');
    assert.deepStrictEqual(dependents.sort(), ['A', 'B']);
  });

  test('filters by relationship type', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('A', 'B', 'USES');

    const imports = graph.getDependenciesByType('A', 'IMPORTS');
    assert.deepStrictEqual(imports, ['B']);

    const uses = graph.getDependenciesByType('A', 'USES');
    assert.deepStrictEqual(uses, ['B']);
  });

  test('transitive dependencies (BFS)', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });
    graph.addNode({ id: 'C', label: 'C', kind: 'file' });
    graph.addNode({ id: 'D', label: 'D', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('B', 'C', 'IMPORTS');
    graph.addEdge('C', 'D', 'IMPORTS');

    const transitive = graph.getTransitiveDependencies('A', 10);
    assert.deepStrictEqual(transitive.sort(), ['B', 'C', 'D']);
  });

  test('transitive dependencies respect max depth', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });
    graph.addNode({ id: 'C', label: 'C', kind: 'file' });
    graph.addNode({ id: 'D', label: 'D', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('B', 'C', 'IMPORTS');
    graph.addEdge('C', 'D', 'IMPORTS');

    const transitive = graph.getTransitiveDependencies('A', 2);
    assert.deepStrictEqual(transitive.sort(), ['B', 'C']);
  });

  test('transitive dependents (reverse BFS)', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });
    graph.addNode({ id: 'C', label: 'C', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('B', 'C', 'IMPORTS');

    const dependents = graph.getTransitiveDependents('C', 10);
    assert.deepStrictEqual(dependents.sort(), ['A', 'B']);
  });

  test('removes node and its edges', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });
    graph.addNode({ id: 'C', label: 'C', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('B', 'C', 'IMPORTS');

    graph.removeNode('B');

    assert.strictEqual(graph.hasNode('B'), false);
    assert.deepStrictEqual(graph.getDirectDependencies('A'), []);
    assert.deepStrictEqual(graph.getDirectDependents('C'), []);
  });

  test('prevents duplicate edges', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('A', 'B', 'IMPORTS'); // duplicate

    assert.strictEqual(graph.edgeCount, 1);
  });

  test('handles cycles in BFS', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addNode({ id: 'B', label: 'B', kind: 'file' });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('B', 'A', 'IMPORTS');

    // Should not infinite loop
    const deps = graph.getTransitiveDependencies('A', 10);
    assert.deepStrictEqual(deps, ['B']);
  });

  test('serialization round-trip', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file', filePath: 'a.ts' });
    graph.addNode({
      id: 'B',
      label: 'B',
      kind: 'class',
      filePath: 'b.ts',
    });

    graph.addEdge('A', 'B', 'IMPORTS');
    graph.addEdge('A', 'B', 'USES');

    const serialized = graph.serialize();
    const restored = DependencyGraph.deserialize(serialized);

    assert.strictEqual(restored.nodeCount, 2);
    assert.strictEqual(restored.edgeCount, 2);
    assert.ok(restored.hasNode('A'));
    assert.ok(restored.hasNode('B'));
    assert.deepStrictEqual(restored.getDirectDependencies('A'), ['B', 'B']);
  });

  test('clear removes all data', () => {
    graph.addNode({ id: 'A', label: 'A', kind: 'file' });
    graph.addEdge('A', 'A', 'IMPORTS');

    graph.clear();

    assert.strictEqual(graph.nodeCount, 0);
    assert.strictEqual(graph.edgeCount, 0);
  });
});
