import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  GetInfoOnLocationArgsSchema,
  GetCompletionsArgsSchema,
  GetCodeActionsArgsSchema,
  GetReferencesArgsSchema,
  StartLspArgsSchema,
  OpenDocumentArgsSchema,
  CloseDocumentArgsSchema,
  GetDiagnosticsArgsSchema,
  SetLogLevelArgsSchema,
  GoToDefinitionArgsSchema,
  GetDocumentSymbolsArgsSchema,
  GetWorkspaceSymbolsArgsSchema,
  GetSignatureHelpArgsSchema,
  FormatDocumentArgsSchema,
  RenameSymbolArgsSchema,
  GoToTypeDefinitionArgsSchema,
  GoToImplementationArgsSchema,
  ExecuteCommandArgsSchema,
  ToolInput,
  ToolHandler
} from "../types/index.js";
import { LSPClient } from "../lspClient.js";
import { debug, info, error, notice, warning, setLogLevel } from "../logging/index.js";
import { activateExtension } from "../extensions/index.js";
import { waitForDiagnostics } from "../shared/waitForDiagnostics.js";

const RestartLspArgsSchema = z.object({
  root_dir: z.string().optional().describe(
    "Optional new project root directory. If omitted, restarts with the same root."
  ),
});

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

// Named handler functions
async function handleGetInfoOnLocation(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetInfoOnLocationArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting info on location in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const text = await lspClient!.getInfoOnLocation(fileUri, {
    line: args.line - 1,
    character: args.column - 1
  });
  debug(`Returned info on location: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);
  return { content: [{ type: "text", text }] };
}

async function handleGetCompletions(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetCompletionsArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting completions in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const completions = await lspClient!.getCompletion(fileUri, {
    line: args.line - 1,
    character: args.column - 1
  });
  debug(`Returned ${completions.length} completions`);
  return { content: [{ type: "text", text: JSON.stringify(completions, null, 2) }] };
}

async function handleGetCodeActions(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetCodeActionsArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting code actions in file: ${args.file_path} (${args.start_line}:${args.start_column} to ${args.end_line}:${args.end_column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const codeActions = await lspClient!.getCodeActions(fileUri, {
    start: {
      line: args.start_line - 1,
      character: args.start_column - 1
    },
    end: {
      line: args.end_line - 1,
      character: args.end_column - 1
    }
  });
  debug(`Returned ${codeActions.length} code actions`);
  return { content: [{ type: "text", text: JSON.stringify(codeActions, null, 2) }] };
}

async function handleOpenDocument(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof OpenDocumentArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Opening document: ${args.file_path}`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  try {
    const fileContent = await fs.readFile(args.file_path, 'utf-8');
    const fileUri = createFileUri(args.file_path);
    await lspClient!.openDocument(fileUri, fileContent, args.language_id);
    return { content: [{ type: "text", text: `File successfully opened: ${args.file_path}` }] };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error opening document: ${errorMessage}`);
    throw new Error(`Failed to open document: ${errorMessage}`);
  }
}

async function handleCloseDocument(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof CloseDocumentArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Closing document: ${args.file_path}`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  try {
    const fileUri = createFileUri(args.file_path);
    await lspClient!.closeDocument(fileUri);
    return { content: [{ type: "text", text: `File successfully closed: ${args.file_path}` }] };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error closing document: ${errorMessage}`);
    throw new Error(`Failed to close document: ${errorMessage}`);
  }
}

async function handleGetDiagnostics(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetDiagnosticsArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  try {
    if (args.file_path) {
      debug(`Reopening and getting diagnostics for file: ${args.file_path}`);
      const fileUri = createFileUri(args.file_path);
      await lspClient!.reopenDocument(fileUri);
      await waitForDiagnostics(lspClient!, [fileUri]);
      const diagnostics = lspClient!.getDiagnostics(fileUri);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ [fileUri]: diagnostics }, null, 2)
        }],
      };
    } else {
      debug("Reopening all documents and getting diagnostics for all files");
      await lspClient!.reopenAllDocuments();
      const openDocumentUris = lspClient!.getOpenDocuments();
      await waitForDiagnostics(lspClient!, openDocumentUris);
      const allDiagnostics = lspClient!.getAllDiagnostics();
      const diagnosticsObject: Record<string, any[]> = {};
      allDiagnostics.forEach((value: any[], key: string) => {
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
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error getting diagnostics: ${errorMessage}`);
    throw new Error(`Failed to get diagnostics: ${errorMessage}`);
  }
}

async function handleStartLsp(
  getLspClient: () => LSPClient | null,
  lspServerPath: string,
  lspServerArgs: string[],
  setLspClient: (client: LSPClient) => void,
  rootDir: string,
  setRootDir: (dir: string) => void,
  args: z.infer<typeof StartLspArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  info(`Starting LSP server with root directory: ${args.root_dir}`);
  try {
    const lspClient = getLspClient();
    // Shut down existing client before creating new one (prevents leak)
    if (lspClient) {
      try {
        await lspClient.shutdown();
      } catch (err) {
        warning("Error shutting down existing LSP client:", err);
      }
    }

    const newClient = new LSPClient(lspServerPath, lspServerArgs);
    await newClient.initialize(args.root_dir);
    setLspClient(newClient);
    setRootDir(args.root_dir);
    return {
      content: [{ type: "text", text: `LSP server initialized with root: ${args.root_dir}` }],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`Error starting LSP server: ${errorMessage}`);
    throw new Error(`Failed to start LSP server: ${errorMessage}`);
  }
}

async function handleGetReferences(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetReferencesArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting references in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const refs = await lspClient!.getReferences(
    fileUri,
    { line: args.line - 1, character: args.column - 1 },
    args.include_declaration ?? false,
  );
  const formatted = refs.map((loc: any) => ({
    file: loc.uri.replace(/^file:\/\//, ""),
    line: loc.range.start.line + 1,
    column: loc.range.start.character + 1,
    end_line: loc.range.end.line + 1,
    end_column: loc.range.end.character + 1,
  }));
  debug(`Found ${formatted.length} references`);
  return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
}

async function handleSetLogLevel(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof SetLogLevelArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { level } = args;
  setLogLevel(level);
  return { content: [{ type: "text", text: `Log level set to: ${level}` }] };
}

async function handleRestartLspServer(
  getLspClient: () => LSPClient | null,
  args: { root_dir?: string },
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  await lspClient!.restart(args.root_dir);
  return { content: [{ type: "text", text: "LSP server restarted successfully" }] };
}

async function handleGoToDefinition(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GoToDefinitionArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting definition in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const locations = await lspClient!.getDefinition(fileUri, {
    line: args.line - 1,
    character: args.column - 1
  });
  const formatted = locations.map((loc: any) => ({
    file: loc.uri.replace(/^file:\/\//, ""),
    line: loc.range.start.line + 1,
    column: loc.range.start.character + 1,
    end_line: loc.range.end.line + 1,
    end_column: loc.range.end.character + 1,
  }));
  debug(`Found ${formatted.length} definition location(s)`);
  return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
}

async function handleGetDocumentSymbols(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetDocumentSymbolsArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting document symbols for: ${args.file_path}`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const symbols = await lspClient!.getDocumentSymbols(fileUri);
  debug(`Found ${symbols.length} document symbol(s)`);
  return { content: [{ type: "text", text: JSON.stringify(symbols, null, 2) }] };
}

async function handleGetWorkspaceSymbols(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetWorkspaceSymbolsArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting workspace symbols for query: "${args.query}"`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const symbols = await lspClient!.getWorkspaceSymbols(args.query);
  debug(`Found ${symbols.length} workspace symbol(s)`);
  return { content: [{ type: "text", text: JSON.stringify(symbols, null, 2) }] };
}

async function handleGetSignatureHelp(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GetSignatureHelpArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting signature help in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const result = await lspClient!.getSignatureHelp(fileUri, {
    line: args.line - 1,
    character: args.column - 1
  });
  const text = result !== null ? JSON.stringify(result, null, 2) : "No signature help available at this location";
  debug(`Signature help result: ${text.slice(0, 100)}`);
  return { content: [{ type: "text", text }] };
}

async function handleFormatDocument(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof FormatDocumentArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Formatting document: ${args.file_path}`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const edits = await lspClient!.formatDocument(fileUri, {
    tabSize: args.tab_size,
    insertSpaces: args.insert_spaces,
  });
  debug(`Format document returned ${edits.length} edit(s)`);
  return { content: [{ type: "text", text: JSON.stringify(edits, null, 2) }] };
}

async function handleRenameSymbol(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof RenameSymbolArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Renaming symbol in file: ${args.file_path} (${args.line}:${args.column}) to "${args.new_name}"`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const workspaceEdit = await lspClient!.renameSymbol(
    fileUri,
    { line: args.line - 1, character: args.column - 1 },
    args.new_name,
  );
  const text = workspaceEdit !== null
    ? JSON.stringify(workspaceEdit, null, 2)
    : "Rename not supported or symbol cannot be renamed at this location";
  debug(`Rename symbol result: ${text.slice(0, 100)}`);
  return { content: [{ type: "text", text }] };
}

async function handleGoToTypeDefinition(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GoToTypeDefinitionArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting type definition in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const locations = await lspClient!.getTypeDefinition(fileUri, {
    line: args.line - 1,
    character: args.column - 1
  });
  const formatted = locations.map((loc: any) => ({
    file: loc.uri.replace(/^file:\/\//, ""),
    line: loc.range.start.line + 1,
    column: loc.range.start.character + 1,
    end_line: loc.range.end.line + 1,
    end_column: loc.range.end.character + 1,
  }));
  debug(`Found ${formatted.length} type definition location(s)`);
  return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
}

async function handleGoToImplementation(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof GoToImplementationArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Getting implementation in file: ${args.file_path} (${args.line}:${args.column})`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const fileContent = await fs.readFile(args.file_path, 'utf-8');
  const fileUri = createFileUri(args.file_path);
  await lspClient!.openDocument(fileUri, fileContent, args.language_id);
  const locations = await lspClient!.getImplementation(fileUri, {
    line: args.line - 1,
    character: args.column - 1
  });
  const formatted = locations.map((loc: any) => ({
    file: loc.uri.replace(/^file:\/\//, ""),
    line: loc.range.start.line + 1,
    column: loc.range.start.character + 1,
    end_line: loc.range.end.line + 1,
    end_column: loc.range.end.character + 1,
  }));
  debug(`Found ${formatted.length} implementation location(s)`);
  return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
}

async function handleExecuteCommand(
  getLspClient: () => LSPClient | null,
  args: z.infer<typeof ExecuteCommandArgsSchema>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  debug(`Executing command: ${args.command}`);
  const lspClient = getLspClient();
  checkLspClientInitialized(lspClient);
  const result = await lspClient!.executeCommand(args.command, args.args as any[] | undefined);
  const text = result !== null ? JSON.stringify(result, null, 2) : "Command executed successfully (no result returned)";
  debug(`Execute command result: ${text.slice(0, 100)}`);
  return { content: [{ type: "text", text }] };
}

// Define handlers for each tool
export const getToolHandlers = (getLspClient: () => LSPClient | null, lspServerPath: string, lspServerArgs: string[], setLspClient: (client: LSPClient) => void, rootDir: string, setRootDir: (dir: string) => void, server?: any) => {
  return {
    "get_info_on_location": {
      schema: GetInfoOnLocationArgsSchema,
      handler: (args: any) => handleGetInfoOnLocation(getLspClient, args),
    },
    "get_completions": {
      schema: GetCompletionsArgsSchema,
      handler: (args: any) => handleGetCompletions(getLspClient, args),
    },
    "get_code_actions": {
      schema: GetCodeActionsArgsSchema,
      handler: (args: any) => handleGetCodeActions(getLspClient, args),
    },
    "open_document": {
      schema: OpenDocumentArgsSchema,
      handler: (args: any) => handleOpenDocument(getLspClient, args),
    },
    "close_document": {
      schema: CloseDocumentArgsSchema,
      handler: (args: any) => handleCloseDocument(getLspClient, args),
    },
    "get_diagnostics": {
      schema: GetDiagnosticsArgsSchema,
      handler: (args: any) => handleGetDiagnostics(getLspClient, args),
    },
    "start_lsp": {
      schema: StartLspArgsSchema,
      handler: (args: any) => handleStartLsp(getLspClient, lspServerPath, lspServerArgs, setLspClient, rootDir, setRootDir, args),
    },
    "get_references": {
      schema: GetReferencesArgsSchema,
      handler: (args: any) => handleGetReferences(getLspClient, args),
    },
    "set_log_level": {
      schema: SetLogLevelArgsSchema,
      handler: (args: any) => handleSetLogLevel(getLspClient, args),
    },
    "restart_lsp_server": {
      schema: RestartLspArgsSchema,
      handler: (args: any) => handleRestartLspServer(getLspClient, args),
    },
    "go_to_definition": {
      schema: GoToDefinitionArgsSchema,
      handler: (args: any) => handleGoToDefinition(getLspClient, args),
    },
    "get_document_symbols": {
      schema: GetDocumentSymbolsArgsSchema,
      handler: (args: any) => handleGetDocumentSymbols(getLspClient, args),
    },
    "get_workspace_symbols": {
      schema: GetWorkspaceSymbolsArgsSchema,
      handler: (args: any) => handleGetWorkspaceSymbols(getLspClient, args),
    },
    "get_signature_help": {
      schema: GetSignatureHelpArgsSchema,
      handler: (args: any) => handleGetSignatureHelp(getLspClient, args),
    },
    "format_document": {
      schema: FormatDocumentArgsSchema,
      handler: (args: any) => handleFormatDocument(getLspClient, args),
    },
    "rename_symbol": {
      schema: RenameSymbolArgsSchema,
      handler: (args: any) => handleRenameSymbol(getLspClient, args),
    },
    "go_to_type_definition": {
      schema: GoToTypeDefinitionArgsSchema,
      handler: (args: any) => handleGoToTypeDefinition(getLspClient, args),
    },
    "go_to_implementation": {
      schema: GoToImplementationArgsSchema,
      handler: (args: any) => handleGoToImplementation(getLspClient, args),
    },
    "execute_command": {
      schema: ExecuteCommandArgsSchema,
      handler: (args: any) => handleExecuteCommand(getLspClient, args),
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
      name: "start_lsp",
      description: "Initialize or reinitialize the LSP server with a specific project root directory. Call this before using get_references, get_info_on_location, or get_diagnostics when working in a project different from the one the server was started with. The root_dir should be the workspace root (directory containing go.work, go.mod, package.json, etc.).",
      inputSchema: zodToJsonSchema(StartLspArgsSchema) as ToolInput,
    },
    {
      name: "get_references",
      description: "Find all references to a symbol at a specific location in a file via LSP. Returns every location in the codebase where the symbol is used. Use this to determine if a symbol is dead (zero references), to understand call sites before refactoring, or to trace data flow. Results include file path and line/column for each reference.",
      inputSchema: zodToJsonSchema(GetReferencesArgsSchema) as ToolInput,
    },
    {
      name: "set_log_level",
      description: "Set the server logging level. Use this tool to control the verbosity of logs generated by the LSP MCP server. Available levels from least to most verbose: emergency, alert, critical, error, warning, notice, info, debug. Increasing verbosity can help troubleshoot issues but may generate large amounts of output.",
      inputSchema: zodToJsonSchema(SetLogLevelArgsSchema) as ToolInput,
    },
    {
      name: "restart_lsp_server",
      description: "Restart the LSP server process. Use this if the LSP server becomes unresponsive or after making significant changes to the project structure. Optionally provide a new root_dir to restart with a different workspace root.",
      inputSchema: zodToJsonSchema(RestartLspArgsSchema) as ToolInput,
    },
    {
      name: "go_to_definition",
      description: "Jump to the definition of a symbol at a specific location in a file via LSP. Returns the file path and position where the symbol is defined. Useful for navigating to type declarations, function implementations, or variable assignments across the codebase.",
      inputSchema: zodToJsonSchema(GoToDefinitionArgsSchema) as ToolInput,
    },
    {
      name: "get_document_symbols",
      description: "Get all symbols defined in a document via LSP (functions, classes, variables, methods, etc.). Returns a hierarchical DocumentSymbol tree or flat SymbolInformation list depending on server support. Use this to get a structural overview of a file.",
      inputSchema: zodToJsonSchema(GetDocumentSymbolsArgsSchema) as ToolInput,
    },
    {
      name: "get_workspace_symbols",
      description: "Search for symbols across the entire workspace via LSP. Use an empty query string to list all indexed symbols, or provide a query to filter by name. Returns matching symbol names, kinds, and locations.",
      inputSchema: zodToJsonSchema(GetWorkspaceSymbolsArgsSchema) as ToolInput,
    },
    {
      name: "get_signature_help",
      description: "Get function signature help at a specific location in a file via LSP. Returns available overloads and highlights the active parameter. Use this when the cursor is inside a function call's argument list to understand what parameters the function expects.",
      inputSchema: zodToJsonSchema(GetSignatureHelpArgsSchema) as ToolInput,
    },
    {
      name: "format_document",
      description: "Get formatting edits for an entire document via LSP. Returns TextEdit[] describing the changes needed to format the file according to the language server's style rules. The edits are returned for inspection — they are NOT applied automatically. Use this to see what formatting changes a formatter would make.",
      inputSchema: zodToJsonSchema(FormatDocumentArgsSchema) as ToolInput,
    },
    {
      name: "rename_symbol",
      description: "Get a WorkspaceEdit for renaming a symbol across the entire workspace via LSP. Returns the edit object describing all files and positions that need to change — it is NOT applied automatically. Inspect the returned WorkspaceEdit to understand the full scope of a rename before applying it.",
      inputSchema: zodToJsonSchema(RenameSymbolArgsSchema) as ToolInput,
    },
    {
      name: "go_to_type_definition",
      description: "Jump to the definition of the type of a symbol at a specific location in a file via LSP. Unlike go_to_definition (which goes to where the symbol itself is defined), this navigates to the type declaration. Useful for interface types, type aliases, and class definitions when working with instances or variables.",
      inputSchema: zodToJsonSchema(GoToTypeDefinitionArgsSchema) as ToolInput,
    },
    {
      name: "go_to_implementation",
      description: "Find all implementations of an interface or abstract method at a specific location in a file via LSP. Returns the file paths and positions of all concrete implementations. Use this to navigate from an interface declaration or abstract method to the concrete classes that implement it.",
      inputSchema: zodToJsonSchema(GoToImplementationArgsSchema) as ToolInput,
    },
    {
      name: "execute_command",
      description: "Execute a workspace command via LSP. Commands are server-defined identifiers returned by code actions (in the command field of a CodeAction). Use this after get_code_actions to trigger a server-side operation such as applying a refactoring, generating code, or running a server-specific action. Returns the server-defined result or null.",
      inputSchema: zodToJsonSchema(ExecuteCommandArgsSchema) as ToolInput,
    },
  ];
};
