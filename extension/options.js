import { getSettings, setSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await getSettings();
  $('port').value = s.port;
  $('token').value = s.token;
  $('allowAll').checked = !!s.allowAll;
  $('sites').value = s.allowedSites.join('\n');
  $('dialog').value = s.dialogPolicy;
}

$('save').onclick = async () => {
  await setSettings({
    port: Number($('port').value) || 7851,
    token: $('token').value.trim(),
    allowAll: $('allowAll').checked,
    allowedSites: $('sites').value.split('\n').map((l) => l.trim()).filter(Boolean),
    dialogPolicy: $('dialog').value
  });
  $('saved').textContent = 'Saved';
  setTimeout(() => ($('saved').textContent = ''), 1500);
};

load();
