// ============================================================================
// Project Memory — Component Classifier
// ============================================================================
// Classifies files into component types using heuristics:
// 1. File name patterns (*.service.ts → service)
// 2. Directory location (middleware/ → middleware)
// 3. Code patterns (decorators, React components, exports)
// ============================================================================

import * as path from 'path';
import { ComponentType, SymbolInfo } from '../types';

/**
 * File name suffix → component type mapping.
 * Order matters: first match wins.
 */
const FILE_NAME_PATTERNS: [RegExp, ComponentType][] = [
  [/\.controller\.(ts|tsx|js|jsx)$/i, 'controller'],
  [/\.service\.(ts|tsx|js|jsx)$/i, 'service'],
  [/\.repository\.(ts|tsx|js|jsx)$/i, 'repository'],
  [/\.gateway\.(ts|tsx|js|jsx)$/i, 'gateway'],
  [/\.middleware\.(ts|tsx|js|jsx)$/i, 'middleware'],
  [/\.guard\.(ts|tsx|js|jsx)$/i, 'guard'],
  [/\.pipe\.(ts|tsx|js|jsx)$/i, 'pipe'],
  [/\.interceptor\.(ts|tsx|js|jsx)$/i, 'interceptor'],
  [/\.decorator\.(ts|tsx|js|jsx)$/i, 'decorator'],
  [/\.module\.(ts|tsx|js|jsx)$/i, 'module'],
  [/\.model\.(ts|tsx|js|jsx)$/i, 'model'],
  [/\.entity\.(ts|tsx|js|jsx)$/i, 'model'],
  [/\.dto\.(ts|tsx|js|jsx)$/i, 'model'],
  [/\.schema\.(ts|tsx|js|jsx)$/i, 'model'],
  [/\.interface\.(ts|tsx|js|jsx)$/i, 'interface'],
  [/\.type\.(ts|tsx|js|jsx)$/i, 'type'],
  [/\.types\.(ts|tsx|js|jsx)$/i, 'type'],
  [/\.enum\.(ts|tsx|js|jsx)$/i, 'enum'],
  [/\.constant[s]?\.(ts|tsx|js|jsx)$/i, 'constant'],
  [/\.config\.(ts|tsx|js|jsx)$/i, 'config'],
  [/\.handler\.(ts|tsx|js|jsx)$/i, 'handler'],
  [/\.hook\.(ts|tsx|js|jsx)$/i, 'hook'],
  [/\.util[s]?\.(ts|tsx|js|jsx)$/i, 'utility'],
  [/\.helper[s]?\.(ts|tsx|js|jsx)$/i, 'utility'],
  [/\.(spec|test)\.(ts|tsx|js|jsx)$/i, 'test'],
  [/\.(e2e-spec|e2e)\.(ts|tsx|js|jsx)$/i, 'test'],
];

/**
 * Directory name → component type mapping.
 */
const DIRECTORY_PATTERNS: Record<string, ComponentType> = {
  controllers: 'controller',
  services: 'service',
  repositories: 'repository',
  models: 'model',
  entities: 'model',
  middleware: 'middleware',
  middlewares: 'middleware',
  guards: 'guard',
  pipes: 'pipe',
  interceptors: 'interceptor',
  decorators: 'decorator',
  modules: 'module',
  hooks: 'hook',
  utils: 'utility',
  utilities: 'utility',
  helpers: 'utility',
  components: 'component',
  pages: 'component',
  views: 'component',
  screens: 'component',
  layouts: 'component',
  widgets: 'component',
  config: 'config',
  configs: 'config',
  constants: 'constant',
  types: 'type',
  interfaces: 'interface',
  enums: 'enum',
  handlers: 'handler',
  gateways: 'gateway',
  __tests__: 'test',
  tests: 'test',
  test: 'test',
  spec: 'test',
};

/**
 * Classifies a file into a component type based on multiple heuristics.
 *
 * @param filePath - Workspace-relative file path
 * @param symbols - Extracted symbols from the file (for content-based classification)
 * @returns The classified component type
 */
