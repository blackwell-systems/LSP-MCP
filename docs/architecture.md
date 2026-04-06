# Architecture

lsp-mcp is a [Model Context Protocol](https://modelcontextprotocol.io/) server that wraps a Language Server Protocol subprocess. This document describes the layer structure, key patterns, and internal design decisions.

---

## Layer Structure

```
index.ts                          ← MCP server entry point
├── src/tools/index.ts            ← Tool handler registry (24 tools)
├── src/resources/index.ts        ← Resource + subscription handlers
├── src/prompts/index.ts          ← Prompt definitions
└── src/extensions/<lang>.ts      ← Language-specific extensions

src/lspClient.ts                  ← LSP subprocess wrapper
src/shared/
├── utils.ts                      ← Shared utilities (uriToFilePath, createFileUri, checkLspClientInitialized)
└── waitForDiagnostics.ts         ← Diagnostic stabilisation helper
src/types/index.ts                ← Zod schemas + TypeScript types
src/logging/index.ts              ← MCP logging bridge
```

### Layer rules

- `index.ts` owns the MCP server lifecycle and routes requests to handlers
- `src/tools/` and `src/resources/` both import from `src/shared/` — they do not import from each other
- `src/lspClient.ts` has no upward dependencies — it only imports from `src/shared/` and `src/types/`
- `src/extensions/` imports from `src/tools/` for re-exported utilities

---

## The `withDocument` Pattern

Most tool handlers need to open a file before querying the language server. The `withDocument` helper encapsulates this:

```typescript
// src/tools/index.ts
async function withDocument<T>(
  getLspClient: () => LSPClient | null,
  filePath: string,
  languageId: string,
  callback: (lspClient: LSPClient, fileUri: string) => Promise<T>,
): Promise<T> {
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(filePath, "utf-8");
  const fileUri = createFileUri(filePath);
  await lspClient!.openDocument(fileUri, fileContent, languageId);
  return callback(lspClient!, fileUri);
}
```

Used by 16 of the 24 tool handlers:

```typescript
async function handleGoToDefinition(getLspClient, args) {
  return withDocument(getLspClient, args.file_path, args.language_id, async (lspClient, fileUri) => {
    const locations = await lspClient.getDefinition(fileUri, {
      line: args.line - 1,       // tools use 1-based; LSP uses 0-based
      character: args.column - 1,
    });
    return { content: [{ type: "text", text: JSON.stringify(locations) }] };
  });
}
```

Handlers that do not follow this pattern (e.g. `open_document`, `get_diagnostics`, `get_workspace_symbols`) manage the LSP client directly — they either don't require a file path or have different lifecycle semantics.

---

## URI Handling

LSP uses `file://` URIs throughout. Two utilities handle the conversion:

```typescript
// path → URI  (for sending to the LSP server)
createFileUri("/path/to/file.ts")  // → "file:///path/to/file.ts"

// URI → path  (for reading results from the LSP server)
uriToFilePath("file:///path/to/file.ts")  // → "/path/to/file.ts"
```

`uriToFilePath` uses `new URL(uri).pathname` rather than string slicing, which correctly handles percent-encoded characters and is robust to non-standard URI forms.

**Position coordinates:** Tool inputs are 1-based (line 1, column 1 = first character). LSP is 0-based internally. The conversion `args.line - 1` / `args.column - 1` happens inside each handler. Schema validation rejects `line: 0` and `column: 0` with a clear error.

---

## LSP Client Lifecycle

```
start_lsp (tool call)
    ↓
LSPClient.initialize(rootDir)
    ↓
spawn(lspServerPath)
    ↓
sendRequest("initialize", capabilities)
    ↓  ← server may send window/workDoneProgress/create, workspace/configuration here
    ↓  ← these server-initiated requests are handled in handleServerRequest()
receive initialize response
    ↓
this.initialized = true
sendNotification("initialized", {})
    ↓
tool calls now available
```

`initialized` is set to `true` before `initialized` is sent (not after) to prevent a race where the server's first request arrives in the window between sending `initialized` and setting the flag.

When the LSP subprocess crashes, the `close` event handler:
1. Sets `initialized = false`
2. Rejects all pending `responsePromises` immediately (callers fail fast instead of waiting for timeouts)
3. Logs the last 4KB of stderr for diagnosis

---

## Resource Subscription System

Resources expose LSP data over MCP's subscribe/unsubscribe mechanism. When a client subscribes to a diagnostic resource, the server sends `notifications/resources/updated` each time diagnostics change for that file.

```
client → resources/subscribe { uri: "lsp-diagnostics:///path/to/file.ts" }
                                              ↓
                              lspClient.subscribeToDiagnostics(callback)
                                              ↓
                              callback stored in subscription context Map
                                              ↓
          later: LSP server sends textDocument/publishDiagnostics
                                              ↓
                              callback fires → server.notification("notifications/resources/updated")
                                              ↓
client ← notifications/resources/updated { uri: "lsp-diagnostics:///path/to/file.ts" }
                                              ↓
client → resources/read { uri: "lsp-diagnostics:///path/to/file.ts" }
                                              ↓
client ← current diagnostics JSON
```

The subscription callback is stored in a `Map<uri, SubscriptionContext>` server-side so it can be correctly removed on unsubscribe.

---

## waitForDiagnostics

`waitForDiagnostics(lspClient, targetUris, timeoutMs?)` is used by `get_diagnostics` to wait for the language server to finish publishing diagnostics after a document is opened. It resolves when:

1. All target URIs have received at least one diagnostic notification *after* the initial snapshot (the first notification is excluded — it's the server's pre-existing state)
2. No further diagnostic notifications arrive for 500ms (the "stabilisation" window)
3. OR the optional `timeoutMs` is exceeded

An empty `targetUris` array resolves immediately.

---

## Extension System

Language-specific extensions are loaded at startup by `activateExtension(languageId)`. An extension is a TypeScript module at `src/extensions/<language-id>.ts` that can export any combination of:

```typescript
export function getToolHandlers(): Record<string, ToolHandler>
export function getToolDefinitions(): Tool[]
export function getResourceHandlers(): Record<string, ResourceHandler>
export function getSubscriptionHandlers(): Record<string, SubscriptionHandler>
export function getUnsubscriptionHandlers(): Record<string, UnsubscriptionHandler>
export function getPromptDefinitions(): Prompt[]
export function getPromptHandlers(): Record<string, PromptHandler>
```

All features are namespaced by language ID automatically. Extensions take precedence over core handlers in case of name conflicts.
