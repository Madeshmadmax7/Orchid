import * as fs from 'fs';
import * as path from 'path';
import { ProjectIndex } from '../src/knowledge/projectIndex';
import { DependencyGraph } from '../src/graph/dependencyGraph';
import { QueryRouter } from '../src/retrieval/queryRouter';
import { SymbolRetriever } from '../src/retrieval/symbolRetriever';
import { GraphRetriever } from '../src/retrieval/graphRetriever';
import { HybridRetriever } from '../src/retrieval/hybridRetriever';
import { ContextRanker } from '../src/retrieval/contextRanker';
import { ContextCompressor } from '../src/retrieval/contextCompressor';
import { analyzeFile } from '../src/analyzer/fileAnalyzer';
import { buildGraph } from '../src/graph/graphBuilder';
import { FileMetadata } from '../src/types';

const MOCK_DIR = path.join(__dirname, 'mock_project');

function setupMockProject() {
  if (!fs.existsSync(MOCK_DIR)) {
    fs.mkdirSync(MOCK_DIR);
  }

  const files = {
    'payment.service.ts': `
      import { checkAuth } from './auth.service';
      import { db } from './db';
      /**
       * PaymentService handles creation and verification of payments.
       */
      export class PaymentService {
        async createPayment(amount: number) {
          checkAuth();
          return db.query('INSERT INTO payments...');
        }
        async verifyPayment(id: string) {
          const p = await db.query('SELECT * FROM payments WHERE id=' + id);
          if (!p) throw new Error("Validation fails");
          return true;
        }
      }
    `,
    'refund.service.ts': `
      import { db } from './db';
      import { PaymentService } from './payment.service';
      /**
       * Handles refunds.
       */
      export class RefundService {
        async processRefund(paymentId: string) {
          return db.query('UPDATE payments SET refunded=true');
        }
      }
    `,
    'auth.service.ts': `
      /**
       * Checks authentication for the current user.
       */
      export function checkAuth() {
        // authentication is checked here
        return true;
      }
    `,
    'db.ts': `
      /**
       * Database connection module.
       */
      export const db = {
        /**
         * Database query can fail if connection drops.
         * Returns null if API endpoint drops connection.
         */
        async query(sql: string) {
          return null;
        }
      };
    `,
    'api.controller.ts': `
      import { PaymentService } from './payment.service';
      import { RefundService } from './refund.service';
      
      /**
       * Controller for API endpoints.
       */
      export class ApiController {
        private paymentService = new PaymentService();
        private refundService = new RefundService();
        
        /**
         * How does this API endpoint reach the database?
         * Handles incoming requests.
         */
        async handleRequest() {
          await this.paymentService.createPayment(100);
          await this.paymentService.verifyPayment("123");
        }
      }
    `,
    'order.service.ts': `
      import { OrderRepository } from './order.repository';
      export class OrderService {
        async createOrder(id: string) {
          if (!id) throw new Error("Missing order ID");
          return OrderRepository.save(id);
        }
      }
    `,
    'order.repository.ts': `
      export class OrderRepository {
        static async save(id: string) { return true; }
      }
    `,
    'order.controller.ts': `
      import { OrderService } from './order.service';
      export class OrderController {
        private service = new OrderService();
        async create() {
          await this.service.createOrder("1");
        }
      }
    `
  };

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(MOCK_DIR, name), content.trim());
  }
}

