// Service worker: keeps a WebSocket to the local MCP server and executes browser commands.
import { getSettings, hostAllowed, normalizeUrl } from './settings.js';
import * as cdp from './cdp.js';
import { agentDom } from './dom.js';
import { parseCombo, parseModifiers, macCommand, MOD } from './keys.js';

const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_MAX_WIDTH = 1024;

let settings = null;
const settingsReady = getSettings().then((s) => (settings = s));
const cfg = async () => settings || settingsReady;

let ws = null;
let reconnectTimer = null;
let backoff = 1000;
let connectedAt = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- connection ----------
function wsOpen() { return !!(ws && ws.readyState === WebSocket.OPEN); }

async function connect() {
  const s = await cfg();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  let sock;
  try { sock = new WebSocket(`ws://127.0.0.1:${s.port}/extension`); } catch { scheduleReconnect(); return; }
  ws = sock;
  sock.onopen = () => {
    backoff = 1000;
    connectedAt = Date.now();
    sock.send(JSON.stringify({ type: 'hello', token: s.token, version: VERSION }));
  };
  sock.onmessage = (ev) => handleMessage(ev.data);
  sock.onclose = () => { if (ws === sock) { ws = null; connectedAt = null; } scheduleReconnect(); };
  sock.onerror = () => {};
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, backoff);
  backoff = Math.min(backoff * 2, 10000);
}

function reply(obj) { if (wsOpen()) ws.send(JSON.stringify(obj)); }

async function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'ping') { reply({ type: 'pong' }); return; }
  if (!msg.id || !msg.method) return;
  try {
    const handler = handlers[msg.method];
    if (!handler) throw new Error(`Unknown method: ${msg.method}`);
    const result = await handler(msg.params || {});
    reply({ id: msg.id, ok: true, result });
  } catch (e) {
    reply({ id: msg.id, ok: false, error: (e && e.message) || String(e) });
  }
}

chrome.alarms.create('ak-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ak-keepalive') connect(); });
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  settings = await getSettings();
  if (changes.port || changes.token) { backoff = 1000; if (ws) ws.close(); else connect(); }
});
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg && msg.type === 'status') {
    respond({ connected: wsOpen(), port: settings ? settings.port : null, since: connectedAt, version: VERSION });
    return;
  }
  if (msg && msg.type === 'reconnect') { backoff = 1000; if (ws) ws.close(); else connect(); respond({ ok: true }); }
});
connect();

// ---------- helpers ----------
async function getTab(tabId) {
  if (tabId == null) {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!t) throw new Error('No active tab. Call tabs_context and pass a tabId.');
    return t;
  }
  try { return await chrome.tabs.get(Number(tabId)); }
  catch { throw new Error(`Tab ${tabId} not found. Call tabs_context to get current tab ids.`); }
}

async function assertAllowed(url) {
  const s = await cfg();
  if (!hostAllowed(url || '', s)) {
    throw new Error(`Site not allowed: ${url || '(empty)'}. Ask the user to click the Browser Agent Kit icon in Chrome and press "Allow this site" (or enable "Allow all sites"). chrome:// pages can never be controlled.`);
  }
}

async function allowedTab(tabId) {
  const tab = await getTab(tabId);
  await assertAllowed(tab.url);
  return tab;
}

async function focusTab(tab) {
  try { if (!tab.active) await chrome.tabs.update(tab.id, { active: true }); } catch { /* ignore */ }
}

async function prepare(tabId) {
  const tab = await allowedTab(tabId);
  await focusTab(tab);
  const s = await cfg();
  await cdp.attach(tab.id, s.dialogPolicy);
  return tab;
}

async function inject(tabId, action, args) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId }, func: agentDom, args: [action, args || {}] });
  } catch (e) {
    throw new Error(`Cannot run on this page: ${e.message}`);
  }
  const r = results && results[0];
  if (!r) throw new Error('Script injection returned nothing (page may still be loading).');
  if (r.result && r.result.error) throw new Error(r.result.error);
  return r.result;
}

