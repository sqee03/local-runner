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
- Deno 2.9+ for Windows and Mac packaging

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

## What the UI shows

- `Hello World`
- frontend loaded state
- MQTT connection status
- backend message status
- latest message published on topic `mvp/test`

## Configuration

- Shipped defaults live in [config/defaults.json](/Users/sqee/Documents/local-mqtt-app-runner/config/defaults.json)
- Machine-specific overrides live in [config/user-overrides.json](/Users/sqee/Documents/local-mqtt-app-runner/config/user-overrides.json)
- In the packaged desktop app, open `Config` from the tray menu
- In browser-based local development, use the `Config` button in the top-right corner
- The settings cover:
  - local host/interface binding
  - the internal control-service port
  - FE, BE, and MQTT service ports
  - FE, BE, and MQTT executable/entry/working-directory paths
  - the MQTT demo topic
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

Build the Windows package with:

```bash
npm run package:windows
```

The build downloads the official Windows x64 Node.js runtime locally on demand into `vendor/windows-node-x64/` if it is missing.

This produces the Windows desktop app executable:

- [release/PackageRunner.exe](/Users/sqee/Documents/local-mqtt-app-runner/release/PackageRunner.exe)

What is embedded inside that one file:

- the Node runtime from [vendor/windows-node-x64/node.exe](/Users/sqee/Documents/local-mqtt-app-runner/vendor/windows-node-x64/node.exe)
- the built runner UI from `dist/`
- the injected `fe`, `be`, and `mqtt` packages
- the runner scripts and runtime dependencies

At runtime, the executable extracts its embedded payload automatically and starts the bundled services through the bundled `node.exe`. User-writable config is kept outside that extracted payload in a stable data folder so updates do not wipe overrides.

User config location:

- preferred portable location: `<folder containing PackageRunner.exe>/PackageRunner-data/config/`
- fallback location when the executable folder is not writable: `%LOCALAPPDATA%/PackageRunner/config/`

Files created there:

- `defaults.json`
- `user-overrides.json`

`npm run package:windows:gui` currently resolves to the same packaging flow as `npm run package:windows`.

## Mac Apple Silicon Packaging

Build the Apple Silicon Mac app with:

```bash
npm run package:mac:arm
```

The build downloads the official macOS ARM64 Node.js runtime locally on demand into `vendor/macos-arm64-node/` if it is missing.

This produces:

- [release/PackageRunner-macos-arm64.app](/Users/sqee/Documents/local-mqtt-app-runner/release/PackageRunner-macos-arm64.app)

What is embedded inside that one file:

- the Node runtime from [vendor/macos-arm64-node/README.md](/Users/sqee/Documents/local-mqtt-app-runner/vendor/macos-arm64-node/README.md)
- the built runner UI from `dist/`
- the injected `fe`, `be`, and `mqtt` packages
- the runner scripts and runtime dependencies

At runtime, the desktop app extracts its embedded payload automatically, starts the bundled services through the bundled Mac Node runtime, and loads the FE app inside the desktop window. User-writable config is kept outside that extracted payload in a stable data folder so updates do not wipe overrides.

User config location:

- preferred portable location: `<folder containing PackageRunner-macos-arm64>/PackageRunner-data/config/`
- fallback location when the executable folder is not writable: `~/Library/Application Support/PackageRunner/config/`

Files created there:

- `defaults.json`
- `user-overrides.json`

Bundled runtime behavior:

- runtime binaries are not meant to be committed to git
- each packaging command vendors the required official Node runtime locally into `vendor/` before building
- if the runtime already exists locally, it is reused

Important Mac notes:

- the packaging flow builds the `.app` bundle in `/tmp` and then copies it into `release/` to avoid macOS extended-attribute issues when signing directly inside iCloud/Documents-backed folders
- the generated app is ad-hoc signed by the Deno packaging flow
- for smoother distribution to other Mac users, proper Apple signing and notarization is still recommended
