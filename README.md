# Orchid

Orchid is an advanced AI Context Optimization extension for Visual Studio Code, designed to solve the significant bottleneck in modern AI-assisted development: context bloat. Standard LLM coding assistants consume massive amounts of tokens by naively reading entire files to establish context. This brute-force approach leads to slower response times, degraded AI reasoning due to cluttered context windows, and unnecessary computational waste.

Orchid solves this by analyzing a codebase once to build a persistent, highly structured intelligence map.

## Features

- **Deterministic AST Parsing**: Maps out every function, class, and architectural dependency across the repository without requiring constant cloud compute.
- **Background Semantic Indexer**: Leverages a fast LLM to generate precise, one-sentence summaries for every single method, interface, and class, persisting them directly into a local metadata graph.
- **Real-Time File Watcher**: Instantly re-indexes specific components upon file modification, seamlessly updating semantic memory in the background without interrupting the development workflow.
- **Query Routing**: The `@orchid` chat participant intercepts developer requests and performs a lightning-fast search against its semantic graph, extracting only the necessary architectural logic.
- **Token Reduction**: By feeding the main LLM a surgically compressed context payload, Orchid reduces input token consumption by up to 90% per request.

## Installation

1. Navigate to the Extensions panel in Visual Studio Code.
2. Click the Views and More Actions menu (ellipsis) and select "Install from VSIX...".
3. Select the provided `orchid` VSIX file to install the extension.
4. Reload the Visual Studio Code window if prompted.

## Usage

1. Open any JavaScript or TypeScript workspace in Visual Studio Code.
2. Open the Orchid view from the Activity Bar and click "Analyze Project". The initial analysis will parse the AST and build the background semantic index.
3. Open GitHub Copilot Chat and use the `@orchid` participant to query your codebase. 

## Architecture

Orchid utilizes a two-phase architecture. The extraction phase runs a lightweight indexing engine over the source code to persist minimal, highly-accurate symbol data locally within the workspace. The retrieval phase uses keyword matching against the generated AI summaries to locate specific methods across the codebase, injecting only the necessary context into the Copilot context window.
