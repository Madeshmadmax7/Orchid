// ============================================================================
// Project Memory — Commands
// ============================================================================
// Registers all VS Code commands and wires them to the analyzer,
// storage, and UI modules.
// ============================================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { RepositoryAnalyzer } from '../analyzer/repositoryAnalyzer';
import { MetadataStore } from '../knowledge/metadataStore';
import { ProjectIndex } from '../knowledge/projectIndex';
import { DependencyGraph } from '../graph/dependencyGraph';
import { SidebarProvider } from './sidebarProvider';
import { ComponentTreeProvider } from './componentTreeProvider';

/**
 * Registers all Project Memory commands.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  analyzer: RepositoryAnalyzer,
  metadataStore: MetadataStore,
  projectIndex: ProjectIndex,
  graph: DependencyGraph,
  sidebarProvider: SidebarProvider,
  componentTreeProvider: ComponentTreeProvider
): void {
  // ── Analyze Project ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'projectMemory.analyzeProject',
      async () => {
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
          return;
        }

        sidebarProvider.setIndexing(true);

        try {
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Project Memory',
              cancellable: true,
            },
            async (progress, token) => {
              progress.report({ message: 'Scanning workspace files...' });

              const result = await analyzer.analyzeProject(
                workspaceFolder,
                token
              );

              if (token.isCancellationRequested) {
                vscode.window.showWarningMessage(
                  'Project Memory: Analysis cancelled.'
                );
                return null;
              }

              progress.report({
                message: `Analyzed ${result.fileCount} files`,
                increment: 100,
              });

              return result;
            }
          );

          if (result) {
            sidebarProvider.setProjectMetadata(result.projectMetadata);
            sidebarProvider.setAnalysisResult({
              fileCount: result.fileCount,
              symbolCount: result.symbolCount,
              dependencyCount: result.dependencyCount,
              durationMs: result.durationMs,
              errors: result.errors.length,
            });
            componentTreeProvider.setProjectIndex(
              projectIndex,
              workspaceFolder.uri.fsPath
            );

            const errorMsg =
              result.errors.length > 0
                ? ` (${result.errors.length} errors)`
                : '';
            vscode.window.showInformationMessage(
              `Project Memory: Analyzed ${result.fileCount} files, ` +
                `${result.symbolCount} symbols, ` +
                `${result.dependencyCount} dependencies ` +
                `in ${(result.durationMs / 1000).toFixed(1)}s${errorMsg}`
            );
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `Project Memory: Analysis failed — ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          sidebarProvider.setIndexing(false);
        }
      }
    )
  );

  // ── Reindex Changed Files ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'projectMemory.reindexChanged',
      async () => {
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
          return;
        }

        const hasData = await metadataStore.hasData();
        if (!hasData) {
          vscode.window.showWarningMessage(
            'Project Memory: No existing analysis found. Run "Analyze Project" first.'
          );
          return;
        }

        sidebarProvider.setIndexing(true);

        try {
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Project Memory: Reindexing...',
              cancellable: true,
            },
            async (_progress, token) => {
              return await analyzer.incrementalReindex(
                workspaceFolder,
                token
              );
            }
          );

          // Refresh UI
          const projectMeta = await metadataStore.loadProjectMetadata();
          if (projectMeta) {
            sidebarProvider.setProjectMetadata(projectMeta);
          }
          componentTreeProvider.setProjectIndex(
            projectIndex,
            workspaceFolder.uri.fsPath
          );

          vscode.window.showInformationMessage(
            `Project Memory: Reindexed — ` +
              `${result.updated} updated, ` +
              `${result.unchanged} unchanged, ` +
              `${result.removed} removed`
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Project Memory: Reindex failed — ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          sidebarProvider.setIndexing(false);
        }
      }
    )
  );

  // ── Clear Cache ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('projectMemory.clearCache', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Project Memory: Clear all cached analysis data?',
        { modal: true },
        'Clear'
      );

      if (confirm !== 'Clear') {
        return;
      }

      try {
        await metadataStore.clear();
        projectIndex.clear();
        graph.clear();
        sidebarProvider.clearData();
        componentTreeProvider.clearData();

        vscode.window.showInformationMessage(
          'Project Memory: Cache cleared.'
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Project Memory: Failed to clear cache — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  // ── Show Overview ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('projectMemory.showOverview', () => {
      vscode.commands.executeCommand(
        'workbench.view.extension.project-memory'
      );
    })
  );

  // ── Search Symbols ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('projectMemory.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search Project Memory (symbols, classes, functions, etc.)',
        placeHolder: 'e.g. PaymentService',
      });

      if (!query) {
        return;
      }

      const results = projectIndex.searchSymbols(query);
      if (results.length === 0) {
        vscode.window.showInformationMessage(`Project Memory: No results for "${query}"`);
        return;
      }

      // Format results for QuickPick
      const items = results.map((res) => {
        const symbol = res.symbolInfo;
        const icon = getSymbolIconString(symbol.kind);
        const desc = symbol.parameters ? `(${symbol.parameters.length} params)` : '';
        
        return {
          label: `${icon} ${symbol.name} ${desc}`,
          description: res.filePath,
          detail: `Type: ${symbol.kind} | Line: ${symbol.startLine}`,
          location: res,
        };
      });

      const selected = await vscode.window.showQuickPick(items, {
        matchOnDescription: true,
        placeHolder: `Found ${results.length} results. Select one to navigate.`,
      });

      if (selected) {
        const workspaceFolder = getWorkspaceFolder();
        if (workspaceFolder) {
          const absolutePath = path.join(workspaceFolder.uri.fsPath, selected.location.filePath);
          const uri = vscode.Uri.file(absolutePath);
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc);
          
          // Jump to line
          const line = Math.max(0, selected.location.symbolInfo.startLine - 1);
          const range = new vscode.Range(line, 0, line, 0);
          editor.selection = new vscode.Selection(line, 0, line, 0);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
      }
    })
  );
}

/**
 * Returns a VS Code codicon string for a symbol kind.
 */
function getSymbolIconString(kind: string): string {
  const iconMap: Record<string, string> = {
    class: '$(symbol-class)',
    function: '$(symbol-method)',
    method: '$(symbol-method)',
    property: '$(symbol-property)',
    interface: '$(symbol-interface)',
    type: '$(symbol-class)',
    enum: '$(symbol-enum)',
    variable: '$(symbol-variable)',
    constant: '$(symbol-constant)',
    'react-component': '$(symbol-misc)',
  };
  return iconMap[kind] ?? '$(symbol-misc)';
}

/**
 * Gets the first workspace folder or shows an error.
 */
function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage(
      'Project Memory: No workspace folder open.'
    );
    return undefined;
  }
  return folders[0];
}
