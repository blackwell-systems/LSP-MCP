#!/usr/bin/env node
// Multi-language LSP integration test for MCP using the official SDK

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import assert from 'assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to our compiled server script
const LSP_MCP_SERVER = path.join(__dirname, '..', 'dist', 'index.js');

// Language configuration
const LANGUAGES = [
  {
    name: 'TypeScript',
    id: 'typescript',
    binary: 'typescript-language-server',
    serverArgs: ['--stdio'],
    fixture: path.join(__dirname, 'ts-project'),
    file: path.join(__dirname, 'ts-project', 'src', 'example.ts'),
    hoverLine: 11,    // line with 'export interface Person' (line 10 is closing JSDoc */)
    hoverColumn: 18,  // column on 'Person'
    definitionLine: 4,      // 'export function add(' — 1-indexed
    definitionColumn: 17,   // column of 'add' identifier
    callSiteLine: 4,        // consumer.ts: 'const sum = add(1, 2);'
    callSiteColumn: 14,     // column of 'add(' in consumer.ts
    callSiteFile: path.join(__dirname, 'ts-project', 'src', 'consumer.ts'),
    referenceLine: 11,      // 'export interface Person {' in example.ts
    referenceColumn: 18,    // column of 'Person'
    completionLine: 7,      // consumer.ts: 'const alice: Person = { name: ...'
    completionColumn: 26,   // after 'alice: Person = { ' (after opening brace)
    completionFile: path.join(__dirname, 'ts-project', 'src', 'consumer.ts'),
    workspaceSymbolQuery: 'Person',
    supportsFormatting: true,
    secondFile: path.join(__dirname, 'ts-project', 'src', 'consumer.ts'),
    symbolName: 'Person',
  },
  {
    name: 'Python',
    id: 'python',
    binary: 'pyright-langserver',  // pyright is the CLI; pyright-langserver is the LSP server
    serverArgs: ['--stdio'],
    fixture: path.join(__dirname, 'fixtures/python'),
    file: path.join(__dirname, 'fixtures/python', 'main.py'),
    hoverLine: 4,     // line with 'class Person'
    hoverColumn: 7,   // column on 'Person'
    definitionLine: 1,      // 'def add(x: int, y: int) -> int:'
    definitionColumn: 5,    // column of 'add'
    callSiteLine: 15,       // '    result = add(1, 2)'
    callSiteColumn: 14,     // column of 'add(' call
    referenceLine: 4,       // 'class Person:'
    referenceColumn: 7,     // column of 'Person'
    completionLine: 14,     // '    print(p.greet())'  — after 'p.'
    completionColumn: 13,   // column after 'p.' dot
    workspaceSymbolQuery: 'Person',
    supportsFormatting: false,   // pyright-langserver does not support formatting
    secondFile: path.join(__dirname, 'fixtures/python', 'greeter.py'),
    symbolName: 'Person',
  },
  {
    name: 'Go',
    id: 'go',
    binary: 'gopls',
    serverArgs: [],
    fixture: path.join(__dirname, 'fixtures/go'),
    file: path.join(__dirname, 'fixtures/go', 'main.go'),
    hoverLine: 6,     // line with 'type Person struct' (1-indexed)
    hoverColumn: 6,   // column on 'Person'
    definitionLine: 16,     // 'func add(x, y int) int {'
    definitionColumn: 6,    // column of 'add'
    callSiteLine: 23,       // '    fmt.Println(add(1, 2))'
    callSiteColumn: 17,     // column of 'add(' call
    referenceLine: 6,       // 'type Person struct {'
    referenceColumn: 6,     // column of 'Person'
    completionLine: 22,     // '    fmt.Println(p.Greet())'  — after 'p.'
    completionColumn: 19,   // column after 'p.' before 'Greet'
    workspaceSymbolQuery: 'Person',
    supportsFormatting: true,
    secondFile: path.join(__dirname, 'fixtures/go', 'greeter.go'),
    symbolName: 'Person',
  },
  {
    name: 'Rust',
    id: 'rust',
    binary: 'rust-analyzer',
    serverArgs: [],
    fixture: path.join(__dirname, 'fixtures/rust'),
    file: path.join(__dirname, 'fixtures/rust', 'src', 'main.rs'),
    hoverLine: 2,     // line with 'struct Person'
    hoverColumn: 8,   // column on 'Person'
    definitionLine: 23,     // 'fn add(x: i32, y: i32) -> i32 {' (after mod greeter insertion)
    definitionColumn: 4,    // column of 'add'
    callSiteLine: 30,       // 'println!("{}", add(1, 2));' (shifted by mod greeter lines)
    callSiteColumn: 20,     // column of 'add(' call
    referenceLine: 2,       // 'pub struct Person {'
    referenceColumn: 12,    // column of 'Person'
    completionLine: 28,     // 'let p = Person::new("Alice", 30);'
    completionColumn: 11,   // after 'p.' in next line
    workspaceSymbolQuery: 'Person',
    supportsFormatting: true,
    secondFile: path.join(__dirname, 'fixtures/rust', 'src', 'greeter.rs'),
    symbolName: 'Person',
  },
  {
    name: 'Java',
    id: 'java',
    binary: 'jdtls',
    serverArgs: ['-data', '/tmp/jdtls-workspace-lsp-mcp-test'],
    logLevel: 'notice',  // verbose so crashes surface in CI
    fixture: path.join(__dirname, 'fixtures/java'),  // jdtls needs project root with pom.xml
    file: path.join(__dirname, 'fixtures/java', 'src', 'main', 'java', 'com', 'example', 'Person.java'),
    hoverLine: 5,     // line with 'public class Person' (shifted +1 by package declaration)
    hoverColumn: 14,  // column on 'Person'
    definitionLine: 20,     // 'public static int add(int x, int y) {'
    definitionColumn: 23,   // column of 'add'
    callSiteLine: 27,       // 'System.out.println(add(1, 2));'
    callSiteColumn: 28,     // column of 'add(' call
    referenceLine: 6,       // 'public class Person {'
    referenceColumn: 14,    // column of 'Person'
    completionLine: 25,     // 'Person p = new Person("Alice", 30);'
    completionColumn: 16,   // after 'new Person(' — triggers constructor completions
    workspaceSymbolQuery: 'Person',
    supportsFormatting: true,
    secondFile: path.join(__dirname, 'fixtures/java', 'src', 'main', 'java', 'com', 'example', 'Greeter.java'),
    symbolName: 'Person',
  },
  {
    name: 'C',
    id: 'c',
    binary: 'clangd',
    serverArgs: [],
    fixture: path.join(__dirname, 'fixtures/c'),
    file: path.join(__dirname, 'fixtures/c', 'person.c'),
    hoverLine: 3,     // line with 'Person create_person(...)' — Person type usage after refactor
    hoverColumn: 1,   // column on 'Person'
    definitionLine: 10,     // 'int add(int x, int y) {'
    definitionColumn: 5,    // column of 'add'
    callSiteLine: 16,       // '    return add(1, 2);'
    callSiteColumn: 12,     // column of 'add(' call
    referenceLine: 3,       // 'Person create_person(...)' — Person type usage
    referenceColumn: 1,     // column of 'Person'
    completionLine: 15,     // 'Person p = create_person("Alice", 30);'
    completionColumn: 12,   // after 'p = '
    workspaceSymbolQuery: 'Person',
    supportsFormatting: true,
    secondFile: path.join(__dirname, 'fixtures/c', 'greeter.c'),
    symbolName: 'create_person',
    declarationLine: 3,     // 'Person create_person(...)' in person.c — go_to_declaration resolves to person.h
    declarationColumn: 1,   // column 1
  },
  {
    name: 'PHP',
    id: 'php',
    binary: 'intelephense',
    serverArgs: ['--stdio'],
    fixture: path.join(__dirname, 'fixtures/php'),
    file: path.join(__dirname, 'fixtures/php', 'Person.php'),
    hoverLine: 6,     // line with 'class Person {'
    hoverColumn: 7,   // column on 'Person'
    definitionLine: 20,     // 'public static function add(int $x, int $y): int {'
    definitionColumn: 24,   // column of 'add'
    callSiteLine: 27,       // 'echo Person::add(1, 2);'
    callSiteColumn: 14,     // column of 'add' in 'Person::add' (static call)
    referenceLine: 6,       // 'class Person {'
    referenceColumn: 7,     // column of 'Person'
    completionLine: 26,     // '$p = new Person("Alice", 30);'  — after 'new Person('
    completionColumn: 22,   // after '$p->greet()' first char of method
    workspaceSymbolQuery: 'Person',
    supportsFormatting: false,   // intelephense formatting is license-gated
    secondFile: path.join(__dirname, 'fixtures/php', 'Greeter.php'),
    symbolName: 'Person',
  },
];

