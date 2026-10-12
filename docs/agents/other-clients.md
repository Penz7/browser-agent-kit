# Any other MCP client (Zed, JetBrains, Continue, Goose, LibreChat, …)

Print a generic block and paste it where the client keeps its MCP servers:

```bash
node ~/.browser-agent-kit/bin/cli.js setup json
```

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

Transport is **stdio**. Command `node`, one argument (the absolute path to `server/src/index.js`), optional env. Some clients rename the wrapper key (`servers`, `context_servers`, `mcp`) or want `command` as an array; keep the three facts above and adapt the shape.

Known shapes:

| Client | Where | Shape |
|---|---|---|
| Zed | `settings.json` → `context_servers` | `{"browser": {"command": {"path": "node", "args": ["…/index.js"], "env": {…}}}}` (check your Zed version) |
| Continue | `config.yaml` → `mcpServers` | `- name: browser` / `command: node` / `args: […]` |
| JetBrains AI Assistant | Settings → Tools → AI Assistant → MCP | add server with command and args |
| Goose | `~/.config/goose/config.yaml` → `extensions` | `type: stdio`, `cmd: node`, `args: […]` |

After adding, restart the client, confirm the `browser` tools are listed, and follow the shared steps in [_common.md](_common.md) for the extension, site allowlist and `doctor`.
