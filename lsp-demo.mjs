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
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
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
  
  proc.stderr.on('data', d => process.stderr.write(d));

  const transport = new CustomTransport(proc);
  const client = new Client({ name: 'demo', version: '1.0' }, { capabilities: { tools: true } });
  await client.connect(transport);

  const results = {};

  // start_lsp
  results.start_lsp = await callTool(client, 'start_lsp', { root_dir: TS_PROJECT });
  process.stderr.write('start_lsp done\n');
  
  // Wait for TS server
  await new Promise(r => setTimeout(r, 4000));
  process.stderr.write('wait done\n');

  // open_document
  results.open_document = await callTool(client, 'open_document', { file_path: EXAMPLE_FILE, language_id: 'typescript' });
  process.stderr.write('open_document done\n');
  
  await callTool(client, 'open_document', { file_path: CONSUMER_FILE, language_id: 'typescript' });
  process.stderr.write('open consumer done\n');
  
  await new Promise(r => setTimeout(r, 2000));

  // get_diagnostics (waits up to 25s for TS to emit diagnostics)
  results.get_diagnostics = await callTool(client, 'get_diagnostics', { file_path: EXAMPLE_FILE });
  process.stderr.write('get_diagnostics done\n');

  // did_change_watched_files - notification only, instant
  results.did_change_watched_files = await callTool(client, 'did_change_watched_files', { changes: [{ uri: `file://${EXAMPLE_FILE}`, type: 2 }] });
  process.stderr.write('did_change_watched_files done\n');

  // close_document
  results.close_document = await callTool(client, 'close_document', { file_path: EXAMPLE_FILE });
  process.stderr.write('close_document done\n');

  // restart_lsp_server - no set_log_level (would corrupt stdout)
  results.restart_lsp_server = await callTool(client, 'restart_lsp_server', {});
  process.stderr.write('restart_lsp_server done\n');

  console.log(JSON.stringify(results, null, 2));
  proc.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