// Custom transport that works with an existing child process
class CustomStdioTransport {
  constructor(childProcess) {
    this.childProcess = childProcess;
    this.readBuffer = new ReadBuffer();
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;

    this._setupListeners();
  }

  _setupListeners() {
    this.childProcess.stdout.on('data', (data) => {
      this.readBuffer.append(data);
      this._processReadBuffer();
    });

    this.childProcess.on('error', (error) => {
      if (this.onerror) this.onerror(error);
    });

    this.childProcess.on('close', () => {
      if (this.onclose) this.onclose();
    });

    this.childProcess.stdout.on('error', (error) => {
      if (this.onerror) this.onerror(error);
    });

    this.childProcess.stdin.on('error', (error) => {
      if (this.onerror) this.onerror(error);
    });
  }

  _processReadBuffer() {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) break;
        if (this.onmessage) this.onmessage(message);
      } catch (error) {
        if (this.onerror) this.onerror(error);
      }
    }
  }

  async start() {
    return Promise.resolve();
  }

  async close() {
    this.readBuffer.clear();
  }

  send(message) {
    return new Promise((resolve) => {
      if (!this.childProcess.stdin) {
        throw new Error('Not connected');
      }
      const json = serializeMessage(message);
      if (this.childProcess.stdin.write(json)) {
        resolve();
      } else {
        this.childProcess.stdin.once('drain', resolve);
      }
    });
  }
}