async function waitForLoad(tabId, timeout = 15000) {
  const start = Date.now();
  await sleep(150);
  while (Date.now() - start < timeout) {
    let t;
    try { t = await chrome.tabs.get(tabId); } catch { return; }
    if (t.status === 'complete') return;
    await sleep(100);
  }
}

async function settle(tabId) {
  await sleep(300);
  await waitForLoad(tabId, 10000);
  await sleep(100);
}

async function viewport(tabId) {
  const m = await cdp.send(tabId, 'Page.getLayoutMetrics');
  const v = m.cssVisualViewport || m.visualViewport;
  return { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
}

const scaleFor = (vp, maxWidth) => Math.min(1, (maxWidth || DEFAULT_MAX_WIDTH) / vp.width);

// Converts a point from screenshot pixel space (or a ref) into CSS viewport pixels.
async function resolvePoint(tabId, p) {
  if (p.ref) {
    const r = await inject(tabId, 'resolve', { ref: p.ref });
    await sleep(80);
    return r;
  }
  if (typeof p.x !== 'number' || typeof p.y !== 'number') throw new Error('Provide coordinate [x, y] or a ref from read_page/find.');
  const s = scaleFor(await viewport(tabId), p.maxWidth);
  return { x: p.x / s, y: p.y / s };
}

const mouse = (tabId, type, x, y, extra = {}) => cdp.send(tabId, 'Input.dispatchMouseEvent', { type, x, y, ...extra });

async function pressKey(tabId, { modifiers, key }) {
  const mods = [];
  if (modifiers & MOD.ctrl) mods.push({ key: 'Control', code: 'ControlLeft', vk: 17 });
  if (modifiers & MOD.shift) mods.push({ key: 'Shift', code: 'ShiftLeft', vk: 16 });
  if (modifiers & MOD.alt) mods.push({ key: 'Alt', code: 'AltLeft', vk: 18 });
  if (modifiers & MOD.meta) mods.push({ key: 'Meta', code: 'MetaLeft', vk: 91 });
  for (const m of mods) await cdp.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, modifiers });
  const hasText = !!key.text && !(modifiers & (MOD.ctrl | MOD.meta | MOD.alt));
  const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.vk, nativeVirtualKeyCode: key.vk, modifiers };
  const commands = macCommand(modifiers, key);
  await cdp.send(tabId, 'Input.dispatchKeyEvent', {
    type: hasText ? 'keyDown' : 'rawKeyDown', ...base,
    ...(hasText ? { text: key.text, unmodifiedText: key.text } : {}),
    ...(commands ? { commands } : {})
  });
  await cdp.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  for (const m of mods.reverse()) await cdp.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk });
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(s);
}

function tabInfo(t) {
  return { tabId: t.id, windowId: t.windowId, url: t.url, title: t.title, active: t.active, status: t.status };
}

