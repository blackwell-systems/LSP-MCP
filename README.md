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

### MCP Tools
- `get_info_on_location`: Get hover information at a specific location in a file
- `get_completions`: Get completion suggestions at a specific location in a file
- `get_code_actions`: Get code actions for a specific range in a file
- `open_document`: Open a file in the LSP server for analysis
- `close_document`: Close a file in the LSP server
- `get_diagnostics`: Get diagnostic messages (errors, warnings) for open files
- `start_lsp`: Start the LSP server with a specified root directory
- `restart_lsp_server`: Restart the LSP server without restarting the MCP server
- `set_log_level`: Change the server's logging verbosity level at runtime

### MCP Resources
- `lsp-diagnostics://` resources for accessing diagnostic messages with real-time updates via subscriptions
- `lsp-hover://` resources for retrieving hover information at specific file locations
- `lsp-completions://` resources for getting code completion suggestions at specific positions

### Additional Features
- Comprehensive logging system with multiple severity levels
- Colorized console output for better readability
- Runtime-configurable log level
- Detailed error handling and reporting
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

The server includes a comprehensive logging system with 8 severity levels:
- `debug`: Detailed information for debugging purposes
- `info`: General informational messages about system operation
- `notice`: Significant operational events
- `warning`: Potential issues that might need attention
- `error`: Error conditions that affect operation but don't halt the system
- `critical`: Critical conditions requiring immediate attention
- `alert`: System is in an unstable state
- `emergency`: System is unusable

By default, logs are sent to:
1. Console output with color-coding for better readability
2. MCP notifications to the client (via the `notifications/message` method)

#### Viewing Debug Logs

For detailed debugging, you can:

1. Use the `claude --mcp-debug` flag when running Claude to see all MCP traffic between Claude and the server:
   ```
   claude --mcp-debug
   ```

2. Change the log level at runtime using the `set_log_level` tool:
   ```json
   {
     "tool": "set_log_level",
     "arguments": {
       "level": "debug"
     }
   }
   ```

The default log level is `info`, which shows moderate operational detail while filtering out verbose debug messages.

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

### set_log_level

Sets the server's logging level to control verbosity of log messages.

Parameters:
- `level`: The logging level to set. One of: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`.

Example:
```json
{
  "tool": "set_log_level",
  "arguments": {
    "level": "debug"
  }
}
```

## MCP Resources

In addition to tools, the server provides resources for accessing LSP features including diagnostics, hover information, and code completions:

### Diagnostic Resources

The server exposes diagnostic information via the `lsp-diagnostics://` resource scheme. These resources can be subscribed to for real-time updates when diagnostics change.

Resource URIs:
- `lsp-diagnostics://` - Diagnostics for all open files
- `lsp-diagnostics:///path/to/file` - Diagnostics for a specific file

Important: Files must be opened using the `open_document` tool before diagnostics can be accessed.

### Hover Information Resources

The server exposes hover information via the `lsp-hover://` resource scheme. This allows you to get information about code elements at specific positions in files.

Resource URI format:
```
lsp-hover:///path/to/file?line={line}&character={character}&language_id={language_id}
```

Parameters:
- `line`: Line number (1-based)
- `character`: Character position (1-based)
- `language_id`: The programming language (e.g., "haskell")

Example:
```
lsp-hover:///home/user/project/src/Main.hs?line=42&character=10&language_id=haskell
```

### Code Completion Resources

The server exposes code completion suggestions via the `lsp-completions://` resource scheme. This allows you to get completion candidates at specific positions in files.

Resource URI format:
```
lsp-completions:///path/to/file?line={line}&character={character}&language_id={language_id}
```

Parameters:
- `line`: Line number (1-based)
- `character`: Character position (1-based)
- `language_id`: The programming language (e.g., "haskell")

Example:
```
lsp-completions:///home/user/project/src/Main.hs?line=42&character=10&language_id=haskell
```

### Listing Available Resources

To discover available resources, use the MCP `resources/list` endpoint. The response will include all available resources for currently open files, including:
- Diagnostics resources for all open files
- Hover information templates for all open files
- Code completion templates for all open files

### Subscribing to Resource Updates

Diagnostic resources support subscriptions to receive real-time updates when diagnostics change (e.g., when files are modified and new errors or warnings appear). Subscribe to diagnostic resources using the MCP `resources/subscribe` endpoint.

Note: Hover and completion resources don't support subscriptions as they represent point-in-time queries.

### Working with Resources vs. Tools

You can choose between two approaches for accessing LSP features:

1. Tool-based approach: Use the `get_diagnostics`, `get_info_on_location`, and `get_completions` tools for a simple, direct way to fetch information.
2. Resource-based approach: Use the `lsp-diagnostics://`, `lsp-hover://`, and `lsp-completions://` resources for a more RESTful approach.

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
