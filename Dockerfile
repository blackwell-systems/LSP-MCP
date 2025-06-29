FROM node:24-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including typescript-language-server
RUN npm ci --only=production && \
    npm install -g typescript-language-server typescript

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Create a non-root user for security
RUN addgroup -g 1001 -S lsp && \
    adduser -S lsp -u 1001 -G lsp

# Set ownership of the app directory
RUN chown -R lsp:lsp /app

# Switch to non-root user
USER lsp

# Set the entrypoint
ENTRYPOINT ["node", "dist/index.js", "typescript", "/usr/local/bin/typescript-language-server", "--stdio"]
