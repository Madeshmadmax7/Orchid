import * as ts from 'typescript';
import { ProjectIndex } from './src/knowledge/projectIndex';
import { SymbolResolver } from './src/retrieval/symbolResolver';
import { QueryRouter } from './src/retrieval/queryRouter';
import { HybridRetriever } from './src/retrieval/hybridRetriever';
import { SymbolRetriever } from './src/retrieval/symbolRetriever';
import { GraphRetriever } from './src/retrieval/graphRetriever';
import { DependencyGraph } from './src/graph/dependencyGraph';
import { ContextRanker } from './src/retrieval/contextRanker';
import { analyzeFile } from './src/analyzer/fileAnalyzer';
import { SemanticRetriever } from './src/retrieval/semanticRetriever';

const src = `class ChatRequest(BaseModel):
    message: str

class VoiceRequest(BaseModel):
    audio_data: Optional[str] = None`;

const index = new ProjectIndex();
const meta = analyzeFile('main.py', src, 'python');
index.addFile(meta);

const router = new QueryRouter();
const query = router.parseQuery('explain how the VoiceRequest and ChatRequest models work');
console.log('Target Symbols:', query.targetSymbols);

const symbolRetriever = new SymbolRetriever(index);
const mockGraphRetriever = { retrieve: () => [] } as any;
const hybrid = new HybridRetriever(symbolRetriever, mockGraphRetriever, new SemanticRetriever(), index);

const all = hybrid.retrieve(query);
console.log('Hybrid Retrieved:', all.map(c => c.id));



const ranker = new ContextRanker(index);
const ranked = ranker.rank(all, query);
console.log('Ranked:', ranked.map(c => c.id));
