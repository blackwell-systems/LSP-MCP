#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fsSync from "fs";

import { LSPClient } from "./src/lspClient.js";
import { debug, info, notice, warning, error, critical, alert, emergency, setLogLevel, setServer, markServerInitialized, initLogging } from "./src/logging/index.js";
import { getToolHandlers, getToolDefinitions } from "./src/tools/index.js";
import { getPromptHandlers, getPromptDefinitions } from "./src/prompts/index.js";
import {
  getResourceHandlers,
  getSubscriptionHandlers,
  getUnsubscriptionHandlers,
  getResourceTemplates,
  generateResourcesList
} from "./src/resources/index.js";
import {
  getExtensionToolHandlers,
  getExtensionToolDefinitions,
  getExtensionResourceHandlers,
  getExtensionSubscriptionHandlers,
  getExtensionUnsubscriptionHandlers,
  getExtensionResourceTemplates,
  getExtensionPromptDefinitions,
  getExtensionPromptHandlers
} from "./src/extensions/index.js";

import { activateExtension } from "./src/extensions/index.js";

// Install console overrides for logging (must be called before any console usage)
initLogging();

// Get the language ID from the command line arguments
const languageId = process.argv[2];

// Add any language-specific extensions here
await activateExtension(languageId);

// Get LSP binary path and arguments from command line arguments
const lspServerPath = process.argv[3];
if (!lspServerPath) {
  console.error("Error: LSP server path is required as the first argument");
  console.error("Usage: node dist/index.js <language> <lsp-server-path> [lsp-server-args...]");
  process.exit(1);
}

// Get any additional arguments to pass to the LSP server
const lspServerArgs = process.argv.slice(4);

// Verify the LSP server binary exists
try {
  const stats = fsSync.statSync(lspServerPath);
  if (!stats.isFile()) {
    console.error(`Error: The specified path '${lspServerPath}' is not a file`);
    process.exit(1);
  }
} catch (err) {
  console.error(`Error: Could not access the LSP server at '${lspServerPath}'`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// We'll create the LSP client but won't initialize it until start_lsp is called
let lspClient: LSPClient | null = null;
let rootDir = "."; // Default to current directory

// Server-side subscription context store, keyed by resource URI
const subscriptionContexts = new Map<string, any>();

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
    version: "0.3.0",
    description: "MCP server for Language Server Protocol (LSP) integration, providing hover information, code completions, diagnostics, and code actions with resource-based access and extensibility"
  },
  {
    capabilities: {
      tools: {
        listChanged: true
      },
      resources: {
        subscribe: true,
        listChanged: true
      },
      prompts: {
        listChanged: true
      },
      logging: {}
    },
  },
);

// Set the server instance for logging and tools
setServer(server);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debug("Handling ListTools request");
  // Combine core tools and extension tools
  const coreTools = getToolDefinitions();
  const extensionTools = getExtensionToolDefinitions();
  return {
    tools: [...coreTools, ...extensionTools],
  };
});

// Get the combined tool handlers from core and extensions
const getToolsHandlers = () => {
  // Get core handlers, passing the server instance for notifications
  const coreHandlers = getToolHandlers(() => lspClient, lspServerPath, lspServerArgs, setLspClient, rootDir, setRootDir, server);
  // Get extension handlers
  const extensionHandlers = getExtensionToolHandlers();
  // Combine them (extensions take precedence in case of name conflicts)
  return { ...coreHandlers, ...extensionHandlers };
};

