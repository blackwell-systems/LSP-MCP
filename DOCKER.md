# Docker

Run lsp-mcp in a container with a fixed Node.js version, resource limits, and
no dependency on your local environment.

## Setup

1. Copy the example env file and set your project path:
   ```bash
   cp .env.example .env
   # Edit .env: set WORKSPACE_DIR to the absolute path of your project
   ```

2. Build and start:
   ```bash
   docker compose up --build
   ```

## MCP Client Configuration

Point your MCP client at the running container:

```json
{
  "mcpServers": {
    "lsp": {
      "command": "docker",
      "args": [
        "compose",
        "-f", "/path/to/lsp-mcp/docker-compose.yml",
        "run", "--rm", "lsp-mcp"
      ],
      "env": {
        "WORKSPACE_DIR": "/path/to/your/project"
      },
      "workingDirectory": "/path/to/lsp-mcp"
    }
  }
}
```

## Using a Different Language Server

The default image installs `typescript-language-server`. To use a different
language server, override `CMD` at runtime:

```bash
# Rust (rust-analyzer must be installed in the container or on PATH)
docker run --rm -i -v /your/project:/workspace lsp-mcp rust rust-analyzer

# Haskell
docker run --rm -i -v /your/project:/workspace lsp-mcp haskell haskell-language-server-wrapper lsp
```

Or extend the Dockerfile to install your language server:

```dockerfile
FROM ghcr.io/blackwell-systems/lsp-mcp:latest
USER root
RUN apk add --no-cache rust-analyzer
USER lsp
CMD ["rust", "rust-analyzer"]
```

## Resource Limits

Defaults (adjust in `docker-compose.yml` for larger projects):

| Limit | Default |
|-------|---------|
| Memory limit | 4 GB |
| Memory reservation | 1 GB |
| CPU limit | 2 cores |
| CPU reservation | 0.5 cores |
| Node.js heap | 3 GB (`--max-old-space-size=3072`) |

## Notes

- The workspace is mounted read-write so code actions (quick fixes, auto-imports) can modify files
- `TSC_NONPOLLING_WATCHER=true` uses inotify instead of polling for file change detection, which is more efficient in containers
