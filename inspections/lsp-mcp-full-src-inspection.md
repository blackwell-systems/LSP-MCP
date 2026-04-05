# LSP MCP Improved — Full Source Inspection

**Inspector version:** 0.2.0
**Date:** 2026-04-05
**Repo root:** `/Users/dayna.blackwell/code/lsp-mcp-improved`
**Areas audited:** `src/` (all TypeScript source files) + `index.ts` (entry point)

---

## Summary

| Severity | Count |
|----------|-------|
| Error    | 11    |
| Warning  | 10    |
| **Total**| **21**|

| Check Type              | Count |
|-------------------------|-------|
| coverage_gap            | 4     |
| dead_symbol             | 3     |
| silent_failure          | 3     |
| scope_analysis          | 2     |
| doc_drift               | 2     |
| init_side_effects       | 1     |
| cross_field_consistency | 1     |
| error_wrapping          | 1     |
| duplicate_semantics     | 1     |
| panic_not_recovered     | 1     |
| test_coverage           | 1     |
| layer_violation         | 1     |
| interface_saturation    | 1     |

**Highest severity:** error

**Signal:** The server has a set of correctness defects concentrated around its MCP protocol surface — a missing registered tool (`restart_lsp_server`), an incorrect resource-update notification method name that silently breaks subscriptions, a dropped async Promise in the LSP message loop that can produce unhandled rejections, and an `exit`-handler that can never complete its async shutdown — all compounded by pervasive use of `any` types that prevent the TypeScript compiler from catching shape mismatches.

---

## Step 0 — Layer Map

No architectural docs (`DESIGN`, `STRUCTURE`, `CONTRIBUTING`) were found beyond `README.md`. Layer map inferred from imports:

```
index.ts  (entry point / MCP server wiring)
  → src/tools/index.ts       (MCP tool definitions and handlers)
  → src/resources/index.ts   (MCP resource handlers and subscriptions)
  → src/prompts/index.ts     (MCP prompt definitions and handlers)
  → src/extensions/index.ts  (extension loader)
  → src/logging/index.ts     (cross-cutting logging)
  → src/lspClient.ts         (LSP protocol client)
  → src/shared/waitForDiagnostics.ts (shared utility)
  → src/types/index.ts       (shared type definitions)
```

Dependency rules inferred:
- `src/lspClient.ts` must not import from `src/tools/`, `src/resources/`, `src/prompts/`
- `src/types/index.ts` must not import from any `src/*` module other than MCP SDK types
- `src/logging/index.ts` must not import from `src/lspClient.ts` (it is imported by everything)

---

## Findings

---

### index.ts

---

**coverage_gap** · error · confidence: high
`index.ts:356`
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: `process.on('exit', async () => { await lspClient.shutdown() })` — Node.js `exit` events fire synchronously; the event loop is already draining when this handler runs. Any code after the first `await` inside the handler is never executed. The `await lspClient.shutdown()` sends the LSP `shutdown` request and then waits for a response that will never arrive, because the process exits before the I/O can complete. The LSP server process is consequently orphaned (never receives `shutdown` or `exit`).
Fix: Use `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` for graceful async shutdown. The `exit` event should only contain synchronous cleanup.

---

**silent_failure** · error · confidence: high
`index.ts:394-404`
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: Inside `runServer()`, a `setTimeout(..., 100)` auto-initializes `lspClient` with `process.cwd()` as the root. When the user subsequently calls the `start_lsp` tool, `src/tools/index.ts:256` creates a *new* `LSPClient` and calls `setLspClient(newClient)` — but never calls `shutdown()` on the previously auto-created client. The old client's LSP server subprocess is abandoned with its I/O pipes still open and pending response promises that will time out. The failure is silent: the tool returns success.
Fix: The `start_lsp` handler should call `lspClient.shutdown()` (if initialized) before creating the new client.

---

**coverage_gap** · error · confidence: high
`index.ts:231-258` (UnsubscribeRequestSchema handler)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: `const { uri, context } = request.params` — the MCP SDK's `UnsubscribeRequestSchema` defines `params` as `{ uri: string }` only; there is no `context` field. The `context` destructure will always be `undefined`. The `getUnsubscriptionHandlers` functions expect this context to contain the `DiagnosticUpdateCallback` needed to unsubscribe. Passing `undefined` causes the unsubscription handler to throw `"Invalid subscription context for URI: ..."`, making resource unsubscription always fail.
Spec reference: MCP spec `resources/unsubscribe` — params shape is `{ uri: string }` only.
Fix: The subscription context must be tracked server-side (keyed by URI), not passed back through the MCP unsubscribe params.