// Handle tool requests using the toolHandlers object
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    debug(`Handling CallTool request for tool: ${name}`);

    // Get the latest tool handlers and look up the handler for this tool
    const toolHandlers = getToolsHandlers();

    // Check if it's a direct handler or an extension handler
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

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error handling tool request: ${errorMessage}`);
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

    // Get the core and extension resource handlers
    const coreHandlers = getResourceHandlers(lspClient);
    const extensionHandlers = getExtensionResourceHandlers();

    // Combine them (extensions take precedence in case of conflicts)
    const resourceHandlers = { ...coreHandlers, ...extensionHandlers };

    // Find the appropriate handler for this URI scheme
    const handlerKey = Object.keys(resourceHandlers).find(key => uri.startsWith(key));
    if (handlerKey) {
      return await resourceHandlers[handlerKey](uri);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error handling resource request: ${errorMessage}`);
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

    // Get the core and extension subscription handlers
    const coreHandlers = getSubscriptionHandlers(lspClient, server);
    const extensionHandlers = getExtensionSubscriptionHandlers();

    // Combine them (extensions take precedence in case of conflicts)
    const subscriptionHandlers = { ...coreHandlers, ...extensionHandlers };

    // Find the appropriate handler for this URI scheme
    const handlerKey = Object.keys(subscriptionHandlers).find(key => uri.startsWith(key));
    if (handlerKey) {
      const result = await subscriptionHandlers[handlerKey](uri);
      if (result.ok && result.context) {
        subscriptionContexts.set(uri, result.context);
      }
      return result;
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error handling subscription request: ${errorMessage}`);
    return {
      ok: false,
      error: errorMessage
    };
  }
});

// Resource unsubscription handler
server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  try {
    const { uri } = request.params;
    const context = subscriptionContexts.get(uri);
    subscriptionContexts.delete(uri);
    debug(`Handling UnsubscribeResource request for URI: ${uri}`);

    // Get the core and extension unsubscription handlers
    const coreHandlers = getUnsubscriptionHandlers(lspClient);
    const extensionHandlers = getExtensionUnsubscriptionHandlers();

    // Combine them (extensions take precedence in case of conflicts)
    const unsubscriptionHandlers = { ...coreHandlers, ...extensionHandlers };

    // Find the appropriate handler for this URI scheme
    const handlerKey = Object.keys(unsubscriptionHandlers).find(key => uri.startsWith(key));
    if (handlerKey) {
      return await unsubscriptionHandlers[handlerKey](uri, context);
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error handling unsubscription request: ${errorMessage}`);
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
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error handling set level request: ${errorMessage}`);
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

    // Generate the core resources list
    const coreResources = generateResourcesList(lspClient);

    // Get extension resource templates
    const extensionTemplates = getExtensionResourceTemplates();

    // Combine core resources and extension templates
    const resources = [...coreResources, ...extensionTemplates];

    return { resources };
  } catch (err) {
    error(`Error handling list resources request:`, err);
    throw err;
  }
});

// Prompt listing handler
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  try {
    debug("Handling ListPrompts request");
    // Combine core and extension prompts
    const corePrompts = getPromptDefinitions();
    const extensionPrompts = getExtensionPromptDefinitions();
    return {
      prompts: [...corePrompts, ...extensionPrompts],
    };
  } catch (err) {
    error(`Error handling list prompts request:`, err);
    throw err;
  }
});

// Get prompt handler
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    debug(`Handling GetPrompt request for prompt: ${name}`);

    // Get the core and extension prompt handlers
    const coreHandlers = getPromptHandlers();
    const extensionHandlers = getExtensionPromptHandlers();

    // Combine them (extensions take precedence in case of conflicts)
    const promptHandlers = { ...coreHandlers, ...extensionHandlers };

    const promptHandler = promptHandlers[name];

    if (!promptHandler) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    // Call the handler with the arguments
    return await promptHandler(args);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error handling get prompt request: ${errorMessage}`);
    throw new Error(`Error handling get prompt request: ${errorMessage}`);
  }
});

// Graceful async shutdown on signal
const gracefulShutdown = async (signal: string): Promise<void> => {
  info(`Received ${signal}, shutting down MCP server...`);
  try {
    if (lspClient) {
      await lspClient.shutdown();
    }
  } catch (err) {
    warning(`Error during shutdown on ${signal}:`, err);
  }
  process.exit(0);
};

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

// Synchronous exit handler: no async work here
process.on('exit', () => {
  // Intentionally empty — async cleanup is handled by SIGINT/SIGTERM above.
});

// Catch unhandled promise rejections — in Node 15+ these abort the process by default.
// LSP subprocess crashes produce rejected promises; if any escape the catch chain they
// should be logged and ignored rather than killing the MCP server.
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  warning(`Unhandled promise rejection (non-fatal): ${message}`);
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
  
  // Wait a brief moment for the MCP initialization handshake to complete
  // before enabling notifications
  setTimeout(async () => {
    markServerInitialized();
    info("Using LSP server:", lspServerPath);
    if (lspServerArgs.length > 0) {
      info("With arguments:", lspServerArgs.join(' '));
    }
    
    // Create LSP client instance and immediately initialize it
    lspClient = new LSPClient(lspServerPath, lspServerArgs);
    await lspClient.initialize(process.cwd());
  }, 100); // Small delay to allow MCP handshake to complete
}


runServer().catch((err) => {
  emergency("Fatal error running server:", err);
  process.exit(1);
});
