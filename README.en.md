# Codex Manager

A desktop manager for switching between multiple OpenAI/Codex accounts without breaking your active Codex session flow.

[简体中文](./README.md)

[![Release](https://img.shields.io/github/v/release/davaded/codex-manager?display_name=tag&sort=semver)](https://github.com/davaded/codex-manager/releases)
[![Downloads](https://img.shields.io/github/downloads/davaded/codex-manager/total)](https://github.com/davaded/codex-manager/releases)
[![License](https://img.shields.io/github/license/davaded/codex-manager)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/davaded/codex-manager/release.yml?branch=main)](https://github.com/davaded/codex-manager/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#installation)

## UI Preview

Main window:

![Codex Manager Preview](./docs/preview.png)

Tray panel for quick switching and quota checks:

![Tray Panel Demo](./docs/tray-panel-demo.png)

## Why

If you use multiple Codex/OpenAI accounts, two problems show up quickly:

- It is hard to tell which account is active.
- Real quota usage is hard to compare.

Codex Manager reduces both to a few desktop and tray actions.

## Features

- Add accounts with OAuth or import the current `~/.codex/auth.json`
- Keep the shared `~/.codex/sessions` working set intact when switching
- Read real 5-hour and weekly quota usage
- Refresh usage globally or per account
- Smart switch to the account with more available quota
- Use a translucent tray panel for quick switching
- Optionally restart the Codex desktop app after switching
- Export backups and persist app settings

## Installation

> Recommended: download a packaged build from GitHub Releases.

- Windows: `.msi` or `.exe`
- macOS: `.dmg`
- Linux: `.AppImage`, `.deb`, or `.rpm` depending on the release target

Releases: https://github.com/davaded/codex-manager/releases

### Notes

- On first launch, your OS may ask you to confirm that the app is safe to open.
- The app reads and writes `~/.codex/auth.json`, so Codex CLI should already be installed and working.
- On Windows, reopen your terminal after installation so the new `codex-manager` command is picked up from `PATH`.

## Quick Start

1. Launch Codex Manager.
2. Import the current auth or add an account via OAuth.
3. Refresh usage.
4. Switch manually or use Smart Switch.

## Command Line Switching

You can also switch managed accounts from the command line:

```bash
codex-manager list
codex-manager switch work
codex-manager switch dev@company.com
```

The CLI updates both the managed `accounts.json` state and the live `~/.codex/auth.json`.

Just like the desktop flow, if Codex CLI or the desktop app is already running, restart it after switching so the new auth takes effect.

Packaged builds expose the command like this:

- Windows `.exe` / `.msi`: the installer adds `codex-manager` to `PATH`
- Linux `.deb` / `.rpm`: the package-installed binary is available directly as `codex-manager`
- Linux `.AppImage`: create your own launcher or symlink if you want a global `codex-manager` command
- macOS `.dmg`: drag-and-drop installs cannot modify your shell `PATH`, so create a symlink once:

```bash
sudo ln -sf "/Applications/codex-manager.app/Contents/MacOS/codex-manager" /usr/local/bin/codex-manager
```

If you are running from the repo locally, you can expose the command with:

```bash
npm link
```

## Active Account Detection

The app reads `~/.codex/auth.json` and identifies the active account in this order:

1. `email`
2. `userId`
3. `chatgpt_account_id` from saved credentials
4. `refresh_token / access_token / id_token`

This keeps the active state accurate even when saved credentials lag behind.

## Import Current Auth

`Import Current Auth` reads the already active `~/.codex/auth.json` on your machine and registers it as a managed account.

During import, the app:

1. Reads the current `auth.json`
2. Parses `email / userId / accountId`
3. Matches existing accounts to avoid duplicates
4. Saves credentials and refreshes quota data

If the auth state already belongs to an existing account, the app updates that account instead of creating a duplicate.

## Smart Switch

`Smart Switch` refreshes quota data first, then selects the best candidate among accounts with valid usage data.

Current rule set:

- Prefer the account with the lowest `5h` usage
- If `5h` usage is tied, compare weekly usage
- If the active account is already the best choice, do nothing

## Tray Panel

The desktop app creates a system tray icon and a quick action panel.

Current tray behavior:

- Left click toggles the tray panel
- Clicking outside the panel hides it
- Tray menu interactions do not accidentally reopen the panel
- The floating panel stays close to the tray area with platform-specific positioning
- The menu supports:
  - Open tray panel
  - Open main window
  - Hide tray panel
  - Quit
- Inside the panel you can:
  - Import current auth
  - Run Smart Switch
  - Refresh usage
  - View all accounts and switch quickly
  - Check lightweight two-column account cards with quota status

The tray panel is a lightweight floating surface for quick switching, not a replacement for the full main window.

## How It Works

The switch flow is handled serially by the Tauri backend. The main logic lives in [`src-tauri/src/commands/sessions.rs`](./src-tauri/src/commands/sessions.rs).

Current flow:

1. Read the current shared `~/.codex/sessions` state
2. Write the target account's `auth.json`
3. Keep the shared session working set unchanged
4. Restart the Codex desktop app if the setting is enabled

Stability safeguards:

- A global lock prevents concurrent switches
- Failed writes to `auth.json` are rolled back
- Local persistence failures do not incorrectly mark the switch as failed
- Auto-restart shows a confirmation dialog
- Auto-restart failure does not undo the account switch

## Quota Source

Quota values are not estimated by default.

The app uses each account's own `access_token + ChatGPT-Account-Id` to query web-side usage endpoints and read real quota windows plus reset times.

If a request fails, the UI shows the failure reason.

## Data and Paths

App data is stored in the system app-data directory. Main files include:

- `accounts.json`: account list and UI state
- `settings.json`: theme, proxy, auto-refresh, and restart-after-switch settings
- `credentials/<account-id>.json`: saved credentials per account
- `sessions/<account-id>/`: legacy compatibility snapshot directory

The live Codex directory remains:

- `~/.codex/auth.json`: currently active account
- `~/.codex/sessions`: session directory shared by CLI and the desktop app

## Development

Prerequisites:

- Node.js 18+
- Rust stable
- Tauri v2 build environment

Install dependencies:

```bash
npm install
```

Run Tauri in development:

```bash
npm run tauri dev
```

Run the frontend only:

```bash
npm run dev
```

Build checks:

```bash
npm run build
cd src-tauri
cargo check
```

## Roadmap

- macOS and Linux validation and packaging
- Migrate OAuth browser opening from `tauri-plugin-shell` to `tauri-plugin-opener`
- Better diagnostics for port conflicts, permissions, and auth/session directory errors
- More refined tray positioning and platform-specific desktop behavior

## Contributing

PRs and issues are welcome.

Recommended checks before submitting:

- `npm run build`
- `cargo check` in `src-tauri`

If you change switching logic or data migration behavior, document:

- How failures are rolled back
- Whether existing local data structures are affected

## Security Notes

- The app stores credentials locally, so do not use it on untrusted machines.
- The project does not intentionally upload credentials to third parties; quota reads go through official OpenAI-related endpoints.
- If you do not want credentials stored locally, do not add accounts.

## Known Limitations

- OAuth browser opening still uses the deprecated `tauri-plugin-shell` `open` API
- Automatic Codex desktop restart is currently implemented and verified only on Windows
- Most validation so far has happened on Windows; macOS and Linux still need more real-device testing
- Browser-only preview mode still keeps mock fallback behavior for UI inspection
