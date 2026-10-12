# Steps shared by every agent

These steps are the same for every agent and are referenced from each guide.

## A. Install the kit

```bash
gh repo clone Penz7/browser-agent-kit ~/.browser-agent-kit     # or: git clone git@github.com:Penz7/browser-agent-kit.git ~/.browser-agent-kit
cd ~/.browser-agent-kit && npm install
```

## B. Load the extension in Chrome (once)

1. Open `chrome://extensions` (the wizard opens it for you).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and choose `~/.browser-agent-kit/extension` (`node bin/cli.js extension` prints the exact path; the wizard also copies it to your clipboard).
4. A welcome page opens. Green dot = connected to a running server. Red is normal until an agent starts the server.

## C. Allow the sites the agent may touch

Open the site, click the extension icon, press **Allow this site**. Or tick **Allow all sites** (convenient, less safe).

## D. Verify

```bash
node ~/.browser-agent-kit/bin/cli.js doctor
```

Expected: `OK: the Chrome extension connected.` Then ask the agent: *"Open a new tab, go to example.com and read the page title."*

## E. Optional: shared token

```bash
node ~/.browser-agent-kit/bin/cli.js setup <agent> --token
```

Prints a random token, writes it into the agent config, and tells you to paste the same value into extension icon → Settings → Shared token.

## F. Teach the agent (optional but recommended)

Tools carry full descriptions and the server sends usage instructions over MCP, so most agents just work. For better behaviour, add the text of `configs/AGENTS.md.snippet` to the agent's rules file; each guide says where that file lives. Claude Code can also use `skill/SKILL.md` as a skill.
