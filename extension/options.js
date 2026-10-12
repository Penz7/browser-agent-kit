import { getSettings, setSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await getSettings();
  $('port').value = s.port;
  $('token').value = s.token;
  $('allowAll').checked = !!s.allowAll;
  $('sites').value = s.allowedSites.join('\n');
  $('dialog').value = s.dialogPolicy;
  $('inputMode').value = s.inputMode;
  $('idleDetach').value = s.idleDetachSec;
  $('overlay').checked = !!s.overlay;
  $('overlayName').value = s.overlayName;
  $('groupTabs').checked = !!s.groupTabs;
  $('groupName').value = s.groupName;
  $('groupColor').value = s.groupColor;
}

$('save').onclick = async () => {
  await setSettings({
    port: Number($('port').value) || 7851,
    token: $('token').value.trim(),
    allowAll: $('allowAll').checked,
    allowedSites: $('sites').value.split('\n').map((l) => l.trim()).filter(Boolean),
    dialogPolicy: $('dialog').value,
    inputMode: $('inputMode').value,
    idleDetachSec: Math.max(0, Number($('idleDetach').value) || 0),
    overlay: $('overlay').checked,
    overlayName: $('overlayName').value.trim() || 'AI agent',
    groupTabs: $('groupTabs').checked,
    groupName: $('groupName').value.trim() || 'Agent',
    groupColor: $('groupColor').value
  });
  $('saved').textContent = 'Saved';
  setTimeout(() => ($('saved').textContent = ''), 1500);
};

load();
