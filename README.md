# lsp-mcp

[![Blackwell Systems](https://raw.githubusercontent.com/blackwell-systems/blackwell-docs-theme/main/badge-trademark.svg)](https://github.com/blackwell-systems)
[![CI](https://github.com/blackwell-systems/LSP-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/blackwell-systems/LSP-MCP/actions)
[![LSP 3.17](https://img.shields.io/badge/LSP-3.17-blue.svg)](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An MCP server that bridges the [Model Context Protocol](https://modelcontextprotocol.io) and the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/). LLM agents use it to query real language servers for hover information, completions, diagnostics, code actions, and references — without spawning a new server process per request.

Built to the [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — correct lifecycle, capability negotiation, progress protocol, and response shapes throughout. Works with any compliant language server: `typescript-language-server`, `rust-analyzer`, `gopls`, `haskell-language-server`, `clangd`, and others.

## Quick Start

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "lsp": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "blackwell-systems/LSP-MCP",
        "<language-id>",
        "<path-to-lsp-binary>",
        "<lsp-args>"
      ]
    }
  }
}
```

**TypeScript example:**
```json
{
  "mcpServers": {
    "lsp": {
      "type": "stdio",
      "command": "npx",
      "args": ["blackwell-systems/LSP-MCP", "typescript", "typescript-language-server", "--stdio"]
    }
  }
}
```

**Haskell example:**
```json
{
  "mcpServers": {
    "lsp": {
      "type": "stdio",
      "command": "npx",
      "args": ["blackwell-systems/LSP-MCP", "haskell", "haskell-language-server-wrapper", "lsp"]
    }
  }
}
```

## How It Works

The server starts a persistent LSP connection when the MCP session begins. Tools and resources proxy requests to the running language server, returning results in a format agents can reason about. Persistent state means the language server maintains its workspace index and diagnostic cache across requests — no per-call startup cost.

### LSP 3.17 Conformance

This project was built against the [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) directly — each protocol area was implemented by reading the relevant spec section and verified through integration testing against real language servers. The spec sections referenced below are live links into the specification.

The client implements the full LSP 3.17 lifecycle and protocol correctly:

**[Lifecycle](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#lifeCycleMessages) (§3.15.1–3.15.4)**
- Correct `initialize` → `initialized` → `shutdown` sequence
- Graceful async shutdown via `SIGINT`/`SIGTERM` — the LSP subprocess is never orphaned
- Client capabilities declared for every feature used: `hover`, `completion`, `references`, `definition`, `implementation`, `typeDefinition`, `codeAction`, `publishDiagnostics`, `window.workDoneProgress`, `workspace.configuration`
- Server capabilities checked before sending requests — if the server doesn't declare `hoverProvider`, `completionProvider`, `referencesProvider`, or `codeActionProvider`, the request is skipped rather than sent and silently returning empty results

**[Progress protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#progress) (§3.18)**
- `window/workDoneProgress/create` — token pre-registered before acknowledging, so subsequent `$/progress` notifications are always recognized
- `$/progress` begin/report/end — all three kinds handled; workspace-ready detection waits for all active tokens to complete `end` before sending references requests

**Server-initiated requests**
- [`workspace/configuration`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_configuration) — responds with `null` per item, unblocking language servers (e.g. gopls) that gate workspace loading on this response
- `client/registerCapability` — dynamic capability registration acknowledged
- Unknown server-initiated requests receive a `null` response rather than being silently dropped

**[Message framing](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol) and JSON-RPC**
- Content-Length framing uses `Buffer.byteLength` for correct UTF-8 byte counts ([§3.4](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol))
- JSON-RPC 2.0 request/response/notification shapes correct throughout ([§3.3](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol))
- LSP error codes `-32601` (MethodNotFound) and `-32002` (ServerNotInitialized) logged as warnings; other codes at debug level ([§3.6](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#responseMessage))

**Response shapes**
- [`textDocument/hover`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_hover) — handles `MarkupContent` (checks `kind: "markdown" | "plaintext"`), deprecated `MarkedString[]`, and plain string forms (§3.15.11)
- [`textDocument/completion`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_completion) — handles both `CompletionList` and `CompletionItem[]` response shapes (§3.15.13)
- [`textDocument/codeAction`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_codeAction) — `CodeActionContext.diagnostics` populated with diagnostics overlapping the requested range, enabling diagnostic-specific quick fixes (§3.15.22)
- [`textDocument/publishDiagnostics`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_publishDiagnostics) — params shape correct; `versionSupport: false` declared and honored (§3.17.1)

## Prerequisites

- Node.js 18+
- A language server binary accessible on `PATH` (e.g. `typescript-language-server`, `haskell-language-server-wrapper`, `rust-analyzer`)

## Tools

All tools require `start_lsp` to be called first.

### `start_lsp`

Start the language server with a project root. Call this once before using any other tools.

```json
{ "tool": "start_lsp", "arguments": { "root_dir": "/path/to/project" } }
```

### `restart_lsp_server`

Restart the language server without restarting the MCP server. Useful when the LSP process becomes unresponsive or after changing project configuration.

```json
{ "tool": "restart_lsp_server", "arguments": {} }
{ "tool": "restart_lsp_server", "arguments": { "root_dir": "/new/project/root" } }
```

### `open_document`

Open a file for tracking. Required before fetching diagnostics or performing position-based queries on that file.

```json
{ "tool": "open_document", "arguments": { "file_path": "/path/to/file.ts", "language_id": "typescript" } }
```

### `close_document`

Stop tracking a file. Frees language server resources for long-running sessions.

```json
{ "tool": "close_document", "arguments": { "file_path": "/path/to/file.ts" } }
```

### `get_diagnostics`

Get errors and warnings for open files. Omit `file_path` to get diagnostics across all open files — this is the recommended approach as it reflects cross-file dependencies and is always fresh.

```json
{ "tool": "get_diagnostics", "arguments": {} }
{ "tool": "get_diagnostics", "arguments": { "file_path": "/path/to/file.ts" } }
```

### `get_info_on_location`

Get hover information (type signatures, documentation) at a position. Line and column are 1-based.

```json
{
  "tool": "get_info_on_location",
  "arguments": { "file_path": "/path/to/file.ts", "language_id": "typescript", "line": 10, "column": 5 }
}
```

### `get_completions`

Get completion suggestions at a position.

```json
{
  "tool": "get_completions",
  "arguments": { "file_path": "/path/to/file.ts", "language_id": "typescript", "line": 10, "column": 12 }
}
```

### `get_code_actions`

Get available code actions (quick fixes, refactors) for a range.

```json
{
  "tool": "get_code_actions",
  "arguments": {
    "file_path": "/path/to/file.ts", "language_id": "typescript",
    "start_line": 5, "start_column": 1, "end_line": 5, "end_column": 20
  }
}
```

### `get_references`

Find all references to the symbol at a position across the workspace.

```json
{
  "tool": "get_references",
  "arguments": { "file_path": "/path/to/file.ts", "language_id": "typescript", "line": 10, "column": 8 }
}
```

### `set_log_level`

Control log verbosity at runtime. Default is `info`. Valid levels: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

```json
{ "tool": "set_log_level", "arguments": { "level": "debug" } }
```

## Resources

Resources provide the same LSP data via a RESTful URI scheme. Use tools for simple queries; use resources when you want subscriptions or a more structured access pattern.

| Scheme | Description |
|--------|-------------|
| `lsp-diagnostics://` | Diagnostics for all open files |
| `lsp-diagnostics:///path/to/file` | Diagnostics for a specific file (supports subscriptions) |
| `lsp-hover:///path/to/file?line=N&column=N&language_id=X` | Hover information at a position |
| `lsp-completions:///path/to/file?line=N&column=N&language_id=X` | Completions at a position |

Diagnostic resources support `resources/subscribe` — the server sends `notifications/resources/updated` when diagnostics change.

## Recommended Agent Workflow

```
1. start_lsp(root_dir="/your/project")
2. open_document(file_path=..., language_id=...)  # repeat for relevant files
3. get_diagnostics()                               # no file_path = whole project
4. get_info_on_location(...) / get_references(...) # as needed
5. close_document(...)                             # when done with a file
```

**Language IDs:**
- `.ts` → `typescript`, `.tsx` → `typescriptreact`
- `.js` → `javascript`, `.jsx` → `javascriptreact`
- `.hs` → `haskell`
- `.rs` → `rust`, `.py` → `python`, `.go` → `go`

## Extensions

Language-specific extensions add specialized tools, prompts, and resource handlers. They are loaded automatically when a matching `language_id` is passed at startup.

**Haskell extension** — provides a `haskell.typed-hole-use` prompt for typed-hole exploration.

### Writing an Extension

Create `src/extensions/<language-id>.ts` implementing any subset of:

```typescript
interface Extension {
  getToolHandlers?(): Record<string, ToolHandler>;
  getToolDefinitions?(): Tool[];
  getResourceHandlers?(): ResourceHandlerMap;
  getSubscriptionHandlers?(): SubscriptionHandlerMap;
  getUnsubscriptionHandlers?(): UnsubscriptionHandlerMap;
  getResourceTemplates?(): ResourceTemplate[];
  getPromptDefinitions?(): Prompt[];
  getPromptHandlers?(): Record<string, PromptHandler>;
}
```

All extension-provided features are namespaced by language ID (e.g. `haskell.typed-hole-use`).

## Development

```bash
git clone https://github.com/blackwell-systems/LSP-MCP.git
cd LSP-MCP
npm install
npm run build
```

### Testing

```bash
npm test              # all test suites
npm run test:typescript   # TypeScript LSP integration
npm run test:prompts      # prompt handlers
npm run test:diagnostics  # waitForDiagnostics unit tests
npm run test:logging      # logging module unit tests
npm run test:lsp-helpers  # LSP client helper unit tests
npm run test:extensions   # extension loader unit tests
npm run test:tools        # tool utilities unit tests
npm run test:resources    # resource utilities unit tests
```

Current coverage: ~76% statements, ~86% functions. The primary uncovered paths are subscription callbacks that require a live LSP session.

### Debugging

To inspect all MCP traffic:

```bash
claude --mcp-debug
```

Or change log verbosity at runtime:

```json
{ "tool": "set_log_level", "arguments": { "level": "debug" } }
```

## License

MIT
