#!/usr/bin/env node
// Native messaging host for the Chrome extension (optional, installed by `browser-agent-kit native`).
// Chrome starts this process when the extension connects. It watches the hub port with silent TCP probes and tells
// the extension when a server appears, so the extension never has to open WebSockets that Chrome would log as errors.
// It also pings every 25s, which keeps the extension's service worker alive while Chrome runs.
//
// Protocol (Chrome native messaging: 4-byte little-endian length + JSON, both directions):
//   extension -> host: { type: 'watch', port }
//   host -> extension: { type: 'up' | 'down', port } on transitions, { type: 'ping' } periodically, { type: 'hello', pid }
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// Pulls complete messages out of `buf`; returns { messages, rest }.
export function decode(buf) {
  const messages = [];
  let off = 0;
  while (buf.length - off >= 4) {
    const len = buf.readUInt32LE(off);
    if (buf.length - off - 4 < len) break;
    try { messages.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString('utf8'))); } catch { /* skip bad frame */ }
    off += 4 + len;
  }
  return { messages, rest: buf.subarray(off) };
}

export function probe(port, timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export function run({ input = process.stdin, output = process.stdout, pollMs = 1500, pingMs = 25000 } = {}) {
  let port = 0, up = null, buf = Buffer.alloc(0), timer = null;
  const send = (m) => { try { output.write(encode(m)); } catch { /* pipe closed */ } };
  const tick = async () => {
    if (!port) return;
    const now = await probe(port);
    if (now !== up) { up = now; send({ type: now ? 'up' : 'down', port }); }
  };
  input.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages, rest } = decode(buf);
    buf = rest;
    for (const m of messages) {
      if (m && m.type === 'watch' && Number(m.port) > 0) { port = Number(m.port); up = null; tick(); }
    }
  });
  input.on('end', () => process.exit(0));
  input.on('error', () => process.exit(0));
  output.on('error', () => process.exit(0));
  timer = setInterval(tick, pollMs);
  const ping = setInterval(() => send({ type: 'ping' }), pingMs);
  send({ type: 'hello', pid: process.pid });
  return () => { clearInterval(timer); clearInterval(ping); };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
