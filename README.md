# lsp-mcp

[![Blackwell Systems](https://raw.githubusercontent.com/blackwell-systems/blackwell-docs-theme/main/badge-trademark.svg)](https://github.com/blackwell-systems)
[![CI](https://github.com/blackwell-systems/LSP-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/blackwell-systems/LSP-MCP/actions)
[![LSP 3.17](https://img.shields.io/badge/LSP-3.17-blue.svg)](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
[![Languages](https://img.shields.io/badge/languages-7_verified-green.svg)](#multi-language-support)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The most complete MCP server for language intelligence. CI-verified integration tests across **7 languages** (TypeScript, Python, Go, Rust, Java, C, PHP). Built directly against the [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — not just compatible with it.

Unlike typical MCP-LSP bridges, lsp-mcp maintains a **persistent language server session**, enabling agents to operate on a fully indexed workspace with real-time diagnostics and cross-file awareness. Designed for agents, not just protocol passthrough.

## Why lsp-mcp

| | lsp-mcp | typical alternatives |
|--|---------|---------------------|
| Languages (CI-verified) | **7** | 1–2 |
| LSP spec compliance | **3.17, built to spec** | ad hoc |
| Connection model | **persistent** | per-request |
| MCP resource subscriptions | **✓ real-time diagnostics** | ✗ |
| `get_references` (cross-file) | **✓** | rarely |
| Tools | **19** | 3–5 |
| Test coverage | **76% statements, 86% functions** | rarely tested |

## Quick Start

```json
{
  "mcpServers": {
    "lsp": {
      "type": "stdio",
      "command": "npx",
      "args": ["blackwell-systems/LSP-MCP", "<language-id>", "<path-to-lsp-binary>", "<lsp-args>"]
    }
  }
}
```

**TypeScript:**
```json
{ "args": ["blackwell-systems/LSP-MCP", "typescript", "typescript-language-server", "--stdio"] }
```

**Go:**
```json
{ "args": ["blackwell-systems/LSP-MCP", "go", "gopls"] }
```

**Rust:**
```json
{ "args": ["blackwell-systems/LSP-MCP", "rust", "rust-analyzer"] }
```

## Multi-Language Support

Every language below is integration-tested on every CI run — `start_lsp`, `open_document`, `get_diagnostics`, and `get_info_on_location` all verified against the real language server binary:

| Language | Server | Install |
|----------|--------|---------|
| TypeScript / JavaScript | `typescript-language-server` | `npm i -g typescript-language-server typescript` |
| Python | `pyright-langserver` | `npm i -g pyright` |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` |
| Java | `jdtls` | [eclipse.jdt.ls snapshots](https://download.eclipse.org/jdtls/snapshots/) |
| C / C++ | `clangd` | `apt install clangd` / `brew install llvm` |
| PHP | `intelephense` | `npm i -g intelephense` |

## Tools

All tools require `start_lsp` to be called first.

| Tool | Description |
|------|-------------|
| `start_lsp` | Start the language server with a project root |
| `restart_lsp_server` | Restart without restarting the MCP server |
| `open_document` | Open a file for tracking (required before position queries) |
| `close_document` | Stop tracking a file |
| `get_diagnostics` | Errors and warnings — omit `file_path` for whole project |
| `get_info_on_location` | Hover info (type signatures, docs) at a position |
| `get_completions` | Completion suggestions at a position |
| `get_code_actions` | Quick fixes and refactors for a range |
| `get_references` | All references to a symbol across the workspace |
| `go_to_definition` | Jump to the definition of a symbol |
| `go_to_type_definition` | Jump to the type definition of a symbol |
| `go_to_implementation` | Jump to all implementations of an interface or abstract method |
| `execute_command` | Execute a server-side command (e.g. from a code action) |
| `get_document_symbols` | All symbols in a file (functions, classes, variables) |
| `get_workspace_symbols` | Search symbols by name across the workspace |
| `get_signature_help` | Function signature and active parameter at a call site |
| `format_document` | Formatting edits for a file (returned for inspection, not applied) |
| `rename_symbol` | WorkspaceEdit for renaming a symbol across the workspace (returned for inspection, not applied) |
| `set_log_level` | Change log verbosity at runtime |

**Recommended agent workflow:**
```
start_lsp(root_dir="/your/project")
open_document(file_path=..., language_id=...)
get_diagnostics()                          # whole project, no file_path
get_info_on_location(...) / get_references(...)
close_document(...)
```

**Language IDs:** `typescript`, `typescriptreact`, `javascript`, `javascriptreact`, `python`, `go`, `rust`, `java`, `c`, `cpp`, `php`

## Resources

Diagnostic resources support real-time subscriptions — the server sends `notifications/resources/updated` when diagnostics change.

| Scheme | Description |
|--------|-------------|
| `lsp-diagnostics://` | All open files |
| `lsp-diagnostics:///path/to/file` | Specific file (subscribable) |
| `lsp-hover:///path/to/file?line=N&column=N&language_id=X` | Hover at position |
| `lsp-completions:///path/to/file?line=N&column=N&language_id=X` | Completions at position |

## LSP 3.17 Conformance

lsp-mcp is implemented directly against the [LSP 3.17 specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) and validated through integration testing against real language servers. Coverage includes:

- Full lifecycle (`initialize` → `initialized` → `shutdown`) with graceful SIGINT/SIGTERM handling
- Progress protocol — workspace-ready detection waits for all `$/progress` tokens to complete before sending references
- Server-initiated requests (`workspace/configuration`, `window/workDoneProgress/create`, dynamic registration) — all correctly responded to, unblocking servers that gate workspace loading on these responses
- Correct JSON-RPC framing, error code handling, and response shape normalization across hover, completion, code actions, and diagnostics

See [docs/lsp-conformance.md](./docs/lsp-conformance.md) for the full implementation breakdown with spec section references.

## Extensions

Language-specific extensions add tools, prompts, and resource handlers, loaded automatically by language ID at startup.

**Haskell extension** — provides a `haskell.typed-hole-use` prompt for typed-hole exploration.

To add an extension, create `src/extensions/<language-id>.ts` implementing any subset of `getToolHandlers`, `getToolDefinitions`, `getResourceHandlers`, `getSubscriptionHandlers`, `getPromptDefinitions`, and `getPromptHandlers`. All features are namespaced by language ID.

## Development

```bash
git clone https://github.com/blackwell-systems/LSP-MCP.git
cd LSP-MCP && npm install && npm run build
npm test                   # all unit test suites
npm run test:multi-lang    # 7-language integration test (requires language servers)
```

Coverage: ~76% statements, ~86% functions. To inspect MCP traffic: `claude --mcp-debug`.

## License

MIT
