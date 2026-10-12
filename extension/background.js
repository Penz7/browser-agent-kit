// Service worker: keeps a WebSocket to the local MCP server and executes browser commands.
import { getSettings, hostAllowed, normalizeUrl } from './settings.js';
import * as cdp from './cdp.js';
import { agentDom } from './dom.js';
import { parseCombo, parseModifiers, macCommand, MOD } from './keys.js';
import { parseRef, prefixRef, prefixLines, buildFrameTree, childFrameId, toMainCoords } from './frames.js';
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.js';

const VERSION = chrome.runtime.getManifest().version;
const DEFAULT_MAX_WIDTH = 1024;

let settings = null;
const settingsReady = getSettings().then((s) => (settings = s));
const cfg = async () => settings || settingsReady;

let ws = null;
let reconnectTimer = null;
let backoff = 1000;
let lastAttempt = 0;
let connectedAt = null;
let paused = false;
let busy = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- connection ----------
// Chrome records every failed WebSocket attempt on the extension's "Errors" page, so the worker only retries
// eagerly during a short "hot" window: after Chrome starts, after a live connection drops, or after someone asks
// (popup, settings change, wake tab). Outside that window it probes the port once per IDLE_INTERVAL_MS and otherwise
// waits to be woken: the server opens http://127.0.0.1:<port>/wake in a tab when an agent needs the browser.
const HOT_WINDOW_MS = 2 * 60 * 1000;
const IDLE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 30000;
const wakeTabs = new Set();

// Kept in session storage so it survives service-worker restarts and resets when Chrome restarts.
let connState = null;
const connStateReady = chrome.storage.session.get('connState')
  .then(({ connState: st }) => (connState = st || { hotUntil: Date.now() + HOT_WINDOW_MS, lastAttempt: 0 }));
const state = async () => connState || connStateReady;
function setConnState(patch) { Object.assign(connState, patch); chrome.storage.session.set({ connState }); }
function markHot() { setConnState({ hotUntil: Date.now() + HOT_WINDOW_MS }); }

function wsOpen() { return !!(ws && ws.readyState === WebSocket.OPEN); }
function wsBusy() { return !!(ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)); }

async function connect(force = false) {
  if (wsBusy()) return;
  const s = await cfg();
  const st = await state();
  if (wsBusy()) return;
  const now = Date.now();
  if (force) markHot();
  else if (now >= st.hotUntil && now - st.lastAttempt < IDLE_INTERVAL_MS) return; // idle: wait for the next probe or a wake
  lastAttempt = now;
  setConnState({ lastAttempt: now });
  let sock;
  try { sock = new WebSocket(`ws://127.0.0.1:${s.port}/extension`); } catch { scheduleReconnect(); return; }
  ws = sock;
  sock.onopen = () => {
    backoff = 1000;
    connectedAt = Date.now();
    sock.send(JSON.stringify({ type: 'hello', token: s.token, version: VERSION }));
    closeWakeTabs();
  };
  sock.onmessage = (ev) => handleMessage(ev.data);
  sock.onclose = () => {
    if (ws === sock) {
      ws = null;
      if (connectedAt != null) { backoff = 1000; markHot(); } // a live connection dropped: the agent may restart soon
      connectedAt = null;
    }
    scheduleReconnect();
  };
  sock.onerror = () => {};
}

function scheduleReconnect() {
  if (reconnectTimer || !connState || Date.now() >= connState.hotUntil) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
}

// The server opens this URL in a tab when an agent needs the browser while the extension is idle.
async function isWakeUrl(url) {
  const s = await cfg();
  try { const u = new URL(url); return u.origin === `http://127.0.0.1:${s.port}` && u.pathname === '/wake'; } catch { return false; }
}
function closeWakeTabs() {
  for (const id of wakeTabs) chrome.tabs.remove(id).catch(() => {});
  wakeTabs.clear();
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = info.url || (info.status === 'complete' ? tab.url : '');
  if (!url || !(await isWakeUrl(url))) return;
  wakeTabs.add(tabId);
  if (wsOpen()) closeWakeTabs(); else { backoff = 1000; connect(true); }
});
chrome.tabs.onRemoved.addListener((tabId) => wakeTabs.delete(tabId));

function reply(obj) { if (wsOpen()) ws.send(JSON.stringify(obj)); }

const ALWAYS_ALLOWED_WHEN_PAUSED = new Set(['tabs.context']);

async function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'ping') { reply({ type: 'pong' }); return; }
  if (!msg.id || !msg.method) return;
  busy++;
  try {
    const handler = handlers[msg.method];
    if (!handler) throw new Error(`Unknown method: ${msg.method}`);
    if (paused && !ALWAYS_ALLOWED_WHEN_PAUSED.has(msg.method)) {
      throw new Error('The user pressed "Dừng" (Stop) on the browser overlay. Do not continue until they confirm; they can resume from the extension popup.');
    }
    const result = await handler(msg.params || {});
    reply({ id: msg.id, ok: true, result });
  } catch (e) {
    reply({ id: msg.id, ok: false, error: (e && e.message) || String(e) });
  } finally {
    busy--;
  }
}

