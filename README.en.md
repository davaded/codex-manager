# Codex Manager

A desktop and command-line manager for multiple Codex accounts, with account switching, real quota visibility, live session token tracking, and a calmer desktop workspace for daily use.

[简体中文](./README.md)

[![Release](https://img.shields.io/github/v/release/davaded/codex-manager?display_name=tag&sort=semver)](https://github.com/davaded/codex-manager/releases)
[![Downloads](https://img.shields.io/github/downloads/davaded/codex-manager/total)](https://github.com/davaded/codex-manager/releases)
[![License](https://img.shields.io/github/license/davaded/codex-manager)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/davaded/codex-manager/release.yml?branch=main)](https://github.com/davaded/codex-manager/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#installation)

## Preview

Primary workspace:

<img src="./docs/preview.png" alt="Codex Manager Preview" width="960" />

Tray panel for quick switching and quota checks:

<img src="./docs/tray-panel-demo.png" alt="Tray Panel Demo" width="420" />

## Why

If you use multiple Codex/OpenAI accounts, two problems show up quickly:

- It is hard to tell which account is active.
- Real quota usage is hard to compare.

Codex Manager reduces both to a few desktop and tray actions.

## Features

- Add accounts with OAuth or import the current `~/.codex/auth.json`
- Detect when the current live auth belongs to an unmanaged account
- Import the current live auth with one click
- Keep the shared `~/.codex/sessions` working set intact when switching
- Read real 5-hour and weekly quota usage
- Track live session tokens and refresh them automatically in the stats view
- Record per-account token segments from this version onward
- Refresh usage globally or per account
- Smart switch to the account with more available quota
- Switch between account workspace and stats workspace views
- Use a translucent tray panel for quick switching
- Use hot switching by default, with optional desktop restart as a compatibility fallback
- Export backups and persist app settings
- Switch managed accounts from the command line with `codex-manager`

## Installation

Recommended: download a packaged build from GitHub Releases.

- Windows: `.msi` or `.exe`
- macOS: `.dmg`
- Linux: `.deb`, `.rpm`, or `.AppImage`

Releases: <https://github.com/davaded/codex-manager/releases>

### CLI Availability

After installation, the `codex-manager` command behaves like this:

| Platform | Recommended package | CLI availability |
| --- | --- | --- |
| Windows | `.exe` or `.msi` | Installed to `PATH` automatically |
| macOS | `.dmg` | Use the bundled helper script once |
| Linux | `.deb` or `.rpm` | Available directly as `codex-manager` |
| Linux | `.AppImage` | Use the helper script once, or keep it portable |

Notes:

- On Windows, reopen your terminal after installation so the new `PATH` is picked up.
- On macOS, the release ships as a `.dmg`. If you also want a global `codex-manager` command, run the bundled helper script once after dragging the app into `/Applications`.
- On Linux, prefer `.deb` or `.rpm` if you want a package-managed CLI experience.
- The app reads and writes `~/.codex/auth.json`, so Codex CLI should already be installed and working.

## Command Line Switching

You can switch managed accounts from the command line:

```bash
codex-manager list
codex-manager switch work
codex-manager switch dev@company.com
codex-manager switch 2
```

The CLI updates both the managed `accounts.json` state and the live `~/.codex/auth.json`.

By default, switching only hot-swaps `~/.codex/auth.json` and does not close Codex.
If your local Codex Desktop still holds on to the previous auth, enable the compatibility fallback to restart Codex after switching.

For `.dmg` and `.AppImage` installs, the release helper script can expose the command globally:

```bash
sudo bash ./install-unix-cli.sh /Applications/codex-manager.app /usr/local/bin/codex-manager
```

If you are running from the repo locally, you can still expose the dev CLI wrapper with:

```bash
npm link
```

That local command is now only a thin wrapper and forwards to the Rust CLI implementation in this repo, so `cargo` must be available on the machine.

## Quick Start

1. Launch Codex Manager.
2. Import the current auth or add an account via OAuth.
3. Refresh usage.
4. Use the `Accounts` view for switching and the `Stats` view for live token and routing insight.
5. Switch manually, use Smart Switch, or use `codex-manager switch ...`.

## Active Account Detection

The app reads `~/.codex/auth.json` and identifies the current account in this order:

1. `email`
2. `userId`
3. `chatgpt_account_id` from saved credentials
4. `refresh_token / access_token / id_token`

If the live auth does not match any managed account but still contains a recognizable identity, the app shows it as an unmanaged current account instead of incorrectly keeping an old managed account active.

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

## Token Tracking

The stats view reads the rollout log for the current live session and polls automatically, so the current session token count keeps moving while the session is active.

Per-account token tracking uses segmented accounting:

1. The active account keeps accumulating the current live session tokens
2. When you switch away, that segment is written back to the previous account
3. The newly active account starts a fresh segment from the switch point

That means per-account token totals become accurate from this version onward, but older shared-session history cannot be perfectly attributed retroactively.

## Tray Panel

The desktop app creates a system tray icon and a quick action panel.

Current tray behavior:

- Left click toggles the tray panel
- Clicking outside the panel hides it
- Tray menu interactions do not accidentally reopen the panel
- The floating panel stays close to the tray area with platform-specific positioning
- You can import current auth, run Smart Switch, refresh usage, and switch quickly from the tray

## How It Works

The switch flow is handled serially by the Tauri backend. The main logic lives in [`src-tauri/src/commands/sessions.rs`](./src-tauri/src/commands/sessions.rs).

Current flow:

1. Read the current shared `~/.codex/sessions` state
2. Write the target account's `auth.json`
3. Keep the shared session working set unchanged
4. Hot-swap `auth.json` by default, and only restart the Codex desktop app when the compatibility setting is enabled

Stability safeguards:

- A global lock prevents concurrent switches
- Failed writes to `auth.json` are rolled back
- Local persistence failures do not incorrectly mark the switch as failed
- Auto-restart shows a confirmation dialog
- Auto-restart failure does not undo the account switch

## Data and Paths

App data is stored in the system app-data directory. Main files include:

- `accounts.json`: account list, UI state, and per-account token ledger state
- `settings.json`: theme, proxy, auto-refresh, auto-preheat, and compatibility restart settings
- `credentials/<account-id>.json`: saved credentials per account
- `sessions/<account-id>/`: legacy compatibility session directory

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

- More real-device validation for macOS and Linux installers
- Migrate OAuth browser opening from `tauri-plugin-shell` to `tauri-plugin-opener`
- Better diagnostics for port conflicts, permissions, and auth/session directory errors
- More refined tray positioning and platform-specific desktop behavior

## Security Notes

- The app stores credentials locally, so do not use it on untrusted machines.
- The project does not intentionally upload credentials to third parties; quota reads go through official OpenAI-related endpoints.
- If you do not want credentials stored locally, do not add accounts.

## Known Limitations

- OAuth browser opening still uses the deprecated `tauri-plugin-shell` `open` API
- Automatic Codex desktop restart is currently implemented and verified only on Windows
- Most end-to-end installer validation so far has happened on Windows; macOS and Linux still need more real-device testing
- Browser-only preview mode still keeps mock fallback behavior for UI inspection
- Per-account token totals are based on segmented accounting over a shared session store, not perfect historical attribution
