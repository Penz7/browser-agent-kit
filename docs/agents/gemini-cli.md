# Gemini CLI

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- gemini
```

Writes `mcpServers.browser` into `~/.gemini/settings.json`. Project-level: `.gemini/settings.json`.

## Manual config

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["/Users/you/.browser-agent-kit/server/src/index.js"],
      "env": { "BROWSER_KIT_PORT": "7851" },
      "timeout": 60000
    }
  }
}
```

## Activate

Start `gemini`, run `/mcp` to list servers and tools. First use of a tool asks for confirmation; choose "always allow" for the `browser` server to avoid prompts.

## Teach Gemini CLI

Add `configs/AGENTS.md.snippet` to `GEMINI.md` in the project (or `~/.gemini/GEMINI.md` globally).

## Troubleshooting

- `/mcp` shows "disconnected": run `node …/server/src/index.js` by hand to surface errors.
- Gemini CLI and Antigravity share `~/.gemini`; configuring both is fine, they read different files.
- Shared steps: see [_common.md](_common.md).
