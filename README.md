# Local MQTT App Simulator

Local desktop simulator for a React frontend, a Node-based MQTT broker, and a
backend publisher. The packaged application embeds the runtime and opens the
frontend in a native Deno desktop window; a browser-based flow remains available
for local development.

## Requirements

- Node.js 26 or newer
- npm 11 or newer
- macOS is required to produce the Apple Silicon app

Packaging downloads target-specific Node and Deno binaries when they are not
already cached. The npm packaging commands do not require a global Deno
installation; a global Deno installation is required to invoke any `deno task`
command.

## Tech Stack

The simulator is a TypeScript-first local desktop/runtime wrapper:

| Area | Technology | Role |
| --- | --- | --- |
| Simulator UI | React 19, React DOM, Vite | Browser-based control UI for config and runtime state |
| Source language | TypeScript | Strictly typed UI, Node runtime scripts, injected services, and packaging scripts |
| Runtime orchestration | Node.js | Serves the simulator API/UI and starts/stops the injected local packages |
| Desktop shell | Deno Desktop | Native desktop window, tray menu, payload extraction, and packaged app launcher |
| Bundling | Vite, esbuild | Builds the React UI and bundles/minifies Node/injected runtime entries for packaging |
| Config storage | JSON files | Shipped defaults plus local user overrides |
| Icon/package utilities | `pe-library`, `resedit`, platform tools | Windows icon resource embedding, macOS icon/app/dmg finalization |

The repository uses npm workspaces. The root `package.json` owns the simulator,
desktop, build, and packaging stack. Each mocked injected app has its own
`package.json` under `injections/*`, so example-only runtime packages stay out
of the root simulator dependency list and are scoped to the mock that imports them.

## Mocked/demo pieces

The app currently ships a mocked injected runtime to prove the packaging and
orchestration flow. These pieces are examples, not final product integrations:

| Mock/demo part | Files | Package | Dependencies used for the mock |
| --- | --- | --- | --- |
| Local MQTT broker | `injections/mqtt/server.ts` | `injections/mqtt/package.json` | `aedes`, `websocket-stream` |
| Backend publisher | `injections/be/server.ts` | `injections/be/package.json` | `mqtt` |
| Injected frontend placeholder | `injections/fe/server.ts`, `injections/fe/app.ts`, `injections/fe/index.html` | `injections/fe/package.json` | no framework dependency; plain HTML/CSS/TS |

`aedes` is only there to provide an embedded MQTT broker for the local example.
`websocket-stream` exposes that broker over WebSocket for the demo frontend.
`mqtt` is used by the mocked backend publisher to send heartbeat/test messages.
Those packages are declared by the individual injected app packages, not the
root simulator package. `ws` is not a direct dependency of this repository; it is
currently pulled transitively by the mocked MQTT/WebSocket packages.

## Development

Install dependencies and start the complete local runtime:

```bash
npm install
npm run simulator
```

`npm run simulator` builds the React control UI, starts the MQTT broker and the
injected backend/frontend services, then opens the control UI in the default
browser.

The default local endpoints are:

| Service | Endpoint |
| --- | --- |
| Simulator UI | `http://127.0.0.1:4173` |
| Injected frontend | `http://127.0.0.1:4300` |
| MQTT TCP | `mqtt://127.0.0.1:18883` |
| MQTT WebSocket | `ws://127.0.0.1:19001` |

Use `npm run dev` when only the Vite UI is needed. `npm run build` creates the
web assets in `dist/`.

## Configuration

Shipped defaults live in `config/defaults.json`; development overrides live in
`config/user-overrides.json`. Overrides are merged over defaults and take effect
the next time the services start.

In a packaged app, configuration is managed from the tray menu or by launching
the app with `--config`. The launcher copies defaults into a writable data
directory and keeps user overrides there:

| Platform | Preferred location | Fallback location |
| --- | --- | --- |
| Windows | `<simulator.exe directory>/simulator-data/config/` | `%LOCALAPPDATA%/simulator/config/` |
| macOS | `<simulator.app>/Contents/MacOS/simulator-data/config/` | `~/Library/Application Support/simulator/config/` |

Runtime output is appended to separate files under the `logs/` folder in the
same `simulator-data` directory: `launcher.log`, `orchestrator.log`, `fe.log`,
`be.log`, and `mqtt.log`. The tray's **Open logs** action opens this folder.
Local development writes the same set (except `launcher.log`) under the project
`logs/` directory.

## Packaging

Build the Windows x64 app directory:

```bash
npm run package:windows:bundle
```

The launchable artifact is `release/windows/simulator/simulator.exe`. The package
includes the Node runtime, built UI, and minified service bundles. It does not
include the editable service sources or a loose `node_modules` tree, and does
not require Node or npm on the target machine.

Build the Deno-native Windows installer instead:

```bash
npm run package:windows:installer
```

The installer command leaves a single artifact at `release/windows/simulator.msi`;
its intermediate `release/windows/simulator/` bundle is removed after the MSI is
created. The MSI installs the app per-machine under `%ProgramFiles%` and
registers an uninstaller. The existing `npm run package:windows` command remains
an alias for the bundle-only flow.

Build the Apple Silicon macOS app:

```bash
npm run package:mac:arm:bundle
```

The artifact is `release/mac/simulator.app`. The build is ad-hoc signed by the Deno
packaging flow; external distribution still requires an Apple Developer signing
identity and notarization.

Build the Deno-native drag-to-Applications disk image instead:

```bash
npm run package:mac:arm:installer
```

The installer artifact is `release/mac/simulator.dmg`. Deno also leaves its source
bundle at `release/mac/simulator.app`, so both forms are available after this
command. The installer command must run on macOS because Deno uses the system
`hdiutil` tool. The existing `npm run package:mac:arm` command remains an alias
for the bundle-only flow.

The equivalent bundle and installer tasks can be run with Deno:

```bash
deno task package:windows:bundle
deno task package:windows:installer
deno task package:mac:arm:bundle
deno task package:mac:arm:installer
```

The `compile:*` Deno tasks are internal compile-only steps. They expect the
payload manifest and runtime caches prepared by the full packaging pipeline.

Packaging stores downloaded build tools and intermediate payloads under `.tmp/`.
Generated application artifacts are written under `release/`; both directories
are intentionally ignored by Git.

The packaging pipeline typechecks the TypeScript sources, then bundles and
minifies the simulator, frontend server, backend, MQTT broker, and injected browser
script with esbuild. Original source files remain unchanged in `scripts/` and
`injections/` for development. Bundling
reduces casual source exposure but should not be treated as encryption or as
protection against determined reverse engineering.

## Desktop Behavior

- Normal launch starts the local services and shows the frontend in the desktop
  window.
- `--config` opens the configuration view without automatically starting the
  service group.
- The tray menu can focus the app, open configuration, start or stop services,
  and quit.
- Quitting the app stops the child runtime owned by that launcher instance.
- If configured ports are occupied, the launcher chooses nearby free ports for
  the current session.

See [docs/architecture.md](docs/architecture.md) for the runtime and packaging
layout.

## Asset Maintenance

The shared tray/app symbol geometry lives in `scripts/icon-renderer.ts`.
Windows packaging generates a matching 512px app PNG and a multi-resolution
ICO, then embeds all ICO sizes directly into `simulator.exe`. macOS packaging uses
the generated app PNG to build its ICNS container. Tray assets are checked in
and can be regenerated with:

```bash
npm run build:node
node .tmp/node-runtime/scripts/build-tray-icons.js
```
