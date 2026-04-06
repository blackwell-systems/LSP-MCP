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
  },
  {
    name: 'Java',
    id: 'java',
    binary: 'jdtls',
    serverArgs: [],
    fixture: path.join(__dirname, 'fixtures/java'),  // jdtls needs project root, not src/
    file: path.join(__dirname, 'fixtures/java', 'src', 'Person.java'),
    hoverLine: 4,     // line with 'public class Person'
    hoverColumn: 14,  // column on 'Person'
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

// Run tests for a single language
async function testLanguage(lang) {
  const result = {
    name: lang.name,
    status: 'PASS',
    details: '',
    diagnosticCount: 0,
    hoverSnippet: '',
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

  try {
    // Verify fixture file exists
    await fs.access(lang.file);

    // Spawn MCP server: node dist/index.js <lang_id> <binary_full_path> [serverArgs...]
    const spawnArgs = [LSP_MCP_SERVER, lang.id, binaryPath, ...lang.serverArgs];
    console.log(`\n[${lang.name}] Starting MCP server: node ${spawnArgs.join(' ')}`);

    serverProcess = spawn('node', spawnArgs, {
      env: { ...process.env, LOG_LEVEL: 'error' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.stderr.on('data', (data) => {
      // Suppress noisy LSP server stderr; only log in verbose mode
      if (process.env.VERBOSE) {
        process.stderr.write(`[${lang.name}] STDERR: ${data.toString().trim()}\n`);
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

    // Wait for LSP to initialize
    await new Promise(resolve => setTimeout(resolve, 4000));

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

  } catch (err) {
    result.status = 'FAIL';
    result.details = err.message;
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

// Print the summary table
function printSummary(results) {
  console.log('\n');
  console.log('Language     | Status | Details');
  console.log('-------------|--------|' + '-'.repeat(60));

  for (const r of results) {
    const lang = r.name.padEnd(12);
    const status = r.status.padEnd(6);
    console.log(`${lang} | ${status} | ${r.details}`);
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
