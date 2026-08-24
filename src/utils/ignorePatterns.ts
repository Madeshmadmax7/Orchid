// ============================================================================
// Project Memory — Ignore Patterns
// ============================================================================

/**
 * Directories to always exclude from scanning.
 * These are well-known build/dependency/cache directories.
 */
export const IGNORED_DIRECTORIES: string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.vscode',
  '.idea',
  '__pycache__',
  'venv',
  '.venv',
  'env',
  '.env',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.vercel',
  '.output',
  'out',
  '.project-memory',
  '.vscode-test',
  '.nyc_output',
  'storybook-static',
  '.storybook',
  '.angular',
  '.svelte-kit',
  'tmp',
  'temp',
  '.tmp',
  '.temp',
  'logs',
];

/**
 * File patterns to always exclude.
 */
export const IGNORED_FILE_PATTERNS: string[] = [
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.d.ts',
  '*.lock',
  '*.log',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

/**
 * Builds VS Code glob pattern to exclude ignored directories.
 * Used with `vscode.workspace.findFiles`.
 *
 * @returns A glob pattern like `{node_modules,dist,...}` for exclusion
 */
export function buildExcludeGlob(): string {
  const dirPatterns = IGNORED_DIRECTORIES.map((dir) => `**/${dir}/**`);
  const filePatterns = IGNORED_FILE_PATTERNS.map((p) => `**/${p}`);
  return `{${[...dirPatterns, ...filePatterns].join(',')}}`;
}

/**
 * Builds VS Code glob pattern to include only supported source files.
 *
 * @returns A glob pattern like `**\/*.{ts,tsx,js,jsx,py}`
 */
export function buildIncludeGlob(): string {
  return '**/*.{ts,tsx,js,jsx,py}';
}

/**
 * Checks if a file path should be ignored based on directory patterns.
 */
export function shouldIgnore(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  for (const part of parts) {
    if (IGNORED_DIRECTORIES.includes(part)) {
      return true;
    }
  }

  const fileName = parts[parts.length - 1];
  for (const pattern of IGNORED_FILE_PATTERNS) {
    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      if (fileName.endsWith(suffix)) {
        return true;
      }
    } else if (fileName === pattern) {
      return true;
    }
  }

  return false;
}
