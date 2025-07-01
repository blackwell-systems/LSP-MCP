import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetInfoOnLocationArgsSchema,
  GetCompletionsArgsSchema,
  GetCodeActionsArgsSchema,
  OpenDocumentArgsSchema,
  CloseDocumentArgsSchema,
  GetDiagnosticsArgsSchema,
  SetLogLevelArgsSchema,
  ToolInput,
  ToolHandler
} from "../types/index.js";
import { LSPClient } from "../lspClient.js";
import { debug, info, logError, notice, warning, setLogLevel } from "../logging/index.js";
import { activateExtension, deactivateExtension, listActiveExtensions } from "../extensions/index.js";
import { waitForDiagnostics } from "../shared/waitForDiagnostics.js";

// Create a file URI from a file path
export const createFileUri = (filePath: string): string => {
  return `file://${path.resolve(filePath)}`;
};

// Check if LSP client is initialized
export const checkLspClientInitialized = (lspClient: LSPClient | null): void => {
  if (!lspClient) {
    throw new Error("LSP server not ready yet – initialization is still in progress or failed.");
  }
};

// Define handlers for each tool
export const getToolHandlers = (lspClient: LSPClient | null, lspServerPath: string, lspServerArgs: string[], setLspClient: (client: LSPClient) => void, rootDir: string, setRootDir: (dir: string) => void, server?: any) => {
  return {
    "get_info_on_location": {
      schema: GetInfoOnLocationArgsSchema,
      handler: async (args: any) => {
        debug(`Getting info on location in file: ${args.file_path} (${args.line}:${args.column})`);

        checkLspClientInitialized(lspClient);

        // Read the file content
        const fileContent = await fs.readFile(args.file_path, 'utf-8');

        // Create a file URI
        const fileUri = createFileUri(args.file_path);

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient!.openDocument(fileUri, fileContent, args.language_id);

        // Get information at the location
        const text = await lspClient!.getInfoOnLocation(fileUri, {
          line: args.line - 1, // LSP is 0-based
          character: args.column - 1
        });

        debug(`Returned info on location: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);

        return {
          content: [{ type: "text", text }],
        };
      }
    },

    "get_completions": {
      schema: GetCompletionsArgsSchema,
      handler: async (args: any) => {
        debug(`Getting completions in file: ${args.file_path} (${args.line}:${args.column})`);

        checkLspClientInitialized(lspClient);

        // Read the file content
        const fileContent = await fs.readFile(args.file_path, 'utf-8');

        // Create a file URI
        const fileUri = createFileUri(args.file_path);

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient!.openDocument(fileUri, fileContent, args.language_id);

        // Get completions at the location
        const completions = await lspClient!.getCompletion(fileUri, {
          line: args.line - 1, // LSP is 0-based
          character: args.column - 1
        });

        debug(`Returned ${completions.length} completions`);

        return {
          content: [{ type: "text", text: JSON.stringify(completions, null, 2) }],
        };
      }
    },

    "get_code_actions": {
      schema: GetCodeActionsArgsSchema,
      handler: async (args: any) => {
        debug(`Getting code actions in file: ${args.file_path} (${args.start_line}:${args.start_column} to ${args.end_line}:${args.end_column})`);

        checkLspClientInitialized(lspClient);

        // Read the file content
        const fileContent = await fs.readFile(args.file_path, 'utf-8');

        // Create a file URI
        const fileUri = createFileUri(args.file_path);

        // Open the document in the LSP server (won't reopen if already open)
        await lspClient!.openDocument(fileUri, fileContent, args.language_id);

        // Get code actions for the range
        const codeActions = await lspClient!.getCodeActions(fileUri, {
          start: {
            line: args.start_line - 1, // LSP is 0-based
            character: args.start_column - 1
          },
          end: {
            line: args.end_line - 1,
            character: args.end_column - 1
          }
        });

        debug(`Returned ${codeActions.length} code actions`);

        return {
          content: [{ type: "text", text: JSON.stringify(codeActions, null, 2) }],
        };
      }
    },


    "open_document": {
      schema: OpenDocumentArgsSchema,
      handler: async (args: any) => {
        debug(`Opening document: ${args.file_path}`);

        checkLspClientInitialized(lspClient);

        try {
          // Read the file content
          const fileContent = await fs.readFile(args.file_path, 'utf-8');

          // Create a file URI
          const fileUri = createFileUri(args.file_path);

          // Open the document in the LSP server
          await lspClient!.openDocument(fileUri, fileContent, args.language_id);

          return {
            content: [{ type: "text", text: `File successfully opened: ${args.file_path}` }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error opening document: ${errorMessage}`);
          throw new Error(`Failed to open document: ${errorMessage}`);
        }
      }
    },

    "close_document": {
      schema: CloseDocumentArgsSchema,
      handler: async (args: any) => {
        debug(`Closing document: ${args.file_path}`);

        checkLspClientInitialized(lspClient);

        try {
          // Create a file URI
          const fileUri = createFileUri(args.file_path);

          // Use the closeDocument method
          await lspClient!.closeDocument(fileUri);

          return {
            content: [{ type: "text", text: `File successfully closed: ${args.file_path}` }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logError(`Error closing document: ${errorMessage}`);
          throw new Error(`Failed to close document: ${errorMessage}`);
        }
      }
    },

    "get_diagnostics": {
      schema: GetDiagnosticsArgsSchema,
      handler: async (args: any) => {
        checkLspClientInitialized(lspClient);

        try {
          // Get diagnostics for a specific file or all files
          if (args.file_path) {
            // For a specific file
            debug(`Reopening and getting diagnostics for file: ${args.file_path}`);
            const fileUri = createFileUri(args.file_path);

            // Reopen the file to get the latest content
            await lspClient!.reopenDocument(fileUri);

            // Wait for diagnostics to stabilize
            await waitForDiagnostics(lspClient!, [fileUri]);

            const diagnostics = lspClient!.getDiagnostics(fileUri);

            return {
              content: [{
                type: "text",
                text: JSON.stringify({ [fileUri]: diagnostics }, null, 2)
              }],
            };
          } else {
            // For all files
            debug("Reopening all documents and getting diagnostics for all files");
            await lspClient!.reopenAllDocuments();
            
            // Get all open document URIs
            const openDocumentUris = lspClient!.getOpenDocuments();
            
            // Wait for diagnostics to stabilize for all open documents
            await waitForDiagnostics(lspClient!, openDocumentUris);
            
            const allDiagnostics = lspClient!.getAllDiagnostics();

            // Convert Map to object for JSON serialization
            const diagnosticsObject: Record<string, any[]> = {};
            allDiagnostics.forEach((value: any[], key: string) => {
              // Only include diagnostics for open files
              if (lspClient!.isDocumentOpen(key)) {
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
    },

    "set_log_level": {
      schema: SetLogLevelArgsSchema,
      handler: async (args: any) => {
        // Set the log level
        const { level } = args;
        setLogLevel(level);

        return {
          content: [{ type: "text", text: `Log level set to: ${level}` }],
        };
      }
    },
  };
};

// Get tool definitions for the server
export const getToolDefinitions = () => {
  return [
    {
      name: "get_info_on_location",
      description: "Get information on a specific location in a file via LSP hover. Use this tool to retrieve detailed type information, documentation, and other contextual details about symbols in your code. Particularly useful for understanding variable types, function signatures, and module documentation at a specific location in the code. Use this whenever you need to get a better idea on what a particular function is doing in that context.",
      inputSchema: zodToJsonSchema(GetInfoOnLocationArgsSchema) as ToolInput,
    },
    {
      name: "get_completions",
      description: "Get completion suggestions at a specific location in a file. Use this tool to retrieve code completion options based on the current context, including variable names, function calls, object properties, and more. Helpful for code assistance and auto-completion at a particular location. Use this when determining which functions you have available in a given package, for example when changing libraries.",
      inputSchema: zodToJsonSchema(GetCompletionsArgsSchema) as ToolInput,
    },
    {
      name: "get_code_actions",
      description: "Get code actions for a specific range in a file. Use this tool to obtain available refactorings, quick fixes, and other code modifications that can be applied to a selected code range. Examples include adding imports, fixing errors, or implementing interfaces.",
      inputSchema: zodToJsonSchema(GetCodeActionsArgsSchema) as ToolInput,
    },
    {
      name: "open_document",
      description: "Open a file in the LSP server for analysis. Use this tool before performing operations like getting diagnostics, hover information, or completions for a file. The file remains open for continued analysis until explicitly closed. The language_id parameter tells the server which language service to use (e.g., 'typescript', 'javascript', 'haskell'). The LSP server starts automatically on MCP launch.",
      inputSchema: zodToJsonSchema(OpenDocumentArgsSchema) as ToolInput,
    },
    {
      name: "close_document",
      description: "Close a file in the LSP server. Use this tool when you're done with a file to free up resources and reduce memory usage. It's good practice to close files that are no longer being actively analyzed, especially in long-running sessions or when working with large codebases.",
      inputSchema: zodToJsonSchema(CloseDocumentArgsSchema) as ToolInput,
    },
    {
      name: "get_diagnostics",
      description: "Get diagnostic messages (errors, warnings) for files. Use this tool to identify problems in code files such as syntax errors, type mismatches, or other issues detected by the language server. When used without a file_path, returns diagnostics for all open files.",
      inputSchema: zodToJsonSchema(GetDiagnosticsArgsSchema) as ToolInput,
    },
    {
      name: "set_log_level",
      description: "Set the server logging level. Use this tool to control the verbosity of logs generated by the LSP MCP server. Available levels from least to most verbose: emergency, alert, critical, error, warning, notice, info, debug. Increasing verbosity can help troubleshoot issues but may generate large amounts of output.",
      inputSchema: zodToJsonSchema(SetLogLevelArgsSchema) as ToolInput,
    },
  ];
};
