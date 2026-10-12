# Cline (VS Code)

Cline lets you pick any model (DeepSeek, Qwen, GLM, OpenRouter, Ollama…), so this is the usual path for models that have no native agent of their own.

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- cline
```

Writes `cline_mcp_settings.json` in VS Code's global storage:

- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/`
- Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/`
- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\`

## Manual config

Cline → **MCP Servers** icon → **Installed** → **Configure MCP Servers** opens that file. Add:

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/Users/you/.browser-agent-kit/server/src/index.js"],
      "env": { "BROWSER_KIT_PORT": "7851" },
      "disabled": false,
      "autoApprove": ["tabs_context", "read_page", "find", "get_page_text", "computer"]
    }
  }
}
```

`autoApprove` is optional; it stops Cline from asking before each read-only call.

## Activate

Reload the VS Code window. Cline → MCP Servers → `browser` shows green with 15 tools. Use **Act** mode.

## Teach Cline

Add `configs/AGENTS.md.snippet` to `.clinerules` (file) or `.clinerules/browser.md` (folder) in the project.

## Model tips

- Weak-vision models: in the config set `"BROWSER_KIT_AUTO_SCREENSHOT": "0"` under `env`, and tell the model to rely on `read_page` and ref clicks.
- Small context windows: ask for `read_page` with filter `interactive` and `get_page_text` with a `limit`.

## Troubleshooting

- Server shows red: hover for the error; usually the path. Run `node …/server/src/index.js` manually.
- Shared steps: see [_common.md](_common.md).
