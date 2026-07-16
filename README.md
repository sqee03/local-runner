# Local MQTT App Runner

Local desktop runner for a React frontend, a Node-based MQTT broker, and a
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

## Development

Install dependencies and start the complete local runtime:

```bash
npm install
npm run runner
```

`npm run runner` builds the React control UI, starts the MQTT broker and the
injected backend/frontend services, then opens the control UI in the default
browser.

The default local endpoints are:

| Service | Endpoint |
| --- | --- |
| Runner UI | `http://127.0.0.1:4173` |
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
the app with `--runner`. The launcher copies defaults into a writable data
directory and keeps user overrides there:

| Platform | Preferred location | Fallback location |
| --- | --- | --- |
| Windows | `<runner.exe directory>/runner-data/config/` | `%LOCALAPPDATA%/runner/config/` |
| macOS | `<runner.app>/Contents/MacOS/runner-data/config/` | `~/Library/Application Support/runner/config/` |

The desktop launcher writes startup diagnostics to `desktop.log` in the same
`runner-data` directory.

## Packaging

Build the Windows x64 app directory:

```bash
npm run package:windows
```

The launchable artifact is `release/windows/runner/runner.exe`. The package
includes the Node runtime, built UI, injected services, runner scripts, and
runtime dependencies. It does not require Node or npm on the target machine.

Build the Apple Silicon macOS app:

```bash
npm run package:mac:arm
```

The artifact is `release/mac/runner.app`. The build is ad-hoc signed by the Deno
packaging flow; external distribution still requires an Apple Developer signing
identity and notarization.

The equivalent full packaging tasks can be run with Deno:

```bash
deno task package:windows
deno task package:mac:arm
```

The `compile:windows` and `compile:mac:arm` Deno tasks are internal compile-only
steps. They expect the payload manifest and runtime caches prepared by the full
packaging pipeline. `package:win` is the explicit CEF-backed Windows variant.

Packaging stores downloaded build tools and intermediate payloads under `.tmp/`.
Generated application artifacts are written under `release/`; both directories
are intentionally ignored by Git.

## Desktop Behavior

- Normal launch starts the local services and shows the frontend in the desktop
  window.
- `--runner` opens the configuration view without automatically starting the
  service group.
- The tray menu can focus the app, open configuration, start or stop services,
  and quit.
- Quitting the app stops the child runtime owned by that launcher instance.
- If configured ports are occupied, the launcher chooses nearby free ports for
  the current session.

See [docs/architecture.md](docs/architecture.md) for the runtime and packaging
layout.

## Asset Maintenance

The source app icon is `desktop/assets/app-icon.png`. Packaging regenerates the
platform icon container for its target. Tray assets are checked in and can be
regenerated with:

```bash
node scripts/build-tray-icons.js
```
