#!/usr/bin/env node
// browser-agent-kit CLI
//   browser-agent-kit                 -> run the MCP server (stdio)
//   browser-agent-kit setup <agent>   -> write MCP config for codex | claude | cursor | gemini | windsurf | json
//   browser-agent-kit extension       -> print the extension folder to load in chrome://extensions
//   browser-agent-kit doctor          -> check whether the Chrome extension is connected
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server', 'src', 'index.js');
const EXTENSION = path.join(ROOT, 'extension');
const PORT = process.env.BROWSER_KIT_PORT || '7851';
const [cmd, ...rest] = process.argv.slice(2);

// --token: generate a shared secret so only clients that know it can use the hub (recommended).
let TOKEN = process.env.BROWSER_KIT_TOKEN || '';
if (rest.includes('--token') && !TOKEN) {
  const { randomBytes } = await import('node:crypto');
  TOKEN = randomBytes(24).toString('hex');
}
const mcpEntry = () => ({ command: 'node', args: [SERVER], env: { BROWSER_KIT_PORT: PORT, ...(TOKEN ? { BROWSER_KIT_TOKEN: TOKEN } : {}) } });

function mergeJson(file, mutate) {
  let data = {};
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${file} is not valid JSON; fix it or add the config by hand.`); }
  }
  mutate(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return file;
}

function removeFromJson(file, key = 'mcpServers') {
  if (!fs.existsSync(file)) return null;
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!d[key] || !d[key].browser) return null;
  delete d[key].browser;
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  return file;
}

function setupJsonClient(file) {
  return mergeJson(file, (d) => { d.mcpServers = d.mcpServers || {}; d.mcpServers.browser = mcpEntry(); });
}

function removeCodex() {
  const file = path.join(home, '.codex', 'config.toml');
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  // Drop [mcp_servers.browser] and [mcp_servers.browser.env] tables up to the next table header.
  const out = src.replace(/\n?\[mcp_servers\.browser(?:\.env)?\][^[]*/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (out === src) return null;
  fs.writeFileSync(file, out);
  return file;
}

function setupCodex() {
  const file = path.join(os.homedir(), '.codex', 'config.toml');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/^\[mcp_servers\.browser\]/m.test(existing)) return file + ' (already configured)';
  const block = `\n[mcp_servers.browser]\ncommand = "node"\nargs = [${JSON.stringify(SERVER)}]\n\n[mcp_servers.browser.env]\nBROWSER_KIT_PORT = "${PORT}"\n${TOKEN ? `BROWSER_KIT_TOKEN = ${JSON.stringify(TOKEN)}\n` : ''}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, (existing && !existing.endsWith('\n') ? '\n' : '') + block);
  return file;
}

function setupClaude() {
  const envArgs = ['--env', `BROWSER_KIT_PORT=${PORT}`, ...(TOKEN ? ['--env', `BROWSER_KIT_TOKEN=${TOKEN}`] : [])];
  const r = spawnSync('claude', ['mcp', 'add', 'browser', '--scope', 'user', ...envArgs, '--', 'node', SERVER], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.log('\n`claude` CLI not found or failed. Run this yourself:\n');
    console.log(`  claude mcp add browser --scope user ${envArgs.join(' ')} -- node ${SERVER}\n`);
    return null;
  }
  return 'claude mcp (user scope)';
}

const home = os.homedir();

