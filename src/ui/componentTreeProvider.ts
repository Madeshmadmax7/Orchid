// ============================================================================
// Project Memory — Component Tree Provider
// ============================================================================
// TreeDataProvider for the Component Explorer sidebar view.
// Organizes files by component type, then shows symbols within each file.
// ============================================================================

import * as vscode from 'vscode';
import { ComponentType, SymbolInfo, SymbolKind } from '../types';
import { ProjectIndex, SymbolLocation } from '../knowledge/projectIndex';

/**
 * Tree item types for the component explorer.
 */
type TreeItemType = 'category' | 'file' | 'symbol';

/**
 * Data associated with a tree item.
 */
interface TreeItemData {
  type: TreeItemType;
  label: string;
  componentType?: ComponentType;
  filePath?: string;
  symbolInfo?: SymbolInfo;
}

/**
 * A tree item in the component explorer.
 */
class ComponentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly data: TreeItemData,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(data.label, collapsibleState);

    switch (data.type) {
      case 'category':
        this.iconPath = this.getCategoryIcon(data.componentType!);
        this.contextValue = 'category';
        break;

      case 'file':
        this.iconPath = vscode.ThemeIcon.File;
        this.contextValue = 'file';
        this.resourceUri = data.filePath
          ? vscode.Uri.file(data.filePath)
          : undefined;
        this.description = data.filePath?.split('/').slice(0, -1).join('/');
        if (data.filePath) {
          this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(data.filePath)],
          };
        }
        break;

      case 'symbol':
        this.iconPath = this.getSymbolIcon(data.symbolInfo!.kind);
        this.contextValue = 'symbol';
        this.description = this.getSymbolDescription(data.symbolInfo!);
        if (data.filePath && data.symbolInfo) {
          this.command = {
            command: 'vscode.open',
            title: 'Go to Symbol',
            arguments: [
              vscode.Uri.file(data.filePath),
              {
                selection: new vscode.Range(
                  data.symbolInfo.startLine - 1,
                  0,
                  data.symbolInfo.startLine - 1,
                  0
                ),
              },
            ],
          };
        }
        break;
    }
  }

  private getCategoryIcon(type: ComponentType): vscode.ThemeIcon {
    const iconMap: Partial<Record<ComponentType, string>> = {
      service: 'server-process',
      controller: 'globe',
      repository: 'database',
      component: 'symbol-misc',
      utility: 'wrench',
      middleware: 'layers',
      hook: 'link',
      module: 'package',
      model: 'symbol-structure',
      gateway: 'plug',
      handler: 'terminal',
      test: 'beaker',
      config: 'gear',
      guard: 'shield',
      main: 'home',
      interface: 'symbol-interface',
      type: 'symbol-class',
      enum: 'symbol-enum',
      constant: 'symbol-constant',
    };
    return new vscode.ThemeIcon(iconMap[type] ?? 'file');
  }

  private getSymbolIcon(kind: SymbolKind): vscode.ThemeIcon {
    const iconMap: Record<SymbolKind, string> = {
      class: 'symbol-class',
      function: 'symbol-method',
      method: 'symbol-method',
      property: 'symbol-property',
      interface: 'symbol-interface',
      type: 'symbol-class',
      enum: 'symbol-enum',
      variable: 'symbol-variable',
      constant: 'symbol-constant',
      constructor: 'symbol-method',
      getter: 'symbol-property',
      setter: 'symbol-property',
      namespace: 'symbol-namespace',
      'react-component': 'symbol-misc',
    };
    return new vscode.ThemeIcon(iconMap[kind] ?? 'symbol-misc');
  }

  private getSymbolDescription(symbol: SymbolInfo): string {
    let desc: string = symbol.kind;
    if (symbol.parameters) {
      desc += `(${symbol.parameters.length})`;
    }
    if (symbol.isAsync) {
      desc = `async ${desc}`;
    }
    if (symbol.isStatic) {
      desc = `static ${desc}`;
    }
    return desc;
  }
}

/**
 * Provides tree data for the Component Explorer.
 */
