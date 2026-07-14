# Local MQTT App Runner MVP

This repository contains an MVP for a frontend-led local package:

- a React app served locally
- a bundled MQTT broker with WebSocket support
- a backend stub that publishes a test message
- a launcher that starts everything and opens the browser
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
- open the browser automatically

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

This produces:

- [release/PackageRunner-macos-arm64](/Users/sqee/Documents/local-mqtt-app-runner/release/PackageRunner-macos-arm64)

What is embedded inside that one file:

- the Node runtime from [vendor/macos-arm64-node/README.md](/Users/sqee/Documents/local-mqtt-app-runner/vendor/macos-arm64-node/README.md)
- the built runner UI from `dist/`
- the injected `fe`, `be`, and `mqtt` packages
- the runner scripts and runtime dependencies

At runtime, the executable extracts its embedded payload automatically and starts the runner through the bundled Mac Node runtime. User-writable config is kept outside that extracted payload in a stable data folder so updates do not wipe overrides.

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

Important Mac note:

- `deno compile` adds an ad-hoc signature by default
- for smoother distribution to other Mac users, proper Apple signing and notarization is still recommended
