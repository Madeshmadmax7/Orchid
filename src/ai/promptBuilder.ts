// ============================================================================
// Project Memory — Prompt Builder
// ============================================================================
// Builds the final prompt array for the VS Code Copilot API.
// ============================================================================

import * as vscode from 'vscode';
import { RetrievedContext, QueryIntent } from '../types';
import { ContextCompressor } from '../retrieval/contextCompressor';

export class PromptBuilder {
  constructor(private compressor: ContextCompressor) {}

  /**
   * Builds the prompt messages array including the retrieved project context.
   */
  buildPrompt(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    retrievedContexts: RetrievedContext[],
    intent?: QueryIntent
  ) {
    const messages: vscode.LanguageModelChatMessage[] = [];

    // 1. Unified System Prompt
    // Intent classification is handled by Copilot natively from the original user request.
    // Orchid's role is to supply accurate, grounded project context only.
    const systemInstruction =
      'You are Orchid, an expert software engineering assistant with deep knowledge of the user\'s codebase.\n' +
      'Use the provided RELEVANT PROJECT CONTEXT to answer requests accurately and thoroughly.\n' +
      'The context contains deterministic structural data (AST extraction, symbols, imports, dependencies) from the user\'s codebase.\n' +
      '\n' +
      '=== EXPLANATION RULES ===\n' +
      'When the user asks you to explain, describe, or analyse anything, you MUST give a thorough, comprehensive, multi-paragraph response.\n' +
      'Cover: what it does, how it works internally, its design rationale, all relevant components, data flow, edge cases, and any important caveats.\n' +
      'Never give a 2–3 line summary when a full explanation is asked for. Depth and completeness are required.\n' +
      '\n' +
      '=== CODE GENERATION / MODIFICATION RULES ===\n' +
      'RULE 1 — READ FIRST: Before editing any existing file, you MUST call `orchid_read_source` to fetch the exact current file content. Never guess at existing code.\n' +
      'RULE 2 — USE THE TOOLS: You MUST use `orchid_edit` for changes to existing files, and `orchid_create_file` to create brand-new files. NEVER output raw fenced code blocks (``` ```) as a substitute for making an edit.\n' +
      'RULE 3 — COMPLETE CODE ONLY: Every function, class, or snippet you write must be 100% complete and production-ready. Absolutely NO placeholder comments such as "// add later", "// TODO", "// implement here", "// ..." or stub bodies. Write the full implementation every time.\n' +
      'RULE 4 — EXACT MATCH: The `originalText` field in `orchid_edit` must exactly match the text currently in the file (obtained via `orchid_read_source`).\n' +
      'RULE 5 — CONFIRM AFTER: After applying edits, briefly summarise what was changed and why.\n' +
      '\n' +
      '=== GENERAL RULES ===\n' +
      'Do not invent files, symbols, APIs, or implementation details not present in the context.\n' +
      'If the available context is insufficient, clearly state what additional information is needed and suggest running Project Memory: Analyze Project.';

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
    const maxTokens = 6000;
    const compressionResult = this.compressor.compress(retrievedContexts, maxTokens, intent);
    
    const finalPrompt = `${systemInstruction}\n\n=== PROJECT CONTEXT ===\n${compressionResult.text}\n=======================\n\nUser Question:\n${request.prompt}`;
    
    messages.push(vscode.LanguageModelChatMessage.User(finalPrompt));

    return { messages, compressionResult };
  }
}
