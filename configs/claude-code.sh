#!/bin/sh
# Claude Code: register the server once (user scope = available in every project).
claude mcp add browser --scope user \
  --env BROWSER_KIT_PORT=7851 \
  -- node ~/.browser-agent-kit/server/src/index.js
