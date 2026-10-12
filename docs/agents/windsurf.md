# Windsurf (Codeium)

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- windsurf
```

Writes `~/.codeium/windsurf/mcp_config.json`.

## Manual config

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/Users/you/.browser-agent-kit/server/src/index.js"],
      "env": { "BROWSER_KIT_PORT": "7851" }
    }
  }
}
```

## Activate

Cascade panel → MCP icon (or Windsurf Settings → **Cascade** → **MCP Servers**) → **Refresh**. Enable the `browser` server and its tools.

## Teach Windsurf

Add `.windsurf/rules/browser.md` in the project with the contents of `configs/AGENTS.md.snippet`, or a global rule in Windsurf settings.

## Troubleshooting

- Windsurf caps the number of enabled tools; if some `browser` tools are missing, disable other servers.
- Shared steps: see [_common.md](_common.md).