---

**doc_drift** · error · confidence: high
`index.ts:293-303` (ListResourcesRequestSchema handler, line 300)
`index.ts:307-325` (ListPromptsRequestSchema handler, line 321)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: Error responses for `ListResources` and `ListPrompts` return `{ resources: [], isError: true, error: errorMessage }` / `{ prompts: [], isError: true, error: errorMessage }`. The MCP SDK schemas `ListResourcesResultSchema` and `ListPromptsResultSchema` do not have an `isError` field — that field exists only on `CallToolResultSchema`. Returning these extra fields on protocol-level errors violates the response contract; callers cannot rely on them. The correct approach for handler errors is to `throw`, which the SDK converts to a proper JSON-RPC error response.
Fix: Replace the try/catch return with `throw error` in these handlers.

---

### src/resources/index.ts

---

**coverage_gap** · error · confidence: high
`src/resources/index.ts:224` and `src/resources/index.ts:265`
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: Both subscription callbacks (for single-file and all-files) send `method: "notifications/resources/update"`. The correct MCP method name is `"notifications/resources/updated"` (with a trailing `d`). Additionally, the payload includes a `content` field which is not part of the `ResourceUpdatedNotification` schema — that schema only accepts `{ uri: string }`. As a result, subscribed clients never receive valid resource-change notifications; the wrong method is silently routed nowhere.
Spec reference: MCP spec `ResourceUpdatedNotification` — method is `notifications/resources/updated`, params is `{ uri: string }` only.
Fix: Change the method string to `"notifications/resources/updated"` and remove the `content` field from params. Clients that need fresh data will call `ReadResource` upon receiving the notification.

---

