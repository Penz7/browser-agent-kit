# Cursor

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- cursor
```

Writes `~/.cursor/mcp.json` (global). For a single project create `.cursor/mcp.json` with the same content.

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

Cursor Settings → **MCP** → the `browser` server appears; toggle it on. A green dot and the tool list confirm it started. Use **Agent** mode in chat (not Ask).

## Teach Cursor

Add a rule file `.cursor/rules/browser.mdc` with `alwaysApply: true` and the contents of `configs/AGENTS.md.snippet`.

## Troubleshooting

- Yellow/red dot: click to see the server log. Usually a wrong path or `npm install` not run.
- Cursor limits the number of active MCP tools; disable servers you do not need if `browser` tools are cut off.
- Shared steps: see [_common.md](_common.md).
