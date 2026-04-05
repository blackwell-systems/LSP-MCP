// Type definitions

import { z } from "zod";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";

// LSP message handling
export interface LSPMessage {
  jsonrpc: string;
  id?: number | string;  // present for requests and responses
  method?: string;        // present for requests and notifications
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// LSP diagnostic type
export interface LSPDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: 1 | 2 | 3 | 4; // error, warning, info, hint
  code?: number | string;
  source?: string;
  message: string;
  data?: unknown;
}

// Define a type for diagnostic subscribers
export type DiagnosticUpdateCallback = (uri: string, diagnostics: LSPDiagnostic[]) => void;

// Define a type for subscription context
export interface SubscriptionContext {
  callback: DiagnosticUpdateCallback;
}

// Logging level type
export type LoggingLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

// Tool input type
export const ToolInputSchema = ToolSchema.shape.inputSchema;
export type ToolInput = z.infer<typeof ToolInputSchema>;

// Tool handler types
export type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>;

// Resource handler type
export type ResourceHandler = (uri: string) => Promise<{ contents: Array<{ type: string, text: string, uri: string }> }>;

// Subscription handler type
export type SubscriptionHandler = (uri: string) => Promise<{ ok: boolean, context?: SubscriptionContext, error?: string }>;

// Unsubscription handler type
export type UnsubscriptionHandler = (
  uri: string,
  context: SubscriptionContext | undefined,
) => Promise<{ ok: boolean, error?: string }>;

// Prompt types
export interface Prompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
}

export type PromptHandler = (args?: Record<string, string>) => Promise<{
  messages: Array<{
    role: string;
    content: {
      type: string;
      text: string;
    };
  }>;
}>;

// Schema definitions
export const GetInfoOnLocationArgsSchema = z.object({
  file_path: z.string().describe("Path to the file"),
  language_id: z.string().describe("The programming language the file is written in"),
  line: z.coerce.number().describe(`Line number`),
  column: z.coerce.number().describe(`Column position`),
});

export const GetCompletionsArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file`),
  language_id: z.string().describe(`The programming language the file is written in`),
  line: z.coerce.number().describe(`Line number`),
  column: z.coerce.number().describe(`Column position`),
});

export const GetCodeActionsArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file`),
  language_id: z.string().describe(`The programming language the file is written in`),
  start_line: z.coerce.number().describe(`Start line number`),
  start_column: z.coerce.number().describe(`Start column position`),
  end_line: z.coerce.number().describe(`End line number`),
  end_column: z.coerce.number().describe(`End column position`),
});

export const OpenDocumentArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file to open`),
  language_id: z.string().describe(`The programming language the file is written in`),
});

export const CloseDocumentArgsSchema = z.object({
  file_path: z.string().describe(`Path to the file to close`),
});

export const GetDiagnosticsArgsSchema = z.object({
  file_path: z.string().optional().describe(`Path to the file to get diagnostics for. If not provided, returns diagnostics for all open files.`),
});

export const GetReferencesArgsSchema = z.object({
  file_path: z.string().describe("Path to the file containing the symbol"),
  language_id: z.string().describe("The programming language the file is written in"),
  line: z.coerce.number().describe("Line number of the symbol (1-based)"),
  column: z.coerce.number().describe("Column position of the symbol (1-based)"),
  include_declaration: z.boolean().optional().default(false).describe("Include the symbol's own declaration in results"),
});

export const StartLspArgsSchema = z.object({
  root_dir: z.string().describe("Absolute path to the project root. gopls will use this as the workspace root for module discovery and cross-file analysis. Call this before get_references or other LSP operations when working in a different project than the server was started with."),
});

export const SetLogLevelArgsSchema = z.object({
  level: z.enum(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'])
    .describe("The logging level to set")
});


