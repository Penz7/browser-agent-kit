// End-to-end protocol test: real MCP client <-> real server <-> fake extension over WebSocket.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7900 + Math.floor(Math.random() * 100);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const calls = [];

function fakeExtension() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryConnect = () => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/extension`);
      ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', token: 'secret', version: 'test' })); resolve(ws); });
      ws.on('error', () => { if (++attempts > 50) reject(new Error('could not reach server')); else setTimeout(tryConnect, 100); });
      ws.on('message', (buf) => {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
        calls.push(msg.method);
        const page = { url: 'https://example.com/', title: 'Example' };
        const results = {
          'tabs.context': [{ tabId: 7, active: true, allowed: true, ...page }],
          'tabs.create': { tabId: 8, ...page },
          screenshot: { data: PNG, mime: 'image/png', width: 1, height: 1, scale: 1, viewport: { width: 1, height: 1 }, ...page },
          read_page: { ...page, lines: ['[ref_1] button "Sign in"', 'h1 "Example Domain"'], truncated: false, iframes: 0, viewport: { width: 1280, height: 800 }, scroll: { x: 0, y: 0, pageHeight: 800 } },
          click: { x: 10, y: 20, covered: false, target: 'Sign in', ...page },
          find: { url: page.url, matches: [{ score: 13, line: '[ref_1] button "Sign in"' }] },
          form_input: { results: [{ ref: 'ref_1', ok: true, name: 'Email' }] },
          evaluate: { type: 'object', value: { a: 1 } }
        };
        if (msg.method === 'navigate' && msg.params.url === 'chrome://bad') return ws.send(JSON.stringify({ id: msg.id, ok: false, error: 'Site not allowed: chrome://bad' }));
        if (msg.method === 'navigate') return ws.send(JSON.stringify({ id: msg.id, ok: true, result: { tabId: msg.params.tabId, ...page } }));
        const result = results[msg.method];
        if (result === undefined) return ws.send(JSON.stringify({ id: msg.id, ok: false, error: 'unhandled in fake: ' + msg.method }));
        ws.send(JSON.stringify({ id: msg.id, ok: true, result }));
      });
    };
    tryConnect();
  });
}

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); }

const env = { ...process.env, BROWSER_KIT_PORT: String(PORT), BROWSER_KIT_TOKEN: 'secret' };
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'src', 'index.js')], env });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
assert(tools.length >= 14, `server exposes ${tools.length} tools`);

let r = await client.callTool({ name: 'tabs_context', arguments: {} });
assert(r.isError, 'without extension connected, tool returns a clear error');
assert(/not connected/i.test(r.content[0].text), 'error text explains how to connect the extension');

const ext = await fakeExtension();
await new Promise((res) => setTimeout(res, 200));

r = await client.callTool({ name: 'tabs_context', arguments: {} });
assert(!r.isError && /tabId=7/.test(r.content[0].text), 'tabs_context lists tabs');

r = await client.callTool({ name: 'read_page', arguments: { tabId: 7, filter: 'interactive' } });
assert(r.content[1].text.includes('<untrusted_page_content') && r.content[1].text.includes('ref_1'), 'read_page wraps page content as untrusted and lists refs');

r = await client.callTool({ name: 'computer', arguments: { tabId: 7, action: 'left_click', ref: 'ref_1' } });
assert(!r.isError && r.content.some((c) => c.type === 'image'), 'click by ref returns a screenshot');
assert(calls.filter((c) => c === 'click').length === 1, 'click command reached the extension');

r = await client.callTool({ name: 'computer', arguments: { tabId: 7, action: 'screenshot' } });
assert(r.content[0].type === 'image' && r.content[0].mimeType === 'image/png', 'screenshot returns an image block');

r = await client.callTool({ name: 'navigate', arguments: { tabId: 7, url: 'chrome://bad' } });
assert(r.isError && /not allowed/i.test(r.content[0].text), 'extension errors are relayed to the agent');

r = await client.callTool({ name: 'javascript_tool', arguments: { tabId: 7, code: '({a:1})' } });
assert(r.content[0].text.includes('"a": 1'), 'javascript_tool returns JSON result');

r = await client.callTool({ name: 'browser_batch', arguments: { steps: [
  { tool: 'navigate', args: { tabId: 7, url: 'example.com' } },
  { tool: 'form_input', args: { tabId: 7, fields: [{ ref: 'ref_1', value: 'x' }] } },
  { tool: 'computer', args: { tabId: 7, action: 'left_click', ref: 'ref_1' } }
] } });
const batchShots = r.content.filter((c) => c.type === 'image').length;
assert(!r.isError && batchShots === 1, 'browser_batch runs all steps and returns exactly one screenshot');

// Second server process on the same port must relay through the first (leaf mode).
const t2 = new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'src', 'index.js')], env });
const c2 = new Client({ name: 'smoke2', version: '0.0.0' });
await c2.connect(t2);
r = await c2.callTool({ name: 'tabs_context', arguments: {} });
assert(!r.isError && /tabId=7/.test(r.content[0].text), 'second agent process relays through the hub');

await c2.close();
ext.close();
await client.close();
console.log('\nAll smoke tests passed.');
process.exit(0);
