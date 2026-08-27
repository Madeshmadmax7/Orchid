/**
 * Targeted modification query trace to evaluate whether implementation-level
 * context reaches Copilot for MODIFICATION queries.
 *
 * Run: npx ts-node --project tsconfig.json trace_modification.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProjectIndex } from './src/knowledge/projectIndex';
import { DependencyGraph } from './src/graph/dependencyGraph';
import { QueryRouter } from './src/retrieval/queryRouter';
import { SymbolRetriever } from './src/retrieval/symbolRetriever';
import { GraphRetriever } from './src/retrieval/graphRetriever';
import { HybridRetriever } from './src/retrieval/hybridRetriever';
import { ContextRanker } from './src/retrieval/contextRanker';
import { ContextCompressor } from './src/retrieval/contextCompressor';
import { SemanticRetriever } from './src/retrieval/semanticRetriever';
import { analyzeFile } from './src/analyzer/fileAnalyzer';
import { buildGraph } from './src/graph/graphBuilder';
import { detectLanguage, isSupportedFile } from './src/utils/languageDetector';
import { shouldIgnore } from './src/utils/ignorePatterns';

const JARVIS_ROOT = 'C:\\Users\\MADDY\\OneDrive\\Desktop\\CSE-4\\jarvis';

function discoverFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    let entries: any[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (shouldIgnore(relPath + '/')) continue;
        walk(fullPath);
      } else {
        if (!shouldIgnore(relPath) && isSupportedFile(fullPath)) {
          results.push(relPath);
        }
      }
    }
  }
  walk(root);
  return results;
}

async function run() {
  console.log('Building Jarvis index...');
  const files = discoverFiles(JARVIS_ROOT);
  const metadataList = [];
  for (const relPath of files) {
    const absPath = path.join(JARVIS_ROOT, relPath.replace(/\//g, '\\'));
    const content = fs.readFileSync(absPath, 'utf-8');
    const lang = detectLanguage(absPath);
    metadataList.push(analyzeFile(relPath, content, lang));
  }

  const projectIndex = new ProjectIndex();
  projectIndex.build(metadataList);
  console.log(`Indexed ${files.length} files.\n`);

  const graph = new DependencyGraph();
  const newGraph = buildGraph(metadataList);
  for (const node of newGraph.getAllNodes()) graph.addNode(node);
  for (const edge of newGraph.getAllEdges()) graph.addEdge(edge.source, edge.target, edge.type, edge.metadata);

  const queryRouter = new QueryRouter(projectIndex);
  const symbolRetriever = new SymbolRetriever(projectIndex);
  const graphRetriever = new GraphRetriever(graph, projectIndex);
  const hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever, new SemanticRetriever(), projectIndex);
  const contextRanker = new ContextRanker(projectIndex);
  const contextCompressor = new ContextCompressor();

  const queries = [
    // Tests 3-5 (modification queries)
    'change voice like real jarvis',
    'add a comment to VoiceRequest explaining what it does',
    'rename VoiceRequest to VoiceInputRequest',
    // Tests 6-8 (novel feature requests)
    'add logout functionality to the Jarvis application',
    'add pagination to the appropriate listing functionality',
    'add notification support',
    // Test 1 (explanation – regression check)
    'explain VoiceRequest',
    // Test 9 (broad explanation)
    'explain how the jarvis works',
    // Test 10 (negative)
    'explain nonexistentFunction',
  ];

  for (const q of queries) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`QUERY: ${q}`);
    const parsedQuery = queryRouter.parseQuery(q);
    console.log(`  Intent:         ${parsedQuery.intent}`);
    console.log(`  targetSymbols:  ${JSON.stringify(parsedQuery.targetSymbols)}`);
    console.log(`  targetFiles:    ${JSON.stringify(parsedQuery.targetFiles)}`);
    console.log(`  keywords:       ${JSON.stringify(parsedQuery.keywords)}`);
    console.log(`  concepts:       ${JSON.stringify(parsedQuery.concepts)}`);

    const allContexts = hybridRetriever.retrieve(parsedQuery);
    console.log(`\n  HybridRetriever returned ${allContexts.length} candidates`);

    const rankedContexts = contextRanker.rank(allContexts, parsedQuery);
    console.log(`  ContextRanker  returned ${rankedContexts.length} ranked candidates`);

    // Show ALL ranked candidates with file + type
    const usedFiles = new Set(rankedContexts.map(c => c.filePath));
    console.log(`  Retrieved files (${usedFiles.size}): ${[...usedFiles].join(', ')}`);

    for (const ctx of rankedContexts.slice(0, 8)) {
      const label = ctx.type === 'symbol' ? `symbol:${ctx.symbolInfo?.name}` : `file:${ctx.filePath?.split('/').pop()}`;
      console.log(`    [score=${ctx.relevanceScore.toFixed(3)}] ${label}`);
    }

    const compressed = contextCompressor.compress(rankedContexts, 1500);
    console.log(`\n  Candidate tokens: ${compressed.candidateTokenCount}`);
    console.log(`  Final tokens:     ${compressed.tokenCount}`);
    console.log(`  Files considered: ${compressed.filesConsidered}, Symbols retrieved: ${compressed.symbolsRetrieved}, Symbols included: ${compressed.symbolsIncluded}`);
    console.log(`  Context levels:   L1=${compressed.contextLevels.L1}, L2=${compressed.contextLevels.L2}, L3=${compressed.contextLevels.L3}`);
    console.log(`\n--- FULL COMPRESSED CONTEXT ---\n${compressed.text}`);

    // Modification-specific evaluation
    if (['MODIFICATION'].includes(parsedQuery.intent)) {
      const hasImplementationCode = compressed.text.includes('Calls out to') || compressed.text.includes('Members');
      const hasFilePaths = usedFiles.size > 0;
      const hasEnoughContext = compressed.symbolsIncluded > 0 || compressed.filesConsidered > 0;
      console.log(`\n  MODIFICATION ASSESSMENT:`);
      console.log(`    Has file paths:         ${hasFilePaths}`);
      console.log(`    Has symbol members:     ${compressed.text.includes('Members')}`);
      console.log(`    Has call graph:         ${compressed.text.includes('Calls out to')}`);
      console.log(`    Has enough context:     ${hasEnoughContext}`);
      console.log(`    Copilot can implement:  ${hasEnoughContext && hasFilePaths ? 'LIKELY' : 'INSUFFICIENT'}`);
    }
  }
}

run().catch(console.error);
