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
import { ContextRanker } from '../retrieval/contextRanker';
import { ContextCompressor } from '../retrieval/contextCompressor';
import { PromptBuilder } from './promptBuilder';
import { RetrievedContext } from '../types';

export class ChatParticipant {
  private queryRouter: QueryRouter;
  private symbolRetriever: SymbolRetriever;
  private graphRetriever: GraphRetriever;
  private contextRanker: ContextRanker;
  private promptBuilder: PromptBuilder;

  constructor(
    private projectIndex: ProjectIndex,
    private graph: DependencyGraph
  ) {
    this.queryRouter = new QueryRouter();
    this.symbolRetriever = new SymbolRetriever(this.projectIndex);
    this.graphRetriever = new GraphRetriever(this.graph, this.projectIndex);
    this.contextRanker = new ContextRanker();
    this.promptBuilder = new PromptBuilder(new ContextCompressor());
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

    // 2. Retrieve contexts
    const symbolContexts = this.symbolRetriever.retrieve(parsedQuery);
    const graphContexts = this.graphRetriever.retrieve(parsedQuery, 1); // Depth 1

    const allContexts = [...symbolContexts, ...graphContexts];

    // 3. Rank contexts
    const rankedContexts = this.contextRanker.rank(allContexts, parsedQuery.maxResults);

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
    const messages = this.promptBuilder.buildPrompt(request, context, rankedContexts);

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
