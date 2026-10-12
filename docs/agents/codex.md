# OpenAI Codex CLI

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- codex
```

Writes a `[mcp_servers.browser]` block into `~/.codex/config.toml`. Safe to re-run: it detects an existing block.

## Manual config

Append to `~/.codex/config.toml`:

```toml
[mcp_servers.browser]
command = "node"
args = ["/Users/you/.browser-agent-kit/server/src/index.js"]

[mcp_servers.browser.env]
BROWSER_KIT_PORT = "7851"
# BROWSER_KIT_TOKEN = "paste-the-same-token-into-the-extension"
```

Use the absolute path to `server/src/index.js` (no `~`).

## Activate

Start a new `codex` session. Check with `/mcp` inside Codex: the `browser` server should list 15 tools (`tabs_context`, `computer`, `read_page`, …).

## Teach Codex

Add `configs/AGENTS.md.snippet` to your project's `AGENTS.md` (Codex reads `AGENTS.md` in the repo root and in `~/.codex/AGENTS.md` for global rules).

## Try it

```
codex "Open a new tab, go to example.com, and tell me the page title."
```

## Troubleshooting

- `/mcp` shows the server but no tools: the server could not start. Run `node ~/.browser-agent-kit/server/src/index.js` manually; it should stay silent (it speaks MCP on stdio). Any error printed means a bad path or missing `npm install`.
- Codex runs with a sandbox; the kit needs localhost networking. If tool calls fail with connection errors, allow network access for the session or set `sandbox_mode` per your Codex version's docs.
- Shared steps (extension, allow sites, doctor): see [_common.md](_common.md).
