// ============================================================================
// Tests — Component Classifier
// ============================================================================

import * as assert from 'assert';
import { classifyComponent } from '../../analyzer/componentClassifier';
import { SymbolInfo } from '../../types';

function makeSymbol(overrides: Partial<SymbolInfo>): SymbolInfo {
  return {
    name: 'Test',
    kind: 'class',
    startLine: 1,
    endLine: 10,
    isExported: true,
    ...overrides,
  };
}

suite('ComponentClassifier', () => {
  test('classifies by file name pattern', () => {
    assert.strictEqual(
      classifyComponent('src/users/user.service.ts', []),
      'service'
    );
    assert.strictEqual(
      classifyComponent('src/auth/auth.controller.ts', []),
      'controller'
    );
    assert.strictEqual(
      classifyComponent('src/data/user.repository.ts', []),
      'repository'
    );
    assert.strictEqual(
      classifyComponent('src/payments/stripe.gateway.ts', []),
      'gateway'
    );
    assert.strictEqual(
      classifyComponent('src/auth/auth.middleware.ts', []),
      'middleware'
    );
    assert.strictEqual(
      classifyComponent('src/app/app.module.ts', []),
      'module'
    );
  });

  test('classifies test files', () => {
    assert.strictEqual(
      classifyComponent('src/users/user.service.spec.ts', []),
      'test'
    );
    assert.strictEqual(
      classifyComponent('src/users/user.test.ts', []),
      'test'
    );
    assert.strictEqual(
      classifyComponent('src/users/user.e2e-spec.ts', []),
      'test'
    );
  });

  test('classifies by directory', () => {
    assert.strictEqual(
      classifyComponent('src/hooks/useAuth.ts', [
        makeSymbol({ name: 'useAuth', kind: 'function' }),
      ]),
      'hook'
    );
    assert.strictEqual(
      classifyComponent('src/utils/formatDate.ts', []),
      'utility'
    );
    assert.strictEqual(
      classifyComponent('src/models/user.ts', []),
      'model'
    );
  });

  test('classifies React components by content', () => {
    assert.strictEqual(
      classifyComponent('src/Button.tsx', [
        makeSymbol({ name: 'Button', kind: 'react-component' }),
      ]),
      'component'
    );
  });

  test('classifies hooks by naming convention', () => {
    assert.strictEqual(
      classifyComponent('src/useAuth.ts', [
        makeSymbol({ name: 'useAuth', kind: 'function' }),
      ]),
      'hook'
    );
  });

  test('classifies main/entry files', () => {
    assert.strictEqual(classifyComponent('src/main.ts', []), 'main');
    assert.strictEqual(classifyComponent('src/index.ts', []), 'main');
    assert.strictEqual(classifyComponent('server.ts', []), 'main');
  });

  test('classifies by decorator patterns', () => {
    assert.strictEqual(
      classifyComponent('src/users.ts', [
        makeSymbol({ name: 'Users', decorators: ['Controller'] }),
      ]),
      'controller'
    );
    assert.strictEqual(
      classifyComponent('src/auth.ts', [
        makeSymbol({ name: 'Auth', decorators: ['Injectable'] }),
      ]),
      'service'
    );
  });

  test('classifies by heritage', () => {
    assert.strictEqual(
      classifyComponent('src/custom.ts', [
        makeSymbol({
          name: 'CustomService',
          heritage: { extends: ['BaseService'] },
        }),
      ]),
      'service'
    );
  });

  test('returns unknown for unclassifiable files', () => {
    assert.strictEqual(
      classifyComponent('src/misc/something.ts', [
        makeSymbol({ name: 'doStuff', kind: 'function' }),
      ]),
      'unknown'
    );
  });
});
