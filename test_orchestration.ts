import * as path from 'path';
import * as fs from 'fs';

const mock_module = require('module');
const originalRequire = mock_module.prototype.require;

// 1. Mock VS Code
const mockVscode = {
  chat: {
    createChatParticipant: () => ({ iconPath: null })
  },
  window: {
    createOutputChannel: () => ({ appendLine: console.log, show: () => {} })
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: __dirname } }],
    openTextDocument: async (uri: any) => {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      const lines = content.split('\n');
      return {
        lineCount: lines.length,
        lineAt: (i: number) => ({ text: lines[i] }),
        getText: () => content,
        positionAt: (idx: number) => {
          let current = 0;
          for (let i = 0; i < lines.length; i++) {
            if (current + lines[i].length + 1 > idx) {
              return new mockVscode.Position(i, idx - current, idx);
            }
            current += lines[i].length + 1;
          }
          return new mockVscode.Position(0, 0, idx);
        }
      };
    },
    applyEdit: async (edit: any) => {
      for (const [uri, edits] of edit._edits) {
        let content = fs.readFileSync(uri.fsPath, 'utf8');
        // Sort by index descending to avoid offset issues
        edits.sort((a: any, b: any) => b.range.start.__idx - a.range.start.__idx);
        for (const e of edits) {
          const startIdx = e.range.start.__idx;
          const endIdx = e.range.end.__idx;
          content = content.substring(0, startIdx) + e.replacementText + content.substring(endIdx);
        }
        fs.writeFileSync(uri.fsPath, content);
        console.log(`\n[MOCK] Applied edit to ${uri.fsPath}`);
      }
      return true;
    }
  },
  Uri: {
    file: (f: string) => ({ fsPath: f }),
    joinPath: () => ({})
  },
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
  LanguageModelToolCallPart: class LanguageModelToolCallPart {
    constructor(public callId: string, public name: string, public input: any) {}
  },
  LanguageModelTextPart: class LanguageModelTextPart {
    constructor(public value: string) {}
  },
  LanguageModelToolResultPart: class LanguageModelToolResultPart {
    constructor(public callId: string, public content: any[]) {}
  },
  LanguageModelChatMessage: {
    User: (v: any) => ({ role: 'user', content: v }),
    Assistant: (v: any) => ({ role: 'assistant', content: v })
  },
  lm: {
    selectChatModels: async () => [mockModel]
  }
};

mock_module.prototype.require = function(id: string) {
  if (id === 'vscode') return mockVscode;
  return originalRequire.apply(this, arguments);
};

// 2. Mock Model Simulation
let testScenario: 'EXPLAIN' | 'EDIT' | 'NEGATIVE_MISSING_FILE' | 'NEGATIVE_INVALID_SYMBOL' | 'NEGATIVE_ORIGINAL_TEXT_NOT_FOUND' = 'EDIT';

const mockModel = {
  vendor: 'mock',
  family: 'gpt-mock',
  name: 'mock-model',
  sendRequest: async (messages: any[], options: any, token: any) => {
    console.log(`[MOCK LM] Received ${messages.length} messages.`);
    let stream: any[] = [];
    
    // Check if we are responding to a tool result
    const lastMsg = messages[messages.length - 1];
    
    if (testScenario === 'EXPLAIN') {
      stream.push(new mockVscode.LanguageModelTextPart("This is an explanation of VoiceRequest."));
    } else if (testScenario === 'EDIT') {
      if (lastMsg.role === 'user' && lastMsg.content[0] instanceof mockVscode.LanguageModelToolResultPart) {
        // We received the tool result (source code)
        console.log(`[MOCK LM] Received tool result for read_source. Submitting orchid_edit.`);
        
        const sourceCode = lastMsg.content[0].content[0].value;
        const originalText = "class VoiceRequest:\n    audio_data: str";
        const replacementText = "class VoiceRequest:\n    # Represents a request for a voice interaction\n    audio_data: str";
        
        stream.push(new mockVscode.LanguageModelToolCallPart('call-2', 'orchid_edit', {
          modifications: [
            {
              filePath: 'backend/main.py',
              edits: [
                {
                  originalText: originalText,
                  replacementText: replacementText
                }
              ]
            }
          ]
        }));
      } else {
        // First turn: invoke read_source
        console.log(`[MOCK LM] First turn. Submitting orchid_read_source.`);
        stream.push(new mockVscode.LanguageModelToolCallPart('call-1', 'orchid_read_source', {
          filePath: 'backend/main.py',
          startLine: 2, // From L1/L2 Context
          endLine: 9
        }));
      }
    } else if (testScenario === 'NEGATIVE_MISSING_FILE') {
        stream.push(new mockVscode.LanguageModelToolCallPart('call-err', 'orchid_read_source', {
          filePath: 'backend/does_not_exist.py'
        }));
        testScenario = 'EXPLAIN'; // End loop after err
    } else if (testScenario === 'NEGATIVE_ORIGINAL_TEXT_NOT_FOUND') {
        stream.push(new mockVscode.LanguageModelToolCallPart('call-err2', 'orchid_edit', {
          modifications: [{
            filePath: 'backend/main.py',
            edits: [{ originalText: "This text is completely imaginary", replacementText: "Oops" }]
          }]
        }));
        testScenario = 'EXPLAIN'; // End loop
    }
    
    return {
      stream: (async function* () {
        for (const chunk of stream) yield chunk;
      })()
    };
  }
};

