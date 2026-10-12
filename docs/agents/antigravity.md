# Google Antigravity

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- antigravity
```

Writes the `browser` server into the global file `~/.gemini/config/mcp_config.json`. If an older build's file `~/.gemini/antigravity/mcp_config.json` exists it is updated too. Existing servers are kept.

Project-only instead of global:

```bash
cd your-project && node ~/.browser-agent-kit/bin/cli.js setup antigravity --workspace   # writes ./.agents/mcp_config.json
```

## Manual config

`~/.gemini/config/mcp_config.json` (or `.agents/mcp_config.json` in the workspace):

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

Not sure where your build reads from? In Antigravity: agent panel → `…` → **MCP Servers** → **Manage MCP Servers** → **View raw config**. Paste the block there.

## Activate

Agent panel → `…` → **MCP Servers** → **Manage MCP Servers** → **Refresh** (or restart the IDE). The `browser` server should show its tools.

## Teach Antigravity

Create `.agents/rules/browser.md` in the project with the contents of `configs/AGENTS.md.snippet`. Global rules go in `~/.gemini/GEMINI.md`.

## Antigravity's own browser vs this kit

Antigravity ships a browser subagent that uses its own Chrome profile. This kit instead controls **your** everyday Chrome with your logins. Both can coexist; tell the agent "use the browser MCP tools" when you want the kit.

## Troubleshooting

- Tools not listed after Refresh: open **View raw config**, confirm the JSON is valid and the path is absolute, restart the IDE.
- "Site not allowed": click the extension icon on that site → Allow this site.
- Shared steps: see [_common.md](_common.md).
