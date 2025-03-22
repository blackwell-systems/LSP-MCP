# LSP MCP Server

An MCP (Model Context Protocol) server for interacting with  LSP (Language Server Protocol) interface.
This server acts as a bridge that allows LLMs to query an LSP Hover and Completion providers.

## Overview

The  MCP Server works by:
1. Starting an LSP client that connects to a LSP server
2. Exposing MCP tools that send requests to the LSP server
3. Returning the results in a format that LLMs can understand and use

This enables LLMs to utilize LSPs for more accurate code suggestions.


## Features

- `get_info_on_location`: Get hover information at a specific location in a file
- `get_completions`: Get completion suggestions at a specific location in a file
- `get_code_actions`: Get code actions for a specific range in a file
- `open_document`: Open a file in the LSP server for analysis
- `close_document`: Close a file in the LSP server
- `get_diagnostics`: Get diagnostic messages (errors, warnings) for open files
- `start_lsp`: Start the LSP server with a specified root directory
- `restart_lsp_server`: Restart the LSP server without restarting the MCP server
- Real-time diagnostic updates via MCP resource subscriptions
- Detailed logging for debugging and auditing
- Simple command-line interface

## Prerequisites

- Node.js (v16 or later)
- npm

For the demo server:
- GHC (8.10 or later)
- Cabal (3.0 or later)

## Installation

### Building the MCP Server

1. Clone this repository:
   ```
   git clone https://github.com/your-username/lsp-mcp.git
   cd lsp-mcp
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Build the MCP server:
   ```
   npm run build
   ```

## Usage

Run the MCP server by providing the path to the LSP executable and any arguments to pass to the LSP server:

```
npx tritlo/lsp-mcp /path/to/lsp [lsp-args...]
```

For example:
```
npx tritlo/lsp-mcp /usr/bin/haskell-language-server-wrapper lsp
```

### Important: Starting the LSP Server

With version 0.2.0 and later, you must explicitly start the LSP server by calling the `start_lsp` tool before using any LSP functionality. This ensures proper initialization with the correct root directory, which is especially important when using tools like npx:

```json
{
  "tool": "start_lsp",
  "arguments": {
    "root_dir": "/path/to/your/project"
  }
}
```

### Logging

You can enable logging to a file by setting the `LSP_MCP_LOG` environment variable before starting the server:

```
export LSP_MCP_LOG=/path/to/lsp-mcp.log
npx tritlo/lsp-mcp /path/to/lsp-server [lsp-server-args...]
```

This will create a detailed log file with timestamps that captures:
- All console output
- LSP protocol messages
- MCP tool requests and responses
- Errors and exceptions

## API

The server provides the following MCP tools:

### get_info_on_location

Gets hover information at a specific location in a file.

Parameters:
- `file_path`: Path to the file
- `language_id`: The programming language the file is written in (e.g., "haskell")
- `line`: Line number (0-based)
- `character`: Character position (0-based)

Example:
```json
{
  "tool": "get_info_on_location",
  "arguments": {
    "file_path": "/path/to/your/file",
    "language_id": "haskell",
    "line": 3,
    "character": 5
  }
}
```

### get_completions

Gets completion suggestions at a specific location in a file.

Parameters:
- `file_path`: Path to the file
- `language_id`: The programming language the file is written in (e.g., "haskell")
- `line`: Line number (0-based)
- `character`: Character position (0-based)

Example:
```json
{
  "tool": "get_completions",
  "arguments": {
    "file_path": "/path/to/your/file",
    "language_id": "haskell",
    "line": 3,
    "character": 10
  }
}
```

### get_code_actions

Gets code actions for a specific range in a file.

Parameters:
- `file_path`: Path to the file
- `language_id`: The programming language the file is written in (e.g., "haskell")
- `start_line`: Start line number (0-based)
- `start_character`: Start character position (0-based)
- `end_line`: End line number (0-based)
- `end_character`: End character position (0-based)

Example:
```json
{
  "tool": "get_code_actions",
  "arguments": {
    "file_path": "/path/to/your/file",
    "language_id": "haskell",
    "start_line": 3,
    "start_character": 5,
    "end_line": 3,
    "end_character": 10
  }
}
```

### start_lsp

Starts the LSP server with a specified root directory. This must be called before using any other LSP-related tools.

Parameters:
- `root_dir`: The root directory for the LSP server (absolute path recommended)

Example:
```json
{
  "tool": "start_lsp",
  "arguments": {
    "root_dir": "/path/to/your/project"
  }
}
```

### restart_lsp_server

Restarts the LSP server process without restarting the MCP server. This is useful for recovering from LSP server issues or for applying changes to the LSP server configuration.

Parameters:
- `root_dir`: (Optional) The root directory for the LSP server. If provided, the server will be initialized with this directory after restart.

Example without root_dir (uses previously set root directory):
```json
{
  "tool": "restart_lsp_server",
  "arguments": {}
}
```

Example with root_dir:
```json
{
  "tool": "restart_lsp_server",
  "arguments": {
    "root_dir": "/path/to/your/project"
  }
}
```

### open_document

Opens a file in the LSP server for analysis. This must be called before accessing diagnostics or performing other operations on the file.

Parameters:
- `file_path`: Path to the file to open
- `language_id`: The programming language the file is written in (e.g., "haskell")

Example:
```json
{
  "tool": "open_document",
  "arguments": {
    "file_path": "/path/to/your/file",
    "language_id": "haskell"
  }
}
```

### close_document

Closes a file in the LSP server when you're done working with it. This helps manage resources and cleanup.

Parameters:
- `file_path`: Path to the file to close

Example:
```json
{
  "tool": "close_document",
  "arguments": {
    "file_path": "/path/to/your/file"
  }
}
```

### get_diagnostics

Gets diagnostic messages (errors, warnings) for one or all open files.

Parameters:
- `file_path`: (Optional) Path to the file to get diagnostics for. If not provided, returns diagnostics for all open files.

Example for a specific file:
```json
{
  "tool": "get_diagnostics",
  "arguments": {
    "file_path": "/path/to/your/file"
  }
}
```

Example for all open files:
```json
{
  "tool": "get_diagnostics",
  "arguments": {}
}
```

## MCP Resources

In addition to tools, the server also provides resources for accessing diagnostics with real-time updates:

### Diagnostic Resources

The server exposes diagnostic information via the `lsp-diagnostics://` resource scheme. These resources can be subscribed to for real-time updates when diagnostics change.

