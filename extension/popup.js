import { getSettings, setSettings, hostAllowed } from './settings.js';

const $ = (id) => document.getElementById(id);
let host = '';
let url = '';

async function refresh() {
  const s = await getSettings();
  const status = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  $('dot').className = 'dot' + (status && status.connected ? ' on' : '');
  $('status').textContent = status && status.connected
    ? `Connected to MCP server on port ${status.port}`
    : `Not connected (port ${status ? status.port : s.port}). Start an agent that uses the MCP server.`;
  $('pausedRow').style.display = status && status.paused ? '' : 'none';
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  url = (tab && tab.url) || '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  const allowed = hostAllowed(url, s);
  $('host').textContent = host ? `${host} — ${allowed ? 'allowed' : 'blocked'}` : '(no site)';
  $('allowAll').checked = !!s.allowAll;
  const listed = s.allowedSites.includes(host);
  $('allowSite').style.display = host && !listed ? '' : 'none';
  $('removeSite').style.display = host && listed ? '' : 'none';
}

$('allowSite').onclick = async () => {
  const s = await getSettings();
  if (host && !s.allowedSites.includes(host)) await setSettings({ allowedSites: [...s.allowedSites, host] });
  refresh();
};
$('removeSite').onclick = async () => {
  const s = await getSettings();
  await setSettings({ allowedSites: s.allowedSites.filter((h) => h !== host) });
  refresh();
};
$('allowAll').onchange = async (e) => { await setSettings({ allowAll: e.target.checked }); refresh(); };
$('resume').onclick = async () => { await chrome.runtime.sendMessage({ type: 'resume' }); refresh(); };
$('reconnect').onclick = async () => { await chrome.runtime.sendMessage({ type: 'reconnect' }); setTimeout(refresh, 1500); };
$('options').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

refresh();
