# OpenCode

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- opencode
```

Writes `~/.config/opencode/opencode.json` (OpenCode's own schema, not `mcpServers`). Project-level: `opencode.json` in the repo root.

## Manual config

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browser": {
      "type": "local",
      "command": ["node", "/Users/you/.browser-agent-kit/server/src/index.js"],
      "enabled": true,
      "environment": { "BROWSER_KIT_PORT": "7851" }
    }
  }
}
```

## Activate

Restart `opencode`. Tools show up as `browser_computer`, `browser_read_page`, etc.

## Teach OpenCode

Add `configs/AGENTS.md.snippet` to `AGENTS.md` in the project.

## Troubleshooting

- OpenCode runs any provider (DeepSeek, OpenRouter, local models). For weak-vision models set `"BROWSER_KIT_AUTO_SCREENSHOT": "0"` in `environment`.
- Shared steps: see [_common.md](_common.md).
