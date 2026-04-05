FROM node:20-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for layer caching — npm install only re-runs when
# dependencies change, not on every source code change
COPY package.json package-lock.json ./

# Install all dependencies (including dev dependencies needed for build)
RUN npm ci

# Install TypeScript language server globally (default language server)
RUN npm install -g typescript typescript-language-server

# Copy source and build
COPY . .
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Create a non-root user for security
RUN addgroup -g 1001 -S lsp && \
    adduser -S lsp -u 1001 -G lsp

# Set ownership of the app directory
RUN chown -R lsp:lsp /app

# Switch to non-root user
USER lsp

# Default working directory is the mounted workspace
WORKDIR /workspace

# ENTRYPOINT is the binary; CMD provides the default language server (TypeScript).
# Override CMD to use a different language server:
#   docker run ... lsp-mcp haskell haskell-language-server-wrapper lsp
#   docker run ... lsp-mcp rust rust-analyzer
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["typescript", "typescript-language-server", "--stdio"]
