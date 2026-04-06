// Demo 2: Semantic tools - needs TS server to be fully ready
// Uses a new process with a long initialization wait

import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const TS_PROJECT = '/Users/dayna.blackwell/code/LSP-MCP/test/ts-project';
const EXAMPLE_FILE = `${TS_PROJECT}/src/example.ts`;
const CONSUMER_FILE = `${TS_PROJECT}/src/consumer.ts`;
const LSP_MCP = '/Users/dayna.blackwell/code/LSP-MCP/dist/index.js';
const TS_BIN = '/Users/dayna.blackwell/code/LSP-MCP/node_modules/.bin/typescript-language-server';

class CustomTransport {
  constructor(proc) {
    this.proc = proc;
    this.readBuffer = new ReadBuffer();
    this.onmessage = null; this.onerror = null; this.onclose = null;
    proc.stdout.on('data', d => {
      this.readBuffer.append(d);
      while (true) {
        const msg = this.readBuffer.readMessage();
        if (!msg) break;
        if (this.onmessage) this.onmessage(msg);
      }
    });
    proc.on('close', () => { if (this.onclose) this.onclose(); });
  }
  async start() {}
  async close() { this.readBuffer.clear(); }
  send(msg) {
    return new Promise(resolve => {
      const json = serializeMessage(msg);
      if (this.proc.stdin.write(json)) resolve();
      else this.proc.stdin.once('drain', resolve);
    });
  }
}

async function callTool(client, name, args) {
  try {
    return await client.callTool({ name, arguments: args });
  } catch(e) {
    return { error: e.message };
  }
}

async function main() {
  const proc = spawn('node', [LSP_MCP, 'typescript', TS_BIN, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LOG_LEVEL: 'emergency' }
  });
  
  const stderrLines = [];
  proc.stderr.on('data', d => {
    process.stderr.write(d);
    stderrLines.push(d.toString());
  });

  const transport = new CustomTransport(proc);
  const client = new Client({ name: 'demo', version: '1.0' }, { capabilities: { tools: true } });
  await client.connect(transport);

  const results = {};

  // start_lsp first
  await callTool(client, 'start_lsp', { root_dir: TS_PROJECT });
  process.stderr.write('start_lsp done\n');
  
  // Long wait for TS server full init
  await new Promise(r => setTimeout(r, 8000));
  process.stderr.write('long wait done\n');

  // open both files
  await callTool(client, 'open_document', { file_path: EXAMPLE_FILE, language_id: 'typescript' });
  await callTool(client, 'open_document', { file_path: CONSUMER_FILE, language_id: 'typescript' });
  process.stderr.write('files opened\n');

  await new Promise(r => setTimeout(r, 3000));
  process.stderr.write('post-open wait done\n');

  // get_info_on_location
  results.get_info_on_location = await callTool(client, 'get_info_on_location', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 4, column: 17
  });
  process.stderr.write(`get_info_on_location done: ${JSON.stringify(results.get_info_on_location).slice(0,80)}\n`);

  // get_completions
  results.get_completions = await callTool(client, 'get_completions', {
    file_path: CONSUMER_FILE, language_id: 'typescript', line: 4, column: 14
  });
  process.stderr.write(`get_completions done: ${JSON.stringify(results.get_completions).slice(0,80)}\n`);

  // get_references
  results.get_references = await callTool(client, 'get_references', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 11, column: 18, include_declaration: true
  });
  process.stderr.write(`get_references done: ${JSON.stringify(results.get_references).slice(0,80)}\n`);

  // go_to_definition
  results.go_to_definition = await callTool(client, 'go_to_definition', {
    file_path: CONSUMER_FILE, language_id: 'typescript', line: 7, column: 16
  });
  process.stderr.write(`go_to_definition done: ${JSON.stringify(results.go_to_definition).slice(0,80)}\n`);

  // get_document_symbols
  results.get_document_symbols = await callTool(client, 'get_document_symbols', {
    file_path: EXAMPLE_FILE, language_id: 'typescript'
  });
  process.stderr.write(`get_document_symbols done\n`);

  // get_workspace_symbols
  results.get_workspace_symbols = await callTool(client, 'get_workspace_symbols', { query: 'Greeter' });
  process.stderr.write(`get_workspace_symbols done\n`);

  // get_signature_help - inside add(1, 2) in consumer.ts
  results.get_signature_help = await callTool(client, 'get_signature_help', {
    file_path: CONSUMER_FILE, language_id: 'typescript', line: 4, column: 14
  });
  process.stderr.write(`get_signature_help done\n`);

  // get_code_actions on the undefinedVariable line (line 44)
  results.get_code_actions = await callTool(client, 'get_code_actions', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', start_line: 44, start_column: 1, end_line: 44, end_column: 35
  });
  process.stderr.write(`get_code_actions done\n`);

  // format_document
  results.format_document = await callTool(client, 'format_document', {
    file_path: EXAMPLE_FILE, language_id: 'typescript'
  });
  process.stderr.write(`format_document done\n`);

  // rename_symbol
  results.rename_symbol = await callTool(client, 'rename_symbol', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 4, column: 17, new_name: 'addNumbers'
  });
  process.stderr.write(`rename_symbol done\n`);

  // prepare_rename
  results.prepare_rename = await callTool(client, 'prepare_rename', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 4, column: 17
  });
  process.stderr.write(`prepare_rename done\n`);

  // go_to_type_definition - 'alice' variable (line 7, col 7 in consumer.ts)
  results.go_to_type_definition = await callTool(client, 'go_to_type_definition', {
    file_path: CONSUMER_FILE, language_id: 'typescript', line: 7, column: 7
  });
  process.stderr.write(`go_to_type_definition done\n`);

  // go_to_implementation - greet method (line 30, col 3)
  results.go_to_implementation = await callTool(client, 'go_to_implementation', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 30, column: 3
  });
  process.stderr.write(`go_to_implementation done\n`);

  // go_to_declaration - add (line 4, col 17)
  results.go_to_declaration = await callTool(client, 'go_to_declaration', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 4, column: 17
  });
  process.stderr.write(`go_to_declaration done\n`);

  // get_diagnostics with all open files
  results.get_diagnostics_all = await callTool(client, 'get_diagnostics', {});
  process.stderr.write(`get_diagnostics_all done\n`);

  console.log(JSON.stringify(results, null, 2));
  proc.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
