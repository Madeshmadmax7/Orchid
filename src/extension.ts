// ============================================================================
// Project Memory — Extension Entry Point
// ============================================================================
// Activates the extension:
// 1. Creates core services (MetadataStore, ProjectIndex, DependencyGraph)
// 2. Registers sidebar views
// 3. Registers commands
// 4. Loads existing analysis data if available
// ============================================================================

import * as vscode from 'vscode';
import { MetadataStore } from './knowledge/metadataStore';
import { ProjectIndex } from './knowledge/projectIndex';
import { DependencyGraph } from './graph/dependencyGraph';
import { RepositoryAnalyzer } from './analyzer/repositoryAnalyzer';
import { SidebarProvider } from './ui/sidebarProvider';
import { ComponentTreeProvider } from './ui/componentTreeProvider';
import { registerCommands } from './ui/commands';
import { ChatParticipant } from './ai/chatParticipant';
import { SemanticIndexer } from './knowledge/semanticIndexer';

/**
 * Extension activation.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Project Memory: Activating...');

  // ── Get workspace root ──────────────────────────────────────────────
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders?.[0]?.uri;

  // ── Create core services ────────────────────────────────────────────
  const metadataStore = workspaceRoot
    ? new MetadataStore(workspaceRoot)
    : new MetadataStore(context.globalStorageUri);

  const projectIndex = new ProjectIndex();
  const graph = new DependencyGraph();

  // ── Create UI providers ─────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context.extensionUri);
  const componentTreeProvider = new ComponentTreeProvider();

  // ── Create Semantic Indexer ─────────────────────────────────────────
  const semanticIndexer = new SemanticIndexer(metadataStore, sidebarProvider);

  const analyzer = new RepositoryAnalyzer(
    metadataStore,
    projectIndex,
    graph,
    semanticIndexer
  );



  // Register the sidebar webview
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Register the component tree view
  const treeView = vscode.window.createTreeView('projectMemory.components', {
    treeDataProvider: componentTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // ── Register AI Participant ─────────────────────────────────────────
  const chatParticipant = new ChatParticipant(projectIndex, graph);
  chatParticipant.register(context);

  // ── Register commands ───────────────────────────────────────────────
  registerCommands(
    context,
    analyzer,
    metadataStore,
    projectIndex,
    graph,
    sidebarProvider,
    componentTreeProvider
  );

  // ── Load existing data ──────────────────────────────────────────────
  if (workspaceRoot) {
    loadExistingData(
      analyzer,
      metadataStore,
      projectIndex,
      graph,
      sidebarProvider,
      componentTreeProvider,
      workspaceFolders![0]
    );
  }

  // ── Auto-Reindex on Save ────────────────────────────────────────────
  let reindexTimeout: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      // Only react to file saves within the workspace
      if (!workspaceRoot || !doc.uri.fsPath.startsWith(workspaceRoot.fsPath)) {
        return;
      }
      
      // Debounce reindexing
      if (reindexTimeout) {
        clearTimeout(reindexTimeout);
      }
      
      reindexTimeout = setTimeout(async () => {
        try {
          const folder = workspaceFolders![0];
          const result = await analyzer.incrementalReindex(folder, new vscode.CancellationTokenSource().token);
          
          if (result.updated > 0 || result.removed > 0) {
            // Update UI if things changed
            const projectMeta = await metadataStore.loadProjectMetadata();
            if (projectMeta) {
              sidebarProvider.setProjectMetadata(projectMeta);
            }
            componentTreeProvider.refresh();
          }
        } catch (err) {
          console.error('Project Memory: Auto-reindex failed', err);
        }
      }, 1000); // 1s debounce
    })
  );

  console.log('Project Memory: Activated successfully.');
}

/**
 * Attempts to load existing analysis data on activation.
 */
async function loadExistingData(
  analyzer: RepositoryAnalyzer,
  metadataStore: MetadataStore,
  projectIndex: ProjectIndex,
  graph: DependencyGraph,
  sidebarProvider: SidebarProvider,
  componentTreeProvider: ComponentTreeProvider,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
  try {
    const loaded = await analyzer.loadExistingData();
    if (loaded) {
      const projectMeta = await metadataStore.loadProjectMetadata();
      if (projectMeta) {
        sidebarProvider.setProjectMetadata(projectMeta);
        componentTreeProvider.setProjectIndex(
          projectIndex,
          workspaceFolder.uri.fsPath
        );
        console.log(
          `Project Memory: Loaded existing data — ` +
            `${projectMeta.totalFiles} files, ` +
            `${projectMeta.totalSymbols} symbols`
        );
      }
    } else {
      console.log('Project Memory: No existing data found.');
    }
  } catch (err) {
    console.error('Project Memory: Failed to load existing data:', err);
  }
}

/**
 * Extension deactivation.
 */
export function deactivate(): void {
  console.log('Project Memory: Deactivated.');
}
