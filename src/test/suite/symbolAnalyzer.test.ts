// ============================================================================
// Tests — Symbol Analyzer
// ============================================================================

import * as assert from 'assert';
import * as ts from 'typescript';
import { extractSymbols } from '../../analyzer/symbolAnalyzer';

function parse(code: string, fileName: string = 'test.ts'): ts.SourceFile {
  const kind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : fileName.endsWith('.js')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  return ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
}

suite('SymbolAnalyzer', () => {
  test('extracts class declarations', () => {
    const source = parse(`
      export class PaymentService {
        private amount: number;
        constructor(amount: number) {
          this.amount = amount;
        }
        async processPayment(): Promise<boolean> {
          return true;
        }
      }
    `);
    const symbols = extractSymbols(source);

    const cls = symbols.find((s) => s.name === 'PaymentService');
    assert.ok(cls, 'PaymentService class should be found');
    assert.strictEqual(cls!.kind, 'class');
    assert.strictEqual(cls!.isExported, true);

    const ctor = symbols.find((s) => s.name === 'constructor');
    assert.ok(ctor, 'constructor should be found');
    assert.strictEqual(ctor!.parentSymbol, 'PaymentService');

    const method = symbols.find((s) => s.name === 'processPayment');
    assert.ok(method, 'processPayment method should be found');
    assert.strictEqual(method!.kind, 'method');
    assert.strictEqual(method!.isAsync, true);
    assert.strictEqual(method!.parentSymbol, 'PaymentService');
  });

  test('extracts function declarations', () => {
    const source = parse(`
      export function calculateTotal(items: number[]): number {
        return items.reduce((sum, item) => sum + item, 0);
      }
      
      function helperFunc(): void {}
    `);
    const symbols = extractSymbols(source);

    const exported = symbols.find((s) => s.name === 'calculateTotal');
    assert.ok(exported);
    assert.strictEqual(exported!.kind, 'function');
    assert.strictEqual(exported!.isExported, true);
    assert.ok(exported!.parameters!.length > 0);

    const helper = symbols.find((s) => s.name === 'helperFunc');
    assert.ok(helper);
    assert.strictEqual(helper!.isExported, false);
  });

  test('extracts arrow functions', () => {
    const source = parse(`
      export const fetchData = async (url: string): Promise<any> => {
        return fetch(url);
      };
      
      const TIMEOUT = 3000;
    `);
    const symbols = extractSymbols(source);

    const arrow = symbols.find((s) => s.name === 'fetchData');
    assert.ok(arrow);
    assert.strictEqual(arrow!.isAsync, true);
    assert.strictEqual(arrow!.isExported, true);

    const constant = symbols.find((s) => s.name === 'TIMEOUT');
    assert.ok(constant);
    assert.strictEqual(constant!.kind, 'constant');
  });

  test('extracts interfaces', () => {
    const source = parse(`
      export interface User {
        id: string;
        name: string;
        email: string;
      }
      
      interface InternalConfig {
        debug: boolean;
      }
    `);
    const symbols = extractSymbols(source);

    const exported = symbols.find((s) => s.name === 'User');
    assert.ok(exported);
    assert.strictEqual(exported!.kind, 'interface');
    assert.strictEqual(exported!.isExported, true);

    const internal = symbols.find((s) => s.name === 'InternalConfig');
    assert.ok(internal);
    assert.strictEqual(internal!.isExported, false);
  });

  test('extracts heritage clauses', () => {
    const source = parse(`
      class Animal {
        move() {}
      }
      
      interface Flyable {
        fly(): void;
      }
      
      export class Bird extends Animal implements Flyable {
        fly() {}
      }
    `);
    const symbols = extractSymbols(source);

    const bird = symbols.find((s) => s.name === 'Bird');
    assert.ok(bird);
    assert.deepStrictEqual(bird!.heritage?.extends, ['Animal']);
    assert.deepStrictEqual(bird!.heritage?.implements, ['Flyable']);
  });

  test('extracts enums', () => {
    const source = parse(`
      export enum PaymentStatus {
        Pending,
        Verified,
        Failed,
        Refunded,
      }
    `);
    const symbols = extractSymbols(source);

    const enumSym = symbols.find((s) => s.name === 'PaymentStatus');
    assert.ok(enumSym);
    assert.strictEqual(enumSym!.kind, 'enum');
    assert.strictEqual(enumSym!.isExported, true);
  });

  test('detects React components in TSX', () => {
    const source = parse(
      `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
      
      export const Card = ({ title }: { title: string }) => {
        return (
          <div className="card">
            <h2>{title}</h2>
          </div>
        );
      };
    `,
      'test.tsx'
    );
    const symbols = extractSymbols(source);

    const button = symbols.find((s) => s.name === 'Button');
    assert.ok(button);
    assert.strictEqual(button!.kind, 'react-component');

    const card = symbols.find((s) => s.name === 'Card');
    assert.ok(card);
    assert.strictEqual(card!.kind, 'react-component');
  });

  test('extracts type aliases', () => {
    const source = parse(`
      export type ID = string | number;
      type InternalState = { loading: boolean; data: any };
    `);
    const symbols = extractSymbols(source);

    const exported = symbols.find((s) => s.name === 'ID');
    assert.ok(exported);
    assert.strictEqual(exported!.kind, 'type');
    assert.strictEqual(exported!.isExported, true);
  });

  test('extracts class properties', () => {
    const source = parse(`
      class Service {
        private name: string;
        static instanceCount: number = 0;
        
        getName(): string {
          return this.name;
        }
      }
    `);
    const symbols = extractSymbols(source);

    const prop = symbols.find((s) => s.name === 'name' && s.kind === 'property');
    assert.ok(prop);
    assert.strictEqual(prop!.parentSymbol, 'Service');

    const staticProp = symbols.find(
      (s) => s.name === 'instanceCount'
    );
    assert.ok(staticProp);
    assert.strictEqual(staticProp!.isStatic, true);
  });
});
