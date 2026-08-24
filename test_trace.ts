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
    let entries;
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
  console.log('Building index for Jarvis...');
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

  let baselineProjectTokens = 0;
  for (const meta of metadataList) {
     const text = fs.readFileSync(path.join(JARVIS_ROOT, meta.filePath), 'utf-8');
     baselineProjectTokens += Math.ceil(text.length / 4);
  }
  console.log(`Total Baseline Project Tokens (Estimate): ${baselineProjectTokens}`);

  const graph = new DependencyGraph();
  const newGraph = buildGraph(metadataList);
  for (const node of newGraph.getAllNodes()) graph.addNode(node);
  for (const edge of newGraph.getAllEdges()) graph.addEdge(edge.source, edge.target, edge.type, edge.metadata);

  const queryRouter = new QueryRouter(projectIndex);
  const symbolRetriever = new SymbolRetriever(projectIndex);
  const graphRetriever = new GraphRetriever(graph, projectIndex);
  const semanticRetriever = new SemanticRetriever(); // Dummy
  const hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever, semanticRetriever, projectIndex);
  const contextRanker = new ContextRanker(projectIndex);
  const contextCompressor = new ContextCompressor();

  const queries = [
    // Tests 8-9 (Fix A — modification with new vocabulary)
    "Add logout functionality to the Jarvis application.",
    "Add pagination to the appropriate data/listing functionality in the Jarvis application.",
    "Add notification support to the Jarvis application.",
    // Test 8 (Fix B — parent-symbol over-retrieval fixed)
    "Disable Voice",
    // Tests 10-11 (explicit symbol retrieval must remain unchanged)
    "explain VoiceRequest",
    "explain ChatRequest",
    "explain how the VoiceRequest and ChatRequest models work",
    "explain ThemeToggle",
    // Test 4 (broad project overview)
    "explain how the jarvis works",
    // Tests 5-7 (negative / unresolved targets must NOT trigger fallback)
    "explain nonexistentFunction",
    "explain nonexistentClass",
    "explain backend/nonexistent.py"
  ];

  for (const q of queries) {
    console.log(`\n======================================================`);
    console.log(`QUERY: ${q}`);
    const parsedQuery = queryRouter.parseQuery(q);
    console.log(`Parsed Intent: ${parsedQuery.intent}`);
    console.log(`Target Symbols: ${JSON.stringify(parsedQuery.targetSymbols)}`);
    console.log(`Keywords: ${JSON.stringify(parsedQuery.keywords)}`);
    console.log(`Concepts: ${JSON.stringify(parsedQuery.concepts)}`);

    const allContexts = hybridRetriever.retrieve(parsedQuery);
    console.log(`HybridRetriever returned ${allContexts.length} candidates`);
    
    // Log top candidates from HybridRetriever
    for (const ctx of allContexts.slice(0, 3)) {
      console.log(`  Candidate: [${ctx.type}] ${ctx.id} | Score: ${ctx.relevanceScore}`);
      // console.log(`  Content snippet: ${ctx.content.substring(0, 100).replace(/\n/g, ' ')}...`);
    }

    const rankedContexts = contextRanker.rank(allContexts, parsedQuery);
    console.log(`ContextRanker returned ${rankedContexts.length} ranked candidates`);
    
    // Log ranked candidates
    for (const ctx of rankedContexts.slice(0, 3)) {
      console.log(`  Ranked Candidate: [${ctx.type}] ${ctx.id} | Score: ${ctx.relevanceScore}`);
      if (q.includes("VoiceRequest") || q.includes("jarvis")) {
         console.log(`  Content passed to Compressor:\n${ctx.content}`);
         // Show file metadata if it's a file context, because ContextCompressor formatFile uses fileMeta!
         if (ctx.type === 'file' && ctx.fileMeta) {
             console.log(`  Has fileMeta: true. Symbols count: ${ctx.fileMeta.symbols.length}`);
         }
         if (ctx.type === 'symbol' && ctx.symbolInfo) {
             console.log(`  Has symbolInfo: true. Fields: ${Object.keys(ctx.symbolInfo).join(', ')}`);
             console.log(`  Calls: ${ctx.symbolInfo.calls?.length}`);
         }
      }
    }

    const compressed = contextCompressor.compress(rankedContexts);
    console.log(`\nCompressed Context (${compressed.tokenCount} tokens):\n${compressed.text}`);
  }
}

run().catch(console.error);
