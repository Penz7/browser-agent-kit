#!/bin/sh
# One-line installer: curl -fsSL https://raw.githubusercontent.com/Penz7/browser-agent-kit/main/install.sh | sh -s -- [codex|claude|antigravity|cursor|gemini|windsurf|json ...]
set -e
DIR="${BROWSER_KIT_DIR:-$HOME/.browser-agent-kit}"
REPO="${BROWSER_KIT_REPO:-https://github.com/Penz7/browser-agent-kit.git}"

command -v git >/dev/null 2>&1 || { echo "git is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required (https://nodejs.org)"; exit 1; }

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
npm install --omit=dev --no-audit --no-fund --silent

if [ "$#" -gt 0 ]; then
  node bin/cli.js setup "$@"
else
  echo
  echo "Installed. Configure an agent with one of:"
  echo "  node $DIR/bin/cli.js setup codex"
  echo "  node $DIR/bin/cli.js setup claude"
  echo "  node $DIR/bin/cli.js setup antigravity"
  echo "  node $DIR/bin/cli.js setup cursor | gemini | windsurf"
  echo "  node $DIR/bin/cli.js setup json     # Cline, Roo, OpenCode..."
  echo
  echo "Then load the extension in Chrome: chrome://extensions -> Developer mode -> Load unpacked ->"
  echo "  $DIR/extension"
fi
