// Stub scaffold — Agent C will fill in full implementations.
// All agents may import from this file in Wave 1.

import * as path from "path";
import { LSPClient } from "../lspClient.js";

/**
 * Convert a file:// URI to an absolute filesystem path.
 * Uses URL parsing for correctness; handles encoded characters.
 */
export function uriToFilePath(uri: string): string {
  return new URL(uri).pathname;
}

/**
 * Assert that lspClient is non-null. Throws if null.
 * Moved from src/tools/index.ts to eliminate peer-layer import.
 */
export const checkLspClientInitialized = (lspClient: LSPClient | null): void => {
  if (!lspClient) {
    throw new Error("LSP server not ready yet – initialization is still in progress or failed.");
  }
};

/**
 * Create a file:// URI from an absolute or relative file path.
 * Moved from src/tools/index.ts to shared utilities.
 */
export const createFileUri = (filePath: string): string => {
  return `file://${path.resolve(filePath)}`;
};
