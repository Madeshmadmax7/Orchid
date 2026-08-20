// ============================================================================
// Project Memory — Sidebar Provider
// ============================================================================
// WebviewViewProvider that renders the project overview dashboard.
// Shows project stats, status, and action buttons styled to match VS Code.
// ============================================================================

import * as vscode from 'vscode';
import { ProjectMetadata } from '../types';

/**
 * Provides the Project Overview webview in the sidebar.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'projectMemory.overview';

  private view?: vscode.WebviewView;
  private projectMetadata?: ProjectMetadata;
  private isIndexing = false;
  private lastAnalysisResult?: {
    fileCount: number;
    symbolCount: number;
    dependencyCount: number;
    durationMs: number;
    errors: number;
  };

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'analyze':
          vscode.commands.executeCommand('projectMemory.analyzeProject');
          break;
        case 'reindex':
          vscode.commands.executeCommand('projectMemory.reindexChanged');
          break;
        case 'clear':
          vscode.commands.executeCommand('projectMemory.clearCache');
          break;
      }
    });

    this.updateView();
  }

  /**
   * Updates the project metadata and refreshes the view.
   */
  setProjectMetadata(metadata: ProjectMetadata): void {
    this.projectMetadata = metadata;
    this.updateView();
  }

  /**
   * Sets the indexing state and refreshes the view.
   */
  setIndexing(indexing: boolean): void {
    this.isIndexing = indexing;
    this.updateView();
  }

  /**
   * Sets the last analysis result for display.
   */
  setAnalysisResult(result: {
    fileCount: number;
    symbolCount: number;
    dependencyCount: number;
    durationMs: number;
    errors: number;
  }): void {
    this.lastAnalysisResult = result;
    this.updateView();
  }

  /**
   * Clears the displayed data (e.g., after cache clear).
   */
  clearData(): void {
    this.projectMetadata = undefined;
    this.lastAnalysisResult = undefined;
    this.updateView();
  }

  private updateView(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const meta = this.projectMetadata;

    const statusIcon = this.isIndexing
      ? '⏳'
      : meta
        ? '✓'
        : '○';
    const statusText = this.isIndexing
      ? 'Indexing...'
      : meta
        ? 'Indexed'
        : 'Not Indexed';
    const statusClass = this.isIndexing
      ? 'status-indexing'
      : meta
        ? 'status-indexed'
        : 'status-none';

    const projectName = meta?.projectName ?? 'No Project';
    const totalFiles = meta?.totalFiles ?? 0;
    const totalSymbols = meta?.totalSymbols ?? 0;
    const totalDeps = meta?.totalDependencies ?? 0;

    // Component breakdown
    const componentTypes = meta?.componentTypes ?? {};
    const componentCount = Object.values(componentTypes).reduce(
      (sum, count) => sum + (count ?? 0),
      0
    );

    // Language breakdown
    const languages = meta?.languages ?? {};
    const languageEntries = Object.entries(languages)
      .filter(([, count]) => (count ?? 0) > 0)
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

    // Time since last analysis
    const lastAnalysis = meta?.lastFullAnalysis
      ? this.getTimeSince(meta.lastFullAnalysis)
      : 'Never';

    // Duration
    const duration = this.lastAnalysisResult
      ? `${(this.lastAnalysisResult.durationMs / 1000).toFixed(1)}s`
      : '';

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 0 12px 12px;
            margin: 0;
          }

          .section {
            margin-bottom: 16px;
          }

          .section-title {
            text-transform: uppercase;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.5px;
            color: var(--vscode-sideBarSectionHeader-foreground);
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
          }

          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
          }

          .status-indexed {
            background: rgba(40, 167, 69, 0.15);
            color: #28a745;
          }

          .status-indexing {
            background: rgba(255, 193, 7, 0.15);
            color: #ffc107;
          }

          .status-none {
            background: rgba(128, 128, 128, 0.15);
            color: var(--vscode-descriptionForeground);
          }

          .stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }

          .stat-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
            border-radius: 6px;
            padding: 10px;
            text-align: center;
          }

          .stat-value {
            font-size: 20px;
            font-weight: 700;
            color: var(--vscode-textLink-foreground);
          }

          .stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-top: 2px;
          }

          .info-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 12px;
          }

          .info-label {
            color: var(--vscode-descriptionForeground);
          }

          .info-value {
            color: var(--vscode-foreground);
            font-weight: 500;
          }

          .btn {
            width: 100%;
            padding: 8px 12px;
            margin-bottom: 6px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
          }

          .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
          }

          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }

          .language-bar {
            height: 6px;
            border-radius: 3px;
            background: var(--vscode-editor-background);
            overflow: hidden;
            display: flex;
            margin-top: 6px;
            margin-bottom: 4px;
          }

          .language-segment {
            height: 100%;
          }

          .language-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            font-size: 11px;
          }

          .legend-item {
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .legend-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
          }

          .empty-state {
            text-align: center;
            padding: 24px 16px;
            color: var(--vscode-descriptionForeground);
          }

          .empty-state p {
            margin: 8px 0;
            font-size: 12px;
            line-height: 1.5;
          }

          .empty-icon {
            font-size: 32px;
            margin-bottom: 8px;
          }
        </style>
      </head>
      <body>
        ${
          !meta && !this.isIndexing
            ? `
          <div class="empty-state">
            <div class="empty-icon">🌸</div>
            <p><strong>Orchid</strong></p>
            <p>Analyze your project to build persistent knowledge for smarter AI context retrieval.</p>
            <button class="btn btn-primary" onclick="send('analyze')">
              Analyze Project
            </button>
          </div>
        `
            : `
          <!-- Status -->
          <div class="section">
            <div class="section-title">Project</div>
            <div class="info-row">
              <span class="info-label">Name</span>
              <span class="info-value">${this.escapeHtml(projectName)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Status</span>
              <span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span>
            </div>
            ${duration ? `
            <div class="info-row">
              <span class="info-label">Analysis Time</span>
              <span class="info-value">${duration}</span>
            </div>
            ` : ''}
            <div class="info-row">
              <span class="info-label">Last Updated</span>
              <span class="info-value">${lastAnalysis}</span>
            </div>
          </div>
          
          <div id="semanticStatus" style="margin-top: 10px; font-size: 11px; color: var(--vscode-textLink-foreground);"></div>

          <!-- Stats -->
          <div class="section">
            <div class="section-title">Statistics</div>
            <div class="stat-grid">
              <div class="stat-card">
                <div class="stat-value">${this.formatNumber(totalFiles)}</div>
                <div class="stat-label">Files</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${this.formatNumber(componentCount)}</div>
                <div class="stat-label">Components</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${this.formatNumber(totalSymbols)}</div>
                <div class="stat-label">Symbols</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">${this.formatNumber(totalDeps)}</div>
                <div class="stat-label">Dependencies</div>
              </div>
            </div>
          </div>

          <!-- Languages -->
          ${languageEntries.length > 0 ? `
          <div class="section">
            <div class="section-title">Languages</div>
            <div class="language-bar">
              ${languageEntries.map(([lang, count], i) => {
                const pct = totalFiles > 0 ? ((count ?? 0) / totalFiles) * 100 : 0;
                const colors = ['#3178c6', '#f7df1e', '#61dafb', '#764abc'];
                return `<div class="language-segment" style="width:${pct}%;background:${colors[i % colors.length]}"></div>`;
              }).join('')}
            </div>
            <div class="language-legend">
              ${languageEntries.map(([lang, count], i) => {
                const colors = ['#3178c6', '#f7df1e', '#61dafb', '#764abc'];
                return `<span class="legend-item"><span class="legend-dot" style="background:${colors[i % colors.length]}"></span>${lang} (${count})</span>`;
              }).join('')}
            </div>
          </div>
          ` : ''}

          <!-- Actions -->
          <div class="section">
            <div class="section-title">Actions</div>
            <button class="btn btn-primary" onclick="send('analyze')" ${this.isIndexing ? 'disabled' : ''}>
              ${this.isIndexing ? '⏳ Analyzing...' : '🔍 Analyze Project'}
            </button>
            <button class="btn btn-secondary" onclick="send('reindex')" ${this.isIndexing || !meta ? 'disabled' : ''}>
              🔄 Reindex Changed Files
            </button>
            <button class="btn btn-secondary" onclick="send('clear')" ${this.isIndexing ? 'disabled' : ''}>
              🗑️ Clear Cache
            </button>
          </div>
        `
        }

        <script>
          const vscode = acquireVsCodeApi();
          function send(command) {
            vscode.postMessage({ command });
          }

          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
              case 'updateSemanticStatus':
                const el = document.getElementById('semanticStatus');
                if (el) {
                  el.innerText = message.status;
                }
                break;
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private formatNumber(n: number): string {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}k`;
    }
    return n.toString();
  }

  public updateSemanticStatus(status: string): void {
    if (this.view) {
      this.view.webview.postMessage({ type: 'updateSemanticStatus', status });
    }
  }

  private getTimeSince(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) {
      return 'Just now';
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
