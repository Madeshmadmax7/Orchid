import { buildIncludeGlob, buildExcludeGlob, shouldIgnore } from './src/utils/ignorePatterns';
import { isSupportedFile } from './src/utils/languageDetector';

console.log("Exclude glob:", buildExcludeGlob());
console.log("Include glob:", buildIncludeGlob());
console.log("backend/main.py should ignore?", shouldIgnore('backend/main.py'));
console.log("backend/venv/foo.py should ignore?", shouldIgnore('backend/venv/foo.py'));
console.log("backend/main.py is supported?", isSupportedFile('backend/main.py'));
