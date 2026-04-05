# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `restart_lsp_server` tool - restart the LSP server process without restarting the MCP server
- Unit test suite for `waitForDiagnostics` function with coverage for timing, snapshot exclusion, and timeout behaviors
- Unit tests for core modules: logging, LSP client helpers, extensions, tools utilities, resource utilities (50 new tests across 5 files)
- Code coverage reporting via `c8` (76% statement coverage, 86% function coverage)
- `initLogging()` function for explicit console override initialization (improves test isolation)
- Type-safe interfaces for LSP diagnostics (`LSPDiagnostic`)
- Diagnostic filtering for `getCodeActions` - now passes overlapping diagnostics per LSP 3.17 spec §3.16.8
- Client capability declarations for `references`, `definition`, `implementation`, `typeDefinition` per LSP 3.17 §3.15.2
- Server capability checks before sending `hover`, `completion`, `codeAction`, `references` requests per LSP 3.17 §3.15.3
- `$/progress` "report" kind handling for intermediate progress notifications per LSP 3.17 §3.18
- Progress token pre-registration when handling `window/workDoneProgress/create` per LSP 3.17 §3.18

### Changed
- **BREAKING:** Renamed `logError` to `error` for consistency with other log level helpers (debug, info, warning, etc.)
- Refactored tool handlers from inline closures to named top-level functions for better readability
- Improved LSP message type safety: replaced `any` with `Record<string, unknown>` and `unknown` for boundary types
- Extracted `handleMessage` responsibilities into separate helper methods (`handleServerResponse`, `handleNotification`, `handleServerRequest`)
- Replaced dynamic `fs/promises` import with static import in `lspClient.ts`
- Extension path resolution now uses `import.meta.url` instead of `process.cwd()` for consistency
- Buffer overflow handling now discards entire buffer instead of keeping potentially corrupt tail bytes
- Hover response parsing now correctly checks `MarkupContent.kind` (`"markdown"` | `"plaintext"`) before falling back to deprecated `MarkedString` forms per LSP 3.17 §3.15.11
- LSP error code `-32601` (MethodNotFound) and `-32002` (ServerNotInitialized) now logged as warnings; other error codes logged at debug level per LSP 3.17 §3.6

### Fixed
- **Critical:** MCP resource subscription notifications now use correct method name `notifications/resources/updated` (was `notifications/resources/update`)
- **Critical:** Unsubscribe requests now work correctly - subscription contexts tracked server-side instead of expecting non-existent `context` param
- **Critical:** Async exit handler replaced with proper SIGINT/SIGTERM handlers to prevent orphaned LSP processes
- Dropped Promise in LSP message queue processing now has `.catch()` handler to prevent unhandled rejections
- `start_lsp` tool no longer leaks LSP client processes - old client is shut down before creating new one
- Console override side effects moved from module import time to explicit `initLogging()` call
- ListResources and ListPrompts error handlers now throw errors instead of returning invalid `isError` field
- URI parsing in subscription handlers now uses proper URL parsing instead of hardcoded `slice(18)` offset
- Tool handlers now use getter pattern `() => lspClient` to prevent stale client references after `setLspClient()` calls
- Type guards added for LSP message fields (`result`, `params`, `value`) to handle `unknown` types correctly

### Removed
- Deprecated `rootPath` field from LSP initialize request (superseded by `rootUri` per LSP 3.17 §3.15.1)
- Dead symbol `PromptName.LANGUAGE_HELP` from prompts enum
- Unused imports `deactivateExtension` and `listActiveExtensions` from tools module

## [0.3.0] - 2024-04-05

### Added
- Initial LSP MCP server implementation
- Support for get_references tool (textDocument/references)
- Integration tests with TypeScript LSP
- CI/CD pipeline via GitHub Actions
- Server-initiated LSP request handling (window/workDoneProgress/create, workspace/configuration, client/registerCapability)

[Unreleased]: https://github.com/blackwell-systems/lsp-mcp-improved/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/blackwell-systems/lsp-mcp-improved/releases/tag/v0.3.0
