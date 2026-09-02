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
import { ModelSelector } from './modelSelector';
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
    const { messages, compressionResult } = this.promptBuilder.buildPrompt(request, context, rankedContexts, parsedQuery.intent);

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
    const maxTokens = 6000;
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

    // 5. Smart Model Selection
    const modelResult = await ModelSelector.selectForTask(
      parsedQuery.intent,
      request.prompt,
      this.outputChannel
    );

    if (!modelResult) {
      response.markdown('⚠️ No language model is currently available. Please ensure GitHub Copilot is installed and active.');
      return {};
    }

    const selectedModel = modelResult.model;
    response.progress(`Using ${modelResult.label} (${modelResult.tier} tier)...`);

    // Track whether Orchid successfully answered
    let orchidAnswered = false;
    let orchidResponseText = '';

    // 6. Send to LM
    try {

      const editFileTool: vscode.LanguageModelChatTool = {
        name: 'orchid_edit',
        description: 'Edit existing files in the workspace. You MUST use this tool whenever the user asks you to write, add, modify, or delete any code in an existing file. NEVER output raw fenced code blocks as a substitute for this tool call. Always call orchid_read_source first to get the exact current file content, then use this tool with a precise originalText match. Write complete, production-ready code — no placeholder comments, no stubs.',
        inputSchema: {
          type: 'object',
          properties: {
            modifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filePath: { type: 'string', description: 'Absolute or relative path to the file' },
                  edits: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        originalText: { type: 'string', description: 'The exact existing text to replace. Must match exactly what orchid_read_source returned.' },
                        replacementText: { type: 'string', description: 'The complete new text. Must be fully implemented with no placeholders.' }
                      },
                      required: ['originalText', 'replacementText']
                    }
                  }
                },
                required: ['filePath', 'edits']
              }
            }
          },
          required: ['modifications']
        }
      };

      const createFileTool: vscode.LanguageModelChatTool = {
        name: 'orchid_create_file',
        description: 'Create a brand-new file in the workspace with the given content. Use this when the user asks you to create a new file. Write 100% complete, production-ready file content — no placeholders, no stubs.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute or relative path to the new file' },
            content: { type: 'string', description: 'The complete content to write to the new file' }
          },
          required: ['filePath', 'content']
        }
      };

      const readSourceTool: vscode.LanguageModelChatTool = {
        name: 'orchid_read_source',
        description: 'Read the exact source code of a file. Use this BEFORE editing to get the exact originalText. You can optionally specify startLine and endLine to read a specific range.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute or relative path to the file' },
            startLine: { type: 'number', description: 'Optional starting line number (1-indexed)' },
            endLine: { type: 'number', description: 'Optional ending line number (inclusive)' }
          },
          required: ['filePath']
        }
      };

      let isDone = false;
      while (!isDone) {
        const chatResponse = await selectedModel.sendRequest(
          messages,
          { tools: [editFileTool, createFileTool, readSourceTool] },
          token
        );

        let toolCallPart: vscode.LanguageModelToolCallPart | undefined;
        // Buffer text so we can suppress it when the LLM is making a tool call.
        // Without this, text like "Here's the code:" gets streamed into chat
        // even when the actual edit is about to happen via orchid_edit.
        let textBuffer = '';

        for await (const fragment of chatResponse.stream) {
          if (fragment instanceof vscode.LanguageModelToolCallPart) {
            toolCallPart = fragment;
            // Discard any text buffered so far — the LLM is doing an edit, not explaining
            textBuffer = '';
          } else if (fragment instanceof vscode.LanguageModelTextPart) {
            if (!toolCallPart) {
              textBuffer += fragment.value;
            }
          } else if (typeof fragment === 'string') {
            if (!toolCallPart) {
              textBuffer += fragment;
            }
          }
        }

        // Only emit text when the response had NO tool call (pure explanation / Q&A)
        if (!toolCallPart && textBuffer.trim()) {
          response.markdown(textBuffer);
          orchidResponseText += textBuffer;
        }

        if (toolCallPart && toolCallPart.name === 'orchid_read_source') {
          response.progress('Reading source code...');
          const args = toolCallPart.input as any;
          try {
            // Resolve URI
            let uri: vscode.Uri;
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
              const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
              const path = require('path');
              const fullPath = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(wsPath, args.filePath);
              uri = vscode.Uri.file(fullPath);
            } else {
              uri = vscode.Uri.file(args.filePath);
            }

            const doc = await vscode.workspace.openTextDocument(uri);
            let text = '';
            if (args.startLine !== undefined && args.endLine !== undefined) {
              const start = Math.max(0, args.startLine - 1);
              const end = Math.min(doc.lineCount - 1, args.endLine - 1);
              for (let i = start; i <= end; i++) {
                text += doc.lineAt(i).text + '\n';
              }
            } else {
              text = doc.getText();
            }

            const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
              new vscode.LanguageModelTextPart(text)
            ]);
            messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
            messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
            // Do NOT set isDone = true, allow loop to continue
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
              new vscode.LanguageModelTextPart(`Failed to read source: ${errorMsg}`)
            ]);
            messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
            messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
          }
        } else if (toolCallPart && toolCallPart.name === 'orchid_create_file') {
          response.progress('Creating new file...');
          const args = toolCallPart.input as any;
          try {
            let uri: vscode.Uri;
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
              const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
              const path = require('path');
              const fullPath = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(wsPath, args.filePath);
              uri = vscode.Uri.file(fullPath);
            } else {
              uri = vscode.Uri.file(args.filePath);
            }

            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.createFile(uri, { ignoreIfExists: false, overwrite: false });
            workspaceEdit.insert(uri, new vscode.Position(0, 0), args.content);
            const success = await vscode.workspace.applyEdit(workspaceEdit);

            if (success) {
              // Open the newly created file in the editor
              await vscode.window.showTextDocument(uri);
              const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
                new vscode.LanguageModelTextPart(`File created successfully: ${args.filePath}`)
              ]);
              messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
              messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
              response.markdown(`\n\n✅ *Created \`${args.filePath}\`. File is now open in the editor.*`);
              isDone = true;
            } else {
              const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
                new vscode.LanguageModelTextPart(`Failed to create file: ${args.filePath}`)
              ]);
              messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
              messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
            }
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
              new vscode.LanguageModelTextPart(`Internal error creating file: ${errorMsg}`)
            ]);
            messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
            messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
          }
        } else if (toolCallPart && toolCallPart.name === 'orchid_edit') {
          response.progress('Applying workspace edits...');
          const args = toolCallPart.input as any;
          const workspaceEdit = new vscode.WorkspaceEdit();
          let hasErrors = false;
          let errorMessage = '';

          try {
            if (args.modifications && Array.isArray(args.modifications)) {
              for (const mod of args.modifications) {
                if (!mod.filePath || !Array.isArray(mod.edits)) continue;

                // Resolve URI
                let uri: vscode.Uri;
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                  const wsPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                  const path = require('path');
                  const fullPath = path.isAbsolute(mod.filePath) ? mod.filePath : path.resolve(wsPath, mod.filePath);
                  uri = vscode.Uri.file(fullPath);
                } else {
                  uri = vscode.Uri.file(mod.filePath);
                }

                // Open file
                let doc: vscode.TextDocument;
                try {
                  doc = await vscode.workspace.openTextDocument(uri);
                } catch (e) {
                  hasErrors = true;
                  errorMessage += `File not found: ${mod.filePath}\n`;
                  continue;
                }

                const docText = doc.getText();

                for (const edit of mod.edits) {
                  if (typeof edit.originalText !== 'string' || typeof edit.replacementText !== 'string') continue;

                  const idx = docText.indexOf(edit.originalText);
                  if (idx === -1) {
                    hasErrors = true;
                    errorMessage += `Could not find originalText in ${mod.filePath}:\n${edit.originalText}\n`;
                  } else {
                    const lastIdx = docText.lastIndexOf(edit.originalText);
                    if (idx !== lastIdx) {
                      hasErrors = true;
                      errorMessage += `Ambiguous match for originalText in ${mod.filePath}. Provided text occurs multiple times.\n`;
                    } else {
                      const startPos = doc.positionAt(idx);
                      const endPos = doc.positionAt(idx + edit.originalText.length);
                      const range = new vscode.Range(startPos, endPos);
                      workspaceEdit.replace(uri, range, edit.replacementText);
                    }
                  }
                }
              }

              if (hasErrors) {
                const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
                  new vscode.LanguageModelTextPart(`Edit failed due to validation errors:\n${errorMessage}\nPlease try again with corrected originalText.`)
                ]);
                messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
                messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
              } else {
                const success = await vscode.workspace.applyEdit(workspaceEdit);
                if (success) {
                  const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
                    new vscode.LanguageModelTextPart('Successfully applied edits.')
                  ]);
                  messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
                  messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
                  response.markdown('\n\n✅ *Applied edits directly in the editor. Review the unsaved changes.*');
                  isDone = true;
                } else {
                  const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
                    new vscode.LanguageModelTextPart('Failed to apply workspace edit internally.')
                  ]);
                  messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
                  messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
                }
              }
            } else {
              isDone = true;
            }
          } catch (e) {
             const errorMsg = e instanceof Error ? e.message : String(e);
             const resultPart = new vscode.LanguageModelToolResultPart(toolCallPart.callId, [
               new vscode.LanguageModelTextPart(`Internal error during edit: ${errorMsg}`)
             ]);
             messages.push(vscode.LanguageModelChatMessage.Assistant([toolCallPart]));
             messages.push(vscode.LanguageModelChatMessage.User([resultPart]));
          }
        } else {
          isDone = true;
        }
      }

      orchidAnswered = true;
    } catch (err) {
      // Orchid's LM call failed — will fall back to Copilot below
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Orchid] LM error, falling back to Copilot: ${errorMsg}`);
      orchidAnswered = false;
    }

    // ── Check if Orchid's response indicates it couldn't answer ──────────
    if (orchidAnswered && orchidResponseText) {
      const cantAnswerPatterns = [
        /i don'?t have enough context/i,
        /insufficient context/i,
        /cannot answer/i,
        /can'?t answer/i,
        /no relevant (project )?context found/i,
        /i'?m unable to/i,
        /i don'?t have (the |enough )?information/i,
        /outside (of )?my (knowledge|context)/i,
        /not (enough|sufficient) (context|information|data)/i,
        /beyond (the |my )?(available |provided )?context/i,
      ];
      const looksLikeCantAnswer = cantAnswerPatterns.some(p => p.test(orchidResponseText));
      if (looksLikeCantAnswer) {
        this.outputChannel.appendLine('[Orchid] Response indicates insufficient context. Falling back to Copilot.');
        orchidAnswered = false;
      }
    }

    // ── Copilot Fallback ─────────────────────────────────────────────────
    // When Orchid can't answer, re-send the user's raw query to the same
    // model without project context or tools — so it works like normal Copilot.
    if (!orchidAnswered) {
      try {
        response.progress('Orchid context insufficient — answering with Copilot...');

        const fallbackMessages: vscode.LanguageModelChatMessage[] = [];

        // Replay chat history
        for (const msg of context.history) {
          if (msg instanceof vscode.ChatRequestTurn) {
            fallbackMessages.push(vscode.LanguageModelChatMessage.User(msg.prompt));
          } else if (msg instanceof vscode.ChatResponseTurn) {
            const textParts = msg.response.map(r => r.value).join('');
            fallbackMessages.push(vscode.LanguageModelChatMessage.Assistant(textParts));
          }
        }

        // Send raw user prompt — no system instructions, no project context, no tools
        fallbackMessages.push(vscode.LanguageModelChatMessage.User(request.prompt));

        const fallbackResponse = await selectedModel.sendRequest(fallbackMessages, {}, token);

        response.markdown('\n\n---\nℹ️ *Orchid didn\'t have enough project context for this query. Answering using Copilot:*\n\n');

        for await (const fragment of fallbackResponse.stream) {
          if (fragment instanceof vscode.LanguageModelTextPart) {
            response.markdown(fragment.value);
          } else if (typeof fragment === 'string') {
            response.markdown(fragment);
          }
        }
      } catch (fallbackErr) {
        const errorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        response.markdown(`\n\n*Error: Could not get a response. ${errorMsg}*`);
      }
    }

    return { metadata: { retrievedContexts: rankedContexts.length } };
  }
}
