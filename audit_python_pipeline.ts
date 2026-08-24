/**
 * Full Python Pipeline Audit
 * Tests every stage: discovery, filtering, language detection, AST extraction, 
 * symbol extraction, ID generation, hash generation, summary generation,
 * storage key generation.
 *
 * Run: npx ts-node audit_python_pipeline.ts
 */

import * as path from 'path';
import { detectLanguage, isSupportedFile } from './src/utils/languageDetector';
import { shouldIgnore, buildIncludeGlob, buildExcludeGlob } from './src/utils/ignorePatterns';
import { extractPythonSymbols, extractPythonImports, extractPythonExports } from './src/analyzer/pythonAnalyzer';
import { analyzeFile } from './src/analyzer/fileAnalyzer';
import { classifyComponent } from './src/analyzer/componentClassifier';
import { computeHash, pathToStorageKey, countLinesOfCode } from './src/utils/fileUtils';
import { generateFileSummary, generateSymbolSummary } from './src/analyzer/componentSummarizer';

// ─── Simulate backend/main.py content ────────────────────────────────────────
// This is representative of a FastAPI Python backend
const SIMULATED_MAIN_PY = `
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn
import base64

app = FastAPI()

class ChatRequest(BaseModel):
    message: str

class VoiceRequest(BaseModel):
    audio_data: Optional[str] = None

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    try:
        response_text = "Hello from backend"
        return {"response": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/voice")
async def voice_endpoint(request: VoiceRequest):
    try:
        return {"response": "voice processed"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
`.trim();

const RELATIVE_PATH = 'backend/main.py';
const ABS_PATH = '/workspace/jarvis/backend/main.py';

// ─── STAGE 1: File Discovery (glob patterns) ──────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 1: FILE DISCOVERY GLOB PATTERNS');
console.log('══════════════════════════════════════════════════════');
console.log('Include glob:', buildIncludeGlob());
console.log('Exclude glob (first 200 chars):', buildExcludeGlob().substring(0, 200) + '...');

// ─── STAGE 2: Exclusion Filtering ────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 2: EXCLUSION FILTERING');
console.log('══════════════════════════════════════════════════════');
const testPaths = [
  'backend/main.py',
  'backend/venv/lib/site-packages/fastapi/__init__.py',
  'backend/__pycache__/main.cpython-311.pyc',
  'frontend/src/components/ThemeToggle.jsx',
  'node_modules/react/index.js',
];
for (const tp of testPaths) {
  const ignored = shouldIgnore(tp);
  const status = ignored ? '❌ EXCLUDED' : '✅ INCLUDED';
  console.log(`  ${status}: ${tp}`);
}

// ─── STAGE 3: Language Detection ─────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 3: LANGUAGE DETECTION');
console.log('══════════════════════════════════════════════════════');
const language = detectLanguage(ABS_PATH);
const supported = isSupportedFile(ABS_PATH);
console.log(`  detectLanguage('${RELATIVE_PATH}') =`, language);
console.log(`  isSupportedFile('${RELATIVE_PATH}') =`, supported);
if (language !== 'python') {
  console.error('  ❌ FAILURE: Language not detected as python!');
} else {
  console.log('  ✅ Correctly detected as python');
}
if (!supported) {
  console.error('  ❌ FAILURE: .py is not considered a supported file!');
} else {
  console.log('  ✅ .py is in SUPPORTED_EXTENSIONS');
}

// ─── STAGE 4: Python AST Extraction ─────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 4: PYTHON AST / SYMBOL EXTRACTION');
console.log('══════════════════════════════════════════════════════');
const symbols = extractPythonSymbols(SIMULATED_MAIN_PY, RELATIVE_PATH);
console.log(`  Extracted ${symbols.length} symbols:`);
for (const s of symbols) {
  console.log(`    [${s.kind}] ${s.name}  id=${s.id}  line=${s.startLine}  parent=${s.parentSymbol ?? 'none'}  decorators=${JSON.stringify(s.decorators ?? [])}`);
}

const chatReq = symbols.find(s => s.name === 'ChatRequest');
const voiceReq = symbols.find(s => s.name === 'VoiceRequest');
const chatEndpoint = symbols.find(s => s.name === 'chat_endpoint');
const voiceEndpoint = symbols.find(s => s.name === 'voice_endpoint');

console.log('\n  Key symbol checks:');
console.log('  ChatRequest found?', chatReq ? `✅ [${chatReq.kind}]` : '❌ MISSING');
console.log('  VoiceRequest found?', voiceReq ? `✅ [${voiceReq.kind}]` : '❌ MISSING');
console.log('  chat_endpoint found?', chatEndpoint ? `✅ [${chatEndpoint.kind}] isAsync=${chatEndpoint.isAsync} decorators=${JSON.stringify(chatEndpoint.decorators ?? [])}` : '❌ MISSING');
console.log('  voice_endpoint found?', voiceEndpoint ? `✅ [${voiceEndpoint.kind}] isAsync=${voiceEndpoint.isAsync}` : '❌ MISSING');

// ─── STAGE 5: Python Import Extraction ───────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 5: PYTHON IMPORT EXTRACTION');
console.log('══════════════════════════════════════════════════════');
const imports = extractPythonImports(SIMULATED_MAIN_PY);
console.log(`  Extracted ${imports.length} imports:`);
for (const imp of imports) {
  console.log(`    from '${imp.source}' import [${imp.specifiers.join(', ')}]`);
}

