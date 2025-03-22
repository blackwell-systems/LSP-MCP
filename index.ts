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
  ToolSchema,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Set up logging with multiple log levels
const logFilePath = process.env.LSP_MCP_LOG;
let logStream: fsSync.WriteStream | null = null;
type LoggingLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

// Store original console methods before we do anything else
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Current log level - can be changed at runtime
let logLevel: LoggingLevel = 'debug';

// Map of log levels and their priorities (higher number = higher priority)
const LOG_LEVEL_PRIORITY: Record<LoggingLevel, number> = {
  'debug': 0,
  'info': 1,
  'notice': 2,
  'warning': 3,
  'error': 4,
  'critical': 5,
  'alert': 6,
  'emergency': 7
};

// Check if message should be logged based on current level
const shouldLog = (level: LoggingLevel): boolean => {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[logLevel];
};

if (logFilePath) {
  try {
    // Create or open the log file in append mode
    logStream = fsSync.createWriteStream(logFilePath, { flags: 'a' });

    // Add timestamp to log entries
    const timestamp = new Date().toISOString();
    // Using original console method before we set up the redirections
    logStream.write(`\n[${timestamp}] [info] LSP MCP Server started\n`);
  } catch (error) {
    // Use original console method to prevent recursion before we're fully set up
    originalConsoleError(`Error opening log file ${logFilePath}:`, error);
  }
}

// Core logging function
const log = (level: LoggingLevel, ...args: any[]): void => {
  if (!shouldLog(level)) return;
  
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  
  // Format for console output with color coding
  let consoleMethod = originalConsoleLog; // Use original methods to prevent recursion
  let consolePrefix = '';
  
  switch(level) {
    case 'debug':
      consolePrefix = '\x1b[90m[DEBUG]\x1b[0m'; // Gray
      break;
    case 'info':
      consolePrefix = '\x1b[36m[INFO]\x1b[0m'; // Cyan
      break;
    case 'notice':
      consolePrefix = '\x1b[32m[NOTICE]\x1b[0m'; // Green
      break;
    case 'warning':
      consolePrefix = '\x1b[33m[WARNING]\x1b[0m'; // Yellow
      consoleMethod = originalConsoleWarn || originalConsoleLog;
      break;
    case 'error':
      consolePrefix = '\x1b[31m[ERROR]\x1b[0m'; // Red
      consoleMethod = originalConsoleError;
      break;
    case 'critical':
      consolePrefix = '\x1b[41m\x1b[37m[CRITICAL]\x1b[0m'; // White on red
      consoleMethod = originalConsoleError;
      break;
    case 'alert':
      consolePrefix = '\x1b[45m\x1b[37m[ALERT]\x1b[0m'; // White on purple
      consoleMethod = originalConsoleError;
      break;
    case 'emergency':
      consolePrefix = '\x1b[41m\x1b[1m[EMERGENCY]\x1b[0m'; // Bold white on red
      consoleMethod = originalConsoleError;
      break;
  }
  
  consoleMethod(`${consolePrefix} ${message}`);
  
  // Write to log file if available
  if (logStream) {
    logStream.write(`[${timestamp}] [${level}] ${message}\n`);
  }
  
  // Send notification to MCP client if server is available and initialized
  if (server && typeof server.notification === 'function') {
    try {
      server.notification({
        method: "notifications/message",
        params: {
          level,
          logger: "lsp-mcp-server",
          data: message,
        },
      });
    } catch (error) {
      // Use original console methods to avoid recursion
      originalConsoleError("Error sending notification:", error);
    }
  }
};

// Create helper functions for each log level
const debug = (...args: any[]): void => log('debug', ...args);
const info = (...args: any[]): void => log('info', ...args);
const notice = (...args: any[]): void => log('notice', ...args);
const warning = (...args: any[]): void => log('warning', ...args);
const logError = (...args: any[]): void => log('error', ...args);
const critical = (...args: any[]): void => log('critical', ...args);
const alert = (...args: any[]): void => log('alert', ...args);
const emergency = (...args: any[]): void => log('emergency', ...args);

// Set log level function - defined after log function to avoid circular references 
const setLogLevel = (level: LoggingLevel): void => {
  logLevel = level;
  log('info', `Log level set to: ${level}`);
};


