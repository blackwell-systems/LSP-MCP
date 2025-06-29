# Docker Setup for LSP-MCP Server

This directory includes Docker configuration for running the LSP-MCP server in a containerized environment, which provides several benefits:

- **Stable environment**: Fixed Node.js version, no dependency on local Node version managers
- **Resource control**: Memory and CPU limits to handle large TypeScript projects
- **Isolation**: Clean environment without local development setup conflicts
- **Consistency**: Same environment across different machines and platforms

## Quick Start

1. **Configure your workspace directory:**
   ```bash
   cp .env.example .env
   # Edit .env and set WORKSPACE_DIR to your TypeScript project path
   ```

2. **Build and run:**
   ```bash
   docker-compose up --build
   ```

## Configuration Options

### Environment Variables

- `WORKSPACE_DIR`: Path to your TypeScript project (required)

### MCP Configuration

Update your MCP host configuration to use the Docker container:

```json
{
  "lsp-mcp-docker": {
    "command": "docker",
    "args": [
      "compose",
      "-f", "/path/to/lsp-mcp/docker-compose.yml",
      "run", "--rm", "lsp-mcp"
    ],
    "env": {
      "WORKSPACE_DIR": "/path/to/your/typescript/project"
    },
    "working_directory": "/path/to/lsp-mcp",
    "start_on_launch": false
  }
}
```

## Resource Limits

The default configuration includes resource limits suitable for large TypeScript projects:

- **Memory**: 4GB limit, 1GB reservation
- **CPU**: 2 cores limit, 0.5 core reservation
- **Node.js heap**: 3GB (`--max-old-space-size=3072`)

Adjust these in `docker-compose.yml` based on your project size and system resources.

## Troubleshooting

### Large Projects
For very large TypeScript projects, you may need to:

1. Increase memory limits in `docker-compose.yml`
2. Adjust Node.js heap size via `NODE_OPTIONS`
3. Consider excluding certain directories in your `tsconfig.json`

### Performance
- The container uses read-only volume mounts for security
- TypeScript language server performance depends on project size and complexity
- Consider using TypeScript project references for monorepos