**silent_failure** · warning · confidence: high
`src/resources/index.ts:206` (subscription handler, `uri.slice(18)`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: The file path is extracted from the subscription URI by `uri.slice(18)` — a hardcoded byte offset assuming the scheme is exactly `lsp-diagnostics://` (18 chars). If the scheme ever changes length or if the URI has extra slashes (e.g. `lsp-diagnostics:///path`), the sliced result is wrong. This is inconsistent with every other URI handler in the file, which all use `new URL(uri)` and `parseUriPath()`.
Fix: Parse with `new URL(uri)` and use `parseUriPath()` consistently.

---

### src/lspClient.ts

---

**panic_not_recovered** · error · confidence: high
`src/lspClient.ts:132`
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: Inside the synchronous `handleData` data-event callback, `this.processMessageQueue()` is called without `await` and without `.catch()`. `processMessageQueue` is declared `async` — its returned Promise is silently dropped. Any uncaught exception thrown inside `processMessageQueue` or `handleMessage` becomes an unhandled Promise rejection. In Node.js 15+, unhandled rejections terminate the process. There is no `unhandledRejection` handler registered anywhere in the codebase.
Fix: Attach `.catch(err => logError(...))` to the `processMessageQueue()` call, or wrap the call site in a synchronous try/catch and enqueue for async processing.

---

**coverage_gap** · warning · confidence: high
`src/lspClient.ts:69-136` (`handleData`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: When the buffer overflows the 10 MB safety limit (line 75-80), the buffer is truncated by keeping the *last* `MAX_BUFFER_SIZE` bytes: `this.buffer = this.buffer.substring(this.buffer.length - MAX_BUFFER_SIZE)`. This discards leading bytes that may contain partially-received message headers, but the parser then resumes at the middle of a message body. The next `Content-Length` header match will be against stale/corrupt data, and the parsed JSON is likely to fail. The error path at line 133 logs and silently continues, dropping the message.
Fix: On overflow, discard the entire buffer (set to `""`) and log a warning, rather than keeping the tail which is guaranteed to start mid-message.

---

**coverage_gap** · warning · confidence: high
`src/lspClient.ts:400-482` (`initialize`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: The `initialize` request at line 411 sends `rootPath: resolvedRootDir` (line 418). Per LSP 3.17 spec §3.15.1, `rootPath` is deprecated and should not be sent by new clients; it is superseded by `rootUri` and `workspaceFolders`. Some language servers may still read it, but including it can cause confusion when it contradicts `rootUri`.
Spec reference: LSP 3.17 §3.15.1 `InitializeParams` — `rootPath?: string | null` is marked deprecated.
Fix: Remove `rootPath` from the `initialize` params.

---

**scope_analysis** · warning · confidence: high
`src/lspClient.ts:155-277` (`handleMessage`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: `handleMessage` handles five distinct responsibilities: (1) logging incoming messages, (2) resolving pending response promises, (3) capturing server capabilities, (4) processing `textDocument/publishDiagnostics` notifications, (5) handling workspace progress `$/progress`, and (6) dispatching server-initiated requests (`window/workDoneProgress/create`, `workspace/configuration`, `client/registerCapability`). That is six independent concerns in one 123-line async method. Peer methods (`sendRequest`, `sendNotification`) each have a single responsibility. The nesting depth reaches 4 levels in the diagnostic and progress handlers.
Fix: Extract `handleServerResponse`, `handleNotification`, and `handleServerRequest` as private methods.

---

### src/tools/index.ts

---

**dead_symbol** · error · confidence: reduced
`src/tools/index.ts:20` (import of `deactivateExtension`, `listActiveExtensions`)
[LSP unavailable — Grep fallback, reduced confidence]
What: `deactivateExtension` and `listActiveExtensions` are imported from `src/extensions/index.ts` at line 20 but are never called anywhere in `src/tools/index.ts` or any other file. Neither is registered as a tool handler or used in any logic path. These are dead imports.
Fix: Remove the unused imports. If `deactivateExtension` is intended for a future tool, add a comment explaining this.

---

**coverage_gap** · error · confidence: high
`src/tools/index.ts:322-370` (tool definitions) and `README.md:78`
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: `restart_lsp_server` is documented in `README.md` (line 78, 333-357), referenced in `test/typescript-lsp.test.js` (lines 278, 516), and described in the in-server LSP guide prompt (`src/prompts/index.ts:59`), but it is completely absent from both `getToolHandlers()` and `getToolDefinitions()` in `src/tools/index.ts`. The `LSPClient.restart()` method exists in `src/lspClient.ts:921` but is never called. The test that exercises this tool will fail with "Unknown tool: restart_lsp_server".
Fix: Add a `restart_lsp_server` entry to `getToolHandlers()` and `getToolDefinitions()` that calls `lspClient.restart(optionalRootDir)` and calls `setLspClient` with the existing client instance (since restart mutates in place).

---

**scope_analysis** · warning · confidence: high
`src/tools/index.ts:36-319` (`getToolHandlers`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: `getToolHandlers` is a 284-line factory function that inline-defines all 8 tool handlers. Each handler independently performs the same file-read → URI-construction → openDocument → LSP-request → format pattern. This pattern is repeated 5 times (get_info_on_location, get_completions, get_code_actions, get_references, and the resource handlers in `src/resources/index.ts`). The function has no natural split points that would make it smaller, but each handler is a self-contained closure that could be a named top-level function. Compared to peer modules (`src/resources/index.ts`, `src/extensions/index.ts`) that also use factory-function patterns but at similar scale, this is an outlier in raw size.
Fix: Extract each handler as a named function (e.g. `handleGetInfoOnLocation`) and register them in the factory return object.

---

### src/extensions/index.ts

---

**cross_field_consistency** · error · confidence: high
`src/extensions/index.ts:47-56` (`importExtension`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: The existence check uses `path.resolve(process.cwd(), 'dist', 'src', 'extensions', safeLanguageId + '.js')` (line 47), which resolves to `<cwd>/dist/src/extensions/<lang>.js`. The dynamic `import()` at line 56 uses `./${safeLanguageId}.js` — a relative path resolved from the **compiled** module's location, which is `<repo>/dist/src/extensions/`. These two paths agree only when `cwd` equals the repo root. If the server is launched from a different directory, the `fs.access` check succeeds on the wrong path and the `import()` fails on the real path (or vice versa). This produces a confusing error: the `fs.access` check passes (so no "not found" log), but the `import()` throws.
Fix: Use `import.meta.url` to build an absolute path for both the existence check and the import, so they are always consistent regardless of `cwd`.

---

**dead_symbol** · warning · confidence: reduced
`src/extensions/index.ts:93` (`deactivateExtension`)
`src/extensions/index.ts:114` (`listActiveExtensions`)
[LSP unavailable — Grep fallback, reduced confidence]
What: Both exported functions are imported in `src/tools/index.ts:20` but never called. No other file references them. They are not registered as tool handlers.
Fix: Either register them as tools (enabling runtime extension management) or remove them if the extension lifecycle is entirely startup-time.

---

### src/logging/index.ts

---

**init_side_effects** · error · confidence: high
`src/logging/index.ts:4-6` and `src/logging/index.ts:160-193`
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: At module load time (not inside any function), lines 4-6 capture the original `console.log/warn/error` methods, and lines 160-193 **replace** `console.log`, `console.warn`, and `console.error` with new functions. These are observable global mutations that fire the instant the module is imported. Any test or other module that imports `src/logging/index.ts` — directly or transitively — will find `console.log` overridden. This makes test isolation impossible: the override applies globally and is not reversible without direct access to the logging module's internals.
Fix: Move the console overrides into an explicit `initLogging()` function that is called once from `index.ts` during startup, rather than executing at import time.

---

**duplicate_semantics** · warning · confidence: high
`src/logging/index.ts:139` (`logError`) vs. the `error` function concept
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: The module exports `log("error", ...)` and also a helper named `logError` (line 139) which calls `log("error", ...)`. All other severity levels export a function named after the level: `debug`, `info`, `notice`, `warning`, `critical`, `alert`, `emergency`. Only `error` is given a different name (`logError`). Callers must choose between calling `log("error", ...)` directly and calling `logError(...)`. The inconsistency is a naming anomaly rather than a semantic distinction. Additionally, the `log` function itself is exported (line 63), giving callers a third path to emit any level.
Fix: Rename `logError` to `error` (consistent with the other per-level helpers), and unexport `log` if callers should always use the named helpers.

---

### src/prompts/index.ts

---

**dead_symbol** · warning · confidence: reduced
`src/prompts/index.ts:8` (`PromptName.LANGUAGE_HELP`)
[LSP unavailable — Grep fallback, reduced confidence]
What: The enum `PromptName` defines `LANGUAGE_HELP = "language_help"` at line 8, but this value is never used: `getPromptDefinitions()` only registers `LSP_GUIDE`, and `getPromptHandlers()` only provides a handler for `LSP_GUIDE`. `LANGUAGE_HELP` is never referenced outside its own enum declaration.
Fix: Remove `LANGUAGE_HELP` from the enum, or implement the prompt definition and handler it was presumably intended to support.

---

**doc_drift** · warning · confidence: high
`src/prompts/index.ts:66-70` (LSP guide prompt, workflow example)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: The `lsp_guide` prompt text (line 66) lists `restart_lsp_server` as an available tool: `"- **restart_lsp_server**: Restart the LSP server process if needed"`. This tool does not exist in the server's tool registry (see the `coverage_gap` finding above). A caller following this prompt's guidance will receive "Unknown tool: restart_lsp_server" when they attempt to use it.
Fix: Either implement the `restart_lsp_server` tool (recommended) or remove it from the prompt guide text.

---

### src/types/index.ts

---

**error_wrapping** · warning · confidence: high
`src/types/index.ts:32` (`ToolHandler`), `src/types/index.ts:35` (`ResourceHandler`), `src/types/index.ts:38` (`SubscriptionHandler`), `src/types/index.ts:41` (`UnsubscriptionHandler`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: All handler types use `any` for both input arguments and internal LSP data (`args: any`, `diagnostics: any[]`, `context: any`). This is pervasive — every tool handler in `src/tools/index.ts` is typed as `(args: any) => Promise<...>`, and the `LSPMessage` type in `src/types/index.ts:7-14` uses `params?: any`, `result?: any`, `error?: any`. The TypeScript strict mode (`"strict": true` in `tsconfig.json`) is undermined for all MCP/LSP boundary types. Mismatched field names (e.g. the `notifications/resources/update` vs `notifications/resources/updated` bug) are invisible to the compiler because the notification params are typed `any`.
Fix: Define typed interfaces for LSP message subtypes (responses, notifications, requests) and MCP response shapes. Use the MCP SDK's Zod schemas or derive types from them.

---

### src/shared/waitForDiagnostics.ts

---

**test_coverage** · warning · confidence: reduced
`src/shared/waitForDiagnostics.ts` (exported `waitForDiagnostics` function)
[LSP unavailable — Grep fallback, reduced confidence]
What: `waitForDiagnostics` is a non-trivial exported function with complex timing logic (initial-snapshot exclusion, stabilisation timer, hard timeout). It is not tested in isolation in any test file. The integration tests in `test/typescript-lsp.test.js` exercise the `get_diagnostics` tool (which calls `waitForDiagnostics` internally), but do not verify the stabilisation behaviour, the snapshot-exclusion behaviour, or the hard-timeout path. Edge cases (empty `targetUris`, a URI that never gets a fresh update, early resolution when all files already have cached diagnostics) are not covered.
Fix: Add unit tests for `waitForDiagnostics` with a mock `LSPClient` that exposes the subscriber callback for programmatic control.

---

### Cross-cutting — LSP 3.17 Spec Compliance

---

**coverage_gap** · warning · confidence: high
`src/lspClient.ts:715-716` (`getCodeActions`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: The `textDocument/codeAction` request always sends `context: { diagnostics: [] }` — an empty diagnostics array. Per LSP 3.17 §3.16.8, the `CodeActionContext.diagnostics` field should contain the diagnostics currently active at the requested range, so that the server can offer diagnostic-specific code actions (e.g. "Quick fix for error TS2345"). Passing an empty array means the server cannot provide quick-fixes tied to visible diagnostics. The client has the relevant diagnostics cached in `this.documentDiagnostics`.
Spec reference: LSP 3.17 §3.16.8 `CodeActionContext.diagnostics: Diagnostic[]` — "An array of diagnostics known on the client side overlapping the range."
Fix: Filter `this.documentDiagnostics.get(uri)` for diagnostics whose range overlaps the requested range, and pass them in the context.

---

**layer_violation** · warning · confidence: high
`src/lspClient.ts:767` (dynamic `import("fs/promises")` inside `reopenDocument`)
[LSP unavailable — Grep fallback, reduced confidence; finding is from code reading, high confidence]
What: `fs/promises` is already statically imported at the top of multiple files in the codebase (e.g. `src/resources/index.ts:1`, `src/tools/index.ts:1`). Inside `LSPClient.reopenDocument` (line 767), `fs` is imported dynamically with `const fs = await import("fs/promises")` at every call. This is a performance issue (Node.js caches modules, but the dynamic import still adds overhead), an anti-pattern inconsistent with static imports used everywhere else, and it complicates testing. This is a soft layer violation — the LSP client is performing file I/O that is conceptually the caller's responsibility (the caller already has the file path, and the tools layer does file reading before calling `openDocument`).
Fix: Add a static `import * as fs from "fs/promises"` at the top of `lspClient.ts` and remove the dynamic import.

---

## All Findings

| Severity | Confidence | Check Type              | Finding Summary                                                      | Location |
|----------|------------|-------------------------|----------------------------------------------------------------------|----------|
| error    | high       | coverage_gap            | `process.on('exit', async)` — await never completes; LSP orphaned   | `index.ts:356` |
| error    | high       | silent_failure          | `start_lsp` leaks old LSPClient subprocess without shutdown          | `index.ts:394-404` / `src/tools/index.ts:256` |
| error    | high       | coverage_gap            | `UnsubscribeRequest.params.context` does not exist in MCP schema; unsubscription always fails | `index.ts:233` |
| error    | high       | doc_drift               | `isError` field on ListResources/ListPrompts error responses is not in SDK schema; callers cannot rely on it | `index.ts:300,321` |
| error    | high       | coverage_gap            | `notifications/resources/update` is wrong MCP method name and payload shape; subscriptions never deliver updates | `src/resources/index.ts:224,265` |
| error    | high       | panic_not_recovered     | `processMessageQueue()` Promise dropped without `.catch()`; unhandled rejection can crash process | `src/lspClient.ts:132` |
| error    | high       | cross_field_consistency | Extension existence check path (`process.cwd()/dist/...`) differs from dynamic import path; silently fails when cwd != repo root | `src/extensions/index.ts:47-56` |
| error    | high       | coverage_gap            | `restart_lsp_server` tool is absent from registry but documented, guide-text-referenced, and test-expected | `src/tools/index.ts:322-370` |
| error    | high       | init_side_effects       | Console methods overridden at module import time; breaks test isolation | `src/logging/index.ts:160-193` |
| error    | reduced    | dead_symbol             | `deactivateExtension`, `listActiveExtensions` imported in tools but never called | `src/tools/index.ts:20` |
| error    | high       | doc_drift               | LSP guide prompt lists `restart_lsp_server` which does not exist as a tool | `src/prompts/index.ts:66` |
| warning  | high       | silent_failure          | Subscription URI file-path extraction uses `slice(18)` instead of `URL` parse; silently produces wrong path | `src/resources/index.ts:206` |
| warning  | high       | coverage_gap            | `handleData` buffer overflow truncates keeping tail bytes, guaranteeing mid-message parse failures | `src/lspClient.ts:75-80` |
| warning  | high       | coverage_gap            | `initialize` sends deprecated `rootPath` field per LSP 3.17 §3.15.1 | `src/lspClient.ts:418` |
| warning  | high       | scope_analysis          | `handleMessage` has 6 distinct responsibilities across 123 lines      | `src/lspClient.ts:155-277` |
| warning  | high       | scope_analysis          | `getToolHandlers` is 284 lines of inline handler closures            | `src/tools/index.ts:36-319` |
| warning  | reduced    | dead_symbol             | `deactivateExtension`, `listActiveExtensions` exported but unreferenced outside import | `src/extensions/index.ts:93,114` |
| warning  | reduced    | dead_symbol             | `PromptName.LANGUAGE_HELP` defined in enum but never registered or handled | `src/prompts/index.ts:8` |
| warning  | high       | duplicate_semantics     | `logError` is same as `error` helper; naming inconsistent with all other level helpers | `src/logging/index.ts:139` |
| warning  | high       | error_wrapping          | Pervasive `any` typing on all handler, message, and LSP boundary types prevents compiler from catching shape errors | `src/types/index.ts:32-41` |
| warning  | reduced    | test_coverage           | `waitForDiagnostics` has no unit tests for its timing logic, snapshot exclusion, or timeout paths | `src/shared/waitForDiagnostics.ts` |
| warning  | high       | coverage_gap            | `getCodeActions` sends empty `diagnostics: []`, preventing diagnostic-specific quick-fixes per LSP 3.17 §3.16.8 | `src/lspClient.ts:715-716` |
| warning  | high       | layer_violation         | Dynamic `import("fs/promises")` inside `reopenDocument` on every call; static import used elsewhere | `src/lspClient.ts:767` |

---

## Not Checked — Out of Scope

- `app/Server.hs` (Haskell demo server) — outside the `src/` TypeScript audit area
- `test/` files (other than noting which source symbols they test/expose) — test code quality not audited
- `Dockerfile`, `docker-compose.yml` — infrastructure files, not in scope
- `interface_saturation` — no interfaces with 6+ methods were found; the `Extension` interface in `src/extensions/index.ts` has 8 optional methods, but all callers use the full interface and every method is independently optional, so no saturation finding applies
- `context_propagation` — not applicable; this codebase does not use Node.js `AsyncLocalStorage`, Go-style context, or CancellationToken patterns

---

## Not Checked — Tooling Constraints

- **LSP `findReferences` returned empty results for all queries.** This is consistent with the known lsp-mcp server-initialization issue (the mcp__lsp-mcp server must respond to gopls server-initiated requests before the workspace loads, but the workspace loading may not complete during this audit session). All `dead_symbol` findings are marked `confidence: reduced` and are based on Grep fallback. The tool attempted `get_references` on `markServerInitialized` (logging/index.ts:55), `isLogging` (logging/index.ts:60), and `logError` (logging/index.ts:139) — all returned `[]`.
- **LSP `hover` returned no output** for the one query attempted (`logging/index.ts:55`). All `doc_drift` signature comparisons were performed by direct source reading rather than hover confirmation.
- **No `CLAUDE.md`, `DESIGN`, `STRUCTURE`, or `CONTRIBUTING` docs found** in the repo. Layer map was inferred from import graphs.
