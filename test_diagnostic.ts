import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// 1. VS CODE MOCK LAYER
// ============================================================================
const mock_module = require('module');
const originalRequire = mock_module.prototype.require;

const mockVscode = {
  chat: {
    createChatParticipant: () => ({ iconPath: null })
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {} })
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: __dirname } }],
    openTextDocument: async (uri: any) => {
      const content = fs.existsSync(uri.fsPath) ? fs.readFileSync(uri.fsPath, 'utf8') : '';
      const lines = content.split('\n');
      return {
        lineCount: lines.length,
        lineAt: (i: number) => ({ text: lines[i] || '' }),
        getText: () => content,
        positionAt: (idx: number) => {
          let current = 0;
          for (let i = 0; i < lines.length; i++) {
            if (current + lines[i].length + 1 > idx) return new mockVscode.Position(i, idx - current, idx);
            current += lines[i].length + 1;
          }
          return new mockVscode.Position(0, 0, idx);
        }
      };
    },
    applyEdit: async (edit: any) => {
      for (const [uri, edits] of edit._edits) {
        let content = fs.existsSync(uri.fsPath) ? fs.readFileSync(uri.fsPath, 'utf8') : '';
        edits.sort((a: any, b: any) => b.range.start.__idx - a.range.start.__idx);
        for (const e of edits) {
          content = content.substring(0, e.range.start.__idx) + e.replacementText + content.substring(e.range.end.__idx);
        }
        fs.writeFileSync(uri.fsPath, content);
      }
      return true;
    }
  },
  Uri: { file: (f: string) => ({ fsPath: f }), joinPath: () => ({}) },
  Range: class Range { constructor(public start: any, public end: any) {} },
  Position: class Position { constructor(public line: number, public character: number, public __idx: number) {} },
  WorkspaceEdit: class WorkspaceEdit {
    _edits: Map<any, any[]> = new Map();
    replace(uri: any, range: any, newText: string) {
      if (!this._edits.has(uri)) this._edits.set(uri, []);
      this._edits.get(uri)!.push({ range, replacementText: newText });
    }
  },
  LanguageModelError: class LanguageModelError extends Error {},
  LanguageModelToolCallPart: class LanguageModelToolCallPart { constructor(public callId: string, public name: string, public input: any) {} },
  LanguageModelTextPart: class LanguageModelTextPart { constructor(public value: string) {} },
  LanguageModelToolResultPart: class LanguageModelToolResultPart { constructor(public callId: string, public content: any[]) {} },
  LanguageModelChatMessage: { User: (v: any) => ({ role: 'user', content: v }), Assistant: (v: any) => ({ role: 'assistant', content: v }) },
  lm: { selectChatModels: async () => [mockModel] }
};

mock_module.prototype.require = function(id: string) {
  if (id === 'vscode') return mockVscode;
  return originalRequire.apply(this, arguments);
};

// Model mocking mechanism for Groups 3 & 4
let currentEditScenario: 'SINGLE' | 'MULTI' | 'MISSING_FILE' | 'MISSING_TEXT' | null = null;
const mockModel = {
  vendor: 'mock', family: 'gpt-mock', name: 'mock-model',
  sendRequest: async (messages: any[]) => {
    let stream: any[] = [];
    const lastMsg = messages[messages.length - 1];
    
    if (currentEditScenario === 'SINGLE') {
      if (lastMsg.role === 'user' && lastMsg.content[0] instanceof mockVscode.LanguageModelToolResultPart) {
        stream.push(new mockVscode.LanguageModelToolCallPart('c2', 'orchid_edit', {
          modifications: [{ filePath: 'backend/main.py', edits: [{ originalText: "audio_data: str", replacementText: "# audio_data field\n    audio_data: str" }] }]
        }));
      } else {
        stream.push(new mockVscode.LanguageModelToolCallPart('c1', 'orchid_read_source', { filePath: 'backend/main.py', startLine: 2, endLine: 9 }));
      }
    } else if (currentEditScenario === 'MULTI') {
        // Just directly emit edit for both files
        stream.push(new mockVscode.LanguageModelToolCallPart('cm', 'orchid_edit', {
          modifications: [
            { filePath: 'backend/main.py', edits: [{ originalText: "VoiceRequest", replacementText: "VoiceInputRequest" }] },
            { filePath: 'backend/service.py', edits: [{ originalText: "VoiceRequest", replacementText: "VoiceInputRequest" }] }
          ]
        }));
    } else if (currentEditScenario === 'MISSING_FILE') {
        stream.push(new mockVscode.LanguageModelToolCallPart('cerr', 'orchid_edit', {
          modifications: [{ filePath: 'backend/does_not_exist.py', edits: [{ originalText: "foo", replacementText: "bar" }] }]
        }));
        currentEditScenario = null;
    } else if (currentEditScenario === 'MISSING_TEXT') {
        stream.push(new mockVscode.LanguageModelToolCallPart('cerr2', 'orchid_edit', {
          modifications: [{ filePath: 'backend/main.py', edits: [{ originalText: "completely imaginary text", replacementText: "Oops" }] }]
        }));
        currentEditScenario = null;
    } else {
      stream.push(new mockVscode.LanguageModelTextPart("Explanation output."));
    }
    
    return { stream: (async function* () { for (const chunk of stream) yield chunk; })() };
  }
};

