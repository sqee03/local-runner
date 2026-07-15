# Local MQTT App Runner MVP

This repository contains an MVP for a frontend-led local package:

- a React app served locally
- a bundled MQTT broker with WebSocket support
- a backend stub that publishes a test message
- a desktop launcher that starts everything and presents the experience as a desktop app
- a Config view backed by local JSON files for defaults and user overrides
- a Deno-packaged launcher that embeds Node for local Windows and Mac distribution

## Prerequisites

- Node.js 26+
- npm 11+

## Run the MVP

1. Install dependencies:

```bash
npm install
```

2. Start the full local runtime:

```bash
npm run runner
```

This will:

- build the React app into `dist/`
- start the local MQTT broker on `127.0.0.1:18883`
- expose MQTT over WebSockets on `ws://127.0.0.1:19001`
- start the backend publisher
- serve the desktop control UI on `http://127.0.0.1:4173`
- serve the injected frontend app on `http://127.0.0.1:4300`
- open the control UI in the browser for local development

## Configuration

- Shipped defaults live in [config/defaults.json](/Users/sqee/Projects/ciklum/saab/local-mqtt-app-runner/config/defaults.json)
- Machine-specific overrides live in [config/user-overrides.json](/Users/sqee/Projects/ciklum/saab/local-mqtt-app-runner/config/user-overrides.json)
- In the packaged desktop app, open `Config` from the tray menu
- In browser-based local development, use the `Config` button in the top-right corner
- Saved overrides are applied the next time services start

## Packaged App Behavior

- Launching the packaged app normally starts the internal control service in the background, starts MQTT/BE/FE automatically, and opens the FE app inside the desktop window.
- The FE app fills the main desktop window when services are running.
- Launch the same packaged app with `--runner` to open directly into the Config view.
- A tray icon stays available with quick actions for `Open app`, `Open config`, `Start services` or `Stop services`, and `Quit`.
- Left-clicking the tray icon focuses the app window.
- Right-clicking the tray icon opens the native tray menu.
- `Quit` closes the desktop shell and stops the managed runtime started by that app instance.

## Windows Packaging

Build the Windows desktop app with:

```bash
npm run package:windows
```

This now produces only the current desktop-app build in:

- [release/windows/runner](/Users/sqee/Projects/ciklum/saab/local-mqtt-app-runner/release/windows/runner)

Inside that folder, the launchable app is:

- [release/windows/runner/runner.exe](/Users/sqee/Projects/ciklum/saab/local-mqtt-app-runner/release/windows/runner/runner.exe)

Important behavior:

- `release/windows-x64` is a legacy output from the older browser-based packaging flow and should no longer be produced.
- The current packaging cleanup removes old `release/windows-x64` leftovers before each new Windows build.
- The Windows desktop build is the same desktop-app approach as Mac: the app opens in its own desktop window, not in the browser.
- The Windows output is a bundled app directory, similar in spirit to a macOS `.app` bundle.

What is embedded inside the Windows desktop app:

- the packaged Node runtime used by the desktop shell at runtime
- the built frontend from `dist/`
- the injected `fe`, `be`, and `mqtt` packages
- the runner scripts and runtime dependencies

Build-time tool behavior:

- packaging auto-downloads the required Node and Deno binaries locally when missing
- those downloads are temporary local build-tool caches under `.tmp/build-tools/`
- they are not meant to be committed to git

User config location:

- preferred portable location: `<folder containing runner.exe>/runner-data/config/`
- fallback location when the executable folder is not writable: `%LOCALAPPDATA%/runner/config/`

Files created there:

- `defaults.json`
- `user-overrides.json`

## Mac Apple Silicon Packaging

Build the Apple Silicon Mac app with:

```bash
npm run package:mac:arm
```

This produces:

- [release/mac/runner.app](/Users/sqee/Projects/ciklum/saab/local-mqtt-app-runner/release/mac/runner.app)

The Mac build uses the same desktop-app approach as Windows:

- the app opens in its own desktop window
- FE runs inside the app window
- config is available from the tray/menu-bar flow
- runtime services are managed by the desktop app

Build-time tool behavior:

- packaging auto-downloads the required Node and Deno binaries locally when missing
- those downloads are temporary local build-tool caches under `.tmp/build-tools/`
- they are not meant to be committed to git

User config location:

- preferred portable location: `<folder containing runner.app>/runner-data/config/`
- fallback location when the app bundle folder is not writable: `~/Library/Application Support/runner/config/`

Files created there:

- `defaults.json`
- `user-overrides.json`

Important Mac notes:

- the packaging flow builds the `.app` bundle in `/tmp` and then copies it into `release/mac/` to avoid macOS extended-attribute issues when signing directly inside synced folders
- the generated app is ad-hoc signed by the Deno packaging flow
- for smoother distribution to other Mac users, proper Apple signing and notarization is still recommended
