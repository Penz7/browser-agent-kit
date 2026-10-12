import { getSettings, setSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await getSettings();
  $('allowAll').checked = !!s.allowAll;
  const st = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  const on = !!(st && st.connected);
  $('dot').className = 'dot' + (on ? ' on' : '');
  $('status').textContent = on ? `Đã nối với MCP server (port ${st.port})` : `Chưa thấy MCP server trên port ${st ? st.port : s.port}`;
}
$('allowAll').onchange = async (e) => { await setSettings({ allowAll: e.target.checked }); };
$('options').onclick = () => chrome.runtime.openOptionsPage();
refresh();
setInterval(refresh, 2000);