export class ComponentTreeProvider
  implements vscode.TreeDataProvider<ComponentTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ComponentTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projectIndex?: ProjectIndex;
  private workspaceRoot?: string;

  /**
   * Updates the data source and refreshes the tree.
   */
  setProjectIndex(index: ProjectIndex, workspaceRoot: string): void {
    this.projectIndex = index;
    this.workspaceRoot = workspaceRoot;
    this.refresh();
  }

  /**
   * Clears the tree data.
   */
  clearData(): void {
    this.projectIndex = undefined;
    this.workspaceRoot = undefined;
    this.refresh();
  }

  /**
   * Refreshes the tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ComponentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: ComponentTreeItem
  ): Thenable<ComponentTreeItem[]> {
    if (!this.projectIndex) {
      return Promise.resolve([]);
    }

    // Root level: component type categories
    if (!element) {
      return Promise.resolve(this.getCategories());
    }

    // Category level: files of that type
    if (element.data.type === 'category' && element.data.componentType) {
      return Promise.resolve(
        this.getFilesInCategory(element.data.componentType)
      );
    }

    // File level: symbols in that file
    if (element.data.type === 'file' && element.data.filePath) {
      return Promise.resolve(this.getSymbolsInFile(element.data.filePath));
    }

    return Promise.resolve([]);
  }

  private getCategories(): ComponentTreeItem[] {
    if (!this.projectIndex) {
      return [];
    }

    const dist = this.projectIndex.getComponentTypeDistribution();
    const categories: ComponentTreeItem[] = [];

    // Order categories by count (descending)
    const sortedTypes = Object.entries(dist)
      .filter(([, count]) => (count ?? 0) > 0)
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

    for (const [type, count] of sortedTypes) {
      const label = `${this.formatTypeName(type as ComponentType)} (${count})`;
      categories.push(
        new ComponentTreeItem(
          {
            type: 'category',
            label,
            componentType: type as ComponentType,
          },
          vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    }

    return categories;
  }

  private getFilesInCategory(type: ComponentType): ComponentTreeItem[] {
    if (!this.projectIndex || !this.workspaceRoot) {
      return [];
    }

    const filePaths = this.projectIndex.getFilesByType(type);
    return filePaths.map((fp) => {
      const fileName = fp.split('/').pop() ?? fp;
      const absolutePath = `${this.workspaceRoot}/${fp}`;
      return new ComponentTreeItem(
        {
          type: 'file',
          label: fileName,
          filePath: absolutePath,
          componentType: type,
        },
        vscode.TreeItemCollapsibleState.Collapsed
      );
    });
  }

  private getSymbolsInFile(absolutePath: string): ComponentTreeItem[] {
    if (!this.projectIndex || !this.workspaceRoot) {
      return [];
    }

    // Convert absolute path back to relative
    const relativePath = absolutePath
      .replace(this.workspaceRoot + '/', '')
      .replace(this.workspaceRoot + '\\', '');
    const file = this.projectIndex.getFile(relativePath);
    if (!file) {
      return [];
    }

    // Show top-level symbols (exported or important ones)
    return file.symbols
      .filter(
        (s) =>
          !s.parentSymbol ||
          s.kind === 'class' ||
          s.kind === 'function' ||
          s.kind === 'react-component' ||
          s.kind === 'interface'
      )
      .map((symbol) => {
        const hasChildren = file.symbols.some(
          (s) => s.parentSymbol === symbol.name
        );
        const label = symbol.parameters
          ? `${symbol.name}(${symbol.parameters.map((p) => p.split(':')[0].trim()).join(', ')})`
          : symbol.name;

        return new ComponentTreeItem(
          {
            type: 'symbol',
            label,
            filePath: absolutePath,
            symbolInfo: symbol,
          },
          hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        );
      });
  }

  private formatTypeName(type: ComponentType): string {
    const names: Record<ComponentType, string> = {
      service: 'Services',
      controller: 'Controllers',
      repository: 'Repositories',
      component: 'Components',
      utility: 'Utilities',
      middleware: 'Middleware',
      hook: 'Hooks',
      module: 'Modules',
      model: 'Models',
      gateway: 'Gateways',
      handler: 'Handlers',
      test: 'Tests',
      config: 'Configuration',
      decorator: 'Decorators',
      guard: 'Guards',
      pipe: 'Pipes',
      interceptor: 'Interceptors',
      interface: 'Interfaces',
      enum: 'Enums',
      type: 'Types',
      constant: 'Constants',
      main: 'Entry Points',
      unknown: 'Other',
    };
    return names[type] ?? type;
  }
}
