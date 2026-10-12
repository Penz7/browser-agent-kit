# VS Code Copilot (agent mode)

## One-line setup

```bash
cd your-project && node ~/.browser-agent-kit/bin/cli.js setup copilot
```

Writes `./.vscode/mcp.json` for the current project (Copilot uses a `servers` map, not `mcpServers`). For all projects, add the same block under `"mcp": { "servers": … }` in VS Code user `settings.json`.

## Manual config

`.vscode/mcp.json`:

```json
{
  "servers": {
    "browser": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/you/.browser-agent-kit/server/src/index.js"],
      "env": { "BROWSER_KIT_PORT": "7851" }
    }
  }
}
```

## Activate

Open the file; VS Code shows a **Start** lens above the server. Open Copilot Chat → **Agent** mode → tools icon → tick the `browser` tools.

## Teach Copilot

Add `.github/copilot-instructions.md` with the contents of `configs/AGENTS.md.snippet`.

Shared steps: see [_common.md](_common.md).