// Detect which agents are installed on this machine.
function detectAgents() {
  const found = [];
  const has = (p) => fs.existsSync(p);
  const bin = (name) => { const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }); return r.status === 0; };
  if (has(path.join(home, '.codex')) || bin('codex')) found.push('codex');
  if (has(path.join(home, '.claude')) || bin('claude')) found.push('claude');
  if (has(path.join(home, '.gemini', 'antigravity')) || has('/Applications/Antigravity.app') || has(path.join(home, 'Applications', 'Antigravity.app'))) found.push('antigravity');
  if (has(path.join(home, '.cursor'))) found.push('cursor');
  if (has(path.join(home, '.gemini', 'settings.json')) || bin('gemini')) found.push('gemini');
  if (has(path.join(home, '.codeium', 'windsurf'))) found.push('windsurf');
  if (has(path.join(vscodeGlobalStorage(), 'saoudrizwan.claude-dev'))) found.push('cline');
  if (has(path.join(vscodeGlobalStorage(), 'rooveterinaryinc.roo-cline'))) found.push('roo');
  if (has(path.join(home, '.kiro'))) found.push('kiro');
  if (has(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode')) || bin('opencode')) found.push('opencode');
  return found;
}

function openInChrome(url) {
  const tries = process.platform === 'darwin'
    ? [['open', ['-a', 'Google Chrome', url]]]
    : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', 'chrome', url]]]
      : [['google-chrome', [url]], ['chromium', [url]], ['xdg-open', [url]]];
  for (const [c, a] of tries) { const r = spawnSync(c, a, { stdio: 'ignore' }); if (!r.error && r.status === 0) return true; }
  return false;
}

function copyToClipboard(text) {
  const cmd = process.platform === 'darwin' ? ['pbcopy', []] : process.platform === 'win32' ? ['clip', []] : ['xclip', ['-selection', 'clipboard']];
  const r = spawnSync(cmd[0], cmd[1], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
  return !r.error && r.status === 0;
}

async function waitForExtension(seconds) {
  const { Bridge } = await import(path.join(ROOT, 'server', 'src', 'bridge.js'));
  const b = new Bridge({ port: Number(PORT), token: TOKEN });
  await b.start();
  if (b.mode === 'leaf') { b.close(); return 'hub-running'; }
  const end = Date.now() + seconds * 1000;
  let dots = 0;
  while (Date.now() < end) {
    if (b.connected) { b.close(); return 'connected'; }
    await new Promise((r) => setTimeout(r, 1000));
    if (++dots % 5 === 0) process.stdout.write('.');
  }
  b.close();
  return 'timeout';
}

// Antigravity (Google): global config at ~/.gemini/config/mcp_config.json (older builds used
// ~/.gemini/antigravity/mcp_config.json); a workspace file lives at .agents/mcp_config.json.
function setupAntigravity() {
  const workspace = rest.includes('--workspace');
  if (workspace) return setupJsonClient(path.join(process.cwd(), '.agents', 'mcp_config.json'));
  const current = path.join(home, '.gemini', 'config', 'mcp_config.json');
  const legacy = path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
  const written = [setupJsonClient(current)];
  if (fs.existsSync(legacy)) written.push(setupJsonClient(legacy));
  return written.join(' and ') + '\n  In Antigravity: agent panel "..." -> MCP Servers -> Manage MCP Servers -> Refresh (or restart the IDE).';
}

// VS Code extension storage (Cline, Roo Code) is platform specific.
function vscodeGlobalStorage() {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Code', 'User', 'globalStorage');
}

// OpenCode uses its own schema: { mcp: { name: { type: 'local', command: [...], environment: {...} } } }
function setupOpenCode() {
  const file = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'opencode.json');
  return mergeJson(file, (d) => {
    if (!d.$schema) d.$schema = 'https://opencode.ai/config.json';
    d.mcp = d.mcp || {};
    d.mcp.browser = { type: 'local', command: ['node', SERVER], enabled: true, environment: mcpEntry().env };
  });
}

// VS Code Copilot agent mode: project-level .vscode/mcp.json with a "servers" map.
function setupCopilot() {
  const file = path.join(process.cwd(), '.vscode', 'mcp.json');
  return mergeJson(file, (d) => { d.servers = d.servers || {}; d.servers.browser = { type: 'stdio', ...mcpEntry() }; });
}

const REMOVERS = {
  codex: removeCodex,
  claude: () => { const r = spawnSync('claude', ['mcp', 'remove', 'browser', '--scope', 'user'], { stdio: 'inherit' }); return r.status === 0 ? 'claude mcp (user scope)' : null; },
  antigravity: () => [
    removeFromJson(path.join(home, '.gemini', 'config', 'mcp_config.json')),
    removeFromJson(path.join(home, '.gemini', 'antigravity', 'mcp_config.json')),
    removeFromJson(path.join(process.cwd(), '.agents', 'mcp_config.json'))
  ].filter(Boolean).join(' and ') || null,
  cursor: () => removeFromJson(path.join(home, '.cursor', 'mcp.json')),
  gemini: () => removeFromJson(path.join(home, '.gemini', 'settings.json')),
  windsurf: () => removeFromJson(path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
  cline: () => removeFromJson(path.join(vscodeGlobalStorage(), 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')),
  roo: () => removeFromJson(path.join(vscodeGlobalStorage(), 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json')),
  kiro: () => removeFromJson(path.join(home, '.kiro', 'settings', 'mcp.json')),
  opencode: () => removeFromJson(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'opencode.json'), 'mcp'),
  copilot: () => removeFromJson(path.join(process.cwd(), '.vscode', 'mcp.json'), 'servers')
};
REMOVERS.agy = REMOVERS.antigravity;

const AGENTS = {
  codex: setupCodex,
  cline: () => setupJsonClient(path.join(vscodeGlobalStorage(), 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')),
  roo: () => setupJsonClient(path.join(vscodeGlobalStorage(), 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json')),
  kiro: () => setupJsonClient(path.join(home, '.kiro', 'settings', 'mcp.json')),
  opencode: setupOpenCode,
  copilot: setupCopilot,
  claude: setupClaude,
  cursor: () => setupJsonClient(path.join(home, '.cursor', 'mcp.json')),
  gemini: () => setupJsonClient(path.join(home, '.gemini', 'settings.json')),
  windsurf: () => setupJsonClient(path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
  antigravity: setupAntigravity,
  agy: setupAntigravity,
  json: () => { console.log(JSON.stringify({ mcpServers: { browser: mcpEntry() } }, null, 2)); return null; }
};

function printNext() {
  if (TOKEN) console.log(`
Shared token (also paste it into the extension: icon -> Settings -> "Shared token"):
  ${TOKEN}`);
  console.log(`
Next steps:
  1. Chrome -> chrome://extensions -> enable "Developer mode" -> "Load unpacked" -> choose:
       ${EXTENSION}
  2. Open the site you want to automate, click the extension icon, press "Allow this site".
  3. Start your agent and ask it to open a page. Run "npx browser-agent-kit doctor" to check the link.
`);
}

async function doctor() {
  const { WebSocket } = await import('ws');
  const probe = (p) => new Promise((resolve) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT}${p}`);
    const t = setTimeout(() => { s.terminate(); resolve('timeout'); }, 1500);
    s.on('open', () => { clearTimeout(t); s.close(); resolve('open'); });
    s.on('error', () => { clearTimeout(t); resolve('closed'); });
  });
  const hub = await probe('/client');
  if (hub !== 'open') {
    console.log(`No MCP server is listening on port ${PORT}. That is normal when no agent is running.`);
    console.log('Starting a temporary server for 5s to see whether the extension connects...');
    const { Bridge } = await import(path.join(ROOT, 'server', 'src', 'bridge.js'));
    const b = new Bridge({ port: Number(PORT), token: process.env.BROWSER_KIT_TOKEN || '' });
    await b.start();
    await new Promise((r) => setTimeout(r, 5000));
    const okConn = b.connected;
    b.close();
    console.log(okConn ? 'OK: the Chrome extension connected.' : 'Extension did NOT connect. Is it loaded and enabled in chrome://extensions, and is its port set to ' + PORT + '?');
    process.exit(okConn ? 0 : 1);
  }
  console.log(`A hub server is running on port ${PORT} (an agent is using the kit). Click the extension icon in Chrome to see whether it shows "Connected".`);
}

switch (cmd) {
  case undefined:
  case 'serve':
    await import(SERVER);
    break;
  case 'setup': {
    let names = rest.filter((n) => !n.startsWith('--'));
    const wizard = names.length === 0 && !rest.includes('--help');
    if (wizard) {
      names = detectAgents();
      console.log('Browser Agent Kit setup\n');
      if (!names.length) {
        console.log('No supported agent detected. Run: browser-agent-kit setup <agent>, e.g. setup antigravity');
        console.log(`Supported: ${Object.keys(AGENTS).filter((k) => k !== 'agy').join(', ')}`);
        process.exit(1);
      }
      console.log(`Detected agents: ${names.join(', ')}`);
    }
    if ((!wizard && !names.length) || names.some((n) => !AGENTS[n])) {
      console.log(`Usage: browser-agent-kit setup [<${Object.keys(AGENTS).filter((k) => k !== 'agy').join('|')}> ...]`);
      console.log('  With no agent names: detects installed agents, configures all of them, opens chrome://extensions and waits for the extension.');
      console.log('  --open also opens chrome://extensions after configuring the named agents.');
      console.log('  antigravity --workspace writes ./.agents/mcp_config.json for the current project instead of the global file.');
      console.log('  cline / roo write the VS Code extension settings file; copilot writes ./.vscode/mcp.json for the current project.');
      console.log('  json prints a generic mcpServers block for any other MCP client.');
      console.log('  --token generates a shared secret and puts it in the config (paste the same value into the extension Settings).');
      process.exit(1);
    }
    for (const n of names) {
      const where = AGENTS[n]();
      if (where) console.log(`${n}: configured -> ${where}`);
    }
    printNext();
    if (wizard || rest.includes('--open')) {
      const copied = copyToClipboard(EXTENSION);
      const opened = openInChrome('chrome://extensions');
      console.log(`${opened ? 'Opened chrome://extensions in Chrome.' : 'Open chrome://extensions in Chrome.'} Turn on "Developer mode", click "Load unpacked"${copied ? ' and paste the path (already copied to your clipboard):' : ' and choose:'}`);
      console.log(`  ${EXTENSION}`);
      process.stdout.write('\nWaiting up to 3 minutes for the extension to connect');
      const r = await waitForExtension(180);
      console.log();
      if (r === 'connected') console.log('OK: extension connected. Open a site, click the extension icon and press "Allow this site". You are ready.');
      else if (r === 'hub-running') console.log('An agent is already running the server; click the extension icon in Chrome to confirm it shows "Connected".');
      else console.log('Extension did not connect yet. After loading it, run: browser-agent-kit doctor');
    }
    break;
  }
  case 'remove': {
    const names = rest.filter((n) => !n.startsWith('--'));
    const targets = names.length ? names : Object.keys(REMOVERS).filter((k) => k !== 'agy');
    if (names.some((n) => !REMOVERS[n])) { console.log(`Usage: browser-agent-kit remove [<${Object.keys(REMOVERS).filter((k) => k !== 'agy').join('|')}> ...]   (no names = all)`); process.exit(1); }
    for (const n of targets) {
      const where = REMOVERS[n]();
      console.log(where ? `${n}: removed from ${where}` : `${n}: nothing to remove`);
    }
    console.log('\nThe Chrome extension is untouched; remove it from chrome://extensions if you want a full reset.');
    break;
  }
  case 'extension':
    console.log(EXTENSION);
    break;
  case 'doctor':
    await doctor();
    break;
  default:
    console.log('Unknown command. Use: serve | setup [agent…] | remove [agent…] | extension | doctor');
    process.exit(1);
}