// Flag to prevent recursion in logging
let isLogging = false;

// Override console methods to use our logging system
console.log = function(...args) {
  if (isLogging) {
    // Use original method to prevent recursion
    originalConsoleLog(...args);
    return;
  }
  
  isLogging = true;
  info(...args);
  isLogging = false;
};

console.warn = function(...args) {
  if (isLogging) {
    // Use original method to prevent recursion
    originalConsoleWarn(...args);
    return;
  }
  
  isLogging = true;
  warning(...args);
  isLogging = false;
};

console.error = function(...args) {
  if (isLogging) {
    // Use original method to prevent recursion
    originalConsoleError(...args);
    return;
  }
  
  isLogging = true;
  logError(...args);
  isLogging = false;
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

// Define a type for diagnostic subscribers
type DiagnosticUpdateCallback = (uri: string, diagnostics: any[]) => void;

// Define a type for subscription context
interface SubscriptionContext {
  callback: DiagnosticUpdateCallback;
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
  private documentDiagnostics: Map<string, any[]> = new Map();
  private diagnosticSubscribers: Set<DiagnosticUpdateCallback> = new Set();

  constructor(lspServerPath: string, lspServerArgs: string[] = []) {
    this.lspServerPath = lspServerPath;
    this.lspServerArgs = lspServerArgs;
    // Don't start the process automatically - it will be started when needed
  }

  private startProcess(): void {
    info(`Starting LSP client with binary: ${this.lspServerPath}`);
    info(`Using LSP server arguments: ${this.lspServerArgs.join(' ')}`);
    this.process = spawn(this.lspServerPath, this.lspServerArgs, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    // Set up event listeners
    this.process.stdout.on("data", (data: Buffer) => this.handleData(data));
    this.process.stderr.on("data", (data: Buffer) => {
      debug(`LSP Server Message: ${data.toString()}`);
    });

    this.process.on("close", (code: number) => {
      notice(`LSP server process exited with code ${code}`);
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
    // Log the message with appropriate level
    try {
      const direction = 'RECEIVED';
      const messageStr = JSON.stringify(message, null, 2);
      // Use method to determine log level if available, otherwise use debug
      const method = message.method || '';
      const logLevel = this.getLSPMethodLogLevel(method);
      log(logLevel, `LSP ${direction} (${method}): ${messageStr}`);
    } catch (error) {
      warning("Error logging LSP message:", error);
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

    // Handle notification messages
    if ('method' in message && message.id === undefined) {
      // Handle diagnostic notifications
      if (message.method === 'textDocument/publishDiagnostics' && message.params) {
        const { uri, diagnostics } = message.params;

        if (uri && Array.isArray(diagnostics)) {
          const severity = diagnostics.length > 0 ? 
            Math.min(...diagnostics.map(d => d.severity || 4)) : 4;
          
          // Map LSP severity to our log levels
          const severityToLevel: Record<number, LoggingLevel> = {
            1: 'error',      // Error
            2: 'warning',    // Warning
            3: 'info',       // Information
            4: 'debug'       // Hint
          };
          
          const level = severityToLevel[severity] || 'debug';
          
          log(level, `Received ${diagnostics.length} diagnostics for ${uri}`);

          // Store diagnostics, replacing any previous ones for this URI
          this.documentDiagnostics.set(uri, diagnostics);

          // Notify all subscribers about this update
          this.notifyDiagnosticUpdate(uri, diagnostics);
        }
      }
    }
  }

  private getLSPMethodLogLevel(method: string): LoggingLevel {
    // Define appropriate log levels for different LSP methods
    if (method.startsWith('textDocument/did')) {
      return 'debug'; // Document changes are usually debug level
    }
    
    if (method.includes('diagnostic') || method.includes('publishDiagnostics')) {
      return 'info'; // Diagnostics depend on their severity, but base level is info
    }
    
    if (method === 'initialize' || method === 'initialized' || 
        method === 'shutdown' || method === 'exit') {
      return 'notice'; // Important lifecycle events are notice level
    }
    
    // Default to debug level for most LSP operations
    return 'debug';
  }

  private sendRequest<T>(method: string, params?: any): Promise<T> {
    // Check if the process is started
    if (!this.process) {
      return Promise.reject(new Error("LSP process not started. Please call start_lsp first."));
    }

    const id = this.nextId++;
    const request: LSPMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    // Log the request with appropriate level
    try {
      const direction = 'SENT';
      const requestStr = JSON.stringify(request, null, 2);
      const logLevel = this.getLSPMethodLogLevel(method);
      log(logLevel, `LSP ${direction} (${method}): ${requestStr}`);
    } catch (error) {
      warning("Error logging LSP request:", error);
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
    // Check if the process is started
    if (!this.process) {
      console.error("LSP process not started. Please call start_lsp first.");
      return;
    }
    
    const notification: LSPMessage = {
      jsonrpc: "2.0",
      method,
      params
    };

    // Log the notification with appropriate level
    try {
      const direction = 'SENT';
      const notificationStr = JSON.stringify(notification, null, 2);
      const logLevel = this.getLSPMethodLogLevel(method);
      log(logLevel, `LSP ${direction} (${method}): ${notificationStr}`);
    } catch (error) {
      warning("Error logging LSP notification:", error);
    }

    const content = JSON.stringify(notification);
    // Content-Length header should only include the length of the JSON content
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin.write(header + content);
  }

  async initialize(rootDirectory: string = "."): Promise<void> {
    if (this.initialized) return;

    try {
      // Start the process if it hasn't been started yet
      if (!this.process) {
        this.startProcess();
      }
      
      info("Initializing LSP connection...");
      await this.sendRequest("initialize", {
        processId: process.pid,
        clientInfo: {
          name: "lsp-mcp-server"
        },
        rootUri: "file://" + path.resolve(rootDirectory),
        capabilities: {
          textDocument: {
            hover: {
              contentFormat: ["markdown", "plaintext"]
            },
            completion: {
              completionItem: {
                snippetSupport: false
              }
            },
            codeAction: {
              dynamicRegistration: true
            }
          }
        }
      });

      this.sendNotification("initialized", {});
      this.initialized = true;
      notice("LSP connection initialized successfully");
    } catch (error) {
      logError("Failed to initialize LSP connection:", error);
      throw error;
    }
  }

  async openDocument(uri: string, text: string, languageId: string = "haskell"): Promise<void> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP client not initialized. Please call start_lsp first.");
    }

    // If document is already open, update it instead of reopening
    if (this.openedDocuments.has(uri)) {
      // Get current version and increment
      const currentVersion = this.documentVersions.get(uri) || 1;
      const newVersion = currentVersion + 1;

      debug(`Document already open, updating content: ${uri} (version ${newVersion})`);
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

    debug(`Opening document: ${uri}`);
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

  // Check if a document is open
  isDocumentOpen(uri: string): boolean {
    return this.openedDocuments.has(uri);
  }

  // Get a list of all open documents
  getOpenDocuments(): string[] {
    return Array.from(this.openedDocuments);
  }

  // Close a document
  async closeDocument(uri: string): Promise<void> {
    // Check if initialized
    if (!this.initialized) {
      throw new Error("LSP client not initialized. Please call start_lsp first.");
    }

    // Only close if document is open
    if (this.openedDocuments.has(uri)) {
      debug(`Closing document: ${uri}`);
      this.sendNotification("textDocument/didClose", {
        textDocument: { uri }
      });

      // Remove from tracking
      this.openedDocuments.delete(uri);
      this.documentVersions.delete(uri);
    } else {
      debug(`Document not open: ${uri}`);
    }
  }

  // Get diagnostics for a file
  getDiagnostics(uri: string): any[] {
    return this.documentDiagnostics.get(uri) || [];
  }

  // Get all diagnostics
  getAllDiagnostics(): Map<string, any[]> {
    return new Map(this.documentDiagnostics);
  }

  // Subscribe to diagnostic updates
  subscribeToDiagnostics(callback: DiagnosticUpdateCallback): void {
    this.diagnosticSubscribers.add(callback);

    // Send initial diagnostics for all open documents
    this.documentDiagnostics.forEach((diagnostics, uri) => {
      callback(uri, diagnostics);
    });
  }

  // Unsubscribe from diagnostic updates
  unsubscribeFromDiagnostics(callback: DiagnosticUpdateCallback): void {
    this.diagnosticSubscribers.delete(callback);
  }

  // Notify all subscribers about diagnostic updates
  private notifyDiagnosticUpdate(uri: string, diagnostics: any[]): void {
    this.diagnosticSubscribers.forEach(callback => {
      try {
        callback(uri, diagnostics);
      } catch (error) {
        warning("Error in diagnostic subscriber callback:", error);
      }
    });
  }

  // Clear all diagnostic subscribers
  clearDiagnosticSubscribers(): void {
    this.diagnosticSubscribers.clear();
  }

  async getInfoOnLocation(uri: string, position: { line: number, character: number }): Promise<string> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP client not initialized. Please call start_lsp first.");
    }

    debug(`Getting info on location: ${uri} (${position.line}:${position.character})`);

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
      warning(`Error getting hover information: ${error instanceof Error ? error.message : String(error)}`);
    }

    return '';
  }

  async getCompletion(uri: string, position: { line: number, character: number }): Promise<any[]> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP client not initialized. Please call start_lsp first.");
    }

    debug(`Getting completions at location: ${uri} (${position.line}:${position.character})`);

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
      warning(`Error getting completions: ${error instanceof Error ? error.message : String(error)}`);
    }

    return [];
  }

  async getCodeActions(uri: string, range: { start: { line: number, character: number }, end: { line: number, character: number } }): Promise<any[]> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP client not initialized. Please call start_lsp first.");
    }

    debug(`Getting code actions for range: ${uri} (${range.start.line}:${range.start.character} to ${range.end.line}:${range.end.character})`);

    try {
      const response = await this.sendRequest<any>("textDocument/codeAction", {
        textDocument: { uri },
        range,
        context: {
          diagnostics: []
        }
      });

      if (Array.isArray(response)) {
        return response;
      }
    } catch (error) {
      warning(`Error getting code actions: ${error instanceof Error ? error.message : String(error)}`);
    }

    return [];
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    try {
      info("Shutting down LSP connection...");

      // Clear all diagnostic subscribers
      this.clearDiagnosticSubscribers();

      // Close all open documents before shutting down
      for (const uri of this.openedDocuments) {
        try {
          this.sendNotification("textDocument/didClose", {
            textDocument: { uri }
          });
        } catch (error) {
          warning(`Error closing document ${uri}:`, error);
        }
      }

      await this.sendRequest("shutdown");
      this.sendNotification("exit");
      this.initialized = false;
      this.openedDocuments.clear();
      notice("LSP connection shut down successfully");
    } catch (error) {
      logError("Error shutting down LSP connection:", error);
    }
  }

  async restart(rootDirectory?: string): Promise<void> {
    info("Restarting LSP server...");

    // If initialized, try to shut down cleanly first
    if (this.initialized) {
      try {
        await this.shutdown();
      } catch (error) {
        warning("Error shutting down LSP server during restart:", error);
      }
    }

    // Kill the process if it's still running
    if (this.process && !this.process.killed) {
      try {
        this.process.kill();
        notice("Killed existing LSP process");
      } catch (error) {
        logError("Error killing LSP process:", error);
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
    this.documentDiagnostics.clear();
    this.clearDiagnosticSubscribers();

    // Start a new process
    this.startProcess();

    // Initialize with the provided root directory or use the stored one
    if (rootDirectory) {
      await this.initialize(rootDirectory);
      notice(`LSP server restarted and initialized with root directory: ${rootDirectory}`);
    } else {
      info("LSP server restarted but not initialized. Call start_lsp to initialize.");
    }
  }
}


// Schema definitions
const GetInfoOnLocationArgsSchema = z.object({
  file_path: z.string().describe("Path to the file"),
  language_id: z.string().describe("The programming language the file is written in"),
  line: z.number().describe(`Line number`),
  character: z.number().describe(`Character position`),
});

const GetCompletionsArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file`),
  language_id: z.string().describe(`The programming language the file is written in`),
  line: z.number().describe(`Line number`),
  character: z.number().describe(`Character position`),
});

const GetCodeActionsArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file`),
  language_id: z.string().describe(`The programming language the file is written in`),
  start_line: z.number().describe(`Start line number`),
  start_character: z.number().describe(`Start character position`),
  end_line: z.number().describe(`End line number`),
  end_character: z.number().describe(`End character position`),
});

const OpenDocumentArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file to open`),
  language_id: z.string().describe(`The programming language the file is written in`),
});

const CloseDocumentArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file to close`),
});

const GetDiagnosticsArgsSchema = z.object({
  file_path: z.string().optional().describe(`Path to the file to get diagnostics for. If not provided, returns diagnostics for all open files.`),
});

const SetLogLevelArgsSchema = z.object({
  level: z.enum(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'])
    .describe("The logging level to set")
});

const RestartLSPServerArgsSchema = z.object({
  root_dir: z.string().optional().describe("The root directory for the LSP server. If not provided, the server will not be initialized automatically."),
});

const StartLSPArgsSchema = z.object({
  root_dir: z.string().describe("The root directory for the LSP server"),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// We'll create the LSP client but won't initialize it until start_lsp is called
let lspClient: LSPClient;
let rootDir = "."; // Default to current directory

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
      resources: {
        templates: [
          {
            name: "lsp-diagnostics",
            scheme: "lsp-diagnostics",
            pattern: "lsp-diagnostics://{file_path}",
            description: "Get diagnostic messages (errors, warnings) for a specific file or all files",
            subscribe: true,
          }
        ]
      },
      logging: {},
    },
  },
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debug("Handling ListTools request");
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
        name: "get_code_actions",
        description: "Get code actions for a specific range in a file",
        inputSchema: zodToJsonSchema(GetCodeActionsArgsSchema) as ToolInput,
      },
      {
        name: "restart_lsp_server",
        description: "Restart the LSP server process",
        inputSchema: zodToJsonSchema(RestartLSPServerArgsSchema) as ToolInput,
      },
      {
        name: "start_lsp",
        description: "Start the LSP server with a specified root directory",
        inputSchema: zodToJsonSchema(StartLSPArgsSchema) as ToolInput,
      },
      {
        name: "open_document",
        description: "Open a file in the LSP server for analysis",
        inputSchema: zodToJsonSchema(OpenDocumentArgsSchema) as ToolInput,
      },
      {
        name: "close_document",
        description: "Close a file in the LSP server",
        inputSchema: zodToJsonSchema(CloseDocumentArgsSchema) as ToolInput,
      },
      {
        name: "get_diagnostics",
        description: "Get diagnostic messages (errors, warnings) for files",
        inputSchema: zodToJsonSchema(GetDiagnosticsArgsSchema) as ToolInput,
      },
      {
        name: "set_log_level",
        description: "Set the server logging level",
        inputSchema: zodToJsonSchema(SetLogLevelArgsSchema) as ToolInput,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    debug(`Handling CallTool request for tool: ${name}`);

    switch (name) {
      case "get_info_on_location": {
        const parsed = GetInfoOnLocationArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_info_on_location: ${parsed.error}`);
        }

        debug(`Getting info on location in file: ${parsed.data.file_path} (${parsed.data.line}:${parsed.data.character})`);

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        // Read the file content
        const fileContent = await fs.readFile(parsed.data.file_path, 'utf-8');

        // Create a file URI
        const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient.openDocument(fileUri, fileContent, parsed.data.language_id);

        // Get information at the location
        const text = await lspClient.getInfoOnLocation(fileUri, {
          line: parsed.data.line - 1, // LSP is 0-based
          character: parsed.data.character - 1
        });

        debug(`Returned info on location: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);

        return {
          content: [{ type: "text", text }],
        };
      }

      case "get_completions": {
        const parsed = GetCompletionsArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_completions: ${parsed.error}`);
        }

        debug(`Getting completions in file: ${parsed.data.file_path} (${parsed.data.line}:${parsed.data.character})`);

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        // Read the file content
        const fileContent = await fs.readFile(parsed.data.file_path, 'utf-8');

        // Create a file URI
        const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient.openDocument(fileUri, fileContent, parsed.data.language_id);

        // Get completions at the location
        const completions = await lspClient.getCompletion(fileUri, {
          line: parsed.data.line - 1, // LSP is 0-based
          character: parsed.data.character - 1
        });

        debug(`Returned ${completions.length} completions`);

        return {
          content: [{ type: "text", text: JSON.stringify(completions, null, 2) }],
        };
      }

      case "get_code_actions": {
        const parsed = GetCodeActionsArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_code_actions: ${parsed.error}`);
        }

        debug(`Getting code actions in file: ${parsed.data.file_path} (${parsed.data.start_line}:${parsed.data.start_character} to ${parsed.data.end_line}:${parsed.data.end_character})`);

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        // Read the file content
        const fileContent = await fs.readFile(parsed.data.file_path, 'utf-8');

        // Create a file URI
        const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient.openDocument(fileUri, fileContent, parsed.data.language_id);

        // Get code actions for the range
        const codeActions = await lspClient.getCodeActions(fileUri, {
          start: {
            line: parsed.data.start_line - 1, // LSP is 0-based
            character: parsed.data.start_character - 1
          },
          end: {
            line: parsed.data.end_line - 1,
            character: parsed.data.end_character - 1
          }
        });

        debug(`Returned ${codeActions.length} code actions`);

        return {
          content: [{ type: "text", text: JSON.stringify(codeActions, null, 2) }],
        };
      }

      case "restart_lsp_server": {
        const parsed = RestartLSPServerArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for restart_lsp_server: ${parsed.error}`);
        }

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        // Get the root directory from args or use the stored one
        const restartRootDir = parsed.data.root_dir || rootDir;

        info(`Restarting LSP server${parsed.data.root_dir ? ` with root directory: ${parsed.data.root_dir}` : ''}...`);

        try {
          // If root_dir is provided, update the stored rootDir
          if (parsed.data.root_dir) {
            rootDir = parsed.data.root_dir;
          }

          // Restart with the root directory
          await lspClient.restart(restartRootDir);

          return {
            content: [{
              type: "text",
              text: parsed.data.root_dir
                ? `LSP server successfully restarted and initialized with root directory: ${parsed.data.root_dir}`
                : "LSP server successfully restarted"
            }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error restarting LSP server: ${errorMessage}`);
          throw new Error(`Failed to restart LSP server: ${errorMessage}`);
        }
      }

      case "start_lsp": {
        const parsed = StartLSPArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for start_lsp: ${parsed.error}`);
        }

        info(`Starting LSP server with root directory: ${parsed.data.root_dir}`);

        try {
          rootDir = parsed.data.root_dir;

          // Create LSP client if it doesn't exist
          if (!lspClient) {
            lspClient = new LSPClient(lspServerPath, lspServerArgs);
          }

          // Initialize with the specified root directory
          await lspClient.initialize(rootDir);

          return {
            content: [{ type: "text", text: `LSP server successfully started with root directory: ${rootDir}` }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error starting LSP server: ${errorMessage}`);
          throw new Error(`Failed to start LSP server: ${errorMessage}`);
        }
      }

      case "open_document": {
        const parsed = OpenDocumentArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for open_document: ${parsed.error}`);
        }

        debug(`Opening document: ${parsed.data.file_path}`);

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        try {
          // Read the file content
          const fileContent = await fs.readFile(parsed.data.file_path, 'utf-8');

          // Create a file URI
          const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

          // Open the document in the LSP server
          await lspClient.openDocument(fileUri, fileContent, parsed.data.language_id);

          return {
            content: [{ type: "text", text: `File successfully opened: ${parsed.data.file_path}` }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error opening document: ${errorMessage}`);
          throw new Error(`Failed to open document: ${errorMessage}`);
        }
      }

      case "close_document": {
        const parsed = CloseDocumentArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for close_document: ${parsed.error}`);
        }

        debug(`Closing document: ${parsed.data.file_path}`);

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        try {
          // Create a file URI
          const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

          // Use the closeDocument method
          await lspClient.closeDocument(fileUri);

          return {
            content: [{ type: "text", text: `File successfully closed: ${parsed.data.file_path}` }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error closing document: ${errorMessage}`);
          throw new Error(`Failed to close document: ${errorMessage}`);
        }
      }

      case "get_diagnostics": {
        const parsed = GetDiagnosticsArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_diagnostics: ${parsed.error}`);
        }

        // Check if LSP client is initialized
        if (!lspClient) {
          throw new Error("LSP server not started. Call start_lsp first with a root directory.");
        }

        try {
          // Get diagnostics for a specific file or all files
          if (parsed.data.file_path) {
            // For a specific file
            console.log(`Getting diagnostics for file: ${parsed.data.file_path}`);
            const fileUri = `file://${path.resolve(parsed.data.file_path)}`;

            // Verify the file is open
            if (!lspClient.isDocumentOpen(fileUri)) {
              throw new Error(`File ${parsed.data.file_path} is not open. Please open the file with open_document before requesting diagnostics.`);
            }

            const diagnostics = lspClient.getDiagnostics(fileUri);

            return {
              content: [{
                type: "text",
                text: JSON.stringify({ [fileUri]: diagnostics }, null, 2)
              }],
            };
          } else {
            // For all files
            debug("Getting diagnostics for all files");
            const allDiagnostics = lspClient.getAllDiagnostics();

            // Convert Map to object for JSON serialization
            const diagnosticsObject: Record<string, any[]> = {};
            allDiagnostics.forEach((value, key) => {
              // Only include diagnostics for open files
              if (lspClient.isDocumentOpen(key)) {
                diagnosticsObject[key] = value;
              }
            });

            return {
              content: [{
                type: "text",
                text: JSON.stringify(diagnosticsObject, null, 2)
              }],
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error getting diagnostics: ${errorMessage}`);
          throw new Error(`Failed to get diagnostics: ${errorMessage}`);
        }
      }

      case "set_log_level": {
        const parsed = SetLogLevelArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for set_log_level: ${parsed.error}`);
        }

        // Set the log level
        const { level } = parsed.data;
        setLogLevel(level);

        return {
          content: [{ type: "text", text: `Log level set to: ${level}` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling tool request: ${errorMessage}`);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Ensure log file is closed properly on process exit
process.on('exit', async () => {
  info("Shutting down MCP server...");
  try {
    await lspClient.shutdown();
  } catch (error) {
    warning("Error during shutdown:", error);
  }

  if (logStream) {
    log('info', "LSP MCP Server exited");
    logStream.end();
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

// Resource handler for diagnostics
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  try {
    debug(`Handling ReadResource request for URI: ${request.params.uri}`);
    const uri = request.params.uri;

    // Parse the lsp-diagnostics URI
    if (uri.startsWith('lsp-diagnostics://')) {
      // Check if LSP client is initialized
      if (!lspClient) {
        throw new Error("LSP server not started. Call start_lsp first with a root directory.");
      }

      // Extract the file path parameter from the URI
      // lsp-diagnostics:// is 18 characters
      const filePath = uri.slice(18);

      let diagnosticsContent: string;

      if (filePath) {
        // For a specific file
        debug(`Getting diagnostics for file: ${filePath}`);
        const fileUri = `file://${path.resolve(filePath)}`;

        // Verify the file is open
        if (!lspClient.isDocumentOpen(fileUri)) {
          throw new Error(`File ${filePath} is not open. Please open the file with open_document before requesting diagnostics.`);
        }

        const diagnostics = lspClient.getDiagnostics(fileUri);
        diagnosticsContent = JSON.stringify({ [fileUri]: diagnostics }, null, 2);
      } else {
        // For all files
        debug("Getting diagnostics for all files");
        const allDiagnostics = lspClient.getAllDiagnostics();

        // Convert Map to object for JSON serialization
        const diagnosticsObject: Record<string, any[]> = {};
        allDiagnostics.forEach((value, key) => {
          // Only include diagnostics for open files
          if (lspClient.isDocumentOpen(key)) {
            diagnosticsObject[key] = value;
          }
        });

        diagnosticsContent = JSON.stringify(diagnosticsObject, null, 2);
      }

      return {
        content: [{ type: "text", text: diagnosticsContent }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Error handling resource request: ${errorMessage}`);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Resource subscription handler
server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  try {
    const { uri } = request.params;
    debug(`Handling SubscribeResource request for URI: ${uri}`);

    if (uri.startsWith('lsp-diagnostics://')) {
      // Check if LSP client is initialized
      if (!lspClient) {
        throw new Error("LSP server not started. Call start_lsp first with a root directory.");
      }

      // Extract the file path parameter from the URI
      const filePath = uri.slice(18);

      if (filePath) {
        // Subscribe to a specific file
        const fileUri = `file://${path.resolve(filePath)}`;

        // Verify the file is open
        if (!lspClient.isDocumentOpen(fileUri)) {
          throw new Error(`File ${filePath} is not open. Please open the file with open_document before subscribing to diagnostics.`);
        }

        debug(`Subscribing to diagnostics for file: ${filePath}`);

        // Set up the subscription callback
        const callback: DiagnosticUpdateCallback = (diagUri, diagnostics) => {
          if (diagUri === fileUri) {
            // Send resource update to clients
            server.notification({
              method: "notifications/resources/update",
              params: {
                uri,
                content: [{ type: "text", text: JSON.stringify({ [diagUri]: diagnostics }, null, 2) }]
              }
            });
          }
        };

        // Store the callback in the subscription context for later use with unsubscribe
        const subscriptionContext: SubscriptionContext = { callback };

        // Subscribe to diagnostics
        lspClient.subscribeToDiagnostics(callback);

        return {
          ok: true,
          context: subscriptionContext
        };
      } else {
        // Subscribe to all files
        debug("Subscribing to diagnostics for all files");

        // Set up the subscription callback for all files
        const callback: DiagnosticUpdateCallback = (diagUri, diagnostics) => {
          // Only send updates for open files
          if (lspClient.isDocumentOpen(diagUri)) {
            // Get all open documents' diagnostics
            const allDiagnostics = lspClient.getAllDiagnostics();

            // Convert Map to object for JSON serialization
            const diagnosticsObject: Record<string, any[]> = {};
            allDiagnostics.forEach((diagValue, diagKey) => {
              // Only include diagnostics for open files
              if (lspClient.isDocumentOpen(diagKey)) {
                diagnosticsObject[diagKey] = diagValue;
              }
            });

            // Send resource update to clients
            server.notification({
              method: "notifications/resources/update",
              params: {
                uri,
                content: [{ type: "text", text: JSON.stringify(diagnosticsObject, null, 2) }]
              }
            });
          }
        };

        // Store the callback in the subscription context for later use with unsubscribe
        const subscriptionContext: SubscriptionContext = { callback };

        // Subscribe to diagnostics
        lspClient.subscribeToDiagnostics(callback);

        return {
          ok: true,
          context: subscriptionContext
        };
      }
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

    if (uri.startsWith('lsp-diagnostics://') && context && (context as SubscriptionContext).callback) {
      // Check if LSP client is initialized
      if (!lspClient) {
        throw new Error("LSP server not started. Call start_lsp first with a root directory.");
      }

      // Unsubscribe the callback
      lspClient.unsubscribeFromDiagnostics((context as SubscriptionContext).callback);
      debug(`Unsubscribed from diagnostics for URI: ${uri}`);

      return { ok: true };
    }

    throw new Error(`Unknown resource URI or invalid context: ${uri}`);
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

    // Check if LSP client is initialized
    if (!lspClient) {
      return { resources: [] }; // Return empty list if LSP is not initialized
    }

    // List all diagnostic resources (one for each open file)
    const resources = [];

    // Add the "all diagnostics" resource
    resources.push({
      uri: "lsp-diagnostics://",
      name: "All diagnostics",
      description: "Diagnostics for all open files",
      subscribe: true,
    });

    // For each open document, add a resource
    lspClient.getOpenDocuments().forEach(uri => {
      if (uri.startsWith('file://')) {
        const filePath = uri.slice(7); // Remove 'file://' prefix
        resources.push({
          uri: `lsp-diagnostics://${filePath}`,
          name: `Diagnostics for ${path.basename(filePath)}`,
          description: `LSP diagnostics for ${filePath}`,
          subscribe: true,
        });
      }
    });

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

// Start server
async function runServer() {
  info("Starting LSP MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  notice("LSP MCP Server running on stdio");
  info("Using LSP server:", lspServerPath);
  if (lspServerArgs.length > 0) {
    info("With arguments:", lspServerArgs.join(' '));
  }
  if (logFilePath) {
    info(`Logging to file: ${logFilePath}`);
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