// ---------- command handlers ----------
const handlers = {
  async 'tabs.context'() {
    const tabs = await chrome.tabs.query({});
    const s = await cfg();
    return tabs.map((t) => ({ ...tabInfo(t), allowed: hostAllowed(t.url || '', s) }));
  },

  async 'tabs.create'({ url }) {
    const target = url ? normalizeUrl(url) : 'about:blank';
    await assertAllowed(target);
    const tab = await chrome.tabs.create({ url: target, active: true });
    await waitForLoad(tab.id, 30000);
    return tabInfo(await chrome.tabs.get(tab.id));
  },

  async 'tabs.close'({ tabId }) {
    await getTab(tabId);
    await chrome.tabs.remove(Number(tabId));
    return { closed: Number(tabId) };
  },

  async 'tabs.activate'({ tabId }) {
    const tab = await getTab(tabId);
    await chrome.tabs.update(tab.id, { active: true });
    return tabInfo(await chrome.tabs.get(tab.id));
  },

  async navigate({ tabId, url }) {
    const tab = await getTab(tabId);
    if (url === 'back' || url === 'forward') {
      await assertAllowed(tab.url);
      if (url === 'back') await chrome.tabs.goBack(tab.id); else await chrome.tabs.goForward(tab.id);
      await waitForLoad(tab.id, 15000);
    } else {
      const target = normalizeUrl(url);
      await assertAllowed(target);
      await chrome.tabs.update(tab.id, { url: target });
      await waitForLoad(tab.id, 30000);
    }
    await sleep(200);
    return tabInfo(await chrome.tabs.get(tab.id));
  },

  async screenshot({ tabId, maxWidth, format, quality, region }) {
    const tab = await prepare(tabId);
    const vp = await viewport(tab.id);
    const mw = maxWidth || DEFAULT_MAX_WIDTH;
    const shot = await cdp.send(tab.id, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + shot.data)).blob());
    const dpr = bmp.width / vp.width;
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height, cssW = vp.width, cssH = vp.height, scale;
    if (region) {
      const s0 = scaleFor(vp, mw);
      const [x0, y0, x1, y1] = region.map((v) => v / s0);
      cssW = x1 - x0; cssH = y1 - y0;
      if (cssW <= 0 || cssH <= 0) { bmp.close(); throw new Error('region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0'); }
      sx = x0 * dpr; sy = y0 * dpr; sw = cssW * dpr; sh = cssH * dpr;
      scale = Math.min(mw / cssW, 2);
    } else {
      scale = scaleFor(vp, mw);
    }
    const outW = Math.max(1, Math.round(cssW * scale));
    const outH = Math.max(1, Math.round(cssH * scale));
    const canvas = new OffscreenCanvas(outW, outH);
    canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, outW, outH);
    bmp.close();
    const png = format === 'png';
    const blob = await canvas.convertToBlob({ type: png ? 'image/png' : 'image/jpeg', quality: (quality || 85) / 100 });
    return {
      data: await blobToBase64(blob), mime: png ? 'image/png' : 'image/jpeg',
      width: outW, height: outH, scale, zoomed: !!region, viewport: vp, url: tab.url, title: tab.title
    };
  },

  async click(p) {
    const tab = await prepare(p.tabId);
    const pt = await resolvePoint(tab.id, p);
    const modifiers = p.modifiers ? parseModifiers(p.modifiers) : 0;
    const button = p.button || 'left';
    await mouse(tab.id, 'mouseMoved', pt.x, pt.y, { modifiers });
    for (let i = 1; i <= (p.clickCount || 1); i++) {
      await mouse(tab.id, 'mousePressed', pt.x, pt.y, { button, clickCount: i, modifiers });
      await mouse(tab.id, 'mouseReleased', pt.x, pt.y, { button, clickCount: i, modifiers });
    }
    await settle(tab.id);
    const t = await chrome.tabs.get(tab.id);
    return { x: pt.x, y: pt.y, covered: !!pt.covered, target: pt.name, url: t.url, title: t.title };
  },

  async mouse_move(p) {
    const tab = await prepare(p.tabId);
    const pt = await resolvePoint(tab.id, p);
    await mouse(tab.id, 'mouseMoved', pt.x, pt.y);
    await sleep(100);
    return { x: pt.x, y: pt.y };
  },

  async drag(p) {
    const tab = await prepare(p.tabId);
    const a = await resolvePoint(tab.id, { ...p.from, maxWidth: p.maxWidth });
    const b = await resolvePoint(tab.id, { ...p.to, maxWidth: p.maxWidth });
    await mouse(tab.id, 'mouseMoved', a.x, a.y);
    await mouse(tab.id, 'mousePressed', a.x, a.y, { button: 'left', clickCount: 1 });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await mouse(tab.id, 'mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { button: 'left', buttons: 1 });
      await sleep(16);
    }
    await mouse(tab.id, 'mouseReleased', b.x, b.y, { button: 'left', clickCount: 1 });
    await settle(tab.id);
    return { from: a, to: b };
  },

  async type({ tabId, text }) {
    const tab = await prepare(tabId);
    for (const ch of String(text)) {
      if (ch === '\n' || ch === '\r') { await pressKey(tab.id, parseCombo('Enter')); continue; }
      await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
      await cdp.send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
    await settle(tab.id);
    return { typed: String(text).length };
  },

  async key({ tabId, combo, repeat }) {
    const tab = await prepare(tabId);
    const combos = String(combo).trim().split(/\s+/);
    for (let i = 0; i < (repeat || 1); i++) for (const c of combos) await pressKey(tab.id, parseCombo(c));
    await settle(tab.id);
    return { pressed: combo };
  },

  async scroll(p) {
    const tab = await prepare(p.tabId);
    let pt;
    if (p.ref || typeof p.x === 'number') pt = await resolvePoint(tab.id, p);
    else { const vp = await viewport(tab.id); pt = { x: vp.width / 2, y: vp.height / 2 }; }
    const amt = (p.amount == null ? 3 : p.amount) * 100;
    const [dx, dy] = { up: [0, -amt], down: [0, amt], left: [-amt, 0], right: [amt, 0] }[p.direction || 'down'];
    await mouse(tab.id, 'mouseMoved', pt.x, pt.y);
    await mouse(tab.id, 'mouseWheel', pt.x, pt.y, { deltaX: dx, deltaY: dy });
    await sleep(350);
    return inject(tab.id, 'scrollInfo', {});
  },

  async wait({ tabId, ms }) {
    await getTab(tabId);
    await sleep(Math.min(Number(ms) || 1000, 30000));
    return { waited: ms };
  },

  async read_page({ tabId, mode, maxLines }) {
    const tab = await allowedTab(tabId);
    return { tabId: tab.id, ...(await inject(tab.id, 'snapshot', { mode, maxLines })) };
  },

  async find({ tabId, query, limit }) {
    const tab = await allowedTab(tabId);
    return inject(tab.id, 'find', { query, limit });
  },

  async get_text({ tabId, offset, limit }) {
    const tab = await allowedTab(tabId);
    return inject(tab.id, 'text', { offset, limit });
  },

  async form_input({ tabId, fields }) {
    const tab = await allowedTab(tabId);
    const r = await inject(tab.id, 'formInput', { fields });
    await settle(tab.id);
    return r;
  },

  async evaluate({ tabId, expression }) {
    const tab = await prepare(tabId);
    const r = await cdp.send(tab.id, 'Runtime.evaluate', { expression: String(expression), awaitPromise: true, returnByValue: true, userGesture: true, replMode: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || 'JavaScript error');
    }
    const v = r.result || {};
    return { type: v.type, value: v.value !== undefined ? v.value : (v.description || null) };
  },

  async 'console.read'({ tabId, pattern, clear, limit }) {
    const tab = await prepare(tabId);
    let entries = cdp.getConsole(tab.id);
    if (pattern) { const re = new RegExp(pattern, 'i'); entries = entries.filter((e) => re.test(e.text) || re.test(e.level)); }
    const out = entries.slice(-(limit || 200));
    if (clear) cdp.clearConsole(tab.id);
    return { entries: out, total: entries.length };
  },

  async 'network.read'({ tabId, pattern, clear, limit }) {
    const tab = await prepare(tabId);
    let entries = cdp.getNetwork(tab.id);
    if (pattern) { const re = new RegExp(pattern, 'i'); entries = entries.filter((e) => re.test(e.url)); }
    const out = entries.slice(-(limit || 100)).map(({ id, ...rest }) => rest);
    if (clear) cdp.clearNetwork(tab.id);
    return { entries: out, total: entries.length };
  },

  async file_upload({ tabId, ref, paths }) {
    const tab = await prepare(tabId);
    await inject(tab.id, 'markUpload', { ref });
    try {
      const { root } = await cdp.send(tab.id, 'DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send(tab.id, 'DOM.querySelector', { nodeId: root.nodeId, selector: '[data-ak-upload]' });
      if (!nodeId) throw new Error('file input not found');
      await cdp.send(tab.id, 'DOM.setFileInputFiles', { files: paths, nodeId });
    } finally {
      await inject(tab.id, 'unmarkUpload', {}).catch(() => {});
    }
    await settle(tab.id);
    return { uploaded: paths };
  },

  async 'window.resize'({ tabId, width, height }) {
    const tab = await getTab(tabId);
    await chrome.windows.update(tab.windowId, { width: Number(width), height: Number(height) });
    await sleep(300);
    return { width, height };
  }
};