Resource URIs:
- `lsp-diagnostics://` - Diagnostics for all open files
- `lsp-diagnostics:///path/to/file` - Diagnostics for a specific file

Important: Files must be opened using the `open_document` tool before diagnostics can be accessed.

### Listing Available Resources

To discover available diagnostic resources, use the MCP `resources/list` endpoint. The response will include all available diagnostics resources for currently open files.

### Subscribing to Diagnostic Updates

To receive real-time updates when diagnostics change (e.g., when files are modified and new errors or warnings appear), subscribe to the diagnostic resources using the MCP `resources/subscribe` endpoint.

### Working with Resources vs. Tools

You can choose between two approaches for accessing diagnostics:

1. Tool-based approach: Use the `get_diagnostics` tool for a simple, direct way to fetch diagnostics.
2. Resource-based approach: Use the `lsp-diagnostics://` resources for a more RESTful approach that supports real-time updates through subscriptions.

Both approaches provide the same data in the same format and enforce the same requirement that files must be opened first.

## Configuration:

```json
{
  "mcpServers": {
    "lsp-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "tritlo/lsp-mcp",
        "<path-to-lsp>",
        "<lsp-args>"
      ]
    }
  }
}
```

## Troubleshooting

- If the server fails to start, make sure the path to the LSP executable is correct
- Check the log file (if configured) for detailed error messages

## License

MIT License



## Acknowledgments

- HLS team for the Language Server Protocol implementation
- Anthropic for the Model Context Protocol specification
