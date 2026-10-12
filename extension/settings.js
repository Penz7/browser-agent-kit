// Settings shared by the service worker, popup and options page.
export const DEFAULTS = {
  port: 7851,
  token: '',
  allowAll: false,
  allowedSites: [],
  dialogPolicy: 'accept', // accept | dismiss
  inputMode: 'fast',      // fast = DOM events via content script, debugger only when needed | real = CDP for everything
  overlay: true,          // glowing frame + status bar on the tab being controlled
  overlayName: 'AI agent',
  groupTabs: true,        // put tabs the agent creates into a tab group
  groupName: 'Agent',
  groupColor: 'purple',   // grey blue red yellow green pink purple cyan orange
  idleDetachSec: 20       // detach the debugger after this many idle seconds (0 = keep attached)
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

export function normalizeUrl(input) {
  const u = String(input || '').trim();
  if (!u) throw new Error('url is required');
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/.test(u)) return 'http://' + u;
  return 'https://' + u;
}

function matchHost(host, pattern) {
  const p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return host === p || host.endsWith('.' + p);
}

export function hostAllowed(url, settings) {
  if (settings.allowAll) return true;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'about:') return true; // about:blank
  if (!/^(https?|file):$/.test(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  return (settings.allowedSites || []).some((p) => matchHost(host, p));
}
