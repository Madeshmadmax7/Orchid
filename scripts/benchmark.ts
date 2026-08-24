import * as fs from 'fs';
import * as path from 'path';
import { ProjectIndex } from '../src/knowledge/projectIndex';
import { DependencyGraph } from '../src/graph/dependencyGraph';
import { QueryRouter } from '../src/retrieval/queryRouter';
import { SymbolRetriever } from '../src/retrieval/symbolRetriever';
import { GraphRetriever } from '../src/retrieval/graphRetriever';
import { HybridRetriever } from '../src/retrieval/hybridRetriever';
import { ContextRanker } from '../src/retrieval/contextRanker';
import { ContextCompressor } from '../src/retrieval/contextCompressor';
import { analyzeFile } from '../src/analyzer/fileAnalyzer';
import { buildGraph } from '../src/graph/graphBuilder';
import { FileMetadata } from '../src/types';

async function runBenchmark() {
  console.log('Loading project memory...');
  
  const rootPath = path.resolve(__dirname, '..');
  const projectIndex = new ProjectIndex();
  
  // Seed the index with some core extension files for the benchmark simulation
  const testFiles = [
    path.join(rootPath, 'src/ai/chatParticipant.ts'),
    path.join(rootPath, 'src/retrieval/hybridRetriever.ts'),
    path.join(rootPath, 'src/retrieval/contextCompressor.ts'),
  ];
  
  const fileMetas: FileMetadata[] = [];
  
  for (const f of testFiles) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8');
      const meta = analyzeFile(f, content, 'typescript');
      projectIndex.addFile(meta);
      fileMetas.push(meta);
    }
  }
  
  const graph = buildGraph(fileMetas);

  const router = new QueryRouter();
  const symbolRetriever = new SymbolRetriever(projectIndex);
  const graphRetriever = new GraphRetriever(graph, projectIndex);
  const hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever);
  const ranker = new ContextRanker(projectIndex);
  const compressor = new ContextCompressor();

  const queries = [
    'How does ContextCompressor enforce token limits?',
    'What dependencies does chatParticipant use?',
    'Explain the mergeContext logic in HybridRetriever',
  ];

  console.log('\n======================================================');
  console.log(' ORCHID vs BASELINE CONTEXT RETRIEVAL BENCHMARK');
  console.log('======================================================\n');

  for (const q of queries) {
    const parsed = router.parseQuery(q);
    const retrieved = hybridRetriever.retrieve(parsed);
    const ranked = ranker.rank(retrieved, parsed);
    
    // Optimized Pipeline (Phase 9)
    const compressionResult = compressor.compress(ranked, 5000);
    const orchidTokens = compressionResult.tokenCount;

    // Baseline Pipeline (Unoptimized extension: full file text insertion)
    const usedFiles = new Set(ranked.map(c => c.filePath));
    let baselineChars = 0;
    for (const f of usedFiles) {
      if (fs.existsSync(f)) {
        baselineChars += fs.readFileSync(f, 'utf8').length;
      }
    }
    const baselineTokens = Math.ceil(baselineChars / 4);
    
    // Guard against NaN
    const actualBaseline = baselineTokens > 0 ? baselineTokens : 1;
    const savings = (((actualBaseline - orchidTokens) / actualBaseline) * 100).toFixed(1);

    console.log(`Query: "${q}"`);
    console.log(`  Relevant Files Retrieved: ${usedFiles.size}`);
    console.log(`  Baseline Tokens (Full Files) : ${baselineTokens}`);
    console.log(`  Orchid Optimized Tokens      : ${orchidTokens}`);
    console.log(`  Token Reduction              : ${savings}%\n`);
  }
}

runBenchmark().catch(console.error);
