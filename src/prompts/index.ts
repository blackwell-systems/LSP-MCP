// Prompts module for LSP MCP
import { Prompt, PromptHandler } from "../types/index.js";
import { debug, info } from "../logging/index.js";

// Enum for prompt names
enum PromptName {
  LSP_GUIDE = "lsp_guide",
  LANGUAGE_HELP = "language_help",
}

// Get prompt definitions for the server
export const getPromptDefinitions = (): Prompt[] => {
  return [
    {
      name: PromptName.LSP_GUIDE,
      description: "A guide on how to use the LSP (Language Server Protocol) functions available through this MCP server",
    },
    {
      name: PromptName.LANGUAGE_HELP,
      description: "Get help with specific programming language features through LSP",
      arguments: [
        {
          name: "language",
          description: "The programming language you want help with (e.g., typescript, haskell, javascript)",
          required: true,
        },
        {
          name: "feature",
          description: "The specific language feature you want help with (e.g., types, completions, diagnostics)",
          required: false,
        },
      ],
    },
  ];
};

// Define handlers for each prompt
export const getPromptHandlers = (): Record<string, PromptHandler> => {
  return {
    [PromptName.LSP_GUIDE]: async () => {
      debug(`Handling LSP guide prompt`);
      
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "How do I use the LSP functions in this server?",
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# LSP MCP Server Guide

This server provides access to Language Server Protocol (LSP) features through MCP tools. Here's how to use them:

## Getting Started

1. First, start the LSP server with a root directory:
   \`\`\`
   start_lsp(root_dir: "/path/to/your/project")
   \`\`\`

2. Open a file for analysis:
   \`\`\`
   open_document(file_path: "/path/to/your/project/src/file.ts", language_id: "typescript")
   \`\`\`

## Available Tools

- **get_info_on_location**: Get hover information (types, documentation) at a specific position
- **get_completions**: Get code completion suggestions at a cursor position
- **get_code_actions**: Get available code refactorings and quick fixes for a selection
- **get_diagnostics**: Get errors and warnings for open files
- **open_document**: Open a file for analysis
- **close_document**: Close a file when done
- **restart_lsp_server**: Restart the LSP server if needed
- **set_log_level**: Control the server's logging verbosity

## Workflow Example

1. Start LSP: \`start_lsp(root_dir: "/my/project")\`
2. Open file: \`open_document(file_path: "/my/project/src/app.ts", language_id: "typescript")\`
3. Get diagnostics: \`get_diagnostics(file_path: "/my/project/src/app.ts")\`
4. Get hover info: \`get_info_on_location(file_path: "/my/project/src/app.ts", line: 10, character: 15, language_id: "typescript")\`
5. Get completions: \`get_completions(file_path: "/my/project/src/app.ts", line: 12, character: 8, language_id: "typescript")\`
6. Close file when done: \`close_document(file_path: "/my/project/src/app.ts")\`

Remember that line and character positions are 1-based (first line is 1, first character is 1), but LSP internally uses 0-based positions.`,
            },
          },
        ],
      };
    },
    
    [PromptName.LANGUAGE_HELP]: async (args) => {
      const language = args?.language || 'typescript';
      const feature = args?.feature;
      
      debug(`Handling language help prompt for language: ${language}, feature: ${feature || 'all'}`);
      
      // Basic language configurations with specific LSP examples
      const languageInfo: Record<string, any> = {
        typescript: {
          languageId: "typescript",
          fileExtension: ".ts",
          features: {
            types: "TypeScript provides static typing. Use `get_info_on_location` to inspect types at cursor positions.",
            completions: "TypeScript offers intelligent auto-completions for variables, methods, imports, etc. Use `get_completions`.",
            diagnostics: "TypeScript reports type errors, unused variables, and other issues. Use `get_diagnostics`.",
            refactoring: "TypeScript supports refactorings like extract variable/method, rename symbol, etc. Use `get_code_actions`.",
          },
          example: `
// Example TypeScript file
interface User {
  id: number;
  name: string;
  email?: string;
}

function getUser(id: number): User {
  // Get cursor info on 'User' type with:
  // get_info_on_location(file_path: "/path/to/file.ts", line: 7, character: 24, language_id: "typescript")
  return { id, name: "Example" };
}
`
        },
        javascript: {
          languageId: "javascript",
          fileExtension: ".js",
          features: {
            types: "JavaScript can use JSDoc comments for type hints. The LSP will understand these for hover information.",
            completions: "JavaScript provides completions based on object properties and available variables in scope.",
            diagnostics: "JavaScript reports syntax errors and other issues detected by the language server.",
            refactoring: "JavaScript supports common refactorings like variable extraction and code organization.",
          },
          example: `
// Example JavaScript file
/**
 * @typedef {Object} User
 * @property {number} id - User ID
 * @property {string} name - User name
 */

/**
 * @param {number} id - The user ID
 * @returns {User} The user object
 */
function getUser(id) {
  // LSP understands JSDoc types
  // get_info_on_location(file_path: "/path/to/file.js", line: 12, character: 17, language_id: "javascript")
  return { id, name: "Example" };
}
`
        },
        haskell: {
          languageId: "haskell",
          fileExtension: ".hs",
          features: {
            types: "Haskell has strong static typing with type inference. Use `get_info_on_location` to see inferred types.",
            completions: "Haskell LSP provides completions for functions, type constructors, and imports.",
            diagnostics: "Haskell reports type errors and other issues through GHC and the language server.",
            refactoring: "Haskell supports various refactorings like renaming, adding type signatures, etc.",
          },
          example: `
-- Example Haskell file
module User where

data User = User
  { userId :: Int
  , userName :: String
  , userEmail :: Maybe String
  } deriving (Show, Eq)

getUser :: Int -> User
getUser id = User
  { userId = id
  , userName = "Example"
  , userEmail = Nothing
  }
-- Get info on 'User' type with:
-- get_info_on_location(file_path: "/path/to/User.hs", line: 3, character: 6, language_id: "haskell")
`
        }
      };
      
      // Default to TypeScript if the language is not found
      const langData = languageInfo[language.toLowerCase()] || languageInfo.typescript;
      
      // Create response text based on whether a feature was specified
      let responseText = `# Using LSP with ${language}\n\n`;
      
      if (feature && langData.features[feature.toLowerCase()]) {
        // Specific feature response
        responseText += `## ${feature} in ${language}\n`;
        responseText += langData.features[feature.toLowerCase()];
        responseText += `\n\n### Example Usage\n\`\`\`${language.toLowerCase()}\n${langData.example}\n\`\`\`\n`;
      } else {
        // General language response
        responseText += `To use LSP with ${language} files, use the file extension \`${langData.fileExtension}\` and language ID \`${langData.languageId}\`.\n\n`;
        responseText += `## Key Features\n\n`;
        
        Object.entries(langData.features).forEach(([key, value]) => {
          responseText += `### ${key.charAt(0).toUpperCase() + key.slice(1)}\n${value}\n\n`;
        });
        
        responseText += `## Example\n\`\`\`${language.toLowerCase()}\n${langData.example}\n\`\`\`\n`;
        responseText += `\n## Using LSP Tools with ${language}\n\n`;
        responseText += `1. Start the LSP server: \`start_lsp(root_dir: "/path/to/project")\`\n`;
        responseText += `2. Open a ${language} file: \`open_document(file_path: "/path/to/file${langData.fileExtension}", language_id: "${langData.languageId}")\`\n`;
        responseText += `3. Get completions: \`get_completions(file_path: "/path/to/file${langData.fileExtension}", line: 10, character: 5, language_id: "${langData.languageId}")\`\n`;
        responseText += `4. Get hover information: \`get_info_on_location(file_path: "/path/to/file${langData.fileExtension}", line: 5, character: 10, language_id: "${langData.languageId}")\`\n`;
      }
      
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Help me understand how to use ${language} with LSP${feature ? `, focusing on ${feature}` : ''}.`,
            },
          },
          {
            role: "assistant",
            content: {
              type: "text",
              text: responseText,
            },
          },
        ],
      };
    },
  };
};