chrome.alarms.create('ak-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ak-keepalive' && !reconnectTimer) connect(); });
chrome.runtime.onStartup.addListener(() => connect(true));
chrome.runtime.onInstalled.addListener((d) => {
  connect(true);
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  settings = await getSettings();
  if (changes.port || changes.token) { backoff = 1000; if (ws) ws.close(); else connect(true); }
});
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg) return;
  if (msg.type === 'status') {
    // Opening the popup is a good moment to retry: the user is looking at the connection state.
    if (!wsOpen() && Date.now() - lastAttempt > 3000) connect(true);
    respond({ connected: wsOpen(), port: settings ? settings.port : null, since: connectedAt, version: VERSION, paused });
  } else if (msg.type === 'reconnect') {
    backoff = 1000; if (ws) ws.close(); else connect(true); respond({ ok: true });
  } else if (msg.type === 'agent-stop') {
    paused = true; respond({ ok: true });
  } else if (msg.type === 'resume') {
    paused = false; respond({ ok: true });
  }
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

// Lite: no debugger. Used by the fast input mode.
async function prepareLite(tabId) {
  const tab = await allowedTab(tabId);
  await focusTab(tab);
  return tab;
}

// Full: attach the debugger (CDP) and schedule its release when idle.
async function prepare(tabId) {
  const tab = await prepareLite(tabId);
  const s = await cfg();
  await cdp.attach(tab.id, s.dialogPolicy);
  scheduleDetach(tab.id, s);
  return tab;
}

const detachTimers = new Map();
function scheduleDetach(tabId, s) {
  const secs = Number(s.idleDetachSec);
  if (!(secs > 0)) return;
  clearTimeout(detachTimers.get(tabId));
  detachTimers.set(tabId, setTimeout(async () => {
    detachTimers.delete(tabId);
    if (busy > 0) { scheduleDetach(tabId, s); return; } // a command is still running
    await cdp.detach(tabId);
  }, secs * 1000));
}

async function fastMode() { return (await cfg()).inputMode !== 'real'; }

async function inject(tabId, action, args, frameId = 0) {
  let results;
  try {
    const target = frameId ? { tabId, frameIds: [frameId] } : { tabId };
    results = await chrome.scripting.executeScript({ target, func: agentDom, args: [action, args || {}] });
  } catch (e) {
    throw new Error(`Cannot run on this page${frameId ? ` (frame ${frameId})` : ''}: ${e.message}`);
  }
  const r = results && results[0];
  if (!r) throw new Error('Script injection returned nothing (page may still be loading).');
  if (r.result && r.result.error) throw new Error(r.result.error);
  return r.result;
}

// Run an action in every frame of the tab. Frames the extension cannot script are skipped. Returns [{ frameId, result }].
async function injectAll(tabId, action, args) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: agentDom, args: [action, args || {}] });
  } catch {
    return [{ frameId: 0, result: await inject(tabId, action, args) }];
  }
  return (results || []).filter((r) => r && r.result && !r.result.error).map((r) => ({ frameId: r.frameId || 0, result: r.result }));
}

// Geometry of all frames: offsets in main-frame CSS px, visibility, parent links.
async function frameTree(tabId) {
  const rs = await injectAll(tabId, 'frameInfo', {});
  return buildFrameTree(rs.map((r) => ({ frameId: r.frameId, ...r.result })));
}

// Scroll the ancestors' iframe containers so the target frame is on screen, then return the fresh tree.
async function ensureFrameVisible(tabId, frameId) {
  let tree = await frameTree(tabId);
  const f = tree.get(frameId);
  if (!f || !frameId) return tree;
  const main = tree.get(0);
  const vp = (main && main.viewport) || { width: 1e9, height: 1e9 };
  const offscreen = (r) => !r || r.y < 0 || r.x < 0 || r.y + r.h > vp.height || r.x + r.w > vp.width;
  if (!offscreen(f.rect)) return tree;
  // Walk from the top down: each parent scrolls the container of the next frame on the path into view.
  const chain = [];
  for (let cur = f; cur && cur.parentId != null; cur = tree.get(cur.parentId)) chain.unshift(cur);
  for (const cur of chain) {
    try { await inject(tabId, 'showContainer', { index: cur.path[cur.path.length - 1] }, cur.parentId); } catch { /* parent not scriptable */ }
  }
  await sleep(60);
  return frameTree(tabId);
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
  await sleep(250);
  await waitForLoad(tabId, 10000);
  await sleep(80);
  // Real mode: give XHR/fetch triggered by the action a moment to finish, so the next read/screenshot sees the result.
  if (cdp.isAttached(tabId)) await waitNetworkQuiet(tabId, 1500);
}