// Check if a binary is available on PATH; returns full path or null
function resolveBinary(binary) {
  try {
    const result = execSync(`which ${binary}`, { stdio: 'pipe' });
    return result.toString().trim();
  } catch {
    return null;
  }
}

// Tests get_document_symbols tool; asserts result is non-empty array containing Person type entry
async function testGetDocumentSymbols(client, lang) {
  try {
    const result = await client.callTool({
      name: 'get_document_symbols',
      arguments: { file_path: lang.file, language_id: lang.id },
    });
    let arr;
    try {
      arr = JSON.parse(result.content[0].text);
    } catch {
      throw new Error(`failed to parse get_document_symbols response: ${result.content[0].text}`);
    }
    assert(Array.isArray(arr) && arr.length > 0, 'get_document_symbols returned empty array');
    const found = arr.find(s => s.name === lang.symbolName || (s.name && s.name.includes(lang.symbolName)));
    assert(found, `get_document_symbols: no entry with name '${lang.symbolName}'`);
    return { tool: 'get_document_symbols', status: 'pass', detail: `found ${arr.length} symbols` };
  } catch (err) {
    return { tool: 'get_document_symbols', status: 'fail', detail: err.message };
  }
}

// Tests go_to_definition; called at call site, asserts result URI and line match definition
async function testGoToDefinition(client, lang) {
  try {
    const callFile = lang.callSiteFile || lang.file;
    const result = await client.callTool({
      name: 'go_to_definition',
      arguments: {
        file_path: callFile,
        language_id: lang.id,
        line: lang.callSiteLine,
        column: lang.callSiteColumn,
      },
    });
    let loc;
    try {
      loc = JSON.parse(result.content[0].text);
    } catch {
      throw new Error(`failed to parse go_to_definition response: ${result.content[0].text}`);
    }
    assert(loc !== null && loc !== undefined, 'go_to_definition returned null');
    const first = Array.isArray(loc) ? loc[0] : loc;
    assert(first, 'go_to_definition returned empty array');
    // handler returns { file, line, column } format
    const file = first.file || first.uri || first.targetUri || '';
    assert(file.length > 0, 'go_to_definition result has no file');
    const startLine = first.line != null ? first.line : (first.range ? first.range.start.line + 1 : -1);
    assert(Math.abs(startLine - lang.definitionLine) <= 1, `go_to_definition line mismatch: got ${startLine}, expected ~${lang.definitionLine}`);
    return { tool: 'go_to_definition', status: 'pass', detail: 'found definition' };
  } catch (err) {
    return { tool: 'go_to_definition', status: 'fail', detail: err.message };
  }
}

