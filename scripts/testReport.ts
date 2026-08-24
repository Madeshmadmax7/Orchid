import * as fs from 'fs';
import * as path from 'path';
import { ProjectIndex } from '../src/knowledge/projectIndex';
import { DependencyGraph } from '../src/graph/dependencyGraph';
import { QueryRouter } from '../src/retrieval/queryRouter';
import { HybridRetriever } from '../src/retrieval/hybridRetriever';
import { ContextRanker } from '../src/retrieval/contextRanker';
import { ContextCompressor } from '../src/retrieval/contextCompressor';
import { SymbolRetriever } from '../src/retrieval/symbolRetriever';
import { GraphRetriever } from '../src/retrieval/graphRetriever';

// Mock dependencies
const MOCK_DIR = path.join(__dirname, '../src/__mocks__/project');
const index = new ProjectIndex();
const graph = new DependencyGraph();

// Load mock project data
import { analyzeFile } from '../src/analyzer/parser';

// Pre-load all mock files
const files = [
  'api.controller.ts',
  'payment.service.ts',
  'refund.service.ts',
  'order.controller.ts',
  'order.service.ts',
  'order.repository.ts',
  'notification.controller.ts',
  'notification.service.ts',
  'inventory.service.ts',
  'inventory.repository.ts',
  'user.controller.ts',
  'user.service.ts'
];

for (const file of files) {
  const filePath = path.join(MOCK_DIR, file);
  const content = fs.readFileSync(filePath, 'utf8');
  const meta = analyzeFile(filePath, content, 'typescript');
  index.addFile(meta);
  
  graph.addNode({ id: filePath, label: file, kind: 'file', filePath });
  for (const sym of meta.symbols) {
    graph.addNode({ id: sym.id, label: sym.name, kind: sym.kind, filePath });
    graph.addEdge({ source: filePath, target: sym.id, type: 'CONTAINS' });
  }
}

// Build edges
import { DependencyAnalyzer } from '../src/analyzer/dependencyAnalyzer';
const depAnalyzer = new DependencyAnalyzer(index, graph);
for (const file of index.getAllFilePaths()) {
  depAnalyzer.analyzeDependencies(index.getFile(file)!);
}

const router = new QueryRouter();
const symbolRetriever = new SymbolRetriever(index);
const graphRetriever = new GraphRetriever(graph, index);
const hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever);
const ranker = new ContextRanker(index);
const compressor = new ContextCompressor();

const query = "Add refund support to the payment system";
const parsedQuery = router.parseQuery(query);
const allContexts = hybridRetriever.retrieve(parsedQuery);
const rankedContexts = ranker.rank(allContexts, parsedQuery);
const maxTokens = 1500;
const compressionResult = compressor.compress(rankedContexts, maxTokens);

let totalLoc = 0;
for (const filePath of index.getAllFilePaths()) {
  const meta = index.getFile(filePath);
  if (meta) totalLoc += meta.loc;
}
const baselineChars = totalLoc * 50;
const baselineTokens = Math.ceil(baselineChars / 4);

const orchidChars = compressionResult.text.length;
const finalTokens = compressionResult.tokenCount;
const candidateTokens = compressionResult.candidateTokenCount;
const budgetExceeded = finalTokens > maxTokens;

const reduction = ((1 - (finalTokens / Math.max(1, baselineTokens))) * 100).toFixed(1);

const report = 
`ORCHID TOKEN REPORT

Query:
"${query}"

Baseline:
Characters: ${baselineChars}
Estimated tokens: ${baselineTokens}

Orchid (Candidate, pre-compression):
Estimated tokens: ${candidateTokens}

Orchid (Final emitted context):
Characters: ${orchidChars}
Estimated tokens: ${finalTokens}

Estimated reduction:
${reduction}%

Files considered:
${compressionResult.filesConsidered}

Symbols retrieved:
${compressionResult.symbolsRetrieved}

Symbols included:
${compressionResult.symbolsIncluded}

Context levels:
L1: ${compressionResult.contextLevels.L1}
L2: ${compressionResult.contextLevels.L2}
L3: ${compressionResult.contextLevels.L3}

Budget:
${maxTokens} tokens

Budget exceeded:
${budgetExceeded ? 'YES' : 'NO'}

Note: These are ESTIMATED tokens. Orchid does not control the final Copilot OpenAI request and cannot report actual downstream API token usage.`;

console.log(report);
