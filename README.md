<div align="center">

# 🧭 Browser Agent Kit

**Let any AI agent drive your real Chrome, the way Claude in Chrome does.**

Codex · Claude Code · Antigravity · Cursor · Gemini CLI · Windsurf · Cline · Roo Code · OpenCode · Kiro · VS Code Copilot · any MCP client (DeepSeek, Qwen, GLM, Llama…)

[Install](#-install-in-2-minutes) · [Per-agent guides](#-per-agent-guides) · [How it works](#-how-it-works) · [Tools](#-tools-the-agent-gets) · [Security](#-security) · [Troubleshooting](#-troubleshooting) · [Tiếng Việt](README.vi.md)

</div>

---

One Chrome extension plus one MCP server. Every agent that speaks MCP gets the same tools and the same behaviour: its own tab group, a glowing frame on the tab it is working on, element-level clicking, structured page reading, screenshots, JavaScript, console and network logs, and a **Stop** button for you.

| | |
|---|---|
| 🧩 **Shared** | Several agents at once share one extension; the first server process becomes the hub, later ones relay through it |
| 🎯 **Precise clicks** | Every interactive element gets a `ref_N`; agents click by ref instead of guessing pixels |
| 👁 **Two ways to look** | `read_page` for structure, `screenshot` for pixels, combined as needed |
| 🔒 **Safe by default** | Site allowlist, web pages cannot reach the hub, page content is marked as untrusted data |
| ⚡ **Two input modes** | *Real*: trusted events through the Chrome debugger. *Fast*: no debugger, lighter and quicker |
| 🟣 **Visible** | "Agent" tab group, purple frame, status bar, click ripple, Stop button |

---

## 🚀 Install in 2 minutes

Requirements: **Node.js 18+**, **Google Chrome**, access to this repository on GitHub.

### 1. Get the code and run the wizard

```bash
gh repo clone Penz7/browser-agent-kit ~/.browser-agent-kit
cd ~/.browser-agent-kit && npm install && npm run setup
```

No `gh`? Use `git clone git@github.com:Penz7/browser-agent-kit.git ~/.browser-agent-kit`.

The wizard:

1. **Detects** the agents installed on this machine (Codex, Claude Code, Antigravity, Cursor, Gemini CLI, Windsurf, Cline, Roo Code, Kiro, OpenCode) and writes the MCP config for each.
2. **Opens** `chrome://extensions` and **copies** the extension path to your clipboard.
3. **Waits** for the extension to connect and reports OK.

### 2. Load the extension (once; Chrome requires a manual step)

In the `chrome://extensions` tab: enable **Developer mode** (top right) → **Load unpacked** → paste the path from your clipboard → Open. A welcome page appears; a green dot means it is connected.

### 3. Allow a site and go

Open the site you want automated, click the extension icon → **Allow this site**. Then, in your agent:

> Open a new tab, go to example.com and read the page title.

The new tab lands in the **Agent** tab group with a purple frame while the agent works.

<details>
<summary><b>Configure one specific agent instead</b></summary>

```bash
npm run setup -- antigravity          # codex | claude | cursor | gemini | windsurf | cline | roo | kiro | opencode | copilot
npm run setup -- codex claude         # several at once
npm run setup -- json                 # print a generic mcpServers block for any other client
npm run setup -- antigravity --workspace   # project-only config
npm run setup -- antigravity --token       # generate a shared secret (see Security)
```
</details>

<details>
<summary><b>Update</b></summary>

```bash
cd ~/.browser-agent-kit && git pull && npm install
```

Then click ↻ on the Browser Agent Kit card in `chrome://extensions`.
</details>

---

## 📚 Per-agent guides

Each guide covers the one-line setup, the manual config file, how to activate the server inside that agent, where to put the rules that teach it to browse, and agent-specific troubleshooting.

| Agent | Guide | Config written by `setup` |
|---|---|---|
| OpenAI Codex CLI | [docs/agents/codex.md](docs/agents/codex.md) | `~/.codex/config.toml` |
| Claude Code | [docs/agents/claude-code.md](docs/agents/claude-code.md) | `claude mcp add` (user scope) |
| Google Antigravity | [docs/agents/antigravity.md](docs/agents/antigravity.md) | `~/.gemini/config/mcp_config.json` |
| Cursor | [docs/agents/cursor.md](docs/agents/cursor.md) | `~/.cursor/mcp.json` |
| Gemini CLI | [docs/agents/gemini-cli.md](docs/agents/gemini-cli.md) | `~/.gemini/settings.json` |
| Windsurf | [docs/agents/windsurf.md](docs/agents/windsurf.md) | `~/.codeium/windsurf/mcp_config.json` |
| Cline (VS Code) | [docs/agents/cline.md](docs/agents/cline.md) | `cline_mcp_settings.json` |
| Roo Code (VS Code) | [docs/agents/roo-code.md](docs/agents/roo-code.md) | `mcp_settings.json` |
| OpenCode | [docs/agents/opencode.md](docs/agents/opencode.md) | `~/.config/opencode/opencode.json` |
| Kiro | [docs/agents/kiro.md](docs/agents/kiro.md) | `~/.kiro/settings/mcp.json` |
| VS Code Copilot (agent mode) | [docs/agents/vscode-copilot.md](docs/agents/vscode-copilot.md) | `./.vscode/mcp.json` |
| DeepSeek, Qwen, GLM, Llama, other models | [docs/agents/other-models.md](docs/agents/other-models.md) | via Cline / Roo / OpenCode |
| Any other MCP client (Zed, JetBrains, Continue…) | [docs/agents/other-clients.md](docs/agents/other-clients.md) | `setup json` |

---

## 🔍 How it works

```
Agent (Codex / Claude / Antigravity / …)
   │  MCP over stdio
   ▼
server/   MCP server (Node) ── ws://127.0.0.1:7851 ──▶  extension/   Chrome extension (MV3)
          hub: first process owns the port,                   │ chrome.debugger (CDP) + content script
          later processes relay through it                    ▼
                                                        A tab in your Chrome
```

- The **agent** only emits JSON tool calls. The **server** turns them into commands over WebSocket. The **extension** executes them with Chrome APIs and returns the result.
- **Observe → reason → act** loop: after most actions the agent receives a fresh screenshot and checks it before the next step.
- **Stable refs**: a content script tags every interactive element with `ref_N`, valid until the page navigates. Clicking by ref scrolls the element into view and reports if something covers it.
- **Coordinates never drift**: screenshots are downscaled to 1024px wide; server and extension compute the same scale from the viewport, so model coordinates map correctly even on Retina displays.
- **Many agents**: the first server process is the hub, later ones become leaves and relay. No configuration.

### Real vs Fast input mode

| | Real (default) | Fast |
|---|---|---|
| Mouse, keyboard | Trusted events through Chrome DevTools Protocol | Synthetic DOM events from the content script |
| "is debugging this browser" bar | Shown while working, released after 60s idle | Only for shortcuts, JavaScript, console, drag |
| Console / network capture | While the debugger is attached | Only while temporarily attached |
| Best for | Hard sites, editors, `isTrusted` checks | Quick tasks, fewer interruptions |

Change it under extension icon → Settings → *Input mode*.

---

## 🛠 Tools the agent gets

Tool names mirror Claude in Chrome, so prompts and skills written for Claude carry over.

| Tool | What it does |
|---|---|
| `tabs_context` · `tabs_create` · `tabs_close` | list, open (into the Agent group), close tabs |
| `navigate` | go to a URL, `back`, `forward`, wait for load |
| `computer` | `screenshot`, `left/right/middle/double/triple_click`, `left_click_drag`, `mouse_move`, `type`, `key`, `scroll`, `wait`, `zoom`; click by `ref` or `coordinate` |
| `read_page` | compact page outline, every interactive element with a `ref_N` |
| `find` | natural-language element search returning refs |
| `get_page_text` | visible text, paginated with `offset` |
| `form_input` | fill several fields at once with the right events for React / Vue |
| `javascript_tool` | run JS in the page through CDP, not blocked by CSP |
| `read_console_messages` · `read_network_requests` | debugging |
| `file_upload` | attach local files to `<input type=file>` |
| `resize_window` | resize the window |
| `browser_batch` | run several steps, one screenshot at the end |

---

## ⚙️ Settings

Extension icon → **Settings**.

| Setting | Default | Meaning |
|---|---|---|
| Port | 7851 | must match the server's `BROWSER_KIT_PORT` |
| Shared token | empty | only processes that know it can use the hub |
| Allowed sites / Allow all | empty / off | where the agent may act |
| JavaScript dialogs | auto-accept | `alert/confirm/prompt` are always auto-closed so nothing hangs |
| Input mode | Real | see table above |
| Release debugger after idle | 60s | 0 keeps it attached (needed for continuous console capture) |
| Overlay + display name | on, "AI agent" | purple frame and status bar |
| Tab group + name + color | on, "Agent", purple | groups tabs the agent opens |

Server environment variables (set in the MCP config):

| Variable | Default | Meaning |
|---|---|---|
| `BROWSER_KIT_PORT` | 7851 | hub port |
| `BROWSER_KIT_TOKEN` | empty | shared secret, same value in the extension |
| `BROWSER_KIT_MAX_WIDTH` | 1024 | max screenshot width |
| `BROWSER_KIT_AUTO_SCREENSHOT` | 1 | `0` disables the screenshot after each action (saves tokens for weaker models) |
| `BROWSER_KIT_IMAGE_FORMAT` / `_QUALITY` | jpeg / 85 | `png` for sharper text |
| `BROWSER_KIT_EXTENSION_ID` | empty | pin the extension id allowed to connect |
| `BROWSER_KIT_UPLOAD_ROOTS` | `$HOME:$TMPDIR:/tmp` | folders allowed for `file_upload` |
| `BROWSER_KIT_DEBUG` | 0 | `1` logs to stderr |

CLI: `browser-agent-kit` (run the server) · `setup [agent…]` · `remove [agent…]` (undo setup, keeps other servers) · `extension` (print the path) · `doctor` (check the connection).

---

## 🔒 Security

The extension holds `debugger` + `scripting` + `<all_urls>`, so **whoever can talk to the hub can drive Chrome**. The kit closes those doors:

- **Web pages cannot reach the hub.** Browsers always send an `Origin` header on WebSocket upgrades; the hub rejects every `http/https/file/null` origin, accepts only `chrome-extension://…` on `/extension` and origin-less local processes on `/client`.
- **Shared token** (`setup <agent> --token`): when set, both the extension and any second agent must present it before sending commands. Recommended on shared machines.
- **`file_upload`** only accepts regular files under `$HOME` or the temp folder and **never** hidden files or dot-directories (`.ssh`, `.aws`, `.gemini`, `.config`…).
- **Allowlist**: `file:`, `chrome:`, `javascript:`, `data:` can never be controlled, even with Allow all. Matching is by host and subdomain; `example.com.evil.com` does not match `example.com`.
- **Page content is data**: everything read from a page is wrapped in `<untrusted_page_content>`; refs live in the isolated world, page scripts cannot read or forge them.
- **Overlay** lives in a shadow DOM and only inserts text through `textContent`.

The rest is on you: the agent can run JavaScript and read pages on allowed sites, so allow only what you need and have the agent confirm before irreversible actions (purchases, sending messages, deleting).

---

## 🩺 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Red icon, "Not connected" | No agent has started the server yet, or the port differs. Check Settings, press Reconnect, or run `browser-agent-kit doctor`. |
| Agent reports "Site not allowed" | Click the extension icon on that site → Allow this site. |
| "Browser Agent Kit is debugging this browser" bar | Normal in Real mode. Do not press Cancel. To never see it: switch to Fast, or launch Chrome with `--silent-debugger-extension-api`. |
| "Cannot attach debugger" | DevTools is open on that tab. Close it. |
| "Cannot run on this page" | `chrome://` pages, the Chrome Web Store and the PDF viewer are off limits for extensions. |
| Synthetic click does not open a dropdown | Native `<select>` menus need `form_input`, or switch to Real. |
| iframe content missing from `read_page` | Only the main frame is listed. Use screenshots and coordinate clicks for iframes. |
| Agent is refused with "user pressed Stop" | You pressed Stop on the overlay. Extension icon → Resume. |
| Agent does not see the tools | Restart the agent or refresh its MCP server list (see the per-agent guide). |

---

## 🗺 Not yet

- `gif_creator` (record actions as an animated GIF).
- DOM access inside cross-origin iframes.
- Model-based `find` instead of text matching.

**Honest limit:** the tool layer matches Claude in Chrome, but results still depend on the model. Weak-vision models should rely on `read_page` and ref clicks instead of coordinates, and can disable auto screenshots to save tokens.

## 🧪 Development

```bash
npm test     # jsdom tests for DOM/keys/allowlist + MCP ↔ server ↔ fake-extension smoke tests (incl. security)
```

Layout: `extension/` (MV3) · `server/src/` (MCP server, hub/leaf bridge) · `bin/cli.js` · `skill/SKILL.md` · `configs/` · `docs/agents/`.

MIT
