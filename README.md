# Local MQTT App Runner MVP

This repository contains an MVP for a frontend-led local package:

- a React app served locally
- a bundled MQTT broker with WebSocket support
- a backend stub that publishes a test message
- a launcher that starts everything and opens the browser
- a Config page backed by local JSON files for defaults and user overrides

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

## Windows portable packaging

Build a portable Windows bundle with:

```bash
npm run package:windows
```

Expected Windows Node runtime location:

- default: [vendor/windows-node-x64](/Users/sqee/Documents/local-mqtt-app-runner/vendor/windows-node-x64)
- override with env var: `WINDOWS_NODE_RUNTIME_DIR=/path/to/windows-node-runtime`

The packaging script expects that folder to contain `node.exe`.

Output:

- staged bundle folder: [release/windows-x64](/Users/sqee/Documents/local-mqtt-app-runner/release/windows-x64)
- launcher: `PackageRunner.cmd`
- zipped artifact: `release/windows-x64.zip` when the local `zip` command is available
