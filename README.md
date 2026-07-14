# Local MQTT App Runner MVP

This repository contains an MVP for a frontend-led local package:

- a React app served locally
- a bundled MQTT broker with WebSocket support
- a backend stub that publishes a test message
- a launcher that starts everything and presents the experience as a desktop app
- a Config page backed by local JSON files for defaults and user overrides
- a Deno-packaged launcher that embeds Node for single-file Windows and Mac distribution

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
- serve the frontend on `http://127.0.0.1:4173`
- open the runner in the browser automatically for local development

## What the UI shows

- `Hello World`
- frontend loaded state
- MQTT connection status
- backend message status
- latest message published on topic `mvp/test`

## Configuration

- Shipped defaults live in [config/defaults.json](/Users/sqee/Documents/local-mqtt-app-runner/config/defaults.json)
- Machine-specific overrides live in [config/user-overrides.json](/Users/sqee/Documents/local-mqtt-app-runner/config/user-overrides.json)
- Use the `Config` button in the top-right corner to edit ports, interfaces, and process paths
- Saved overrides are applied the next time the runner starts

## Packaged App Behavior

- Launching the packaged app normally starts the runner service in the background, starts MQTT/BE/FE automatically, and opens the Simulator inside the desktop app window.
- The same main app window can switch between `Simulator` and `Config`.
- Launch the same packaged app with `--runner` to open directly into the Config view.
- A tray icon stays available with quick actions for `Open Simulator`, `Open config`, and `Quit`.
- `Quit` closes the desktop shell and stops the managed runtime started by that app instance.

## Windows single-binary packaging

Build the single Windows executable with:

```bash
npm run package:windows
```

The build downloads the official Windows x64 Node.js runtime locally on demand into `vendor/windows-node-x64/` if it is missing.

This produces:

- [release/PackageRunner.exe](/Users/sqee/Documents/local-mqtt-app-runner/release/PackageRunner.exe)

What is embedded inside that one file:

- the Node runtime from [vendor/windows-node-x64/node.exe](/Users/sqee/Documents/local-mqtt-app-runner/vendor/windows-node-x64/node.exe)
- the built runner UI from `dist/`
- the injected `fe`, `be`, and `mqtt` packages
- the runner scripts and runtime dependencies

At runtime, the executable extracts its embedded payload automatically and starts the runner through the bundled `node.exe`. User-writable config is kept outside that extracted payload in a stable data folder so updates do not wipe overrides.

User config location:

- preferred portable location: `<folder containing PackageRunner.exe>/PackageRunner-data/config/`
- fallback location when the executable folder is not writable: `%LOCALAPPDATA%/PackageRunner/config/`

Files created there:

- `defaults.json`
- `user-overrides.json`

There is also an optional hidden-console build:

```bash
npm run package:windows:gui
```

This produces `release/PackageRunner-gui.exe`. It hides the terminal window, but because the runner is still browser-based, the visible-console build is the safer default until the product adds an explicit in-app Quit action.

## Mac Apple Silicon single-binary packaging

Build the Apple Silicon Mac executable with:

```bash
npm run package:mac:arm
```

The build downloads the official macOS ARM64 Node.js runtime locally on demand into `vendor/macos-arm64-node/` if it is missing.

The Mac packaging flow also builds a small native menu-bar helper, so Xcode Command Line Tools must be available on the developer machine.

This produces:

- [release/PackageRunner-macos-arm64.app](/Users/sqee/Documents/local-mqtt-app-runner/release/PackageRunner-macos-arm64.app)

What is embedded inside that one file:

- the Node runtime from [vendor/macos-arm64-node/README.md](/Users/sqee/Documents/local-mqtt-app-runner/vendor/macos-arm64-node/README.md)
- the built runner UI from `dist/`
- the injected `fe`, `be`, and `mqtt` packages
- the runner scripts and runtime dependencies

At runtime, the desktop app extracts its embedded payload automatically, starts the runner through the bundled Mac Node runtime, and loads the Simulator inside the app window. User-writable config is kept outside that extracted payload in a stable data folder so updates do not wipe overrides.

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
