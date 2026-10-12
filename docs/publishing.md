# Publishing the extension

Loading the extension "unpacked" is fine for one machine, but it has two costs: Chrome records every failed
connection attempt on the extension's Errors page (it only does that for unpacked extensions), and users must turn
on Developer mode. Publishing fixes both and adds automatic updates.

## 1. Build the zip

```sh
browser-agent-kit pack          # writes dist/browser-agent-kit-extension-<version>.zip
```

Bump `version` in `extension/manifest.json` first; the store rejects a version it has already seen.
Pushing a tag like `v0.2.0` makes the `release` GitHub workflow build the same zip and attach it to a release.

## 2. Chrome Web Store

1. Register at https://chrome.google.com/webstore/devconsole (one-time fee).
2. New item → upload the zip.
3. Listing: name "Browser Agent Kit", a short description, at least one 1280×800 screenshot (the overlay on a page works well).
4. Privacy tab. The reviewers ask for a justification per permission; this is what the kit does with each:
   - `debugger`: real mouse/keyboard input, screenshots, console and network capture, file-dialog interception (CDP).
   - `tabs`, `tabGroups`: list tabs, open the agent's tabs in a group.
   - `scripting` + host permission `<all_urls>`: read the page outline and run the overlay on sites the user allowed.
   - `storage`, `alarms`: settings and the reconnect schedule.
   - `downloads`: list files the page downloaded (read-only).
   - `nativeMessaging`: learn from a local helper when the user's MCP server is running.
   - Remote code: none. Data use: nothing leaves the machine; the extension only talks to 127.0.0.1.
5. Visibility: "Unlisted" is enough if only your users need it; the link installs it without Developer mode.

Review usually takes a few days because of the `debugger` permission.

## 3. After the first publish

The store-installed copy has a **new extension id**. Update what references it:

```sh
browser-agent-kit native --extension-id <new id>       # native messaging host manifest
export BROWSER_KIT_EXTENSION_ID=<new id>                 # only if you pinned the id in the MCP config
```

Then reload the extension once.

## Self-hosting instead

Chrome on Windows and macOS only installs extensions from the Web Store (enterprise policies aside), so self-hosting
a `.crx` is practical only on Linux and for managed devices. For those, pack with the same command, then sign it
with Chrome: `chrome --pack-extension=extension --pack-extension-key=key.pem`, and serve the `.crx` with an
`update_url` manifest as described in https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux.
