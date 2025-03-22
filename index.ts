#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Set up logging
const logFilePath = process.env.LSP_MCP_LOG;
let logStream: fsSync.WriteStream | null = null;

if (logFilePath) {
  try {
    // Create or open the log file in append mode
    logStream = fsSync.createWriteStream(logFilePath, { flags: 'a' });

    // Add timestamp to log entries
    const timestamp = new Date().toISOString();
    logStream.write(`\n[${timestamp}] LSP MCP Server started\n`);
  } catch (error) {
    console.error(`Error opening log file ${logFilePath}:`, error);
  }
}

// Override console.log and console.error to also write to the log file
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  originalConsoleLog.apply(console, args);

  if (logStream) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    logStream.write(`[${timestamp}] LOG: ${message}\n`);
  }
};

console.error = function(...args) {
  originalConsoleError.apply(console, args);

  if (logStream) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    logStream.write(`[${timestamp}] ERROR: ${message}\n`);
  }
};

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

// LSP message handling
interface LSPMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

class LSPClient {
  private process: any;
  private buffer: string = "";
  private messageQueue: LSPMessage[] = [];
  private nextId: number = 1;
  private responsePromises: Map<string | number, { resolve: Function; reject: Function }> = new Map();
  private initialized: boolean = false;
  private serverCapabilities: any = null;
  private lspServerPath: string;
  private lspServerArgs: string[];
  private openedDocuments: Set<string> = new Set();
  private documentVersions: Map<string, number> = new Map();
  private processingQueue: boolean = false;

  constructor(lspServerPath: string, lspServerArgs: string[] = []) {
    this.lspServerPath = lspServerPath;
    this.lspServerArgs = lspServerArgs;
    this.startProcess();
  }

  private startProcess(): void {
    console.log(`Starting LSP client with binary: ${this.lspServerPath}`);
    console.log(`Using LSP server arguments: ${this.lspServerArgs.join(' ')}`);
    this.process = spawn(this.lspServerPath, this.lspServerArgs, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    // Set up event listeners
    this.process.stdout.on("data", (data: Buffer) => this.handleData(data));
    this.process.stderr.on("data", (data: Buffer) => {
      console.error(`LSP Server Message: ${data.toString()}`);
    });

    this.process.on("close", (code: number) => {
      console.log(`LSP server process exited with code ${code}`);
    });
  }

  private handleData(data: Buffer): void {
    // Append new data to buffer
    this.buffer += data.toString();

    // Process complete messages
    while (true) {
      // Look for the standard LSP header format - this captures the entire header including the \r\n\r\n
      const headerMatch = this.buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch[0].length;

      // Check if we have the complete message (excluding the header)
      if (this.buffer.length < headerEnd + contentLength) break; // Message not complete yet

      // Extract the message content - using exact content length without including the header
      let content = this.buffer.substring(headerEnd, headerEnd + contentLength);
      // Make the parsing more robust by ensuring content ends with a closing brace
      if (content[content.length - 1] !== '}') {
        console.log("Content doesn't end with '}', adjusting...");
        const lastBraceIndex = content.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
          const actualContentLength = lastBraceIndex + 1;
          console.log(`Adjusted content length from ${contentLength} to ${actualContentLength}`);
          content = content.substring(0, actualContentLength);
          // Update buffer position based on actual content length
          this.buffer = this.buffer.substring(headerEnd + actualContentLength);
        } else {
          console.log("No closing brace found, using original content length");
          // No closing brace found, use original approach
          this.buffer = this.buffer.substring(headerEnd + contentLength);
        }
      } else {
        console.log("Content ends with '}', no adjustment needed");
        // Content looks good, remove precisely this processed message from buffer
        this.buffer = this.buffer.substring(headerEnd + contentLength);
      }


      // Parse the message and add to queue
      try {
        const message = JSON.parse(content) as LSPMessage;
        this.messageQueue.push(message);
        this.processMessageQueue();
      } catch (error) {
        console.error("Failed to parse LSP message:", error);
      }
    }
  }