// 3. Main Test
import { ProjectIndex } from './src/knowledge/projectIndex';
import { DependencyGraph } from './src/graph/dependencyGraph';
import { ChatParticipant } from './src/ai/chatParticipant';
import { extractPythonSymbols } from './src/analyzer/pythonAnalyzer';
import { analyzeFile } from './src/analyzer/fileAnalyzer';

async function runTest() {
  console.log("=== Setting up Mock Project ===");
  const pyCode = `
class VoiceRequest:
    audio_data: str

    def __init__(self, data: str):
        self.audio_data = data

    def to_speech(self):
        print(self.audio_data)
`;

  // Write temporary file
  const testFile = path.join(__dirname, 'backend', 'main.py');
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, pyCode);

  const metadata = analyzeFile('backend/main.py', pyCode, 'python');
  const projectIndex = new ProjectIndex();
  projectIndex.build([metadata]);

  const participant = new ChatParticipant(projectIndex, new DependencyGraph());

  const mockResponse = {
    progress: (msg: string) => console.log(`[PROGRESS] ${msg}`),
    markdown: (msg: string) => console.log(`[MARKDOWN] ${msg}`)
  };

  // Run Test 1: EDIT
  console.log("\n\n=== Test 1: EDIT SCENARIO ===");
  testScenario = 'EDIT';
  await (participant as any).handleRequest(
    { prompt: 'add a comment to VoiceRequest explaining what it does' },
    { history: [] },
    mockResponse,
    {}
  );
  
  // Verify file modification
  const newContent = fs.readFileSync(testFile, 'utf8');
  console.log(`\n[ASSERT] File modified successfully: ${newContent.includes('Represents a request')}`);

  // Run Test 2: EXPLAIN
  console.log("\n\n=== Test 2: EXPLAIN SCENARIO ===");
  testScenario = 'EXPLAIN';
  await (participant as any).handleRequest(
    { prompt: 'explain VoiceRequest' },
    { history: [] },
    mockResponse,
    {}
  );

  // Run Test 3: NEGATIVE - FILE NOT FOUND
  console.log("\n\n=== Test 3: NEGATIVE (MISSING FILE) ===");
  testScenario = 'NEGATIVE_MISSING_FILE';
  await (participant as any).handleRequest(
    { prompt: 'modify missing' },
    { history: [] },
    mockResponse,
    {}
  );

  // Run Test 4: NEGATIVE - ORIGINAL TEXT NOT FOUND
  console.log("\n\n=== Test 4: NEGATIVE (TEXT NOT FOUND) ===");
  testScenario = 'NEGATIVE_ORIGINAL_TEXT_NOT_FOUND';
  await (participant as any).handleRequest(
    { prompt: 'modify missing text' },
    { history: [] },
    mockResponse,
    {}
  );

  console.log("\n=== All tests finished ===");
}

runTest().catch(console.error);