export function classifyComponent(
  filePath: string,
  symbols: SymbolInfo[]
): ComponentType {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = path.basename(normalized);

  // 1. Check for main/entry point files
  if (isMainFile(fileName)) {
    return 'main';
  }

  // 2. Check file name patterns (highest priority)
  for (const [pattern, type] of FILE_NAME_PATTERNS) {
    if (pattern.test(fileName)) {
      return type;
    }
  }

  // 3. Check directory-based classification
  const dirs = path.dirname(normalized).split('/');
  for (let i = dirs.length - 1; i >= 0; i--) {
    const dir = dirs[i].toLowerCase();
    if (dir in DIRECTORY_PATTERNS) {
      return DIRECTORY_PATTERNS[dir];
    }
  }

  // 4. Check code-based classification
  return classifyByContent(symbols, fileName);
}

/**
 * Content-based classification using extracted symbols.
 */
function classifyByContent(
  symbols: SymbolInfo[],
  fileName: string
): ComponentType {
  // Check for React components
  const hasReactComponent = symbols.some((s) => s.kind === 'react-component');
  if (hasReactComponent) {
    return 'component';
  }

  // Check for hooks (use* pattern)
  const hasHook = symbols.some(
    (s) =>
      s.name.startsWith('use') &&
      s.name.length > 3 &&
      s.name[3] === s.name[3].toUpperCase() &&
      (s.kind === 'function' || s.kind === 'constant')
  );
  if (hasHook) {
    return 'hook';
  }

  // Check for decorators suggesting NestJS/Angular patterns
  const decoratorTypes = new Set(
    symbols.flatMap((s) => s.decorators ?? []).map((d) => d.toLowerCase())
  );

  if (decoratorTypes.has('controller')) {
    return 'controller';
  }
  if (decoratorTypes.has('injectable')) {
    return 'service';
  }
  if (decoratorTypes.has('module')) {
    return 'module';
  }
  if (decoratorTypes.has('guard') || decoratorTypes.has('useguards')) {
    return 'guard';
  }
  if (decoratorTypes.has('middleware')) {
    return 'middleware';
  }

  // Check if it's mostly interfaces
  const interfaceCount = symbols.filter((s) => s.kind === 'interface').length;
  const totalCount = symbols.length;
  if (totalCount > 0 && interfaceCount / totalCount > 0.5) {
    return 'interface';
  }

  // Check if it's mostly types
  const typeCount = symbols.filter((s) => s.kind === 'type').length;
  if (totalCount > 0 && typeCount / totalCount > 0.5) {
    return 'type';
  }

  // Check if it's mostly enums
  const enumCount = symbols.filter((s) => s.kind === 'enum').length;
  if (totalCount > 0 && enumCount / totalCount > 0.5) {
    return 'enum';
  }

  // Check for classes that extend known patterns
  for (const sym of symbols) {
    if (sym.heritage?.extends) {
      for (const ext of sym.heritage.extends) {
        const lower = ext.toLowerCase();
        if (lower.includes('controller')) return 'controller';
        if (lower.includes('service')) return 'service';
        if (lower.includes('repository')) return 'repository';
        if (lower.includes('gateway')) return 'gateway';
        if (lower.includes('module')) return 'module';
        if (lower.includes('component') || lower === 'react.component')
          return 'component';
      }
    }
  }

  // Check filename for 'use' prefix (hooks)
  if (fileName.match(/^use[A-Z]/)) {
    return 'hook';
  }

  // Check if file has only constants/variables
  const allConstants = symbols.every(
    (s) => s.kind === 'constant' || s.kind === 'variable' || s.kind === 'type'
  );
  if (allConstants && symbols.length > 0) {
    return 'constant';
  }

  return 'unknown';
}

function isMainFile(fileName: string): boolean {
  const mainFiles = [
    'main.ts',
    'main.tsx',
    'main.js',
    'main.jsx',
    'index.ts',
    'index.tsx',
    'index.js',
    'index.jsx',
    'app.ts',
    'app.tsx',
    'app.js',
    'app.jsx',
    'server.ts',
    'server.js',
    // Python entry points
    'main.py',
    'app.py',
    'server.py',
    'wsgi.py',
    'asgi.py',
    'run.py',
  ];
  return mainFiles.includes(fileName.toLowerCase());
}
