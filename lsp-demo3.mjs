// Demo 3: debug logging, capture TS server interaction
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const TS_PROJECT = '/Users/dayna.blackwell/code/LSP-MCP/test/ts-project';
const EXAMPLE_FILE = `${TS_PROJECT}/src/example.ts`;
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
    env: { ...process.env, LOG_LEVEL: 'debug' }  // debug to see what's happening
  });
  
  // Redirect all stderr to a file
  const { createWriteStream } = await import('fs');
  const logFile = createWriteStream('/tmp/lsp-debug.txt');
  proc.stderr.on('data', d => logFile.write(d));

  const transport = new CustomTransport(proc);
  const client = new Client({ name: 'demo', version: '1.0' }, { capabilities: { tools: true } });
  await client.connect(transport);

  // start_lsp
  const startResult = await callTool(client, 'start_lsp', { root_dir: TS_PROJECT });
  process.stderr.write(`start_lsp: ${startResult.content[0].text}\n`);
  
  // Wait for TS server
  await new Promise(r => setTimeout(r, 8000));
  process.stderr.write('wait done\n');

  // open file
  await callTool(client, 'open_document', { file_path: EXAMPLE_FILE, language_id: 'typescript' });
  process.stderr.write('file opened\n');
  
  await new Promise(r => setTimeout(r, 3000));
  
  // Try get_info_on_location
  const hover = await callTool(client, 'get_info_on_location', {
    file_path: EXAMPLE_FILE, language_id: 'typescript', line: 4, column: 17
  });
  process.stderr.write(`hover result: ${JSON.stringify(hover)}\n`);
  
  logFile.end();
  proc.kill();
  process.exit(0);
}

main().catch(e => { process.stderr.write(`ERROR: ${e}\n`); process.exit(1); });
