// Chrome DevTools Protocol access through chrome.debugger, plus per-tab console/network buffers.
const state = new Map();
const MAX_ENTRIES = 1000;

function st(tabId) {
  let s = state.get(tabId);
  if (!s) {
    s = { attached: false, console: [], network: [], netIndex: new Map(), dialogPolicy: 'accept', fileChooser: null, inflight: new Map(), lastNet: 0 };
    state.set(tabId, s);
  }
  return s;
}

function push(list, entry) {
  list.push(entry);
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
}

export async function attach(tabId, dialogPolicy = 'accept') {
  const s = st(tabId);
  s.dialogPolicy = dialogPolicy;
  if (s.attached) return s;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(e.message || '')) {
      throw new Error(`Cannot attach debugger to tab ${tabId}: ${e.message}. Close DevTools for that tab if it is open.`);
    }
  }
  s.attached = true;
  for (const domain of ['Page', 'Runtime', 'Network', 'Log', 'DOM']) {
    try { await chrome.debugger.sendCommand({ tabId }, domain + '.enable'); } catch { /* optional */ }
  }
  // A native "open file" dialog would block the tab and nothing could close it. Intercept it: Chrome then reports
  // Page.fileChooserOpened with the input's node instead of showing the dialog, and file_upload fills that node.
  try { await chrome.debugger.sendCommand({ tabId }, 'Page.setInterceptFileChooserDialog', { enabled: true }); } catch { /* old Chrome */ }
  return s;
}

// The file chooser the page opened most recently (after a click on an upload button), or null.
export function fileChooser(tabId) { return st(tabId).fileChooser; }
export function clearFileChooser(tabId) { st(tabId).fileChooser = null; }

export async function send(tabId, method, params = {}) {
  try {
    return await chrome.debugger.sendCommand({ tabId }, method, params);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (/not attached|no target/i.test(msg)) st(tabId).attached = false;
    throw new Error(`${method} failed: ${msg}`);
  }
}

export async function detach(tabId) {
  const s = st(tabId);
  if (!s.attached) return;
  s.attached = false;
  try { await chrome.debugger.detach({ tabId }); } catch { /* already gone */ }
}

export function isAttached(tabId) { return !!st(tabId).attached; }

// "Quiet" = no request started or finished in the last quietMs and nothing short-lived still loading.
// Requests older than 5s (long polling, streams, websockets) are ignored so they never block a wait.
export function networkQuiet(tabId, quietMs = 400) {
  const s = st(tabId);
  const now = Date.now();
  let young = 0;
  for (const ts of s.inflight.values()) if (now - ts < 5000) young++;
  return young === 0 && now - s.lastNet >= quietMs;
}

export function getConsole(tabId) { return st(tabId).console; }
export function getNetwork(tabId) { return st(tabId).network; }
export function clearConsole(tabId) { st(tabId).console = []; }
export function clearNetwork(tabId) { const s = st(tabId); s.network = []; s.netIndex = new Map(); }

function argText(a) {
  if (!a) return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.unserializableValue) return a.unserializableValue;
  return a.description || a.type || '';
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId == null) return;
  const s = st(tabId);
  const now = Date.now();
  switch (method) {
    case 'Runtime.consoleAPICalled':
      push(s.console, { ts: now, level: params.type, text: (params.args || []).map(argText).join(' ') });
      break;
    case 'Runtime.exceptionThrown': {
      const d = params.exceptionDetails || {};
      push(s.console, { ts: now, level: 'error', text: (d.exception && d.exception.description) || d.text || 'Uncaught exception' });
      break;
    }
    case 'Log.entryAdded': {
      const e = params.entry || {};
      push(s.console, { ts: now, level: e.level || 'log', text: `${e.text || ''}${e.url ? ' (' + e.url + ')' : ''}`, source: e.source });
      break;
    }
    case 'Network.requestWillBeSent': {
      const r = params.request || {};
      const entry = { ts: now, id: params.requestId, method: r.method, url: r.url, type: params.type, status: null };
      push(s.network, entry);
      s.netIndex.set(params.requestId, entry);
      s.inflight.set(params.requestId, now); s.lastNet = now;
      break;
    }
    case 'Network.loadingFinished':
      s.inflight.delete(params.requestId); s.lastNet = now;
      break;
    case 'Network.responseReceived': {
      const entry = s.netIndex.get(params.requestId);
      if (entry) { entry.status = params.response.status; entry.mime = params.response.mimeType; }
      break;
    }
    case 'Network.loadingFailed': {
      const entry = s.netIndex.get(params.requestId);
      if (entry) entry.error = params.errorText;
      s.inflight.delete(params.requestId); s.lastNet = now;
      break;
    }
    case 'Page.javascriptDialogOpening': {
      const accept = s.dialogPolicy !== 'dismiss';
      push(s.console, { ts: now, level: 'dialog', text: `[${params.type}] ${params.message} -> auto-${accept ? 'accepted' : 'dismissed'}` });
      chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', { accept, promptText: '' }).catch(() => {});
      break;
    }
    case 'Page.fileChooserOpened':
      s.fileChooser = { backendNodeId: params.backendNodeId, mode: params.mode || 'selectSingle', ts: now };
      push(s.console, { ts: now, level: 'dialog', text: `[file chooser] opened (${s.fileChooser.mode}) -> suppressed; use file_upload` });
      break;
    case 'Page.frameNavigated':
      if (params.frame && !params.frame.parentId) {
        s.fileChooser = null;
        push(s.console, { ts: now, level: 'navigation', text: `[navigated] ${params.frame.url}` });
      }
      break;
    default:
      break;
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) st(source.tabId).attached = false;
});

chrome.tabs.onRemoved.addListener((tabId) => state.delete(tabId));
