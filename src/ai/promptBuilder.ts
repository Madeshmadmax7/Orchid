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
  ): vscode.LanguageModelChatMessage[] {
    const messages: vscode.LanguageModelChatMessage[] = [];

    // 1. System Prompt
    let systemInstruction = 
      'You are Project Memory, an expert software architect assistant.\n' +
      'Use the provided RELEVANT PROJECT CONTEXT to accurately answer the user\'s question.\n' +
      'The context contains deterministic structural data (AST extraction) about the user\'s codebase.\n' +
      'If the context does not contain the answer, say so, but use your general knowledge if applicable.\n' +
      'Do not guess file paths or component names unless they are in the context.';
    
    messages.push(vscode.LanguageModelChatMessage.User(systemInstruction));

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
    const compressedContext = this.compressor.compress(retrievedContexts);
    const finalPrompt = `${compressedContext}\n\nUser Question:\n${request.prompt}`;
    
    messages.push(vscode.LanguageModelChatMessage.User(finalPrompt));

    return messages;
  }
}