async function waitNetworkQuiet(tabId, maxMs, quietMs = 400) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (cdp.networkQuiet(tabId, quietMs)) return true;
    await sleep(100);
  }
  return cdp.networkQuiet(tabId, quietMs);
}

// Viewport in CSS px. Prefers the content script (no debugger), falls back to CDP.
async function viewport(tabId) {
  try {
    const info = await inject(tabId, 'scrollInfo', {});
    if (info.viewportWidth) return { width: info.viewportWidth, height: info.viewportHeight };
  } catch { /* fall through */ }
  const m = await cdp.send(tabId, 'Page.getLayoutMetrics');
  const v = m.cssVisualViewport || m.visualViewport;
  return { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
}

const scaleFor = (vp, maxWidth) => Math.min(1, (maxWidth || DEFAULT_MAX_WIDTH) / vp.width);

// Converts a point from screenshot pixel space (or a ref) into CSS viewport pixels.
async function resolvePoint(tabId, p) {
  if (p.ref) {
    const { frameId, ref } = parseRef(p.ref);
    if (!frameId) {
      const r = await inject(tabId, 'resolve', { ref });
      await sleep(80);
      return r;
    }
    const tree = await ensureFrameVisible(tabId, frameId);
    const r = await inject(tabId, 'resolve', { ref }, frameId);
    await sleep(80);
    return { ...toMainCoords(await frameTree(tabId).catch(() => tree), frameId, r), frameId };
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

async function typeViaCdp(tabId, text) {
  for (const ch of String(text)) {
    if (ch === '\n' || ch === '\r') { await pressKey(tabId, parseCombo('Enter')); continue; }
    await cdp.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
    await cdp.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(s);
}

function tabInfo(t) {
  return { tabId: t.id, windowId: t.windowId, url: t.url, title: t.title, active: t.active, status: t.status, groupId: t.groupId };
}

// ---------- overlay (glowing frame + status bar on the controlled tab) ----------
const overlayTimers = new Map();
const CURSOR_MOVE_MS = 200; // matches the cursor transition in dom.js
async function showActivity(tabId, text, point) {
  const s = await cfg();
  if (!s.overlay) return false;
  let shown = true;
  try { await inject(tabId, 'overlay', { state: 'show', text, agent: s.overlayName, ...(point || {}) }); } catch { shown = false; /* page not injectable */ }
  clearTimeout(overlayTimers.get(tabId));
  overlayTimers.set(tabId, setTimeout(() => hideActivity(tabId), 8000));
  return shown;
}
// Glide the virtual cursor to the point and give it time to arrive before the real input event lands there.
async function cursorTo(tabId, text, point, ring = true) {
  if (await showActivity(tabId, text, { x: point.x, y: point.y, ring })) await sleep(CURSOR_MOVE_MS);
}
// Files the page asked for through a (suppressed) native file dialog in the last 90 seconds.
function pendingFileChooser(tabId) {
  const c = cdp.fileChooser(tabId);
  return c && Date.now() - c.ts < 90000 ? c : null;
}
const CHOOSER_HINT = 'The page opened a file-picker dialog (the kit suppressed it). Call file_upload with this tabId and the local file paths; no ref is needed.';
async function hideActivity(tabId) {
  clearTimeout(overlayTimers.get(tabId));
  overlayTimers.delete(tabId);
  try { await inject(tabId, 'overlay', { state: 'hide' }); } catch { /* ignore */ }
}
chrome.tabs.onRemoved.addListener((id) => { clearTimeout(overlayTimers.get(id)); overlayTimers.delete(id); clearTimeout(detachTimers.get(id)); detachTimers.delete(id); });

// ---------- downloads started while the agent works ----------
async function sessionStart() {
  const { sessionStart: t } = await chrome.storage.session.get('sessionStart');
  if (t) return t;
  const now = new Date().toISOString();
  await chrome.storage.session.set({ sessionStart: now });
  return now;
}
sessionStart();
async function listDownloads(limit = 20) {
  const since = await sessionStart();
  const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: Math.max(limit, 1), startedAfter: since });
  return items.map((i) => ({
    id: i.id, url: i.finalUrl || i.url, filename: i.filename, state: i.state, paused: i.paused,
    bytes: i.bytesReceived, totalBytes: i.totalBytes, mime: i.mime, startTime: i.startTime, error: i.error, exists: i.exists
  }));
}
// Downloads created after `since` (ms). Used to tell the agent a click started one.
async function downloadsSince(since) {
  try {
    const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 });
    return items.filter((i) => Date.parse(i.startTime) >= since - 50);
  } catch { return []; }
}
const downloadHint = (items) => items.length
  ? `A download started: ${items.map((i) => i.filename ? i.filename.split(/[\\/]/).pop() : i.url).join(', ')}. Call list_downloads (wait=true) to get the saved path.`
  : undefined;