// ─── STAGE 6: Python Export Extraction ───────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 6: PYTHON EXPORT EXTRACTION');
console.log('══════════════════════════════════════════════════════');
const pyExports = extractPythonExports(SIMULATED_MAIN_PY);
console.log(`  Extracted ${pyExports.length} exports (Python has no explicit exports; expected 0):`);

// ─── STAGE 7: Component Classification ───────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 7: COMPONENT CLASSIFICATION');
console.log('══════════════════════════════════════════════════════');
const fileType = classifyComponent(RELATIVE_PATH, symbols);
console.log(`  classifyComponent('${RELATIVE_PATH}') =`, fileType);
// main.py should classify as 'main' 
if (fileType === 'main') {
  console.log('  ✅ Correctly classified as main');
} else {
  console.log(`  ⚠️  Classified as '${fileType}' (expected 'main' because filename is main.py)`);
}

// ─── STAGE 8: Full analyzeFile() call ────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 8: FULL analyzeFile() CALL');
console.log('══════════════════════════════════════════════════════');
const metadata = analyzeFile(RELATIVE_PATH, SIMULATED_MAIN_PY, 'python');
console.log('  filePath:', metadata.filePath);
console.log('  language:', metadata.language);
console.log('  fileType:', metadata.fileType);
console.log('  hash:', metadata.hash);
console.log('  loc:', metadata.loc);
console.log('  symbols count:', metadata.symbols.length);
console.log('  imports count:', metadata.imports.length);
console.log('  exports count:', metadata.exports.length);

// ─── STAGE 9: Symbol Hashes ───────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 9: SYMBOL HASH GENERATION');
console.log('══════════════════════════════════════════════════════');
// Python symbols currently have no `hash` field set by pythonAnalyzer.
// Check if any symbol has a hash.
const symbolsWithHash = metadata.symbols.filter(s => s.hash !== undefined);
const symbolsWithoutHash = metadata.symbols.filter(s => s.hash === undefined);
console.log(`  Symbols with hash: ${symbolsWithHash.length}`);
console.log(`  Symbols WITHOUT hash: ${symbolsWithoutHash.length}`);
if (symbolsWithoutHash.length > 0) {
  console.log('  ❌ PROBLEM: Python symbols have no hash — incremental indexing cannot detect symbol-level changes');
  console.log('     (TS symbols also use endLine=startLine which prevents line-range based hash computation)');
}

// ─── STAGE 10: Summary Generation ────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 10: SUMMARY GENERATION (componentSummarizer)');
console.log('══════════════════════════════════════════════════════');
const fileSummary = generateFileSummary(metadata);
console.log('  File summary:\n');
console.log(fileSummary.split('\n').map(l => '    ' + l).join('\n'));

// ─── STAGE 11: Storage Key Generation ────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 11: STORAGE KEY (pathToStorageKey)');
console.log('══════════════════════════════════════════════════════');
const storageKey = pathToStorageKey(RELATIVE_PATH);
console.log(`  pathToStorageKey('${RELATIVE_PATH}') = '${storageKey}'`);
console.log(`  Would be saved as: .project-memory/files/${storageKey}.json`);

// ─── STAGE 12: Python-specific Issues ─────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('STAGE 12: PYTHON-SPECIFIC ISSUES SUMMARY');
console.log('══════════════════════════════════════════════════════');

// Issue: pythonAnalyzer uses only basename for ID, not relative path
// This means two files in different dirs with same basename will clash
const ids = metadata.symbols.map(s => s.id);
const uniqueIds = new Set(ids);
if (ids.length !== uniqueIds.size) {
  console.log('  ❌ COLLISION: Duplicate symbol IDs detected!');
} else {
  console.log('  ✅ No duplicate symbol IDs');
}

// The ID format: `basename#name:kind` vs TS which uses full relative path
const sampleId = metadata.symbols[0]?.id ?? '(none)';
console.log(`  Sample ID format: '${sampleId}'`);
const usesBasename = sampleId.startsWith('main.py#');
const usesRelativePath = sampleId.startsWith('backend/');
console.log(`  Uses basename only: ${usesBasename}`);
console.log(`  Uses relative path: ${usesRelativePath}`);
if (usesBasename && !usesRelativePath) {
  console.log('  ❌ PROBLEM: IDs use basename only (main.py#...) instead of relative path (backend/main.py#...)');
  console.log('     This means symbols from TWO different main.py files would collide in the ProjectIndex!');
  console.log('     SymbolResolver.ts looks up by ID: symbolById.get(symbol.id) which would be wrong.');
}

// Check endLine vs startLine for Python symbols (affects incremental hash)
const multiLineSymbols = metadata.symbols.filter(s => s.endLine !== s.startLine);
const singleLineSymbols = metadata.symbols.filter(s => s.endLine === s.startLine);
console.log(`\n  Symbols with startLine === endLine (single line): ${singleLineSymbols.length}`);
console.log(`  Symbols spanning multiple lines: ${multiLineSymbols.length}`);
if (singleLineSymbols.length > 0) {
  console.log('  ⚠️  WARNING: All Python symbols have endLine === startLine. Body ranges are missing.');
  console.log('     This means the symbol body cannot be hashed for incremental change detection.');
}

console.log('\n══════════════════════════════════════════════════════');
console.log('AUDIT COMPLETE');
console.log('══════════════════════════════════════════════════════\n');
