#!/bin/sh
# Installer for Browser Agent Kit.
#   Private repo (needs your GitHub login, via gh or git ssh):
#     gh repo clone Penz7/browser-agent-kit ~/.browser-agent-kit && ~/.browser-agent-kit/install.sh
#   Public repo:
#     curl -fsSL https://raw.githubusercontent.com/Penz7/browser-agent-kit/main/install.sh | sh -s -- [agent ...]
set -e
DIR="${BROWSER_KIT_DIR:-$HOME/.browser-agent-kit}"
REPO="${BROWSER_KIT_REPO:-https://github.com/Penz7/browser-agent-kit.git}"
SELF_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo "")

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required (https://nodejs.org)"; exit 1; }

if [ -n "$SELF_DIR" ] && [ -f "$SELF_DIR/package.json" ]; then
  DIR="$SELF_DIR"                      # running from a checkout
elif [ -d "$DIR/.git" ]; then
  echo "Updating $DIR"; git -C "$DIR" pull --ff-only
else
  command -v git >/dev/null 2>&1 || { echo "git is required"; exit 1; }
  echo "Cloning into $DIR"
  if command -v gh >/dev/null 2>&1; then gh repo clone Penz7/browser-agent-kit "$DIR" -- --depth 1; else git clone --depth 1 "$REPO" "$DIR"; fi
fi

cd "$DIR"
npm install --omit=dev --no-audit --no-fund --silent
node bin/cli.js setup "$@"
