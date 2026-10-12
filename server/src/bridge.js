// WebSocket bridge between MCP server processes and the Chrome extension.
// The first process to bind the port becomes the "hub" that owns the extension connection.
// Later processes (other agents running at the same time) become "leaves" and relay through the hub.
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export const NOT_CONNECTED =
  'Chrome extension is not connected. Make sure Chrome is open, the "Browser Agent Kit" extension is installed and enabled, ' +
  'and its port setting matches the server (default 7851). Click the extension icon to see its connection status and press Reconnect.';

// While no agent is running, the extension probes the port only every few minutes (each failed probe is logged by Chrome).
// When a tool call arrives before it reconnected, the hub opens this page in Chrome: the extension sees the URL, connects
// at once and closes the tab. The page is only ever seen when the extension is missing or disabled.
export const WAKE_PATH = '/wake';
const WAKE_WAIT_MS = 12000;
const WAKE_THROTTLE_MS = 20000;
const WAKE_HTML = `<!doctype html><meta charset="utf-8"><title>Browser Agent Kit</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:40em;margin:4em auto;padding:0 1em;color:#222">
<h2>Browser Agent Kit</h2>
<p>An AI agent needs the browser and is waking the extension. This tab closes by itself once the extension connects.</p>
<p>Still reading this? Then the extension is not running in this Chrome profile: install it from <code>chrome://extensions</code>
(Load unpacked, pick the kit's <code>extension</code> folder), make sure it is enabled and its port matches this server, then press Reconnect in its popup.</p>
</body>`;

function wakeCommands(url, browser) {
  if (browser) return process.platform === 'darwin' && !browser.includes('/') ? [['open', ['-a', browser, url]]] : [[browser, [url]]];
  if (process.platform === 'darwin') return [['open', ['-a', 'Google Chrome', url]], ['open', [url]]];
  if (process.platform === 'win32') return [['cmd', ['/c', 'start', '', url]]];
  return [['google-chrome', [url]], ['google-chrome-stable', [url]], ['chromium', [url]], ['chromium-browser', [url]], ['xdg-open', [url]]];
}

export class Bridge {
  constructor({ port, token = '', extensionId = '', wake = true, browser = '', log = () => {} }) {
    this.port = port;
    this.token = token;
    this.extensionId = extensionId;
    this.wake = wake;
    this.browser = browser;
    this.log = log;
    this.mode = null;
    this.http = null;
    this.wss = null;
    this.ext = null;
    this.extWaiters = [];
    this.lastWake = 0;
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
    for (const w of this.extWaiters.splice(0)) w();
    if (this.ext) this.ext.close();
    if (this.leafSocket) this.leafSocket.close();
    if (this.wss) this.wss.close();
    if (this.http) this.http.close();
  }

  // ---- hub side ----
  #listen() {
    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => {
        if ((req.url || '/').split('?')[0] === WAKE_PATH) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(WAKE_HTML); }
        else { res.writeHead(404); res.end(); }
      });
      const wss = new WebSocketServer({ server: http });
      wss.on('connection', (sock, req) => this.#onConnection(sock, req));
      wss.on('error', reject); // ws re-emits the http server's errors (EADDRINUSE) here; unhandled it would crash the process
      http.once('error', reject);
      http.listen(this.port, '127.0.0.1', () => { this.http = http; this.wss = wss; resolve(); });
    });
  }

  // Resolves as soon as the extension says hello, or after `ms`. Opens the wake tab if allowed.
  #waitForExtension(ms) {
    if (!this.wake) return Promise.resolve();
    this.#openWakeTab();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.extWaiters = this.extWaiters.filter((w) => w !== done); resolve(); }, ms);
      const done = () => { clearTimeout(timer); resolve(); };
      this.extWaiters.push(done);
    });
  }

  #openWakeTab() {
    if (Date.now() - this.lastWake < WAKE_THROTTLE_MS) return;
    this.lastWake = Date.now();
    const url = `http://127.0.0.1:${this.port}${WAKE_PATH}`;
    const candidates = wakeCommands(url, this.browser);
    const tryNext = (i) => {
      if (i >= candidates.length) { this.log('could not open the wake tab: no browser command worked'); return; }
      const [cmd, args] = candidates[i];
      let child;
      try { child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }); } catch { tryNext(i + 1); return; }
      let failed = false;
      child.on('error', () => { if (!failed) { failed = true; tryNext(i + 1); } });
      child.on('exit', (code) => { if (code !== 0 && !failed) { failed = true; tryNext(i + 1); } });
      child.unref();
    };
    this.log(`extension not connected, opening ${url} to wake it`);
    tryNext(0);
  }

  // Browsers always send an Origin header on WebSocket upgrades; Node clients do not.
  // A web page (http/https/file/null origin) must never reach either endpoint, otherwise any
  // site the user visits could drive the browser or impersonate the extension.
  #onConnection(sock, req) {
    const path = (req.url || '/').split('?')[0];
    const origin = req.headers.origin;
    const fromExtension = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
      (!this.extensionId || origin === `chrome-extension://${this.extensionId}`);
    if (path === '/extension') {
      if (origin !== undefined && !fromExtension) { this.log(`rejected /extension from origin ${origin}`); sock.close(1008, 'forbidden origin'); return; }
      this.#onExtension(sock);
    } else if (path === '/client') {
      if (origin !== undefined) { this.log(`rejected /client from origin ${origin}`); sock.close(1008, 'forbidden origin'); return; }
      this.#onLeaf(sock);
    } else {
      sock.close(1008, 'unknown path');
    }
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
        for (const w of this.extWaiters.splice(0)) w();
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
    let authed = !this.token;
    sock.on('message', async (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.type === 'hello') {
        if (this.token && msg.token !== this.token) { sock.close(4001, 'bad token'); return; }
        authed = true;
        return;
      }
      if (!authed) { sock.close(4001, 'hello with token required'); return; }
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

  async #requestExt(method, params, timeout = 60000) {
    if (!this.connected) await this.#waitForExtension(WAKE_WAIT_MS);
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
    sock.on('open', () => sock.send(JSON.stringify({ type: 'hello', token: this.token })));
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
      }, timeout + WAKE_WAIT_MS + 1000);
      this.leafPending.set(id, { resolve, reject, timer });
      this.leafSocket.send(JSON.stringify({ id, method, params, timeout }));
    });
  }
}