  private async processMessageQueue(): Promise<void> {
    // If already processing, return to avoid concurrent processing
    if (this.processingQueue) return;

    this.processingQueue = true;

    try {
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift()!;
        await this.handleMessage(message);
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private async handleMessage(message: LSPMessage): Promise<void> {
    // Log the message for debugging
    if (logStream) {
      try {
        const timestamp = new Date().toISOString();
        const direction = 'RECEIVED';
        const logContent = `[${timestamp}] LSP ${direction}: ${JSON.stringify(message, null, 2)}\n`;
        logStream.write(logContent);
      } catch (error) {
        console.error("Error logging LSP message:", error);
      }
    }

    // Handle response messages
    if ('id' in message && (message.result !== undefined || message.error !== undefined)) {
      const promise = this.responsePromises.get(message.id!);
      if (promise) {
        if (message.error) {
          promise.reject(message.error);
        } else {
          promise.resolve(message.result);
        }
        this.responsePromises.delete(message.id!);
      }
    }

    // Store server capabilities from initialize response
    if ('id' in message && message.result?.capabilities) {
      this.serverCapabilities = message.result.capabilities;
    }
  }

  private sendRequest<T>(method: string, params?: any): Promise<T> {
    const id = this.nextId++;
    const request: LSPMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    // Log the request for debugging
    if (logStream) {
      const timestamp = new Date().toISOString();
      const direction = 'SENT';
      const logContent = `[${timestamp}] LSP ${direction}: ${JSON.stringify(request, null, 2)}\n`;
      logStream.write(logContent);
    }

    const promise = new Promise<T>((resolve, reject) => {
      // Set timeout for request
      const timeoutId = setTimeout(() => {
        if (this.responsePromises.has(id)) {
          this.responsePromises.delete(id);
          reject(new Error(`Timeout waiting for response to ${method} request`));
        }
      }, 10000); // 10 second timeout

      // Store promise with cleanup for timeout
      this.responsePromises.set(id, {
        resolve: (result: T) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error: any) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    });

    const content = JSON.stringify(request);
    // Content-Length header should only include the length of the JSON content
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin.write(header + content);

    return promise;
  }

  private sendNotification(method: string, params?: any): void {
    const notification: LSPMessage = {
      jsonrpc: "2.0",
      method,
      params
    };

    // Log the notification for debugging
    if (logStream) {
      const timestamp = new Date().toISOString();
      const direction = 'SENT';
      const logContent = `[${timestamp}] LSP ${direction}: ${JSON.stringify(notification, null, 2)}\n`;
      logStream.write(logContent);
    }

    const content = JSON.stringify(notification);
    // Content-Length header should only include the length of the JSON content
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin.write(header + content);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log("Initializing LSP connection...");
      await this.sendRequest("initialize", {
        processId: process.pid,
        clientInfo: {
          name: "lsp-mcp-server"
        },
        rootUri: "file://" + path.resolve("."),
        capabilities: {
          textDocument: {
            hover: {
              contentFormat: ["markdown", "plaintext"]
            },
            completion: {
              completionItem: {
                snippetSupport: false
              }
            }
          }
        }
      });

      this.sendNotification("initialized", {});
      this.initialized = true;
      console.log("LSP connection initialized successfully");
    } catch (error) {
      console.error("Failed to initialize LSP connection:", error);
      throw error;
    }
  }

  async openDocument(uri: string, text: string, languageId: string = "haskell"): Promise<void> {
    await this.initialize();

    // If document is already open, update it instead of reopening
    if (this.openedDocuments.has(uri)) {
      // Get current version and increment
      const currentVersion = this.documentVersions.get(uri) || 1;
      const newVersion = currentVersion + 1;
      
      console.log(`Document already open, updating content: ${uri} (version ${newVersion})`);
      this.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version: newVersion
        },
        contentChanges: [
          {
            text // Full document update
          }
        ]
      });
      
      // Update version
      this.documentVersions.set(uri, newVersion);
      return;
    }

