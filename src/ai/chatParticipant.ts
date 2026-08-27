// ============================================================================
// Project Memory — Chat Participant
// ============================================================================
// Implements the @projectmemory Copilot participant using the VS Code Chat API.
// ============================================================================

import * as vscode from 'vscode';
import { ProjectIndex } from '../knowledge/projectIndex';
import { DependencyGraph } from '../graph/dependencyGraph';
import { QueryRouter } from '../retrieval/queryRouter';
import { SymbolRetriever } from '../retrieval/symbolRetriever';
import { GraphRetriever } from '../retrieval/graphRetriever';
import { HybridRetriever } from '../retrieval/hybridRetriever';
import { ContextRanker } from '../retrieval/contextRanker';
import { ContextCompressor } from '../retrieval/contextCompressor';
import { PromptBuilder } from './promptBuilder';
import { RetrievedContext } from '../types';

export let lastTokenReport: string | undefined;

export class ChatParticipant {
  private queryRouter: QueryRouter;
  private hybridRetriever: HybridRetriever;
  private contextRanker: ContextRanker;
  private promptBuilder: PromptBuilder;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private projectIndex: ProjectIndex,
    private graph: DependencyGraph
  ) {
    this.queryRouter = new QueryRouter(this.projectIndex);
    const symbolRetriever = new SymbolRetriever(this.projectIndex);
    const graphRetriever = new GraphRetriever(this.graph, this.projectIndex);
    this.hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever, undefined, this.projectIndex);
    
    this.contextRanker = new ContextRanker(this.projectIndex);
    this.promptBuilder = new PromptBuilder(new ContextCompressor());
    this.outputChannel = vscode.window.createOutputChannel('Orchid Debug');
  }

  /**
   * Registers the chat participant with VS Code.
   */
  register(context: vscode.ExtensionContext): void {
    const participant = vscode.chat.createChatParticipant(
      'orchid.participant',
      this.handleRequest.bind(this)
    );
    
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg');
    
    context.subscriptions.push(participant);
  }

  /**
   * Request handler for the @projectmemory participant.
   */
  private async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<vscode.ChatResult> {
    
    if (this.projectIndex.totalFiles === 0) {
      response.markdown('🧠 **Project Memory has no data.** Please run the `Project Memory: Analyze Project` command first to build the project index.');
      return {};
    }

    response.progress('Consulting Project Memory...');

    // 1. Parse query
    const parsedQuery = this.queryRouter.parseQuery(request.prompt);

    // 2. Retrieve contexts using Hybrid Retrieval (Phases 5 & 7)
    const allContexts = this.hybridRetriever.retrieve(parsedQuery);

    // 3. Rank contexts
    const rankedContexts = this.contextRanker.rank(allContexts, parsedQuery);

    // Show retrieved files to user
    const usedFiles = new Set(rankedContexts.map(c => c.filePath));
    if (usedFiles.size > 0) {
      response.markdown(`*Retrieved context from ${usedFiles.size} files:*\n`);
      for (const file of usedFiles) {
        response.markdown(`- \`${file}\`\n`);
      }
      response.markdown('---\n\n');
    }

    // 4. Build Prompt
    const { messages, compressionResult } = this.promptBuilder.buildPrompt(request, context, rankedContexts);

    // ── Metrics Tracking for Token Report ──
    let totalLoc = 0;
    for (const filePath of this.projectIndex.getAllFilePaths()) {
      const meta = this.projectIndex.getFile(filePath);
      if (meta) totalLoc += meta.loc;
    }
    const baselineChars = totalLoc * 50; // Using validation mock estimator
    const baselineTokens = Math.ceil(baselineChars / 4);
    
    const orchidChars = compressionResult.text.length;
    const finalTokens = compressionResult.tokenCount;
    const candidateTokens = compressionResult.candidateTokenCount;
    const maxTokens = 1500;
    const budgetExceeded = finalTokens > maxTokens;
    
    const reduction = ((1 - (finalTokens / Math.max(1, baselineTokens))) * 100).toFixed(1);

    const report = 
`ORCHID TOKEN REPORT

Query:
"${request.prompt}"

Baseline:
Characters: ${baselineChars}
Estimated tokens: ${baselineTokens}

Orchid (Candidate, pre-compression):
Estimated tokens: ${candidateTokens}

Orchid (Final emitted context):
Characters: ${orchidChars}
Estimated tokens: ${finalTokens}

Estimated reduction:
${reduction}%

Files considered:
${compressionResult.filesConsidered}

Symbols retrieved:
${compressionResult.symbolsRetrieved}

Symbols included:
${compressionResult.symbolsIncluded}

Context levels:
L1: ${compressionResult.contextLevels.L1}
L2: ${compressionResult.contextLevels.L2}
L3: ${compressionResult.contextLevels.L3}

Budget:
${maxTokens} tokens

Budget exceeded:
${budgetExceeded ? 'YES' : 'NO'}

Note: These are ESTIMATED tokens. Orchid does not control the final Copilot OpenAI request and cannot report actual downstream API token usage.`;

    lastTokenReport = report;

    // Diagnostics (Phase 11)
    this.outputChannel.appendLine(`\n${report}\n`);
    this.outputChannel.show(true);

    // 5. Send to LM
    try {
      let chatModels = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
      if (chatModels.length === 0) {
        chatModels = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
      }
      if (chatModels.length === 0) {
        chatModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      }
      if (chatModels.length === 0) {
        chatModels = await vscode.lm.selectChatModels({});
      }

      if (chatModels.length === 0) {
        response.markdown('Error: No language model is currently available. Please ensure GitHub Copilot is installed and active.');
        return {};
      }

      // Try to avoid picking embedding or tiny models if possible by sorting/finding
      let selectedModel = chatModels.find(m => (m.name && m.name.includes('gpt-4o')) || (m.family && m.family.includes('gpt-4o'))) ||
                          chatModels.find(m => (m.name && m.name.includes('gpt-4')) || (m.family && m.family.includes('gpt-4'))) ||
                          chatModels[0];

      this.outputChannel.appendLine(`Selected Model: ${selectedModel.vendor} / ${selectedModel.family} (${selectedModel.name || selectedModel.id})`);

      const chatResponse = await selectedModel.sendRequest(messages, {}, token);

      for await (const fragment of chatResponse.text) {
        response.markdown(fragment);
      }
      
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        response.markdown(`\n\n*Error from Language Model: ${err.message}*`);
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        response.markdown(`\n\n*Internal Error: ${errorMsg}*`);
      }
    }

    return { metadata: { retrievedContexts: rankedContexts.length } };
  }
}
