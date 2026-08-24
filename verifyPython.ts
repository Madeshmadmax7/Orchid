import * as fs from 'fs';
import * as path from 'path';
import { ProjectIndex } from './src/knowledge/projectIndex';
import { DependencyGraph } from './src/graph/dependencyGraph';
import { analyzeFile } from './src/analyzer/fileAnalyzer';
import { buildExcludeGlob, buildIncludeGlob, shouldIgnore } from './src/utils/ignorePatterns';
import { detectLanguage } from './src/utils/languageDetector';

const DUMMY_DIR = path.join(__dirname, 'jarvis');
const APP_DIR = path.join(DUMMY_DIR, 'backend');
const VENV_DIR1 = path.join(DUMMY_DIR, 'backend/venv/Lib/site-packages/werkzeug/debug/shared');
const VENV_DIR2 = path.join(DUMMY_DIR, 'backend/venv/Lib/site-packages/urllib3/contrib/emscripten');

// Create dummy dirs
fs.mkdirSync(APP_DIR, { recursive: true });
fs.mkdirSync(VENV_DIR1, { recursive: true });
fs.mkdirSync(VENV_DIR2, { recursive: true });

// Create dummy files
fs.writeFileSync(path.join(APP_DIR, 'main.py'), 'class ChatRequest:\n    message: str\n\ndef my_endpoint():\n    return "hello"');
fs.writeFileSync(path.join(APP_DIR, 'assistant.py'), 'class Assistant:\n    pass');
fs.writeFileSync(path.join(APP_DIR, 'voice.py'), 'def process_voice():\n    pass');
fs.writeFileSync(path.join(VENV_DIR1, 'debugger.js'), 'function debug() {}');
fs.writeFileSync(path.join(VENV_DIR2, 'emscripten_fetch_worker.js'), 'function fetch() {}');

const files = [
  'backend/main.py',
  'backend/assistant.py',
  'backend/voice.py',
  'backend/venv/Lib/site-packages/werkzeug/debug/shared/debugger.js',
  'backend/venv/Lib/site-packages/urllib3/contrib/emscripten/emscripten_fetch_worker.js'
];

let indexedFiles = 0;
let indexedSymbols = 0;

for (const file of files) {
  if (shouldIgnore(file)) {
    console.log(`[IGNORED] ${file}`);
    continue;
  }
  
  const fullPath = path.join(DUMMY_DIR, file);
  const content = fs.readFileSync(fullPath, 'utf8');
  const lang = detectLanguage(fullPath);
  
  try {
    const meta = analyzeFile(fullPath, content, lang);
    console.log(`[INDEXED] ${file} (Symbols: ${meta.symbols.length})`);
    indexedFiles++;
    indexedSymbols += meta.symbols.length;
  } catch (e: any) {
    console.error(`[ERROR] Failed to index ${file}: ${e.message}`);
  }
}

console.log(`\nFiles Indexed: ${indexedFiles}`);
console.log(`Symbols Indexed: ${indexedSymbols}`);

// Cleanup
fs.rmSync(DUMMY_DIR, { recursive: true, force: true });
