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

const mcpEntry = () => ({ command: 'node', args: [SERVER], env: { BROWSER_KIT_PORT: PORT } });

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

function setupJsonClient(file) {
  return mergeJson(file, (d) => { d.mcpServers = d.mcpServers || {}; d.mcpServers.browser = mcpEntry(); });
}

function setupCodex() {
  const file = path.join(os.homedir(), '.codex', 'config.toml');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (/^\[mcp_servers\.browser\]/m.test(existing)) return file + ' (already configured)';
  const block = `\n[mcp_servers.browser]\ncommand = "node"\nargs = [${JSON.stringify(SERVER)}]\n\n[mcp_servers.browser.env]\nBROWSER_KIT_PORT = "${PORT}"\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, (existing && !existing.endsWith('\n') ? '\n' : '') + block);
  return file;
}

function setupClaude() {
  const r = spawnSync('claude', ['mcp', 'add', 'browser', '--scope', 'user', '--env', `BROWSER_KIT_PORT=${PORT}`, '--', 'node', SERVER], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.log('\n`claude` CLI not found or failed. Run this yourself:\n');
    console.log(`  claude mcp add browser --scope user --env BROWSER_KIT_PORT=${PORT} -- node ${SERVER}\n`);
    return null;
  }
  return 'claude mcp (user scope)';
}

const home = os.homedir();

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

const AGENTS = {
  codex: setupCodex,
  claude: setupClaude,
  cursor: () => setupJsonClient(path.join(home, '.cursor', 'mcp.json')),
  gemini: () => setupJsonClient(path.join(home, '.gemini', 'settings.json')),
  windsurf: () => setupJsonClient(path.join(home, '.codeium', 'windsurf', 'mcp_config.json')),
  antigravity: setupAntigravity,
  agy: setupAntigravity,
  json: () => { console.log(JSON.stringify({ mcpServers: { browser: mcpEntry() } }, null, 2)); return null; }
};

function printNext() {
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
    const names = rest.filter((n) => !n.startsWith('--'));
    if (!names.length || names.some((n) => !AGENTS[n])) {
      console.log(`Usage: browser-agent-kit setup <${Object.keys(AGENTS).join('|')}> [...]`);
      console.log('  antigravity --workspace writes ./.agents/mcp_config.json for the current project instead of the global file.');
      console.log('  json prints a generic mcpServers block for Cline, Roo Code, OpenCode, etc.');
      process.exit(1);
    }
    for (const n of names) {
      const where = AGENTS[n]();
      if (where) console.log(`${n}: configured -> ${where}`);
    }
    printNext();
    break;
  }
  case 'extension':
    console.log(EXTENSION);
    break;
  case 'doctor':
    await doctor();
    break;
  default:
    console.log('Unknown command. Use: serve | setup <agent> | extension | doctor');
    process.exit(1);
}