    console.log(`Opening document: ${uri}`);
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text
      }
    });

    // Mark document as open and initialize version
    this.openedDocuments.add(uri);
    this.documentVersions.set(uri, 1);
  }

  async getInfoOnLocation(uri: string, position: { line: number, character: number }): Promise<string> {
    await this.initialize();

    console.log(`Getting info on location: ${uri} (${position.line}:${position.character})`);

    try {
      // Use hover request to get information at the position
      const response = await this.sendRequest<any>("textDocument/hover", {
        textDocument: { uri },
        position
      });

      if (response?.contents) {
        if (typeof response.contents === 'string') {
          return response.contents;
        } else if (response.contents.value) {
          return response.contents.value;
        } else if (Array.isArray(response.contents)) {
          return response.contents.map((item: any) =>
            typeof item === 'string' ? item : item.value || ''
          ).join('\n');
        }
      }
    } catch (error) {
      console.error(`Error getting hover information: ${error instanceof Error ? error.message : String(error)}`);
    }

    return '';
  }

  async getCompletion(uri: string, position: { line: number, character: number }): Promise<any[]> {
    await this.initialize();

    console.log(`Getting completions at location: ${uri} (${position.line}:${position.character})`);

    try {
      const response = await this.sendRequest<any>("textDocument/completion", {
        textDocument: { uri },
        position
      });

      if (Array.isArray(response)) {
        return response;
      } else if (response?.items && Array.isArray(response.items)) {
        return response.items;
      }
    } catch (error) {
      console.error(`Error getting completions: ${error instanceof Error ? error.message : String(error)}`);
    }

    return [];
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    try {
      console.log("Shutting down LSP connection...");

      // Close all open documents before shutting down
      for (const uri of this.openedDocuments) {
        try {
          this.sendNotification("textDocument/didClose", {
            textDocument: { uri }
          });
        } catch (error) {
          console.error(`Error closing document ${uri}:`, error);
        }
      }

      await this.sendRequest("shutdown");
      this.sendNotification("exit");
      this.initialized = false;
      this.openedDocuments.clear();
      console.log("LSP connection shut down successfully");
    } catch (error) {
      console.error("Error shutting down LSP connection:", error);
    }
  }

  async restart(): Promise<void> {
    console.log("Restarting LSP server...");

    // If initialized, try to shut down cleanly first
    if (this.initialized) {
      try {
        await this.shutdown();
      } catch (error) {
        console.error("Error shutting down LSP server during restart:", error);
      }
    }

    // Kill the process if it's still running
    if (this.process && !this.process.killed) {
      try {
        this.process.kill();
        console.log("Killed existing LSP process");
      } catch (error) {
        console.error("Error killing LSP process:", error);
      }
    }

    // Reset state
    this.buffer = "";
    this.messageQueue = [];
    this.nextId = 1;
    this.responsePromises.clear();
    this.initialized = false;
    this.serverCapabilities = null;
    this.openedDocuments.clear();
    this.documentVersions.clear();
    this.processingQueue = false;

    // Start a new process
    this.startProcess();

    // Initialize the new connection
    await this.initialize();
    console.log("LSP server restarted successfully");
  }
}

// Schema definitions
const GetInfoOnLocationArgsSchema = z.object({
  file_path: z.string().describe("Path to the file"),
  language_id: z.string().describe("The programming language the file is written in"),
  line: z.number().describe("Line number (uses 0-based indexing)"),
  character: z.number().describe("Character position (uses 0-based indexing)"),
});

const GetCompletionsArgsSchema = z.object({
  file_path: z.string().describe("Path to the file"),
  language_id: z.string().describe("The programming language the file is written in"),
  line: z.number().describe("Line number (uses 0-based indexing)"),
  character: z.number().describe("Character position (uses 0-based indexing)"),
});

