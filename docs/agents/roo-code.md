# Roo Code (VS Code)

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- roo
```

Writes `mcp_settings.json` under VS Code global storage (`rooveterinaryinc.roo-cline/settings/`). Project-level alternative: `.roo/mcp.json`.

## Manual config

Roo Code → **MCP Servers** → **Edit Global MCP** (or **Edit Project MCP**):

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/Users/you/.browser-agent-kit/server/src/index.js"],
      "env": { "BROWSER_KIT_PORT": "7851" },
      "alwaysAllow": ["tabs_context", "read_page", "find", "get_page_text"]
    }
  }
}
```

## Activate

Roo reloads servers automatically when the file changes; otherwise reload the window. Enable the server in the MCP panel.

## Teach Roo

Add `.roo/rules/browser.md` with the contents of `configs/AGENTS.md.snippet`.

## Troubleshooting

- Make sure "Enable MCP Servers" is on in Roo settings.
- Shared steps: see [_common.md](_common.md).