// ---------- GIF recording of what the agent does on a tab ----------
// Frames are grabbed around each action with the overlay (cursor, status bar) visible, so a person can follow along.
const recordings = new Map(); // tabId -> { frames: [{ data, w, h, ts }], started, width, truncated }
const REC_MAX_FRAMES = 240;
async function captureDataUrl(tab) {
  if (cdp.isAttached(tab.id)) {
    const shot = await cdp.send(tab.id, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return 'data:image/png;base64,' + shot.data;
  }
  const now = await chrome.tabs.get(tab.id);
  if (!now.active) throw new Error('tab not visible');
  for (let attempt = 0; ; attempt++) {
    try { return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
    catch (e) { if (attempt < 3 && /MAX_CAPTURE|exceeded|rate/i.test(e.message || '')) { await sleep(600); continue; } throw e; }
  }
}
async function recordFrame(tabId) {
  const rec = recordings.get(tabId);
  if (!rec || rec.frames.length >= REC_MAX_FRAMES) { if (rec) rec.truncated = true; return; }
  try {
    const tab = await chrome.tabs.get(tabId);
    const bmp = await createImageBitmap(await (await fetch(await captureDataUrl(tab))).blob());
    const scale = Math.min(1, rec.width / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    rec.frames.push({ data: ctx.getImageData(0, 0, w, h).data, w, h, ts: Date.now() });
  } catch { /* tab hidden or page not capturable: skip this frame */ }
}
function encodeGif(rec) {
  const gif = GIFEncoder();
  const w = Math.max(...rec.frames.map((f) => f.w)), h = Math.max(...rec.frames.map((f) => f.h));
  rec.frames.forEach((f, i) => {
    let data = f.data;
    if (f.w !== w || f.h !== h) { // pad smaller frames (window resized mid-recording)
      const padded = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < f.h; y++) padded.set(f.data.subarray(y * f.w * 4, (y + 1) * f.w * 4), y * w * 4);
      data = padded;
    }
    const palette = quantize(data, 256, { format: 'rgb444' });
    const index = applyPalette(data, palette, 'rgb444');
    const next = rec.frames[i + 1];
    const delay = next ? Math.min(2000, Math.max(250, next.ts - f.ts)) : 1500;
    gif.writeFrame(index, w, h, { palette, delay, first: i === 0, repeat: 0 });
  });
  gif.finish();
  return { bytes: gif.bytes(), w, h };
}
function bytesToBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
chrome.tabs.onRemoved.addListener((id) => recordings.delete(id));

// ---------- tab group for agent-created tabs ----------
const groupByWindow = new Map();
async function addToAgentGroup(tab) {
  const s = await cfg();
  if (!s.groupTabs) return;
  try {
    let groupId = groupByWindow.get(tab.windowId);
    if (groupId != null) {
      try { await chrome.tabGroups.get(groupId); } catch { groupId = null; }
    }
    if (groupId == null) {
      const existing = await chrome.tabGroups.query({ windowId: tab.windowId, title: s.groupName });
      if (existing.length) groupId = existing[0].id;
    }
    if (groupId == null) {
      groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, { title: s.groupName, color: s.groupColor || 'purple' });
    } else {
      await chrome.tabs.group({ tabIds: [tab.id], groupId });
    }
    groupByWindow.set(tab.windowId, groupId);
  } catch { /* tab groups unavailable */ }
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
    await addToAgentGroup(tab);
    await waitForLoad(tab.id, 30000);
    showActivity(tab.id, 'Đã mở tab');
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
    showActivity(tab.id, 'Đang xem trang');
    await recordFrame(tab.id);
    return tabInfo(await chrome.tabs.get(tab.id));
  },

  async screenshot({ tabId, maxWidth, format, quality, region }) {
    const fast = await fastMode();
    const tab = fast ? await prepareLite(tabId) : await prepare(tabId);
    const vp = await viewport(tab.id);
    const mw = maxWidth || DEFAULT_MAX_WIDTH;
    // Keep the overlay out of the picture so the model sees the real page.
    const hadOverlay = overlayTimers.has(tab.id);
    if (hadOverlay) { try { await inject(tab.id, 'overlay', { state: 'suspend' }); } catch { /* ignore */ } }
    let dataUrl;
    try {
      if (fast) {
        const now = await chrome.tabs.get(tab.id);
        if (!now.active) throw new Error('Could not bring the tab to the front, so a screenshot of it cannot be taken right now.');
        for (let attempt = 0; ; attempt++) {
          try { dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); break; }
          catch (e) {
            if (attempt < 3 && /MAX_CAPTURE|exceeded|rate/i.test(e.message || '')) { await sleep(600); continue; }
            throw new Error(`captureVisibleTab failed: ${e.message}`);
          }
        }
      } else {
        const shot = await cdp.send(tab.id, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        dataUrl = 'data:image/png;base64,' + shot.data;
      }
    } finally {
      if (hadOverlay) { try { await inject(tab.id, 'overlay', { state: 'resume' }); } catch { /* ignore */ } }
    }
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const dpr = bmp.width / vp.width;
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height, cssW = vp.width, cssH = bmp.height / dpr, scale;
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
      width: outW, height: outH, scale, zoomed: !!region, viewport: { width: vp.width, height: Math.round(cssH) }, url: tab.url, title: tab.title
    };
  },

  async click(p) {
    const button = p.button || 'left';
    const clickCount = p.clickCount || 1;
    const { frameId, ref } = parseRef(p.ref);
    let fast = await fastMode();
    if (fast) {
      // Upload buttons need a real (debugger) click: synthetic clicks cannot open a file picker, and only real ones get intercepted.
      const tab = await prepareLite(p.tabId);
      let probe = { upload: false };
      try { probe = await inject(tab.id, 'uploadLike', ref ? { ref } : await resolvePoint(tab.id, p), frameId); } catch { /* ignore */ }
      if (probe.upload) fast = false;
    }
    if (fast) {
      const tab = await prepareLite(p.tabId);
      const pre = await resolvePoint(tab.id, p); // scrolls the target into view and tells the cursor where to go
      await cursorTo(tab.id, `Click: ${pre.name || ''}`, pre);
      await recordFrame(tab.id);
      const started = Date.now();
      let r;
      if (ref) {
        r = await inject(tab.id, 'click', { ref, button, clickCount, modifiers: p.modifiers }, frameId);
        if (frameId) r = toMainCoords(await frameTree(tab.id), frameId, r);
      } else {
        // Coordinates: descend into child frames until the click lands on a real element.
        let fid = 0, x = pre.x, y = pre.y, tree = null;
        for (let depth = 0; ; depth++) {
          r = await inject(tab.id, 'click', { x, y, button, clickCount, modifiers: p.modifiers }, fid);
          if (r.frameIndex == null) break;
          tree = tree || await frameTree(tab.id);
          const child = childFrameId(tree, fid, r.frameIndex);
          if (child == null || depth >= 4) throw new Error('That point is inside an iframe the kit cannot script in Fast mode. Switch the extension to Real input mode, or click by ref from read_page.');
          fid = child; x = r.innerX; y = r.innerY;
        }
        r = { ...r, x: pre.x, y: pre.y };
      }
      await settle(tab.id);
      await recordFrame(tab.id);
      const t = await chrome.tabs.get(tab.id);
      const hint = r.hint || downloadHint(await downloadsSince(started));
      return { x: r.x, y: r.y, covered: !!r.covered, target: r.name, hint, url: t.url, title: t.title };
    }
    const tab = await prepare(p.tabId);
    const pt = await resolvePoint(tab.id, p);
    const modifiers = p.modifiers ? parseModifiers(p.modifiers) : 0;
    const started = Date.now();
    await cursorTo(tab.id, `Click: ${pt.name || ''}`, pt);
    await recordFrame(tab.id);
    await mouse(tab.id, 'mouseMoved', pt.x, pt.y, { modifiers });
    for (let i = 1; i <= clickCount; i++) {
      await mouse(tab.id, 'mousePressed', pt.x, pt.y, { button, clickCount: i, modifiers });
      await mouse(tab.id, 'mouseReleased', pt.x, pt.y, { button, clickCount: i, modifiers });
    }
    await settle(tab.id);
    await recordFrame(tab.id);
    const t = await chrome.tabs.get(tab.id);
    const chooser = cdp.fileChooser(tab.id);
    const hint = chooser && chooser.ts >= started ? CHOOSER_HINT : downloadHint(await downloadsSince(started));
    return { x: pt.x, y: pt.y, covered: !!pt.covered, target: pt.name, hint, url: t.url, title: t.title };
  },

  async mouse_move(p) {
    const tab = await prepare(p.tabId);
    const pt = await resolvePoint(tab.id, p);
    await cursorTo(tab.id, 'Di chuột', pt, false);
    await mouse(tab.id, 'mouseMoved', pt.x, pt.y);
    await sleep(100);
    return { x: pt.x, y: pt.y };
  },

  async drag(p) {
    const tab = await prepare(p.tabId);
    const a = await resolvePoint(tab.id, { ...p.from, maxWidth: p.maxWidth });
    const b = await resolvePoint(tab.id, { ...p.to, maxWidth: p.maxWidth });
    await cursorTo(tab.id, 'Kéo thả', a);
    await mouse(tab.id, 'mouseMoved', a.x, a.y);
    await mouse(tab.id, 'mousePressed', a.x, a.y, { button: 'left', clickCount: 1 });
    showActivity(tab.id, 'Kéo thả', { x: b.x, y: b.y, ring: false }); // the cursor glides to the drop point alongside the real moves
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await mouse(tab.id, 'mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { button: 'left', buttons: 1 });
      await sleep(16);
    }
    await mouse(tab.id, 'mouseReleased', b.x, b.y, { button: 'left', clickCount: 1 });
    await settle(tab.id);
    await recordFrame(tab.id);
    return { from: a, to: b };
  },

  async type({ tabId, text }) {
    if (await fastMode()) {
      const tab = await prepareLite(tabId);
      const r = await inject(tab.id, 'typeText', { text });
      if (!r.fallback) {
        showActivity(tab.id, `Gõ vào: ${r.into || ''}`);
        await settle(tab.id);
        await recordFrame(tab.id);
        return { typed: r.typed, into: r.into, via: 'dom' };
      }
      // Nothing editable is focused: fall back to real key events.
    }
    const tab = await prepare(tabId);
    showActivity(tab.id, 'Gõ phím');
    await typeViaCdp(tab.id, text);
    await settle(tab.id);
    await recordFrame(tab.id);
    return { typed: String(text).length, via: 'cdp' };
  },

  async key({ tabId, combo, repeat }) {
    const tab = await prepare(tabId);
    showActivity(tab.id, `Phím: ${combo}`);
    const combos = String(combo).trim().split(/\s+/);
    for (let i = 0; i < (repeat || 1); i++) for (const c of combos) await pressKey(tab.id, parseCombo(c));
    await settle(tab.id);
    await recordFrame(tab.id);
    return { pressed: combo };
  },

  async scroll(p) {
    const amt = (p.amount == null ? 3 : p.amount) * 100;
    const [dx, dy] = { up: [0, -amt], down: [0, amt], left: [-amt, 0], right: [amt, 0] }[p.direction || 'down'];
    const label = `Cuộn ${p.direction || 'down'}`;
    if (await fastMode()) {
      const tab = await prepareLite(p.tabId);
      let pt;
      if (p.ref || typeof p.x === 'number') pt = await resolvePoint(tab.id, p);
      else { const vp = await viewport(tab.id); pt = { x: vp.width / 2, y: vp.height / 2 }; }
      showActivity(tab.id, label, { x: pt.x, y: pt.y, ring: false });
      const { frameId, ref } = parseRef(p.ref);
      const r = frameId
        ? await inject(tab.id, 'scroll', { ref, dx, dy }, frameId)
        : await inject(tab.id, 'scroll', { x: pt.x, y: pt.y, dx, dy }); // animated inside the page
      await sleep(120);
      await recordFrame(tab.id);
      return r;
    }
    const tab = await prepare(p.tabId);
    let pt;
    if (p.ref || typeof p.x === 'number') pt = await resolvePoint(tab.id, p);
    else { const vp = await viewport(tab.id); pt = { x: vp.width / 2, y: vp.height / 2 }; }
    await cursorTo(tab.id, label, pt, false);
    await mouse(tab.id, 'mouseMoved', pt.x, pt.y);
    // Several small wheel ticks read as a smooth scroll instead of one jump; pages with wheel handlers also prefer this.
    const steps = Math.min(12, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 60)));
    for (let i = 0; i < steps; i++) {
      await mouse(tab.id, 'mouseWheel', pt.x, pt.y, { deltaX: dx / steps, deltaY: dy / steps });
      await sleep(20);
    }
    await sleep(250);
    await recordFrame(tab.id);
    return inject(tab.id, 'scrollInfo', {});
  },

  async wait({ tabId, ms }) {
    await getTab(tabId);
    await sleep(Math.min(Number(ms) || 1000, 30000));
    return { waited: ms };
  },

  async read_page({ tabId, mode, maxLines }) {
    const tab = await allowedTab(tabId);
    showActivity(tab.id, 'Đọc trang');
    const cap = maxLines || 600;
    const rs = await injectAll(tab.id, 'snapshot', { mode, maxLines: cap });
    const main = (rs.find((r) => r.frameId === 0) || rs[0]).result;
    const tree = buildFrameTree(rs.map((r) => ({ frameId: r.frameId, ...r.result })));
    const lines = [...main.lines];
    let listed = 0, skipped = 0, truncated = main.truncated;
    // Child frames, top-down and in reading order, each introduced by a header line and indented.
    const frames = rs.filter((r) => r.frameId !== 0).map((r) => ({ ...r, info: tree.get(r.frameId) }))
      .filter((r) => r.info).sort((a, b) => a.info.depth - b.info.depth || a.info.offset.y - b.info.offset.y || a.info.offset.x - b.info.offset.x);
    for (const f of frames) {
      if (!f.info.visible || !f.result.lines.length) { skipped++; continue; }
      if (lines.length >= cap) { truncated = true; skipped++; continue; }
      const pad = '  '.repeat(f.info.depth - 1);
      const rc = f.info.rect;
      lines.push(`${pad}iframe f${f.frameId} "${f.result.title || ''}" ${f.result.url} at (${Math.round(rc.x)}, ${Math.round(rc.y)}) ${Math.round(rc.w)}x${Math.round(rc.h)}`);
      for (const l of prefixLines(f.result.lines, f.frameId)) { if (lines.length >= cap) { truncated = true; break; } lines.push(pad + '  ' + l); }
      listed++;
    }
    return { tabId: tab.id, url: main.url, title: main.title, lines, truncated, viewport: main.viewport, scroll: main.scroll, iframes: listed, hiddenFrames: skipped, unreadableFrames: Math.max(0, main.iframes - listed - skipped) };
  },

  async find({ tabId, query, limit }) {
    const tab = await allowedTab(tabId);
    showActivity(tab.id, `Tìm: ${query}`);
    const rs = await injectAll(tab.id, 'find', { query, limit });
    const tree = buildFrameTree(rs.map((r) => ({ frameId: r.frameId, ...r.result })));
    const main = (rs.find((r) => r.frameId === 0) || rs[0]).result;
    const matches = [];
    for (const r of rs) {
      const info = tree.get(r.frameId);
      if (r.frameId && (!info || !info.visible)) continue;
      for (const m of r.result.matches) matches.push({ score: m.score, line: prefixLines([m.line], r.frameId)[0] + (r.frameId ? `  (in iframe f${r.frameId})` : '') });
    }
    matches.sort((a, b) => b.score - a.score);
    return { url: main.url, matches: matches.slice(0, limit || 10) };
  },

  async get_text({ tabId, offset, limit }) {
    const tab = await allowedTab(tabId);
    showActivity(tab.id, 'Đọc nội dung');
    const rs = await injectAll(tab.id, 'textAll', {});
    const tree = buildFrameTree(rs.map((r) => ({ frameId: r.frameId, ...r.result })));
    const main = (rs.find((r) => r.frameId === 0) || rs[0]).result;
    let text = main.text || '';
    for (const r of rs) {
      const info = tree.get(r.frameId);
      if (!r.frameId || !info || !info.visible || !(r.result.text || '').trim()) continue;
      text += `\n\n--- iframe f${r.frameId} ${r.result.url} ---\n${r.result.text}`;
    }
    const off = offset || 0, lim = limit || 20000;
    return { url: main.url, title: main.title, total: text.length, offset: off, text: text.slice(off, off + lim) };
  },

  async form_input({ tabId, fields }) {
    const tab = await allowedTab(tabId);
    showActivity(tab.id, `Điền ${fields.length} ô`);
    // Fields may live in different frames: run each frame's batch there and report under the agent's ref names.
    const byFrame = new Map();
    fields.forEach((f, i) => { const { frameId, ref } = parseRef(f.ref); if (!byFrame.has(frameId)) byFrame.set(frameId, []); byFrame.get(frameId).push({ i, field: { ...f, ref } }); });
    const results = new Array(fields.length);
    for (const [frameId, items] of byFrame) {
      let r;
      try { r = await inject(tab.id, 'formInput', { fields: items.map((x) => x.field) }, frameId); }
      catch (e) { items.forEach((x) => { results[x.i] = { ref: fields[x.i].ref, error: e.message }; }); continue; }
      items.forEach((x, k) => { results[x.i] = { ...r.results[k], ref: fields[x.i].ref }; });
    }
    await settle(tab.id);
    await recordFrame(tab.id);
    return { results };
  },

  async evaluate({ tabId, expression }) {
    const tab = await prepare(tabId);
    showActivity(tab.id, 'Chạy JavaScript');
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
    showActivity(tab.id, 'Tải file lên');
    // A suppressed native dialog names the exact input the page wanted; prefer it over guessing from a ref.
    const chooser = pendingFileChooser(tab.id);
    if (chooser) {
      cdp.clearFileChooser(tab.id);
      await cdp.send(tab.id, 'DOM.setFileInputFiles', { files: paths, backendNodeId: chooser.backendNodeId });
      await settle(tab.id);
      return { uploaded: paths, via: 'file dialog' };
    }
    const q = parseRef(ref);
    await inject(tab.id, 'markUpload', { ref: q.ref }, q.frameId);
    try {
      // pierce:true reaches same-process iframes; cross-origin (out-of-process) iframes are separate debugger targets.
      const { root } = await cdp.send(tab.id, 'DOM.getDocument', { depth: -1, pierce: true });
      let nodeId = null;
      if (!q.frameId) ({ nodeId } = await cdp.send(tab.id, 'DOM.querySelector', { nodeId: root.nodeId, selector: '[data-ak-upload]' }));
      if (!nodeId) {
        const { searchId, resultCount } = await cdp.send(tab.id, 'DOM.performSearch', { query: '[data-ak-upload]' });
        if (resultCount > 0) ({ nodeIds: [nodeId] } = await cdp.send(tab.id, 'DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: 1 }));
        cdp.send(tab.id, 'DOM.discardSearchResults', { searchId }).catch(() => {});
      }
      if (!nodeId) throw new Error(q.frameId ? 'That file input is inside a cross-origin iframe, which file_upload cannot reach. Click the upload button in that iframe first; the kit intercepts the dialog, then call file_upload without a ref.' : 'file input not found');
      await cdp.send(tab.id, 'DOM.setFileInputFiles', { files: paths, nodeId });
    } finally {
      await inject(tab.id, 'unmarkUpload', {}, q.frameId).catch(() => {});
    }
    await settle(tab.id);
    return { uploaded: paths, via: 'input' };
  },

  async wait_for({ tabId, text, selector, ref, networkIdle, gone, timeout }) {
    const tab = networkIdle ? await prepare(tabId) : await allowedTab(tabId);
    const what = text != null ? `text "${text}"` : selector ? `selector ${selector}` : ref ? ref : networkIdle ? 'network idle' : null;
    if (!what) throw new Error('wait_for needs text, selector, ref or network_idle');
    showActivity(tab.id, `Chờ: ${what}`);
    const max = Math.min(Math.max(Number(timeout) || 10000, 500), 60000);
    const start = Date.now();
    let detail;
    while (true) {
      let found;
      if (networkIdle) found = cdp.networkQuiet(tab.id, 500);
      else {
        let r = { found: false };
        try {
          if (ref) { const q = parseRef(ref); r = await inject(tab.id, 'probe', { ref: q.ref }, q.frameId); }
          else {
            const rs = await injectAll(tab.id, 'probe', { text, selector });
            r = rs.map((x) => x.result).find((x) => x.found) || rs[0]?.result || r;
          }
        } catch { /* mid-navigation */ }
        found = !!r.found; detail = r.detail;
      }
      if (gone ? !found : found) return { ok: true, waited: Date.now() - start, what, detail };
      if (Date.now() - start >= max) return { ok: false, waited: Date.now() - start, what, detail };
      await sleep(networkIdle ? 100 : 200);
    }
  },

  async 'downloads.list'({ wait, timeout, limit }) {
    const max = Math.min(Math.max(Number(timeout) || 30000, 1000), 120000);
    const start = Date.now();
    let items = await listDownloads(limit);
    while (wait && items.some((i) => i.state === 'in_progress') && Date.now() - start < max) {
      await sleep(300);
      items = await listDownloads(limit);
    }
    return { items, waited: Date.now() - start };
  },

  async 'gif.start'({ tabId, maxWidth }) {
    const tab = await allowedTab(tabId);
    recordings.set(tab.id, { frames: [], started: Date.now(), width: Math.min(Math.max(Number(maxWidth) || 640, 200), 1280), truncated: false });
    showActivity(tab.id, 'Đang ghi hình');
    await recordFrame(tab.id);
    return { recording: true, tabId: tab.id };
  },

  async 'gif.status'({ tabId }) {
    const rec = recordings.get(Number(tabId));
    return rec ? { recording: true, frames: rec.frames.length, seconds: Math.round((Date.now() - rec.started) / 1000), truncated: rec.truncated } : { recording: false };
  },

  async 'gif.stop'({ tabId }) {
    const rec = recordings.get(Number(tabId));
    if (!rec) throw new Error('No recording is running on this tab. Call gif_recorder with action "start" first.');
    await recordFrame(Number(tabId));
    recordings.delete(Number(tabId));
    if (!rec.frames.length) throw new Error('Nothing was captured (the tab was never visible). Keep the tab in front while recording.');
    const { bytes, w, h } = encodeGif(rec);
    return { data: bytesToBase64(bytes), frames: rec.frames.length, width: w, height: h, seconds: Math.round((Date.now() - rec.started) / 1000), truncated: rec.truncated };
  },

  async 'window.resize'({ tabId, width, height }) {
    const tab = await getTab(tabId);
    await chrome.windows.update(tab.windowId, { width: Number(width), height: Number(height) });
    await sleep(300);
    return { width, height };
  }
};
