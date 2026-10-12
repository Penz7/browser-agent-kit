# Kiro

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- kiro
```

Writes `~/.kiro/settings/mcp.json`. Project-level: `.kiro/settings/mcp.json`.

## Manual config

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/Users/you/.browser-agent-kit/server/src/index.js"],
      "env": { "BROWSER_KIT_PORT": "7851" },
      "disabled": false,
      "autoApprove": ["tabs_context", "read_page", "find", "get_page_text"]
    }
  }
}
```

## Activate

Kiro panel → **MCP Servers** → the server reconnects when the file changes; otherwise use the reconnect button.

## Teach Kiro

Add a steering file `.kiro/steering/browser.md` with the contents of `configs/AGENTS.md.snippet`.

Shared steps: see [_common.md](_common.md).
