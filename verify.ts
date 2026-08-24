import * as fs from 'fs';
import * as path from 'path';
import { buildExcludeGlob, buildIncludeGlob, shouldIgnore } from './src/utils/ignorePatterns';

const DUMMY_DIR = path.join(__dirname, 'jarvis');
const APP_DIR = path.join(DUMMY_DIR, 'backend/app');
const VENV_DIR1 = path.join(DUMMY_DIR, 'backend/venv/Lib/site-packages/werkzeug/debug/shared');
const VENV_DIR2 = path.join(DUMMY_DIR, 'backend/venv/Lib/site-packages/urllib3/contrib/emscripten');

// Create dummy dirs
fs.mkdirSync(APP_DIR, { recursive: true });
fs.mkdirSync(VENV_DIR1, { recursive: true });
fs.mkdirSync(VENV_DIR2, { recursive: true });

// Create dummy files
fs.writeFileSync(path.join(APP_DIR, 'main.ts'), 'export const run = () => {};');
fs.writeFileSync(path.join(VENV_DIR1, 'debugger.js'), 'function debug() {}');
fs.writeFileSync(path.join(VENV_DIR2, 'emscripten_fetch_worker.js'), 'function fetch() {}');

const appFile = path.join('backend', 'app', 'main.ts');
const venvFile1 = path.join('backend', 'venv', 'Lib', 'site-packages', 'werkzeug', 'debug', 'shared', 'debugger.js');

console.log('--- Verifying File Discovery ---');
console.log(`Exclude Glob: ${buildExcludeGlob()}`);
console.log(`Include Glob: ${buildIncludeGlob()}`);
console.log(`App file ignored: ${shouldIgnore(appFile)} (Expected: false)`);
console.log(`Venv file ignored: ${shouldIgnore(venvFile1)} (Expected: true)`);

// Cleanup
fs.rmSync(DUMMY_DIR, { recursive: true, force: true });
