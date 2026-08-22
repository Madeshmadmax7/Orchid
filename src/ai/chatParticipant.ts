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
    this.queryRouter = new QueryRouter();
    const symbolRetriever = new SymbolRetriever(this.projectIndex);
    const graphRetriever = new GraphRetriever(this.graph, this.projectIndex);
    this.hybridRetriever = new HybridRetriever(symbolRetriever, graphRetriever);
    
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
    const { messages, tokenCount } = this.promptBuilder.buildPrompt(request, context, rankedContexts);

    // Diagnostics (Phase 11)
    this.outputChannel.appendLine(`[Query] ${request.prompt}`);
    this.outputChannel.appendLine(`Retrieved ${rankedContexts.length} nodes from ${usedFiles.size} files.`);
    this.outputChannel.appendLine(`Estimated Token Consumption: ${tokenCount} tokens.\n`);

    // 5. Send to LM
    try {
      const chatModels = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4o'
      });

      if (chatModels.length === 0) {
        response.markdown('Error: Copilot GPT-4o model not found.');
        return {};
      }

      const model = chatModels[0];
      const chatResponse = await model.sendRequest(messages, {}, token);

      for await (const fragment of chatResponse.text) {
        response.markdown(fragment);
      }
      
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        response.markdown(`\n\n*Error from Language Model: ${err.message}*`);
      } else {
        throw err;
      }
    }

    return { metadata: { retrievedContexts: rankedContexts.length } };
  }
}