const RestartLSPServerArgsSchema = z.object({});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Create and initialize LSP client
const lspClient = new LSPClient(lspServerPath, lspServerArgs);
lspClient.initialize().catch(error => {
  console.error("Failed to initialize LSP client:", error);
  process.exit(1);
});

// Server setup
const server = new Server(
  {
    name: "lsp-mcp-server",
    version: "0.1.0",
    description: "MCP server for Hover and Completions via LSP"
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log("Handling ListTools request");
  return {
    tools: [
      {
        name: "get_info_on_location",
        description: "Get information on a specific location in a file via LSP hover",
        inputSchema: zodToJsonSchema(GetInfoOnLocationArgsSchema) as ToolInput,
      },
      {
        name: "get_completions",
        description: "Get completion suggestions at a specific location in a file",
        inputSchema: zodToJsonSchema(GetCompletionsArgsSchema) as ToolInput,
      },
      {
        name: "restart_lsp_server",
        description: "Restart the LSP server process",
        inputSchema: zodToJsonSchema(RestartLSPServerArgsSchema) as ToolInput,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    console.log(`Handling CallTool request for tool: ${name}`);

    switch (name) {
      case "get_info_on_location": {
        const parsed = GetInfoOnLocationArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_info_on_location: ${parsed.error}`);
        }

        console.log(`Getting info on location in file: ${parsed.data.file_path} (${parsed.data.line}:${parsed.data.character})`);

        // Read the file content
        const fileContent = await fs.readFile(parsed.data.file_path, 'utf-8');

        // Create a file URI
        const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient.openDocument(fileUri, fileContent, parsed.data.language_id);

        // Get information at the location
        const text = await lspClient.getInfoOnLocation(fileUri, {
          line: parsed.data.line,
          character: parsed.data.character
        });

        console.log(`Returned info on location: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);

        return {
          content: [{ type: "text", text }],
        };
      }

      case "get_completions": {
        const parsed = GetCompletionsArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_completions: ${parsed.error}`);
        }

        console.log(`Getting completions in file: ${parsed.data.file_path} (${parsed.data.line}:${parsed.data.character})`);

        // Read the file content
        const fileContent = await fs.readFile(parsed.data.file_path, 'utf-8');

        // Create a file URI
        const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient.openDocument(fileUri, fileContent, parsed.data.language_id);

        // Get completions at the location
        const completions = await lspClient.getCompletion(fileUri, {
          line: parsed.data.line,
          character: parsed.data.character
        });

        console.log(`Returned ${completions.length} completions`);

        return {
          content: [{ type: "text", text: JSON.stringify(completions, null, 2) }],
        };
      }

      case "restart_lsp_server": {
        const parsed = RestartLSPServerArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for restart_lsp_server: ${parsed.error}`);
        }

        console.log("Restarting LSP server...");

        try {
          await lspClient.restart();
          return {
            content: [{ type: "text", text: "LSP server successfully restarted" }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Error restarting LSP server: ${errorMessage}`);
          throw new Error(`Failed to restart LSP server: ${errorMessage}`);
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error handling tool request: ${errorMessage}`);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Ensure log file is closed properly on process exit
process.on('exit', async () => {
  console.log("Shutting down MCP server...");
  try {
    await lspClient.shutdown();
  } catch (error) {
    console.error("Error during shutdown:", error);
  }

  if (logStream) {
    const timestamp = new Date().toISOString();
    logStream.write(`[${timestamp}] LSP MCP Server exited\n`);
    logStream.end();
  }
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Start server
async function runServer() {
  console.log("Starting LSP MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("LSP MCP Server running on stdio");
  console.log("Using LSP server:", lspServerPath);
  if (lspServerArgs.length > 0) {
    console.log("With arguments:", lspServerArgs.join(' '));
  }
  if (logFilePath) {
    console.log(`Logging to file: ${logFilePath}`);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
