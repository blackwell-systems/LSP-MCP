#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fsSync from "fs";

import { LSPClient } from "./src/lspClient.js";
import { debug, info, notice, warning, logError, critical, alert, emergency, setLogLevel, setServer } from "./src/logging/index.js";
import { getToolHandlers, getToolDefinitions } from "./src/tools/index.js";
import { 
  getResourceHandlers, 
  getSubscriptionHandlers, 
  getUnsubscriptionHandlers, 
  getResourceTemplates,
  generateResourcesList
} from "./src/resources/index.js";

// Get LSP binary path and arguments from command line arguments
const lspServerPath = process.argv[2];
if (!lspServerPath) {
  console.error("Error: LSP server path is required as the first argument");
  console.error("Usage: node dist/index.js <lsp-server-path> [lsp-server-args...]");
  process.exit(1);
}

// Get any additional arguments to pass to the LSP server
const lspServerArgs = process.argv.slice(3);

// Verify the LSP server binary exists
try {
  const stats = fsSync.statSync(lspServerPath);
  if (!stats.isFile()) {
    console.error(`Error: The specified path '${lspServerPath}' is not a file`);
    process.exit(1);
  }
} catch (error) {
  console.error(`Error: Could not access the LSP server at '${lspServerPath}'`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// We'll create the LSP client but won't initialize it until start_lsp is called
let lspClient: LSPClient | null = null;
let rootDir = "."; // Default to current directory

// Set the LSP client function
const setLspClient = (client: LSPClient) => {
  lspClient = client;
};

// Set the root directory function
const setRootDir = (dir: string) => {
  rootDir = dir;
};

// Server setup
const server = new Server(
  {
    name: "lsp-mcp-server",
    version: "0.2.0",
    description: "MCP server for Language Server Protocol (LSP) integration, providing hover information, code completions, diagnostics, and code actions with resource-based access"
  },
  {
    capabilities: {
      tools: {
        description: "A set of tools for interacting with the Language Server Protocol (LSP). These tools provide access to language-specific features like code completion, hover information, diagnostics, and code actions. Before using any LSP features, you must first call start_lsp with the project root directory, then open the files you wish to analyze."
      },
      resources: {
        description: "URI-based access to Language Server Protocol (LSP) features. These resources provide a way to access language-specific features like diagnostics, hover information, and completions through a URI pattern. Before using these resources, you must first call the start_lsp tool with the project root directory, then open the files you wish to analyze using the open_document tool.",
        templates: getResourceTemplates()
      },
      logging: {
        description: "Logging capabilities for the LSP MCP server. Use the set_log_level tool to control logging verbosity. The server sends notifications about important events, errors, and diagnostic updates."
      },
    },
  },
);

// Set the server instance for logging
setServer(server);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debug("Handling ListTools request");
  return {
    tools: getToolDefinitions(),
  };
});

// Get the tool handlers
const getToolsHandlers = () => getToolHandlers(lspClient, lspServerPath, lspServerArgs, setLspClient, rootDir, setRootDir);

// Handle tool requests using the toolHandlers object
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    debug(`Handling CallTool request for tool: ${name}`);

    // Get the latest tool handlers and look up the handler for this tool
    const toolHandlers = getToolsHandlers();
    const toolHandler = toolHandlers[name as keyof typeof toolHandlers];
    if (!toolHandler) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Validate the arguments against the schema
    const parsed = toolHandler.schema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Invalid arguments for ${name}: ${parsed.error}`);
    }

    // Call the handler with the validated arguments
    return await toolHandler.handler(parsed.data);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling tool request: ${errorMessage}`);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Resource handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    const uri = request.params.uri;
    debug(`Handling ReadResource request for URI: ${uri}`);

    // Get the resource handlers
    const resourceHandlers = getResourceHandlers(lspClient);

    // Find the appropriate handler for this URI scheme
    const handlerKey = Object.keys(resourceHandlers).find(key => uri.startsWith(key));
    if (handlerKey) {
      return await resourceHandlers[handlerKey](uri);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling resource request: ${errorMessage}`);
    return {
      contents: [{ type: "text", text: `Error: ${errorMessage}`, uri: request.params.uri }],
      isError: true,
    };
  }
});

// Resource subscription handler
server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  try {
    const { uri } = request.params;
    debug(`Handling SubscribeResource request for URI: ${uri}`);

    // Get the subscription handlers
    const subscriptionHandlers = getSubscriptionHandlers(lspClient, server);

    // Find the appropriate handler for this URI scheme
    const handlerKey = Object.keys(subscriptionHandlers).find(key => uri.startsWith(key));
    if (handlerKey) {
      return await subscriptionHandlers[handlerKey](uri);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling subscription request: ${errorMessage}`);
    return {
      ok: false,
      error: errorMessage
    };
  }
});

// Resource unsubscription handler
server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  try {
    const { uri, context } = request.params;
    debug(`Handling UnsubscribeResource request for URI: ${uri}`);

    // Get the unsubscription handlers
    const unsubscriptionHandlers = getUnsubscriptionHandlers(lspClient);

    // Find the appropriate handler for this URI scheme
    const handlerKey = Object.keys(unsubscriptionHandlers).find(key => uri.startsWith(key));
    if (handlerKey) {
      return await unsubscriptionHandlers[handlerKey](uri, context);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling unsubscription request: ${errorMessage}`);
    return {
      ok: false,
      error: errorMessage
    };
  }
});

// Handle log level changes from client
server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  try {
    const { level } = request.params;
    debug(`Received request to set log level to: ${level}`);

    // Set the log level
    setLogLevel(level);

    return {};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling set level request: ${errorMessage}`);
    return {
      ok: false,
      error: errorMessage
    };
  }
});

// Resource listing handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    debug("Handling ListResource request");

    // Generate the resources list
    const resources = generateResourcesList(lspClient);

    return { resources };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling list resources request: ${errorMessage}`);
    return {
      resources: [],
      isError: true,
      error: errorMessage
    };
  }
});

// Clean up on process exit
process.on('exit', async () => {
  info("Shutting down MCP server...");
  try {
    // Only attempt shutdown if lspClient exists and is initialized
    if (lspClient) {
      await lspClient.shutdown();
    }
  } catch (error) {
    warning("Error during shutdown:", error);
  }
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Don't exit for "Not connected" errors during startup
  if (errorMessage === 'Not connected') {
    warning(`Uncaught exception (non-fatal): ${errorMessage}`, error);
    return;
  }

  critical(`Uncaught exception: ${errorMessage}`, error);
  // Exit with status code 1 to indicate error
  process.exit(1);
});

// Start server
async function runServer() {
  notice(`Starting LSP MCP Server`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  notice("LSP MCP Server running on stdio");
  info("Using LSP server:", lspServerPath);
  if (lspServerArgs.length > 0) {
    info("With arguments:", lspServerArgs.join(' '));
  }

  // Create LSP client instance but don't start the process or initialize yet
  // Both will happen when start_lsp is called
  lspClient = new LSPClient(lspServerPath, lspServerArgs);
  info("LSP client created. Use the start_lsp tool to start and initialize with a root directory.");
}

runServer().catch((error) => {
  emergency("Fatal error running server:", error);
  process.exit(1);
});