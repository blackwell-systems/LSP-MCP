FROM node:24-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install TypeScript globally first (needed for build)
RUN npm install -g typescript typescript-language-server

# Copy source code and configuration
COPY . .

# Install all dependencies (including dev dependencies needed for build)
RUN npm ci

# Build the project
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

# Set working directory to workspace for proper LSP operation
WORKDIR /workspace

# Set the entrypoint
ENTRYPOINT ["node", "/app/dist/index.js", "typescript", "/usr/local/bin/typescript-language-server", "--stdio"]
