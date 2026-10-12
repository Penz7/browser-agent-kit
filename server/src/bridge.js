// WebSocket bridge between MCP server processes and the Chrome extension.
// The first process to bind the port becomes the "hub" that owns the extension connection.
// Later processes (other agents running at the same time) become "leaves" and relay through the hub.
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

export const NOT_CONNECTED =
  'Chrome extension is not connected. Make sure Chrome is open, the "Browser Agent Kit" extension is installed and enabled, ' +
  'and its port setting matches the server (default 7851). Click the extension icon to see its connection status.';

export class Bridge {
  constructor({ port, token = '', log = () => {} }) {
    this.port = port;
    this.token = token;
    this.log = log;
    this.mode = null;
    this.wss = null;
    this.ext = null;
    this.extPending = new Map();
    this.leafSocket = null;
    this.leafPending = new Map();
    this.leaves = new Set();
    this.closed = false;
  }

  async start() {
    if (this.closed) return;
    try {
      await this.#listen();
      this.mode = 'hub';
      this.log(`hub listening on ws://127.0.0.1:${this.port}`);
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      this.mode = 'leaf';
      this.log(`port ${this.port} busy, relaying through existing hub`);
      this.#connectLeaf();
    }
  }

  get connected() {
    if (this.mode === 'hub') return !!(this.ext && this.ext.readyState === WebSocket.OPEN);
    return !!(this.leafSocket && this.leafSocket.readyState === WebSocket.OPEN);
  }

  async request(method, params = {}, timeout = 60000) {
    if (this.mode === 'hub') return this.#requestExt(method, params, timeout);
    return this.#requestLeaf(method, params, timeout);
  }

  close() {
    this.closed = true;
    for (const p of this.extPending.values()) { clearTimeout(p.timer); p.reject(new Error('closing')); }
    for (const p of this.leafPending.values()) { clearTimeout(p.timer); p.reject(new Error('closing')); }
    if (this.ext) this.ext.close();
    if (this.leafSocket) this.leafSocket.close();
    if (this.wss) this.wss.close();
  }

  // ---- hub side ----
  #listen() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
      wss.once('listening', () => { this.wss = wss; resolve(); });
      wss.once('error', reject);
      wss.on('connection', (sock, req) => this.#onConnection(sock, req));
    });
  }

  #onConnection(sock, req) {
    const path = (req.url || '/').split('?')[0];
    if (path === '/extension') this.#onExtension(sock);
    else if (path === '/client') this.#onLeaf(sock);
    else sock.close(1008, 'unknown path');
  }

  #onExtension(sock) {
    let ready = false;
    sock.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'hello') {
        if (this.token && msg.token !== this.token) { sock.close(4001, 'bad token'); return; }
        ready = true;
        if (this.ext && this.ext !== sock) this.ext.close(4000, 'replaced by a newer connection');
        this.ext = sock;
        this.log(`extension connected (v${msg.version || '?'})`);
        return;
      }
      if (!ready || msg.type === 'pong') return;
      const p = msg.id && this.extPending.get(msg.id);
      if (!p) return;
      this.extPending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'unknown extension error'));
    });
    const ping = setInterval(() => { if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'ping' })); }, 20000);
    sock.on('close', () => {
      clearInterval(ping);
      if (this.ext !== sock) return;
      this.ext = null;
      this.log('extension disconnected');
      for (const p of this.extPending.values()) { clearTimeout(p.timer); p.reject(new Error('Extension disconnected while the command was running.')); }
      this.extPending.clear();
    });
    sock.on('error', () => {});
  }

  #onLeaf(sock) {
    this.leaves.add(sock);
    sock.on('message', async (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (!msg.id || !msg.method) return;
      try {
        const result = await this.#requestExt(msg.method, msg.params, msg.timeout);
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id: msg.id, ok: true, result }));
      } catch (e) {
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ id: msg.id, ok: false, error: e.message }));
      }
    });
    sock.on('close', () => this.leaves.delete(sock));
    sock.on('error', () => {});
  }

  #requestExt(method, params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.ext || this.ext.readyState !== WebSocket.OPEN) return reject(new Error(NOT_CONNECTED));
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.extPending.delete(id);
        reject(new Error(`Timed out after ${timeout / 1000}s waiting for the extension (${method}).`));
      }, timeout);
      this.extPending.set(id, { resolve, reject, timer });
      this.ext.send(JSON.stringify({ id, method, params }));
    });
  }

  // ---- leaf side ----
  #connectLeaf() {
    if (this.closed) return;
    const sock = new WebSocket(`ws://127.0.0.1:${this.port}/client`);
    this.leafSocket = sock;
    sock.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      const p = msg.id && this.leafPending.get(msg.id);
      if (!p) return;
      this.leafPending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'unknown error'));
    });
    const retry = () => {
      if (this.leafSocket !== sock) return;
      this.leafSocket = null;
      for (const p of this.leafPending.values()) { clearTimeout(p.timer); p.reject(new Error('Lost connection to the hub process.')); }
      this.leafPending.clear();
      if (!this.closed) setTimeout(() => this.start().catch((e) => this.log('restart failed: ' + e.message)), 1000);
    };
    sock.on('close', retry);
    sock.on('error', () => {});
  }

  #requestLeaf(method, params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.leafSocket || this.leafSocket.readyState !== WebSocket.OPEN) return reject(new Error(NOT_CONNECTED));
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.leafPending.delete(id);
        reject(new Error(`Timed out after ${timeout / 1000}s waiting for the browser (${method}).`));
      }, timeout + 1000);
      this.leafPending.set(id, { resolve, reject, timer });
      this.leafSocket.send(JSON.stringify({ id, method, params, timeout }));
    });
  }
}