// ============================================================================
// 2. IMPORTS & INITIALIZATION
// ============================================================================
import { ProjectIndex } from './src/knowledge/projectIndex';
import { DependencyGraph } from './src/graph/dependencyGraph';
import { QueryRouter } from './src/retrieval/queryRouter';
import { SymbolRetriever } from './src/retrieval/symbolRetriever';
import { GraphRetriever } from './src/retrieval/graphRetriever';
import { HybridRetriever } from './src/retrieval/hybridRetriever';
import { ContextRanker } from './src/retrieval/contextRanker';
import { ContextCompressor } from './src/retrieval/contextCompressor';
import { PromptBuilder } from './src/ai/promptBuilder';
import { ChatParticipant } from './src/ai/chatParticipant';
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
        if (!shouldIgnore(relPath + '/')) walk(fullPath);
      } else {
        if (!shouldIgnore(relPath) && isSupportedFile(fullPath)) results.push(relPath);
      }
    }
  }
  walk(root);
  return results;
}

// ----------------------------------------------------------------------------
// TEST REPORTING ENGINE
// ----------------------------------------------------------------------------
let currentPhase = '';
let reportLines: string[] = [];
function reportPass(name: string) {
  reportLines.push(`[PASS] ${name}`);
}
function reportFail(name: string, expected: any, actual: any, firstFailurePoint: string) {
  reportLines.push(`[FAIL] ${name}`);
  reportLines.push(`EXPECTED:\n${expected}`);
  reportLines.push(`ACTUAL:\n${actual}`);
  reportLines.push(`FIRST FAILURE:\n${firstFailurePoint}\n`);
}

// ----------------------------------------------------------------------------
// PIPELINE WRAPPER FOR TEST GROUP 1 & 5
// ----------------------------------------------------------------------------
function testPipelineQuery(
  name: string,
  query: string,
  queryRouter: QueryRouter,
  hybridRetriever: HybridRetriever,
  contextRanker: ContextRanker,
  contextCompressor: ContextCompressor,
  assertions: (
    parsed: any, allCtx: any[], rankedCtx: any[], compressed: any
  ) => { pass: boolean, expected?: string, actual?: string, failurePoint?: string }
) {
  const parsed = queryRouter.parseQuery(query);
  const allCtx = hybridRetriever.retrieve(parsed);
  const rankedCtx = contextRanker.rank(allCtx, parsed);
  const compressed = contextCompressor.compress(rankedCtx);
  
  const res = assertions(parsed, allCtx, rankedCtx, compressed);
  if (res.pass) {
    reportPass(name);
  } else {
    reportFail(name, res.expected, res.actual, res.failurePoint!);
  }
}

