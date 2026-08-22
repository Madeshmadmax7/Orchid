// ============================================================================
// Project Memory — Semantic Indexer
// ============================================================================
// Uses VS Code's Copilot LLM to generate plain-english summaries for 
// indexed components, enabling semantic search and context optimization.
// Processes requests in a throttled queue to avoid rate limits.
// ============================================================================

import * as vscode from 'vscode';
import { FileMetadata } from '../types';
import { generateFileSummary } from '../analyzer/componentSummarizer';
import { MetadataStore } from './metadataStore';
import { SidebarProvider } from '../ui/sidebarProvider';

export class SemanticIndexer {
  private queue: FileMetadata[] = [];
  private isProcessing: boolean = false;
  private totalInQueue: number = 0;
  private processedCount: number = 0;

  constructor(
    private metadataStore: MetadataStore,
    private sidebarProvider?: SidebarProvider
  ) {}

  /**
   * Adds files to the semantic indexing queue.
   */
  queueFiles(files: FileMetadata[]): void {
    // Only queue files that don't already have a summary
    const toProcess = files.filter(f => !f.summary);
    
    if (toProcess.length === 0) { return; }

    this.queue.push(...toProcess);
    this.totalInQueue += toProcess.length;
    
    this.updateUI();
    this.processQueue();
  }

  /**
   * Processes the queue sequentially with a delay.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) { return; }
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const file = this.queue.shift();
        if (file) {
          await this.generateSummary(file);
          this.processedCount++;
          this.updateUI();
          
          // Delay to respect rate limits (~3 files per second max)
          await new Promise(resolve => setTimeout(resolve, 333));
        }
      }
    } finally {
      this.isProcessing = false;
      this.totalInQueue = 0;
      this.processedCount = 0;
      this.updateUI();
    }
  }

  /**
   * Calls the LLM to generate a semantic summary for the file.
   */
  private async generateSummary(file: FileMetadata): Promise<void> {
    try {
      // Find symbols that need summarization (missing summary)
      const missingSymbols = file.symbols.filter(s => !s.summary);
      const needsFileSummary = !file.summary;

      // If everything is already summarized by AST or cached, skip LLM call entirely
      if (missingSymbols.length === 0 && !needsFileSummary) {
        return;
      }

      // Safely request Copilot models (don't specify family to avoid API errors on older Copilot versions)
      let models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      
      if (!models || models.length === 0) {
        vscode.window.showErrorMessage('Project Memory: Copilot Language Model not found. Ensure Copilot Chat is installed and authorized.');
        return;
      }

      // Pick the first available model
      const model = models[0];

      // Generate the minimal AST structural summary
      const structuralSummary = generateFileSummary(file);

      const symbolNamesToSummarize = missingSymbols.map(s => s.name).join(', ');
      
      const prompt = `You are a code indexer. Read this AST summary and return a valid JSON object.
The JSON MUST contain a 1-sentence description (max 15 words) of its specific purpose for the following symbols ONLY:
${symbolNamesToSummarize}
${needsFileSummary ? '\nAlso include a "__file__" key with a 1-sentence summary of the whole file.' : ''}

Format EXACTLY like this (NO markdown blocks, just raw JSON):
{
  ${needsFileSummary ? '"__file__": "File purpose here",' : ''}
  "FunctionNameOrMethodName": "Purpose here"
}

AST:
${structuralSummary}`;

      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

      let responseText = '';
      for await (const fragment of response.text) {
        responseText += fragment;
      }

      // Parse JSON from the AI
      try {
        const cleanText = responseText.replace(/^```json\n?|```\n?$/g, '').trim();
        const json = JSON.parse(cleanText);

        // Assign file summary
        if (json.__file__) {
          file.summary = json.__file__;
        }

        // Assign symbol summaries
        for (const symbol of file.symbols) {
          if (json[symbol.name]) {
            symbol.summary = json[symbol.name];
          }
        }
      } catch (e) {
        console.warn('Failed to parse AI JSON response', responseText);
      }

      // Persist the updated metadata
      await this.metadataStore.saveFileMetadata(file);
      
    } catch (err: any) {
      // Show an explicit error message so the user knows why it failed
      vscode.window.showErrorMessage(`Project Memory AI Error: ${err.message || 'Unknown error during LLM request'}`);
      console.warn(`Project Memory: Semantic Indexing failed for ${file.filePath}`, err);
    }
  }

  private updateUI(): void {
    if (!this.sidebarProvider) return;

    if (this.totalInQueue === 0) {
      this.sidebarProvider.updateSemanticStatus('');
    } else {
      this.sidebarProvider.updateSemanticStatus(`🌸 AI Indexing: ${this.processedCount} / ${this.totalInQueue}`);
    }
  }
}
