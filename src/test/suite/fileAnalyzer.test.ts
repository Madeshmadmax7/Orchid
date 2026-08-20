// ============================================================================
// Tests — File Analyzer Integration
// ============================================================================

import * as assert from 'assert';
import { analyzeFile, hasFileChanged } from '../../analyzer/fileAnalyzer';

suite('FileAnalyzer', () => {
  test('analyzes a complete TypeScript service file', () => {
    const code = `
      import { Database } from '../shared/database';
      import { Logger } from '../shared/logger';

      export interface User {
        id: string;
        email: string;
        name: string;
      }

      export class UserService {
        private db: Database;
        private logger: Logger;

        constructor(db: Database, logger: Logger) {
          this.db = db;
          this.logger = logger;
        }

        async findById(id: string): Promise<User | null> {
          this.logger.info('Finding user by id');
          return this.db.findOne('users', { id });
        }

        async createUser(data: Partial<User>): Promise<User> {
          const user: User = {
            id: 'new-id',
            email: data.email ?? '',
            name: data.name ?? '',
          };
          await this.db.upsert('users', user);
          return user;
        }
      }
    `;

    const metadata = analyzeFile(
      'src/users/user.service.ts',
      code,
      'typescript'
    );

    // File metadata
    assert.strictEqual(metadata.filePath, 'src/users/user.service.ts');
    assert.strictEqual(metadata.language, 'typescript');
    assert.strictEqual(metadata.fileType, 'service');
    assert.ok(metadata.hash.length > 0);
    assert.ok(metadata.loc > 0);

    // Symbols
    const classSymbol = metadata.symbols.find(
      (s) => s.name === 'UserService'
    );
    assert.ok(classSymbol, 'UserService class should be extracted');
    assert.strictEqual(classSymbol!.kind, 'class');
    assert.strictEqual(classSymbol!.isExported, true);

    const interfaceSymbol = metadata.symbols.find(
      (s) => s.name === 'User'
    );
    assert.ok(interfaceSymbol, 'User interface should be extracted');

    const findById = metadata.symbols.find((s) => s.name === 'findById');
    assert.ok(findById, 'findById method should be extracted');
    assert.strictEqual(findById!.parentSymbol, 'UserService');
    assert.strictEqual(findById!.isAsync, true);

    // Imports
    assert.strictEqual(metadata.imports.length, 2);
    const dbImport = metadata.imports.find((i) =>
      i.source.includes('database')
    );
    assert.ok(dbImport);
    assert.strictEqual(dbImport!.isLocal, true);
    assert.ok(dbImport!.specifiers.includes('Database'));

    // Exports
    const classExport = metadata.exports.find(
      (e) => e.name === 'UserService'
    );
    assert.ok(classExport);
    assert.strictEqual(classExport!.kind, 'class');
  });

  test('detects file changes via hash', () => {
    const content1 = 'const x = 1;';
    const content2 = 'const x = 2;';

    const meta1 = analyzeFile('test.ts', content1, 'typescript');
    assert.strictEqual(hasFileChanged(content1, meta1.hash), false);
    assert.strictEqual(hasFileChanged(content2, meta1.hash), true);
  });

  test('analyzes JSX React component', () => {
    const code = `
      import React from 'react';
      
      interface ButtonProps {
        label: string;
        onClick: () => void;
      }
      
      export const Button: React.FC<ButtonProps> = ({ label, onClick }) => {
        return (
          <button className="btn" onClick={onClick}>
            {label}
          </button>
        );
      };
    `;

    const metadata = analyzeFile('src/components/Button.tsx', code, 'typescriptreact');

    assert.strictEqual(metadata.language, 'typescriptreact');
    assert.strictEqual(metadata.fileType, 'component');

    const button = metadata.symbols.find((s) => s.name === 'Button');
    assert.ok(button);
    assert.strictEqual(button!.kind, 'react-component');
  });
});