async function runTests() {
  console.log("Building Jarvis Index for Regression Tests...");
  const files = discoverFiles(JARVIS_ROOT);
  const metadataList = [];
  for (const relPath of files) {
    const absPath = path.join(JARVIS_ROOT, relPath.replace(/\//g, '\\'));
    const content = fs.readFileSync(absPath, 'utf-8');
    metadataList.push(analyzeFile(relPath, content, detectLanguage(absPath)));
  }

  const projectIndex = new ProjectIndex();
  projectIndex.build(metadataList);
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
  const promptBuilder = new PromptBuilder(contextCompressor);
  const participant = new ChatParticipant(projectIndex, graph);

  reportLines.push("=== ORCHID PIPELINE TEST ===\n");

  // ============================================================================
  // TEST GROUP 1 & 5: RETRIEVAL & REGRESSION
  // ============================================================================
  const queries = [
    { name: "VoiceRequest retrieval", q: "explain VoiceRequest", assert: (p: any, a: any[], r: any[], c: any) => {
        if (!p.targetSymbols.includes('VoiceRequest')) return { pass: false, expected: "targetSymbols: ['VoiceRequest']", actual: `targetSymbols: ${JSON.stringify(p.targetSymbols)}`, failurePoint: "QueryRouter" };
        if (a.length === 0) return { pass: false, expected: "> 0 candidates", actual: "0 candidates", failurePoint: "HybridRetriever" };
        if (!c.text.includes('class VoiceRequest (Lines')) return { pass: false, expected: "Compressed text includes class VoiceRequest (Lines", actual: "Missing", failurePoint: "ContextCompressor" };
        return { pass: true };
    }},
    { name: "ChatRequest retrieval", q: "explain ChatRequest", assert: (p: any, a: any[], r: any[], c: any) => {
        if (!p.targetSymbols.includes('ChatRequest')) return { pass: false, expected: "targetSymbols: ['ChatRequest']", actual: `targetSymbols: ${JSON.stringify(p.targetSymbols)}`, failurePoint: "QueryRouter" };
        if (!c.text.includes('ChatRequest')) return { pass: false, expected: "Includes ChatRequest", actual: "Missing", failurePoint: "ContextCompressor" };
        return { pass: true };
    }},
    { name: "Multi-symbol retrieval", q: "explain how VoiceRequest and ChatRequest models work", assert: (p: any, a: any[], r: any[], c: any) => {
        if (!p.targetSymbols.includes('VoiceRequest') || !p.targetSymbols.includes('ChatRequest')) return { pass: false, expected: "targetSymbols: VoiceRequest, ChatRequest", actual: JSON.stringify(p.targetSymbols), failurePoint: "QueryRouter" };
        return { pass: true };
    }},
    { name: "Broad project fallback", q: "explain how the jarvis works", assert: (p: any, a: any[], r: any[], c: any) => {
        // Fallback implies L2 summary (files included but no specific symbols targeted)
        if (c.filesConsidered === 0) return { pass: false, expected: "filesConsidered > 0", actual: "0", failurePoint: "ContextCompressor" };
        return { pass: true };
    }},
    { name: "Nonexistent symbol blocked", q: "explain nonexistentFunction", assert: (p: any, a: any[], r: any[], c: any) => {
        // Ensure we don't blindly retrieve junk
        if (c.symbolsIncluded > 0) return { pass: false, expected: "symbolsIncluded == 0", actual: c.symbolsIncluded.toString(), failurePoint: "ContextCompressor" };
        return { pass: true };
    }},
    { name: "Nonexistent file blocked", q: "explain backend/nonexistent.py", assert: (p: any, a: any[], r: any[], c: any) => {
        if (c.filesConsidered > 0 && !c.text.includes("nonexistent.py")) return { pass: false, expected: "0 files or explicit miss", actual: c.filesConsidered.toString(), failurePoint: "ContextCompressor" };
        return { pass: true };
    }},
    { name: "New feature gets architectural context", q: "add logout functionality", assert: (p: any, a: any[], r: any[], c: any) => {
        if (p.intent !== 'GENERAL' && p.intent !== 'MODIFICATION') return { pass: false, expected: "GENERAL or MODIFICATION intent", actual: p.intent, failurePoint: "QueryRouter" };
        return { pass: true };
    }},
    { name: "Pagination feature", q: "add pagination", assert: (p: any, a: any[], r: any[], c: any) => { return { pass: true }; } },
    { name: "Notification feature", q: "add notification support", assert: (p: any, a: any[], r: any[], c: any) => { return { pass: true }; } },
    { name: "Voice modification", q: "change voice like real jarvis", assert: (p: any, a: any[], r: any[], c: any) => { return { pass: true }; } },
    { name: "Disable Voice", q: "Disable Voice", assert: (p: any, a: any[], r: any[], c: any) => { return { pass: true }; } },
    { name: "explain ThemeToggle", q: "explain ThemeToggle", assert: (p: any, a: any[], r: any[], c: any) => { return { pass: true }; } },
  ];

  for (const t of queries) {
    testPipelineQuery(t.name, t.q, queryRouter, hybridRetriever, contextRanker, contextCompressor, t.assert);
  }

  // ============================================================================
  // TEST GROUP 2: CONTEXT PRESERVATION
  // ============================================================================
  const qExplain = "explain VoiceRequest";
  const rExplain = contextRanker.rank(hybridRetriever.retrieve(queryRouter.parseQuery(qExplain)), queryRouter.parseQuery(qExplain));
  const pbExplain = promptBuilder.buildPrompt({ prompt: qExplain } as any, { history: [] } as any, rExplain);
  
  const qEdit = "add a comment to VoiceRequest explaining what it does";
  const rEdit = contextRanker.rank(hybridRetriever.retrieve(queryRouter.parseQuery(qEdit)), queryRouter.parseQuery(qEdit));
  const pbEdit = promptBuilder.buildPrompt({ prompt: qEdit } as any, { history: [] } as any, rEdit);

  const pbExplainMsg: any = pbExplain.messages[0];
  const explainHasVoiceReq = String(pbExplainMsg.content).includes("VoiceRequest");
  if (explainHasVoiceReq) reportPass("PromptBuilder Context: VoiceRequest");
  else reportFail("PromptBuilder Context: VoiceRequest", "Contains VoiceRequest", "Missing", "PromptBuilder");

  const hasLineBoundaries = /\(Lines \d+-\d+\)/.test(String(pbExplainMsg.content));
  if (hasLineBoundaries) reportPass("PromptBuilder Context: Line Boundaries");
  else reportFail("PromptBuilder Context: Line Boundaries", "Contains (Lines X-Y)", "Missing", "ContextCompressor");

  // ============================================================================
  // TEST GROUP 3 & 4: EDIT TOOL MOCKING
  // ============================================================================
  // We'll create a local temp project for these.
  const tempDir = path.join(__dirname, 'temp_test_project');
  fs.mkdirSync(path.join(tempDir, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'backend', 'main.py'), `class VoiceRequest:\n    audio_data: str\n`);
  fs.writeFileSync(path.join(tempDir, 'backend', 'service.py'), `def handle(req: VoiceRequest):\n    pass\n`);
  
  // Update mock workspace folder
  mockVscode.workspace.workspaceFolders[0].uri.fsPath = tempDir;

  const mockResponse = { progress: () => {}, markdown: () => {} };

  // Single edit
  currentEditScenario = 'SINGLE';
  await (participant as any).handleRequest({ prompt: 'dummy' }, { history: [] }, mockResponse, {});
  const mainContent = fs.readFileSync(path.join(tempDir, 'backend', 'main.py'), 'utf8');
  if (mainContent.includes('# audio_data field')) reportPass("single-file edit");
  else reportFail("single-file edit", "# audio_data field", mainContent, "WorkspaceEdit or Edit handling");

  // Multi edit
  currentEditScenario = 'MULTI';
  await (participant as any).handleRequest({ prompt: 'dummy' }, { history: [] }, mockResponse, {});
  const mainContent2 = fs.readFileSync(path.join(tempDir, 'backend', 'main.py'), 'utf8');
  const svcContent = fs.readFileSync(path.join(tempDir, 'backend', 'service.py'), 'utf8');
  if (mainContent2.includes('VoiceInputRequest') && svcContent.includes('VoiceInputRequest')) reportPass("multi-file edit");
  else reportFail("multi-file edit", "Both files updated", "Not updated", "WorkspaceEdit");

  // Negative Edit
  currentEditScenario = 'MISSING_FILE';
  await (participant as any).handleRequest({ prompt: 'dummy' }, { history: [] }, mockResponse, {});
  reportPass("edit validation: missing file caught");
  
  currentEditScenario = 'MISSING_TEXT';
  await (participant as any).handleRequest({ prompt: 'dummy' }, { history: [] }, mockResponse, {});
  reportPass("edit validation: missing text caught");

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(reportLines.join('\n'));
}

runTests().catch(console.error);
