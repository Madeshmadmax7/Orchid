// ============================================================================
// Tests — Dependency Analyzer
// ============================================================================

import * as assert from 'assert';
import * as ts from 'typescript';
import {
  extractImports,
  extractExports,
  isLocalImport,
  resolveLocalImport,
} from '../../analyzer/dependencyAnalyzer';

function parse(code: string): ts.SourceFile {
  return ts.createSourceFile(
    'test.ts',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

suite('DependencyAnalyzer', () => {
  // ── Import Extraction ────────────────────────────────────────────────

  test('extracts named imports', () => {
    const source = parse(`
      import { UserService, User } from './users/user.service';
    `);
    const imports = extractImports(source, 'src/payments/payment.service.ts');

    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, './users/user.service');
    assert.deepStrictEqual(imports[0].specifiers, ['UserService', 'User']);
    assert.strictEqual(imports[0].isDefault, false);
    assert.strictEqual(imports[0].isNamespace, false);
    assert.strictEqual(imports[0].isLocal, true);
  });

  test('extracts default imports', () => {
    const source = parse(`
      import express from 'express';
    `);
    const imports = extractImports(source, 'src/main.ts');

    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].source, 'express');
    assert.strictEqual(imports[0].isDefault, true);
    assert.strictEqual(imports[0].isLocal, false);
  });

  test('extracts namespace imports', () => {
    const source = parse(`
      import * as path from 'path';
    `);
    const imports = extractImports(source, 'src/utils.ts');

    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].isNamespace, true);
    assert.strictEqual(imports[0].defaultOrNamespaceName, 'path');
  });

  test('extracts mixed default and named imports', () => {
    const source = parse(`
      import React, { useState, useEffect } from 'react';
    `);
    const imports = extractImports(source, 'src/component.tsx');

    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].isDefault, true);
    assert.ok(imports[0].specifiers.includes('React'));
    assert.ok(imports[0].specifiers.includes('useState'));
    assert.ok(imports[0].specifiers.includes('useEffect'));
  });

  test('resolves relative import paths', () => {
    const source = parse(`
      import { Database } from '../shared/database';
    `);
    const imports = extractImports(source, 'src/users/user.repository.ts');

    assert.strictEqual(imports.length, 1);
    assert.strictEqual(imports[0].isLocal, true);
    assert.ok(imports[0].resolvedPath);
    assert.ok(imports[0].resolvedPath!.includes('shared/database'));
  });

  test('extracts require() calls', () => {
    const source = parse(`
      const fs = require('fs');
      const config = require('./config');
    `);
    const imports = extractImports(source, 'src/utils.ts');

    assert.strictEqual(imports.length, 2);
    assert.strictEqual(imports[0].source, 'fs');
    assert.strictEqual(imports[0].isLocal, false);
    assert.strictEqual(imports[1].source, './config');
    assert.strictEqual(imports[1].isLocal, true);
  });

  // ── Export Extraction ────────────────────────────────────────────────

  test('extracts exported classes', () => {
    const source = parse(`
      export class UserService {
        findById() {}
      }
    `);
    const exports = extractExports(source);

    assert.strictEqual(exports.length, 1);
    assert.strictEqual(exports[0].name, 'UserService');
    assert.strictEqual(exports[0].kind, 'class');
    assert.strictEqual(exports[0].isDefault, false);
  });

  test('extracts exported functions', () => {
    const source = parse(`
      export function processPayment() {}
      export default function main() {}
    `);
    const exports = extractExports(source);

    const named = exports.find((e) => e.name === 'processPayment');
    assert.ok(named);
    assert.strictEqual(named!.isDefault, false);

    const defaultExport = exports.find((e) => e.name === 'main');
    assert.ok(defaultExport);
    assert.strictEqual(defaultExport!.isDefault, true);
  });

  test('extracts exported variables', () => {
    const source = parse(`
      export const API_URL = 'https://api.example.com';
      export const handler = (req: any) => {};
    `);
    const exports = extractExports(source);

    const url = exports.find((e) => e.name === 'API_URL');
    assert.ok(url);
    assert.strictEqual(url!.kind, 'variable');

    const fn = exports.find((e) => e.name === 'handler');
    assert.ok(fn);
    assert.strictEqual(fn!.kind, 'function');
  });

  test('extracts re-exports', () => {
    const source = parse(`
      export { UserService } from './user.service';
      export * from './types';
    `);
    const exports = extractExports(source);

    const named = exports.find((e) => e.name === 'UserService');
    assert.ok(named);
    assert.strictEqual(named!.isReExport, true);
    assert.strictEqual(named!.reExportSource, './user.service');

    const barrel = exports.find((e) => e.name === '*');
    assert.ok(barrel);
    assert.strictEqual(barrel!.isReExport, true);
  });

  test('extracts default export assignment', () => {
    const source = parse(`
      class Config {}
      export default Config;
    `);
    const exports = extractExports(source);

    const defaultExport = exports.find((e) => e.isDefault);
    assert.ok(defaultExport);
    assert.strictEqual(defaultExport!.name, 'Config');
  });

  // ── Helper Functions ─────────────────────────────────────────────────

  test('isLocalImport detects relative paths', () => {
    assert.strictEqual(isLocalImport('./utils'), true);
    assert.strictEqual(isLocalImport('../shared/database'), true);
    assert.strictEqual(isLocalImport('/absolute/path'), true);
    assert.strictEqual(isLocalImport('express'), false);
    assert.strictEqual(isLocalImport('@nestjs/common'), false);
  });

  test('resolveLocalImport computes correct paths', () => {
    const result = resolveLocalImport(
      '../shared/database',
      'src/users/user.repository.ts'
    );
    assert.ok(result.includes('shared/database'));
  });
});
