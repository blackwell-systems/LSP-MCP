import { spawn } from "child_process";
import path from "path";
import * as fs from "fs/promises";
import {
  LSPMessage,
  DiagnosticUpdateCallback,
  LoggingLevel,
} from "./types/index.js";
import {
  debug,
  info,
  notice,
  warning,
  log,
  error,
} from "./logging/index.js";

export class LSPClient {
  private process: any;
  private buffer: string = "";
  private messageQueue: LSPMessage[] = [];
  private nextId: number = 1;
  private responsePromises: Map<
    string | number,
    { resolve: Function; reject: Function }
  > = new Map();
  private initialized: boolean = false;
  private serverCapabilities: any = null;
  private lspServerPath: string;
  private lspServerArgs: string[];
  private openedDocuments: Set<string> = new Set();
  private documentVersions: Map<string, number> = new Map();
  private processingQueue: boolean = false;
  private documentDiagnostics: Map<string, any[]> = new Map();
  private diagnosticSubscribers: Set<DiagnosticUpdateCallback> = new Set();

  // Track file metadata for reopening
  private filePaths: Map<string, string> = new Map(); // uri -> originalPath
  private fileLanguageIds: Map<string, string> = new Map(); // uri -> languageId

  // Track gopls workspace loading progress
  private activeProgressTokens: Set<string | number> = new Set();
  private workspaceReadyResolvers: Array<() => void> = [];

  constructor(lspServerPath: string, lspServerArgs: string[] = []) {
    this.lspServerPath = lspServerPath;
    this.lspServerArgs = lspServerArgs;
    // Don't start the process automatically - it will be started when needed
  }

  private startProcess(): void {
    info(`Starting LSP client with binary: ${this.lspServerPath}`);
    info(`Using LSP server arguments: ${this.lspServerArgs.join(" ")}`);
    this.process = spawn(this.lspServerPath, this.lspServerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
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

    // Implement a safety limit to prevent excessive buffer growth
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB limit
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      error(
        `Buffer size exceeded ${MAX_BUFFER_SIZE} bytes, discarding entire buffer to prevent mid-message parse`,
      );
      this.buffer = "";
    }

    // Process complete messages
    while (true) {
      // Look for the standard LSP header format - this captures the entire header including the \r\n\r\n
      const headerMatch = this.buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1], 10);
      const headerEnd = headerMatch[0].length;

      // Prevent processing unreasonably large messages
      if (contentLength > MAX_BUFFER_SIZE) {
        error(
          `Received message with content length ${contentLength} exceeds maximum size, skipping`,
        );
        this.buffer = this.buffer.substring(headerEnd + contentLength);
        continue;
      }

      // Check if we have the complete message (excluding the header)
      if (this.buffer.length < headerEnd + contentLength) break; // Message not complete yet

      // Extract the message content - using exact content length without including the header
      let content = this.buffer.substring(headerEnd, headerEnd + contentLength);
      // Make the parsing more robust by ensuring content ends with a closing brace
      if (content[content.length - 1] !== "}") {
        debug("Content doesn't end with '}', adjusting...");
        const lastBraceIndex = content.lastIndexOf("}");
        if (lastBraceIndex !== -1) {
          const actualContentLength = lastBraceIndex + 1;
          debug(
            `Adjusted content length from ${contentLength} to ${actualContentLength}`,
          );
          content = content.substring(0, actualContentLength);
          // Update buffer position based on actual content length
          this.buffer = this.buffer.substring(headerEnd + actualContentLength);
        } else {
          debug("No closing brace found, using original content length");
          // No closing brace found, use original approach
          this.buffer = this.buffer.substring(headerEnd + contentLength);
        }
      } else {
        debug("Content ends with '}', no adjustment needed");
        // Content looks good, remove precisely this processed message from buffer
        this.buffer = this.buffer.substring(headerEnd + contentLength);
      }

      // Parse the message and add to queue
      try {
        const message = JSON.parse(content) as LSPMessage;
        this.messageQueue.push(message);
        this.processMessageQueue().catch((err) =>
          error("Unhandled error in processMessageQueue:", err)
        );
      } catch (err) {
        error("Failed to parse LSP message:", err);
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
      const direction = "RECEIVED";
      const messageStr = JSON.stringify(message, null, 2);
      // Use method to determine log level if available, otherwise use debug
      const method = message.method || "";
      const logLevel = this.getLSPMethodLogLevel(method);
      log(logLevel, `LSP ${direction} (${method}): ${messageStr}`);
    } catch (err) {
      warning("Error logging LSP message:", err);
    }