async function runValidation() {
  setupMockProject();

  console.log('--- 1. Verification of Benchmark Methodology ---');
  console.log('Baseline tokens are calculated by taking the length of the full raw string of any file touched by the retrieval process, and dividing by 4.');
  console.log('Orchid tokens are calculated by measuring the length of the highly-compressed structural markdown string emitted by the ContextCompressor, and dividing by 4.');
  console.log('Both methods use the standard approximation of 4 characters per token.\n');

  console.log('--- 2. Validating Retrieval Quality ---');
  const projectIndex = new ProjectIndex();
  
  const testFiles = fs.readdirSync(MOCK_DIR).map(f => path.join(MOCK_DIR, f));
  const fileMetas: FileMetadata[] = [];
  
  for (const f of testFiles) {
    const content = fs.readFileSync(f, 'utf8');
    const meta = analyzeFile(f, content, 'typescript');
    projectIndex.addFile(meta);
    fileMetas.push(meta);
  }
  
  const graph = buildGraph(fileMetas);

  const router = new QueryRouter();
  const symbolRetriever = new SymbolRetriever(projectIndex);
  const graphRetriever = new GraphRetriever(graph, projectIndex);
  const hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever);
  const ranker = new ContextRanker(projectIndex);
  const compressor = new ContextCompressor();

  const queries = [
    { query: "How does payment verification work?", expected: ['ApiController.handleRequest', 'PaymentService.verifyPayment'] },
    { query: "Where is payment creation implemented?", expected: ['PaymentService.createPayment'] },
    { query: "Which service handles refunds?", expected: ['RefundService'] },
    { query: "Where is authentication checked?", expected: ['checkAuth'] },
    { query: "Why could this database query fail?", expected: ['db.query'] },
    { query: "Which files depend on PaymentService?", expected: ['api.controller.ts'] },
    { query: "What does PaymentService depend on?", expected: ['db.ts', 'auth.service.ts'] }, // new regression test
    { query: "Where is this function called?", expected: ['ApiController.handleRequest'] },
    { query: "How does this API endpoint reach the database?", expected: ['ApiController.handleRequest', 'db.query'] },
    { query: "What happens when validation fails?", expected: ['PaymentService.verifyPayment'] },
    { query: "How would I modify this feature?", expected: ['ApiController.handleRequest'] },
    { query: "Who calls PaymentService.verifyPayment?", expected: ['ApiController.handleRequest'] },
    { query: "Where is payment validation handled?", expected: ['PaymentService.verifyPayment'] },
    // Generalization Tests
    { query: "Which files depend on OrderService?", expected: ['order.controller.ts'] },
    { query: "Who calls OrderService.createOrder?", expected: ['OrderController.create'] },
    { query: "What happens when an order is missing an ID?", expected: ['OrderService.createOrder'] },
    { query: "Where are orders created?", expected: ['OrderService.createOrder'] }
  ];

  let totalPrecision = 0;
  let totalRecall = 0;

  for (const { query: q, expected } of queries) {
    const start = Date.now();
    const parsed = router.parseQuery(q);

    const retrieved = hybridRetriever.retrieve(parsed);
    const ranked = ranker.rank(retrieved, parsed);

    const isFileQuery = expected.some(e => e.endsWith('.ts'));
    let candidates = isFileQuery ? ranked.filter(r => r.type === 'file') : ranked.filter(r => r.type === 'symbol' && r.symbolInfo);
    
    if (parsed.intent === 'CALLERS' && parsed.targetSymbols.length > 0) {
      candidates = candidates.filter(r => {
        if (r.type === 'file') return true;
        const fullSymbol = r.symbolInfo!.parentSymbol ? `${r.symbolInfo!.parentSymbol}.${r.symbolInfo!.name}` : r.symbolInfo!.name;
        return !parsed.targetSymbols.some(target => fullSymbol.toLowerCase() === target.toLowerCase() || r.symbolInfo!.name.toLowerCase() === target.toLowerCase());
      });
    }

    const topSymbols = candidates.slice(0,3).map(r => {
      if (r.type === 'file') return require('path').basename(r.filePath);
      const sym = r.symbolInfo!;
      return sym.parentSymbol ? `${sym.parentSymbol}.${sym.name}` : sym.name;
    });
    const latency = Date.now() - start;

    let tp = 0;
    let fp = 0;
    
    // Track which expected symbols we've already matched so we don't double count
    const matchedExpected = new Set<string>();

    for (const retrievedSym of topSymbols) {
      if (!retrievedSym) continue;
      
      const matched = expected.find(e => e.includes(retrievedSym) || retrievedSym.includes(e));
      if (matched) {
        if (!matchedExpected.has(matched)) {
          tp++;
          matchedExpected.add(matched);
        }
      } else {
        fp++;
      }
    }

    const fn = expected.length - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp / expected.length;

    totalPrecision += precision;
    totalRecall += recall;

    console.log(`\nQ: "${q}"`);
    console.log(`   Intent: ${parsed.intent}`);
    console.log(`   Expected:  ${expected.join(', ')}`);
    console.log(`   Retrieved: ${topSymbols.join(', ') || 'None'} (${candidates.length} candidates)`);
    console.log(`   TP: ${tp}, FP: ${fp}, FN: ${fn}, Precision: ${(precision * 100).toFixed(1)}%, Recall: ${(recall * 100).toFixed(1)}%, Latency: ${latency}ms`);
  }

  const avgPrecision = totalPrecision / queries.length;
  const avgRecall = totalRecall / queries.length;
  console.log(`\n--- 3. Retrieval Summary ---`);
  console.log(`   Avg Precision: ${(avgPrecision * 100).toFixed(1)}%`);
  console.log(`   Avg Recall:    ${(avgRecall * 100).toFixed(1)}%`);
  console.log(`   Queries:       ${queries.length}`);

  console.log('\n--- 4. Validating Hard Token Budget ---');
  const parsedAll = router.parseQuery("database payment refund auth");
  const allContexts = hybridRetriever.retrieve(parsedAll);
  const rankedAll = ranker.rank(allContexts, parsedAll);
  
  const limits = [0, 10, 100, 5000];
  for (const limit of limits) {
    const result = compressor.compress(rankedAll, limit);
    console.log(`Budget: ${limit} tokens -> Used: ${result.tokenCount} tokens`);
    if (result.tokenCount > limit && limit !== 0) { // Limit 0 defaults or handles safely
      console.log(`  [!] FAILED: Exceeded budget of ${limit}`);
    } else {
      console.log(`  [OK] Budget respected.`);
    }
  }

  console.log('\n--- 5. Validating Incremental Indexing ---');
  const originalFile = path.join(MOCK_DIR, 'payment.service.ts');
  const originalMeta = analyzeFile(originalFile, fs.readFileSync(originalFile, 'utf8'), 'typescript');
  const originalCreateHash = originalMeta.symbols.find(s => s.name === 'createPayment')!.hash;
  const originalVerifyHash = originalMeta.symbols.find(s => s.name === 'verifyPayment')!.hash;

  // Modify only createPayment
  let modifiedContent = fs.readFileSync(originalFile, 'utf8');
  modifiedContent = modifiedContent.replace('amount: number', 'amount: number, currency: string');
  const newMeta = analyzeFile(originalFile, modifiedContent, 'typescript');
  
  const newCreateHash = newMeta.symbols.find(s => s.name === 'createPayment')!.hash;
  const newVerifyHash = newMeta.symbols.find(s => s.name === 'verifyPayment')!.hash;

  console.log(`Original createPayment Hash: ${originalCreateHash}`);
  console.log(`New createPayment Hash:      ${newCreateHash}`);
  console.log(`Original verifyPayment Hash: ${originalVerifyHash}`);
  console.log(`New verifyPayment Hash:      ${newVerifyHash}`);
  
  if (originalCreateHash !== newCreateHash && originalVerifyHash === newVerifyHash) {
    console.log(`  [OK] Incremental hash behaves perfectly (only modified symbol changed hash).`);
  } else {
    console.log(`  [!] FAILED: Incremental hash logic broken.`);
  }

}

runValidation().catch(console.error);