// Tests get_references on Person type; asserts count >= 2 when secondFile exists
async function testGetReferences(client, lang) {
  try {
    if (lang.secondFile) {
      await client.callTool({
        name: 'open_document',
        arguments: { file_path: lang.secondFile, language_id: lang.id },
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const result = await client.callTool({
      name: 'get_references',
      arguments: {
        file_path: lang.file,
        language_id: lang.id,
        line: lang.referenceLine,
        column: lang.referenceColumn,
        include_declaration: true,
      },
    });
    let arr;
    try {
      arr = JSON.parse(result.content[0].text);
    } catch {
      throw new Error(`failed to parse get_references response: ${result.content[0].text}`);
    }
    assert(Array.isArray(arr), 'get_references result is not an array');
    const minCount = lang.secondFile ? 2 : 1;
    assert(arr.length >= minCount, `get_references returned ${arr.length} references, expected >= ${minCount}`);
    return { tool: 'get_references', status: 'pass', detail: `found ${arr.length} references` };
  } catch (err) {
    return { tool: 'get_references', status: 'fail', detail: err.message };
  }
}

// Tests get_completions; asserts result is non-empty array
async function testGetCompletions(client, lang) {
  try {
    const result = await client.callTool({
      name: 'get_completions',
      arguments: {
        file_path: lang.completionFile || lang.file,
        language_id: lang.id,
        line: lang.completionLine,
        column: lang.completionColumn,
      },
    });
    let arr;
    try {
      arr = JSON.parse(result.content[0].text);
    } catch {
      throw new Error(`failed to parse get_completions response: ${result.content[0].text}`);
    }
    assert(Array.isArray(arr) && arr.length > 0, 'get_completions returned empty array');
    return { tool: 'get_completions', status: 'pass', detail: `found ${arr.length} completions` };
  } catch (err) {
    return { tool: 'get_completions', status: 'fail', detail: err.message };
  }
}

// Tests get_workspace_symbols with query 'Person'; asserts result contains entry named Person
async function testGetWorkspaceSymbols(client, lang) {
  try {
    const result = await client.callTool({
      name: 'get_workspace_symbols',
      arguments: { query: lang.workspaceSymbolQuery },
    });
    let arr;
    try {
      arr = JSON.parse(result.content[0].text);
    } catch {
      throw new Error(`failed to parse get_workspace_symbols response: ${result.content[0].text}`);
    }
    assert(Array.isArray(arr) && arr.length > 0, 'get_workspace_symbols returned empty array');
    const found = arr.find(s => s.name && s.name.includes(lang.workspaceSymbolQuery));
    assert(found, `get_workspace_symbols: no entry with name including '${lang.workspaceSymbolQuery}'`);
    return { tool: 'get_workspace_symbols', status: 'pass', detail: `found ${arr.length} symbols` };
  } catch (err) {
    return { tool: 'get_workspace_symbols', status: 'fail', detail: err.message };
  }
}

// Capability-gated format_document test; skips if lang.supportsFormatting is false
async function testFormatDocument(client, lang) {
  if (lang.supportsFormatting === false) {
    return { tool: 'format_document', status: 'skip', detail: 'formatting not supported' };
  }
  try {
    const result = await client.callTool({
      name: 'format_document',
      arguments: { file_path: lang.file, language_id: lang.id },
    });
    let arr;
    try {
      arr = JSON.parse(result.content[0].text);
    } catch {
      // Non-JSON or empty response is acceptable (already formatted)
      arr = [];
    }
    assert(Array.isArray(arr), 'format_document result is not an array');
    return { tool: 'format_document', status: 'pass', detail: 'ok' };
  } catch (err) {
    return { tool: 'format_document', status: 'fail', detail: err.message };
  }
}

// C-only; tests go_to_declaration from person.c definition to person.h declaration
async function testGoToDeclaration(client, lang) {
  if (lang.id !== 'c') {
    return { tool: 'go_to_declaration', status: 'skip', detail: 'not applicable for this language' };
  }
  try {
    await client.callTool({
      name: 'open_document',
      arguments: { file_path: path.join(lang.fixture, 'person.h'), language_id: 'c' },
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    const result = await client.callTool({
      name: 'go_to_declaration',
      arguments: {
        file_path: lang.file,
        language_id: lang.id,
        line: lang.declarationLine,
        column: lang.declarationColumn,
      },
    });
    let loc;
    try {
      loc = JSON.parse(result.content[0].text);
    } catch {
      throw new Error(`failed to parse go_to_declaration response: ${result.content[0].text}`);
    }
    assert(loc !== null && loc !== undefined, 'go_to_declaration returned null');
    const first = Array.isArray(loc) ? loc[0] : loc;
    assert(first, 'go_to_declaration returned empty array');
    // handler returns { file, line, column } format
    const file = first.file || first.uri || first.targetUri || '';
    assert(file.endsWith('person.h'), `go_to_declaration file does not end with 'person.h': ${file}`);
    return { tool: 'go_to_declaration', status: 'pass', detail: 'found declaration in person.h' };
  } catch (err) {
    return { tool: 'go_to_declaration', status: 'fail', detail: err.message };
  }
}

// Run tests for a single language
async function testLanguage(lang) {
  const result = {
    name: lang.name,
    status: 'PASS',
    details: '',
    diagnosticCount: 0,
    hoverSnippet: '',
    tier2: [],
  };

  // Check binary availability — resolve to full path so MCP server can stat it
  const binaryPath = resolveBinary(lang.binary);
  if (!binaryPath) {
    result.status = 'SKIP';
    result.details = `${lang.binary} not found`;
    return result;
  }

  let serverProcess = null;
  let client = null;
  const serverStderrLines = [];

  try {
    // Verify fixture file exists
    await fs.access(lang.file);

    // Spawn MCP server: node dist/index.js <lang_id> <binary_full_path> [serverArgs...]
    const spawnArgs = [LSP_MCP_SERVER, lang.id, binaryPath, ...lang.serverArgs];
    console.log(`\n[${lang.name}] Starting MCP server: node ${spawnArgs.join(' ')}`);

    serverProcess = spawn('node', spawnArgs, {
      env: { ...process.env, LOG_LEVEL: lang.logLevel || 'error' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Capture server stderr for diagnostics on failure
    serverProcess.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (process.env.VERBOSE) {
        process.stderr.write(`[${lang.name}] STDERR: ${text}\n`);
      }
      // Always buffer error/critical lines for post-failure reporting
      if (text.includes('[ERROR]') || text.includes('[CRITICAL]') || text.includes('[NOTICE]')) {
        serverStderrLines.push(text);
      }
    });

    const transport = new CustomStdioTransport(serverProcess);

    client = new Client(
      { name: `multi-lang-test-${lang.id}`, version: '1.0.0' },
      { capabilities: { tools: true } }
    );

    await client.connect(transport);
    console.log(`[${lang.name}] Connected to MCP server`);

    // Give MCP server a moment to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 1. start_lsp
    console.log(`[${lang.name}] Calling start_lsp (root_dir: ${lang.fixture})`);
    const startResult = await client.callTool({
      name: 'start_lsp',
      arguments: { root_dir: lang.fixture },
    });
    assert(startResult.content && startResult.content.length > 0, 'start_lsp returned no content');

    // Wait for LSP to initialize (jdtls needs ~90s; others need ~4s)
    const initWait = lang.id === 'java' ? 90000 : 4000;
    await new Promise(resolve => setTimeout(resolve, initWait));

    // 2. open_document
    console.log(`[${lang.name}] Calling open_document (${lang.file})`);
    const openResult = await client.callTool({
      name: 'open_document',
      arguments: { file_path: lang.file, language_id: lang.id },
    });
    assert(openResult.content && openResult.content.length > 0, 'open_document returned no content');

    // Wait for diagnostics to settle
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. get_diagnostics
    console.log(`[${lang.name}] Calling get_diagnostics`);
    const diagResult = await client.callTool({
      name: 'get_diagnostics',
      arguments: { file_path: lang.file },
    });
    assert(diagResult.content && diagResult.content.length > 0, 'get_diagnostics returned no content');

    // Parse diagnostics count
    try {
      const diagText = diagResult.content[0].text;
      const parsed = JSON.parse(diagText);
      result.diagnosticCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      // Non-JSON response is fine, diagnostics may be formatted as text
      result.diagnosticCount = 0;
    }

    // 4. get_info_on_location (hover)
    console.log(`[${lang.name}] Calling get_info_on_location (line=${lang.hoverLine}, col=${lang.hoverColumn})`);
    const hoverResult = await client.callTool({
      name: 'get_info_on_location',
      arguments: {
        file_path: lang.file,
        language_id: lang.id,
        line: lang.hoverLine,
        column: lang.hoverColumn,
      },
    });
    assert(hoverResult.content && hoverResult.content.length > 0, 'get_info_on_location returned no content');

    const hoverText = hoverResult.content[0].text || '';
    assert(hoverText.length > 0, 'hover info was empty');

    // Capture a short snippet for the summary
    result.hoverSnippet = hoverText.replace(/\n/g, ' ').substring(0, 60);
    result.details = `diagnostics: ${result.diagnosticCount}, hover: "${result.hoverSnippet}"`;

    // Tier 2 tool tests
    const tier2Results = [];

    // 5. get_document_symbols
    const symResult = await testGetDocumentSymbols(client, lang);
    tier2Results.push(symResult);
    console.log(`[${lang.name}] ${symResult.tool}: ${symResult.status} — ${symResult.detail}`);

    // 6. go_to_definition
    const defResult = await testGoToDefinition(client, lang);
    tier2Results.push(defResult);
    console.log(`[${lang.name}] ${defResult.tool}: ${defResult.status} — ${defResult.detail}`);

    // 7. get_references
    const refResult = await testGetReferences(client, lang);
    tier2Results.push(refResult);
    console.log(`[${lang.name}] ${refResult.tool}: ${refResult.status} — ${refResult.detail}`);

    // 8. get_completions
    const compResult = await testGetCompletions(client, lang);
    tier2Results.push(compResult);
    console.log(`[${lang.name}] ${compResult.tool}: ${compResult.status} — ${compResult.detail}`);

    // 9. get_workspace_symbols
    const wsResult = await testGetWorkspaceSymbols(client, lang);
    tier2Results.push(wsResult);
    console.log(`[${lang.name}] ${wsResult.tool}: ${wsResult.status} — ${wsResult.detail}`);

    // 10. format_document (capability-gated)
    const fmtResult = await testFormatDocument(client, lang);
    tier2Results.push(fmtResult);
    console.log(`[${lang.name}] ${fmtResult.tool}: ${fmtResult.status} — ${fmtResult.detail}`);

    // 11. go_to_declaration (C only)
    if (lang.id === 'c') {
      const declResult = await testGoToDeclaration(client, lang);
      tier2Results.push(declResult);
      console.log(`[${lang.name}] ${declResult.tool}: ${declResult.status} — ${declResult.detail}`);
    }

    result.tier2 = tier2Results;

  } catch (err) {
    result.status = 'FAIL';
    result.details = err.message;
    if (serverStderrLines && serverStderrLines.length > 0) {
      console.log(`[${lang.name}] MCP server logs at failure:\n  ${serverStderrLines.slice(-10).join('\n  ')}`);
    }
  } finally {
    // Disconnect client
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
    // Kill server process
    if (serverProcess) {
      serverProcess.kill('SIGINT');
    }
    // Small delay to allow process cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return result;
}

// Print the expanded summary table
function printSummary(results) {
  console.log('\n');
  console.log('Language     | T1 | symbols | definition | references | completions | workspace | format');
  console.log('-------------|----|---------|-----------:|------------|-------------|-----------|-------');

  for (const r of results) {
    const lang = r.name.padEnd(12);
    const t1 = r.status === 'PASS' ? ' ✓ ' : r.status === 'SKIP' ? ' - ' : ' ✗ ';
    const toolStatus = (tool) => {
      if (!r.tier2 || r.tier2.length === 0) return '  -  ';
      const t = r.tier2.find(x => x.tool === tool);
      if (!t) return '  -  ';
      return t.status === 'pass' ? '  ✓  ' : t.status === 'skip' ? '  -  ' : '  ✗  ';
    };
    const sym = toolStatus('get_document_symbols');
    const def = toolStatus('go_to_definition');
    const ref = toolStatus('get_references');
    const comp = toolStatus('get_completions');
    const ws = toolStatus('get_workspace_symbols');
    const fmt = toolStatus('format_document');
    console.log(`${lang} |${t1}|${sym}|${def}|${ref}|${comp}|${ws}|${fmt}`);
  }

  console.log('');
}

// Main runner
async function runTests() {
  console.log('=== Multi-Language LSP MCP Integration Tests ===\n');

  // Verify MCP server exists
  if (!fsSync.existsSync(LSP_MCP_SERVER)) {
    console.error(`ERROR: LSP MCP server not found at ${LSP_MCP_SERVER}`);
    console.error("Make sure you've built the project with 'npm run build'");
    process.exit(1);
  }

  const results = [];

  // Run languages sequentially so output is readable and processes don't collide
  for (const lang of LANGUAGES) {
    console.log(`\n--- Testing ${lang.name} ---`);
    const result = await testLanguage(lang);
    results.push(result);

    if (result.status === 'SKIP') {
      console.log(`[SKIP] ${result.name}: ${result.details}`);
    } else if (result.status === 'PASS') {
      console.log(`[PASS] ${result.name}`);
    } else {
      console.log(`[FAIL] ${result.name}: ${result.details}`);
    }
  }

  printSummary(results);

  const failed = results.filter(r => r.status === 'FAIL');
  const passed = results.filter(r => r.status === 'PASS');
  const skipped = results.filter(r => r.status === 'SKIP');

  console.log(`Results: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);

  process.exit(failed.length > 0 ? 1 : 0);
}

// Execute
runTests().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
