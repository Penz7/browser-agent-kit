# Claude Code

Claude Code already ships "Claude in Chrome"; this kit gives it the same tool names through a server you control (useful offline, in CI accounts without the extension, or to share one browser with other agents).

## One-line setup

```bash
cd ~/.browser-agent-kit && npm run setup -- claude
```

Runs `claude mcp add browser --scope user … -- node …/server/src/index.js`. User scope = available in every project.

## Manual config

```bash
claude mcp add browser --scope user --env BROWSER_KIT_PORT=7851 -- node /Users/you/.browser-agent-kit/server/src/index.js
```

Or a project-level `.mcp.json` committed with the repo:

```json
{ "mcpServers": { "browser": { "command": "node", "args": ["/Users/you/.browser-agent-kit/server/src/index.js"], "env": { "BROWSER_KIT_PORT": "7851" } } } }
```

## Activate

Start `claude`, run `/mcp`, confirm `browser` is connected. Tool names appear as `mcp__browser__computer` etc.

## Teach Claude Code

Install the skill once:

```bash
mkdir -p ~/.claude/skills/browser-agent-kit && cp ~/.browser-agent-kit/skill/SKILL.md ~/.claude/skills/browser-agent-kit/SKILL.md
```

Or paste `configs/AGENTS.md.snippet` into `CLAUDE.md`.

## Avoid two browsers fighting

If the official Claude in Chrome extension is also installed, both tool sets are visible. Tell Claude which one to use ("use the browser MCP server"), or disable one.

## Troubleshooting

- `claude mcp list` shows `browser: failed`: run the server by hand (`node …/server/src/index.js`) to see the error.
- Permission prompts for every tool call: approve "always" for the `browser` server, or add `mcp__browser__*` to `permissions.allow` in `~/.claude/settings.json`.
- Shared steps: see [_common.md](_common.md).
