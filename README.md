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

- `get_info_on_location`: Get hover information at a specific location in a Haskell file
- `get_completions`: Get completion suggestions at a specific location in a Haskell file
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

Run the MCP server by providing the path to the LSP executable:

```
node dist/index.js /path/to/lsp
```

### Logging

You can enable logging to a file by setting the `LSP_MCP_LOG` environment variable before starting the server:

```
export LSP_MCP_LOG=/path/to/ghc-mcp.log
node dist/index.js /path/to/lsp-server
```

This will create a detailed log file with timestamps that captures:
- All console output
- LSP protocol messages
- MCP tool requests and responses
- Errors and exceptions

## API

The server provides the following MCP tools:

### get_info_on_location

Gets hover information at a specific location in a Haskell file.

Parameters:
- `file_path`: Path to the Haskell file
- `line`: Line number (0-based)
- `character`: Character position (0-based)

Example:
```json
{
  "tool": "get_info_on_location",
  "arguments": {
    "file_path": "/path/to/your/file",
    "line": 3,
    "character": 5
  }
}
```

### get_completions

Gets completion suggestions at a specific location in a file.

Parameters:
- `file_path`: Path to the file
- `line`: Line number (0-based)
- `character`: Character position (0-based)

Example:
```json
{
  "tool": "get_completions",
  "arguments": {
    "file_path": "/path/to/your/file",
    "line": 3,
    "character": 10
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