    this.handleServerResponse(message);
    await this.handleNotification(message);
    await this.handleServerRequest(message);
  }

  private handleServerResponse(message: LSPMessage): void {
    // Handle response messages
    if (
      "id" in message &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const promise = this.responsePromises.get(message.id!);
      if (promise) {
        if (message.error) {
          const err = message.error as any;
          // Log known LSP error codes at appropriate levels (§3.6)
          if (err?.code === -32601) {
            warning(`LSP method not supported by server (MethodNotFound): ${JSON.stringify(err)}`);
          } else if (err?.code === -32002) {
            warning(`LSP server not yet initialized (ServerNotInitialized): ${JSON.stringify(err)}`);
          } else {
            debug(`LSP error response: ${JSON.stringify(err)}`);
          }
          promise.reject(message.error);
        } else {
          promise.resolve(message.result);
        }
        this.responsePromises.delete(message.id!);
      }
    }

    // Store server capabilities from initialize response
    if ("id" in message && message.result && typeof message.result === 'object' && message.result !== null && 'capabilities' in message.result) {
      this.serverCapabilities = (message.result as any).capabilities;
      notice(
        `LSP Server Capabilities: ${JSON.stringify(this.serverCapabilities, null, 2)}`,
      );
    }
  }

  private async handleNotification(message: LSPMessage): Promise<void> {
    // Handle notification messages
    if ("method" in message && message.id === undefined) {
      // Handle diagnostic notifications
      if (
        message.method === "textDocument/publishDiagnostics" &&
        message.params
      ) {
        const { uri, diagnostics } = message.params;

        if (typeof uri === 'string' && Array.isArray(diagnostics)) {
          const severity =
            diagnostics.length > 0
              ? Math.min(...diagnostics.map((d) => d.severity || 4))
              : 4;

          // Map LSP severity to our log levels
          const severityToLevel: Record<number, string> = {
            1: "error", // Error
            2: "warning", // Warning
            3: "info", // Information
            4: "debug", // Hint
          };

          const level = severityToLevel[severity] || "debug";

          log(
            level as any,
            `Received ${diagnostics.length} diagnostics for ${uri}`,
          );

          // Store diagnostics, replacing any previous ones for this URI
          this.documentDiagnostics.set(uri, diagnostics);

          // Notify all subscribers about this update
          this.notifyDiagnosticUpdate(uri, diagnostics);
        }
      }

      // Handle workspace loading progress (gopls signals readiness via $/progress)
      if (message.method === "$/progress" && message.params) {
        const { token, value } = message.params;
        if (value && typeof value === 'object' && value !== null && 'kind' in value) {
          const progressValue = value as any;
          if (progressValue.kind === "begin") {
            debug(`Progress begin: token=${token} title="${progressValue.title ?? ''}"`);
            this.activeProgressTokens.add(token as string | number);
          } else if (progressValue.kind === "report") {
            debug(`Progress report: token=${token} message="${progressValue.message ?? ''}" percentage=${progressValue.percentage ?? ''}`);
          } else if (progressValue.kind === "end") {
            debug(`Progress end: token=${token}`);
            this.activeProgressTokens.delete(token as string | number);
            if (this.activeProgressTokens.size === 0 && this.workspaceReadyResolvers.length > 0) {
              info("Workspace loading complete — resolving pending reference waiters");
              const resolvers = this.workspaceReadyResolvers.splice(0);
              for (const resolve of resolvers) resolve();
            }
          }
        }
      }
    }
  }

  private async handleServerRequest(message: LSPMessage): Promise<void> {
    // Handle server-initiated requests (have id but originate from server, not responses)
    if ("method" in message && "id" in message) {
      let result: any = null;

      if (message.method === "window/workDoneProgress/create") {
        // Pre-register the progress token so $/progress begin/end handlers recognize it (§3.18)
        const token = (message.params as any)?.token;
        if (token !== undefined) {
          this.activeProgressTokens.add(token);
          debug(`Pre-registered progress token=${token} id=${message.id}`);
        } else {
          debug(`Acknowledged window/workDoneProgress/create id=${message.id}`);
        }
        result = null;
      } else if (message.method === "workspace/configuration") {
        // Return null for each requested config item — gopls uses this to fetch settings.
        // Without a response gopls blocks and workspace loading never completes.
        const items = (message.params && typeof message.params === 'object' && 'items' in message.params && Array.isArray((message.params as any).items)) ? (message.params as any).items : [];
        result = items.map(() => null);
        debug(`Responded to workspace/configuration with ${items.length} null item(s) id=${message.id}`);
      } else if (message.method === "client/registerCapability") {
        // Acknowledge dynamic capability registration
        debug(`Acknowledged client/registerCapability id=${message.id}`);
        result = null;
      } else {
        // Unknown server request — send null to unblock gopls
        debug(`Unknown server-initiated request: ${message.method} id=${message.id}, responding null`);
        result = null;
      }

      const content = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
      this.process.stdin.write(header + content);
    }
  }

  private getLSPMethodLogLevel(method: string): LoggingLevel {
    // Define appropriate log levels for different LSP methods
    if (method.startsWith("textDocument/did")) {
      return "debug"; // Document changes are usually debug level
    }

    if (
      method.includes("diagnostic") ||
      method.includes("publishDiagnostics")
    ) {
      return "info"; // Diagnostics depend on their severity, but base level is info
    }

    if (
      method === "initialize" ||
      method === "initialized" ||
      method === "shutdown" ||
      method === "exit"
    ) {
      return "notice"; // Important lifecycle events are notice level
    }

    // Default to info level for easier debugging
    return "info";
  }

  // Timeout per request type (ms). References require full workspace indexing.
  private static readonly REQUEST_TIMEOUTS: Record<string, number> = {
    "textDocument/references": 120000,
    "textDocument/hover": 30000,
    "textDocument/completion": 30000,
    "textDocument/codeAction": 30000,
  };
  private static readonly DEFAULT_REQUEST_TIMEOUT = 30000;

  private sendRequest<T>(method: string, params?: any): Promise<T> {
    // Check if the process is started
    if (!this.process) {
      return Promise.reject(new Error("LSP server not initialized yet"));
    }

    const id = this.nextId++;
    const request: LSPMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    // Log the request with appropriate level
    try {
      const direction = "SENT";
      const requestStr = JSON.stringify(request, null, 2);
      const logLevel = this.getLSPMethodLogLevel(method);
      log(logLevel as any, `LSP ${direction} (${method}): ${requestStr}`);
    } catch (err) {
      warning("Error logging LSP request:", err);
    }

    const promise = new Promise<T>((resolve, reject) => {
      // Set timeout for request
      const timeoutMs = LSPClient.REQUEST_TIMEOUTS[method] ?? LSPClient.DEFAULT_REQUEST_TIMEOUT;
      const timeoutId = setTimeout(() => {
        if (this.responsePromises.has(id)) {
          this.responsePromises.delete(id);
          reject(
            new Error(`Timeout waiting for response to ${method} request (${timeoutMs}ms)`),
          );
        }
      }, timeoutMs);

      // Store promise with cleanup for timeout
      this.responsePromises.set(id, {
        resolve: (result: T) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error: any) => {
          clearTimeout(timeoutId);
          reject(error);
        },
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
      console.error("LSP server not initialized yet");
      return;
    }

    const notification: LSPMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };

    // Log the notification with appropriate level
    try {
      const direction = "SENT";
      const notificationStr = JSON.stringify(notification, null, 2);
      const logLevel = this.getLSPMethodLogLevel(method);
      log(logLevel as any, `LSP ${direction} (${method}): ${notificationStr}`);
    } catch (err) {
      warning("Error logging LSP notification:", err);
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
      const resolvedRootDir = path.resolve(rootDirectory);
      await this.sendRequest("initialize", {
        processId: process.pid,
        clientInfo: {
          name: "lsp-mcp-server",
          version: "0.3.0",
        },
        rootUri: "file://" + resolvedRootDir,
        workspaceFolders: [
          {
            uri: "file://" + resolvedRootDir,
            name: path.basename(resolvedRootDir),
          },
        ],
        initializationOptions: {
          preferences: {
            includeCompletionsForModuleExports: true,
            includeCompletionsWithInsertText: true,
          },
          tsserver: {
            useSeparateSyntaxServer: false,
          },
        },
        capabilities: {
          textDocument: {
            hover: {
              contentFormat: ["markdown", "plaintext"],
            },
            completion: {
              completionItem: {
                snippetSupport: false,
              },
            },
            references: {},
            definition: {},
            implementation: {},
            typeDefinition: {},
            codeAction: {
              dynamicRegistration: true,
            },
            diagnostic: {
              dynamicRegistration: false,
            },
            publishDiagnostics: {
              relatedInformation: true,
              versionSupport: false,
              tagSupport: {
                valueSet: [1, 2], // Unnecessary and Deprecated
              },
              codeDescriptionSupport: true,
              dataSupport: true,
            },
          },
          workspace: {
            configuration: true,
            didChangeConfiguration: {
              dynamicRegistration: true,
            },
            didChangeWatchedFiles: {
              dynamicRegistration: true,
            },
          },
          window: {
            workDoneProgress: true,
          },
        },
      });

      this.sendNotification("initialized", {});
      this.initialized = true;
      notice("LSP connection initialized successfully");
    } catch (err) {
      error("Failed to initialize LSP connection:", err);
      throw error;
    }
  }

  async openDocument(
    uri: string,
    text: string,
    languageId: string,
  ): Promise<void> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP server not initialized yet");
    }

    // If document is already open, update it instead of reopening
    if (this.openedDocuments.has(uri)) {
      // Get current version and increment
      const currentVersion = this.documentVersions.get(uri) || 1;
      const newVersion = currentVersion + 1;

      debug(
        `Document already open, updating content: ${uri} (version ${newVersion})`,
      );
      this.sendNotification("textDocument/didChange", {
        textDocument: {
          uri,
          version: newVersion,
        },
        contentChanges: [
          {
            text, // Full document update
          },
        ],
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
        text,
      },
    });

    // Mark document as open and initialize version
    this.openedDocuments.add(uri);
    this.documentVersions.set(uri, 1);

    // Store metadata for future reopening
    if (!this.filePaths.has(uri)) {
      // Extract original file path from URI for later reopening
      const originalPath = uri.replace(/^file:\/\//, "");
      this.filePaths.set(uri, originalPath);
    }
    this.fileLanguageIds.set(uri, languageId);
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
      throw new Error("LSP server not initialized yet");
    }

    // Only close if document is open
    if (this.openedDocuments.has(uri)) {
      debug(`Closing document: ${uri}`);
      this.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });

      // Remove from tracking
      this.openedDocuments.delete(uri);
      this.documentVersions.delete(uri);

      // Remove from file tracking maps
      this.filePaths.delete(uri);
      this.fileLanguageIds.delete(uri);
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
    this.diagnosticSubscribers.forEach((callback) => {
      try {
        callback(uri, diagnostics);
      } catch (err) {
        warning("Error in diagnostic subscriber callback:", err);
      }
    });
  }

  // Clear all diagnostic subscribers
  clearDiagnosticSubscribers(): void {
    this.diagnosticSubscribers.clear();
  }

  private getOverlappingDiagnostics(
    uri: string,
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    },
  ): any[] {
    const diagnostics = this.documentDiagnostics.get(uri) ?? [];
    return diagnostics.filter((d) => {
      if (!d.range) return false;
      const dStart = d.range.start;
      const dEnd = d.range.end;
      // Overlap: d starts before range ends, AND d ends after range starts
      const startsBeforeRangeEnd =
        dStart.line < range.end.line ||
        (dStart.line === range.end.line && dStart.character <= range.end.character);
      const endsAfterRangeStart =
        dEnd.line > range.start.line ||
        (dEnd.line === range.start.line && dEnd.character >= range.start.character);
      return startsBeforeRangeEnd && endsAfterRangeStart;
    });
  }

  async getInfoOnLocation(
    uri: string,
    position: { line: number; character: number },
  ): Promise<string> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP server not initialized yet");
    }

    debug(
      `Getting info on location: ${uri} (${position.line}:${position.character})`,
    );

    if (!this.serverCapabilities?.hoverProvider) {
      debug("Server does not declare hoverProvider capability — skipping hover request");
      return "";
    }

    try {
      // Use hover request to get information at the position
      const response = await this.sendRequest<any>("textDocument/hover", {
        textDocument: { uri },
        position,
      });

      if (response?.contents) {
        if (typeof response.contents === "string") {
          // Deprecated MarkedString plain string form
          return response.contents;
        } else if (Array.isArray(response.contents)) {
          // Deprecated MarkedString[] form
          return response.contents
            .map((item: any) =>
              typeof item === "string" ? item : item.value || "",
            )
            .join("\n");
        } else if (response.contents.kind === "markdown" || response.contents.kind === "plaintext") {
          // MarkupContent form (§3.15.11) — kind distinguishes rendering intent
          return response.contents.value || "";
        } else if (response.contents.value) {
          // Deprecated MarkedString object form { language, value }
          return response.contents.value;
        }
      }
    } catch (err) {
      warning(
        `Error getting hover information: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return "";
  }

  async getCompletion(
    uri: string,
    position: { line: number; character: number },
  ): Promise<any[]> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP server not initialized yet");
    }

    debug(
      `Getting completions at location: ${uri} (${position.line}:${position.character})`,
    );

    if (!this.serverCapabilities?.completionProvider) {
      debug("Server does not declare completionProvider capability — skipping completion request");
      return [];
    }

    try {
      const response = await this.sendRequest<any>("textDocument/completion", {
        textDocument: { uri },
        position,
      });

      if (Array.isArray(response)) {
        return response;
      } else if (response?.items && Array.isArray(response.items)) {
        return response.items;
      }
    } catch (err) {
      warning(
        `Error getting completions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return [];
  }

  async getCodeActions(
    uri: string,
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    },
  ): Promise<any[]> {
    // Check if initialized, but don't auto-initialize
    if (!this.initialized) {
      throw new Error("LSP server not initialized yet");
    }

    debug(
      `Getting code actions for range: ${uri} (${range.start.line}:${range.start.character} to ${range.end.line}:${range.end.character})`,
    );

    if (!this.serverCapabilities?.codeActionProvider) {
      debug("Server does not declare codeActionProvider capability — skipping code action request");
      return [];
    }

    try {
      const response = await this.sendRequest<any>("textDocument/codeAction", {
        textDocument: { uri },
        range,
        context: {
          diagnostics: this.getOverlappingDiagnostics(uri, range),
        },
      });

      if (Array.isArray(response)) {
        return response;
      }
    } catch (err) {
      warning(
        `Error getting code actions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return [];
  }

  // Reopen a specific document to get latest content from disk
  async reopenDocument(uri: string): Promise<void> {
    const filePath = this.filePaths.get(uri);
    const languageId = this.fileLanguageIds.get(uri);

    debug(
      `Attempting to reopen document ${uri}: filePath=${filePath}, languageId=${languageId}`,
    );
    debug(
      `Current tracking maps - filePaths: ${JSON.stringify(Array.from(this.filePaths.entries()))}, fileLanguageIds: ${JSON.stringify(Array.from(this.fileLanguageIds.entries()))}`,
    );
    debug(
      `Currently open documents: ${Array.from(this.openedDocuments).join(", ")}`,
    );

    if (filePath && languageId) {
      debug(`Reopening document: ${uri}`);

      // Close the document first if it's open, but don't remove tracking info
      if (this.isDocumentOpen(uri)) {
        debug(`Document ${uri} is currently open, closing it first`);
        // Send close notification but preserve tracking
        this.sendNotification("textDocument/didClose", {
          textDocument: { uri },
        });

        // Remove from open tracking but preserve file metadata
        this.openedDocuments.delete(uri);
        this.documentVersions.delete(uri);
      } else {
        debug(`Document ${uri} is not currently open`);
      }

      // Read the file content from disk and reopen the document
      try {
        debug(`Reading file content from: ${filePath}`);
        const fileContent = await fs.readFile(filePath, "utf-8");
        debug(`File content length: ${fileContent.length} characters`);
        await this.openDocument(uri, fileContent, languageId);
        debug(`Successfully reopened document: ${uri}`);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        error(`Error reopening document ${uri}: ${errorMessage}`);
        throw new Error(`Failed to reopen document ${uri}: ${errorMessage}`);
      }
    } else {
      const errorMsg = `Cannot reopen document ${uri}: missing file path (${filePath}) or language ID (${languageId}) metadata`;
      error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  // Reopen all previously opened documents to get latest content
  async reopenAllDocuments(): Promise<void> {
    debug(`Reopening all documents (${this.filePaths.size} files)`);

    // Capture the URIs to avoid concurrent modification during iteration
    const urisToReopen = Array.from(this.filePaths.keys());

    if (urisToReopen.length === 0) {
      debug("No documents to reopen");
      return;
    }

    const reopenPromises = urisToReopen.map((uri) => this.reopenDocument(uri));

    try {
      await Promise.all(reopenPromises);
      debug(`Successfully reopened all ${reopenPromises.length} documents`);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      error(`Error reopening documents: ${errorMessage}`);
      throw new Error(`Failed to reopen some documents: ${errorMessage}`);
    }
  }

  // Wait for publishDiagnostics for a URI, then 1.5s of silence.
  // gopls runs a cross-package background load after the first publishDiagnostics;
  // the stability window lets that finish so cross-file references are available.
  async waitForFileIndexed(uri: string, timeoutMs: number = 15000): Promise<void> {
    const STABLE_DELAY = 1500;

    return new Promise<void>((resolve) => {
      let stabilityTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (reason: string) => {
        debug(`waitForFileIndexed: ${reason} for ${uri}`);
        this.unsubscribeFromDiagnostics(listener);
        clearTimeout(hardTimeout);
        if (stabilityTimer) clearTimeout(stabilityTimer);
        resolve();
      };

      const armStability = () => {
        if (stabilityTimer) clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(() => finish("stable"), STABLE_DELAY);
      };

      const listener = (notifUri: string, _diagnostics: any[]) => {
        if (notifUri !== uri) return;
        armStability();
      };

      const hardTimeout = setTimeout(() => finish("timed out"), timeoutMs);
      this.subscribeToDiagnostics(listener);

      // If already cached, arm stability immediately (file was indexed before)
      if (this.documentDiagnostics.has(uri)) {
        armStability();
      }
    });
  }

  private async waitForWorkspaceReady(timeoutMs: number = 60000): Promise<void> {
    if (this.activeProgressTokens.size === 0) return;
    info(`Waiting for gopls workspace loading (${this.activeProgressTokens.size} active token(s))...`);
    await Promise.race([
      new Promise<void>((resolve) => {
        this.workspaceReadyResolvers.push(resolve);
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for workspace loading")), timeoutMs),
      ),
    ]);
  }

  async getReferences(
    uri: string,
    position: { line: number; character: number },
    includeDeclaration: boolean = false,
  ): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> {
    if (!this.initialized) {
      throw new Error("LSP server not initialized yet");
    }

    debug(`Getting references at location: ${uri} (${position.line}:${position.character})`);

    if (!this.serverCapabilities?.referencesProvider) {
      debug("Server does not declare referencesProvider capability — skipping references request");
      return [];
    }

    try {
      await this.waitForWorkspaceReady();
      await this.waitForFileIndexed(uri);
      const response = await this.sendRequest<any>("textDocument/references", {
        textDocument: { uri },
        position,
        context: { includeDeclaration },
      });

      if (Array.isArray(response)) {
        return response;
      }
    } catch (err) {
      warning(`Error getting references: ${err instanceof Error ? err.message : String(err)}`);
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
            textDocument: { uri },
          });
        } catch (err) {
          warning(`Error closing document ${uri}:`, err);
        }
      }

      await this.sendRequest("shutdown");
      this.sendNotification("exit");
      this.initialized = false;
      this.openedDocuments.clear();
      notice("LSP connection shut down successfully");
    } catch (err) {
      error("Error shutting down LSP connection:", err);
    }
  }

  async restart(rootDirectory?: string): Promise<void> {
    info("Restarting LSP server...");

    // If initialized, try to shut down cleanly first
    if (this.initialized) {
      try {
        await this.shutdown();
      } catch (err) {
        warning("Error shutting down LSP server during restart:", err);
      }
    }

    // Kill the process if it's still running
    if (this.process && !this.process.killed) {
      try {
        this.process.kill();
        notice("Killed existing LSP process");
      } catch (err) {
        error("Error killing LSP process:", err);
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

    // Clear file tracking maps
    this.filePaths.clear();
    this.fileLanguageIds.clear();

    // Start a new process
    this.startProcess();

    // Initialize with the provided root directory or use the stored one
    if (rootDirectory) {
      await this.initialize(rootDirectory);
      notice(
        `LSP server restarted and initialized with root directory: ${rootDirectory}`,
      );
    } else {
      info(
        "LSP server restarted but not initialized. Please initialize the server before use.",
      );
    }
  }
}
