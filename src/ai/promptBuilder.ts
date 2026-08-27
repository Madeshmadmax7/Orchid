// ============================================================================
// Project Memory — Prompt Builder
// ============================================================================
// Builds the final prompt array for the VS Code Copilot API.
// ============================================================================

import * as vscode from 'vscode';
import { RetrievedContext } from '../types';
import { ContextCompressor } from '../retrieval/contextCompressor';

export class PromptBuilder {
  constructor(private compressor: ContextCompressor) {}

  /**
   * Builds the prompt messages array including the retrieved project context.
   */
  buildPrompt(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    retrievedContexts: RetrievedContext[]
  ) {
    const messages: vscode.LanguageModelChatMessage[] = [];

    // 1. Unified System Prompt
    // Intent classification is handled by Copilot natively from the original user request.
    // Orchid's role is to supply accurate, grounded project context only.
    const systemInstruction =
      'You are Project Memory, an expert software assistant.\n' +
      'Use the provided RELEVANT PROJECT CONTEXT to answer the user\'s request accurately.\n' +
      'The context contains deterministic structural data (AST extraction) from the user\'s codebase.\n' +
      'If the user is asking a question or requesting an explanation, simply answer the question directly without using any tools.\n' +
      'If the user\'s request requires modifying the codebase, you MUST use the `orchid_edit` tool to apply the changes. Always provide the exact `originalText` to replace. Do not output raw code blocks for edits.\n' +
      'Do not invent files, symbols, APIs, or implementation details not supported by the context.\n' +
      'If the available context is insufficient, clearly state what additional context is required.';

    // 2. Chat History (simplified)
    for (const msg of context.history) {
      if (msg instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(msg.prompt));
      } else if (msg instanceof vscode.ChatResponseTurn) {
        // Collect text responses
        const textParts = msg.response.map(r => r.value).join('');
        messages.push(vscode.LanguageModelChatMessage.Assistant(textParts));
      }
    }

    // 3. Current User Prompt + Context
    const maxTokens = 1500;
    const compressionResult = this.compressor.compress(retrievedContexts, maxTokens);
    
    const finalPrompt = `${systemInstruction}\n\n=== PROJECT CONTEXT ===\n${compressionResult.text}\n=======================\n\nUser Question:\n${request.prompt}`;
    
    messages.push(vscode.LanguageModelChatMessage.User(finalPrompt));

    return { messages, compressionResult };
  }
}
