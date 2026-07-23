# Architecture

## Runtime

The project has two shells around the same Node service orchestrator:

- `npm run runner` builds the TypeScript runtime into `.tmp/node-runtime/`,
  starts `.tmp/node-runtime/scripts/mvp-orchestrator.js`, and opens the runner
  UI in a browser.
- A packaged app starts `desktop/main.ts` as a Deno desktop shell. The shell
  extracts its embedded payload, starts the same orchestrator with the bundled
  Node runtime, and presents the runner routes in a native window.

The orchestrator owns four localhost-only components:

| Component | Source | Responsibility |
| --- | --- | --- |
| Runner | `scripts/mvp-orchestrator.ts` | Serves the control UI and runtime/config APIs |
| Frontend | `injections/fe/` | Serves the injected simulator frontend |
| Backend | `injections/be/` | Publishes test data to MQTT |
| MQTT | `injections/mqtt/` | Provides TCP and WebSocket MQTT endpoints |

The React application in `src/` supplies browser controls plus the packaged
desktop routes `/desktop/simulator` and `/desktop/config`.

## Packaged Startup

1. The Deno launcher reads the embedded `.tmp/payload-manifest.json`.
2. It extracts the payload to `runner-data/runtime/<payload-hash>/`, reusing an
   existing extraction when the hash matches.
3. It copies the shipped defaults to the persistent config directory and reads
   user overrides.
4. It starts the bundled Node runtime against the generated
   `scripts/mvp-orchestrator.js` payload bundle, or
   attaches to an already-running runner on the configured port.
5. It waits for the runner API, starts services for a normal app launch, and
   navigates the desktop window to the appropriate route.
6. The native tray and window share the same runner API for start, stop, and
   navigation actions.

Only the launcher-owned child process is terminated on quit. Attaching to an
existing runner does not transfer process ownership.

## Build Pipeline

The npm and full Deno packaging tasks run the same stages:

1. Typecheck the TypeScript UI and Node runtime sources, then build the Vite
   application.
2. Compile the Node runtime TypeScript sources into `.tmp/node-runtime/` and
   generate the target app icon.
3. Prepare the target release directory.
4. Cache the target Node and Deno build tools under `.tmp/build-tools/`.
5. Bundle and minify the Node entrypoints and injected browser assets into
   `.tmp/packaged-runtime/`.
6. Create the payload manifest containing generated bundles, static assets,
   configuration, and the target Node binary.
7. Run the target-specific `deno desktop` compile task for either a release
   bundle or native installer.
8. Normalize bundle output into `release/windows/runner/` or
   `release/mac/runner.app`. Installer builds additionally emit
   `release/windows/runner.msi` or `release/mac/runner.dmg`, then remove
   transient payload staging. The Windows installer flow also removes its
   intermediate `runner/` bundle so `runner.msi` is its only release artifact.

The Windows desktop launcher uses the GUI-subsystem `nodew.exe` for its child
orchestrator so no console window appears. The regular `node.exe` remains in the
payload for browser/debug execution. The macOS build is assembled in `/tmp`
before being copied to `release/mac/` to avoid extended-attribute issues in the
workspace.

Deno 2.9 copies the configured Windows ICO beside the launcher rather than
embedding it. The packaging pipeline therefore finalizes `runner.exe` with the
shared multi-resolution icon after bundle creation. Installer builds stage that
finalized launcher as Deno's local Windows backend before MSI assembly so the
installed executable carries the same icon resources.

Deno Desktop 2.9 does not expose a `BrowserWindow` icon option. On Windows the
desktop shell therefore loads the same ICO through `user32.dll` and sends both
the small title-bar and large taskbar icon to the native CEF window. This native
step is Windows-only and requires the FFI permission included in Windows builds.

## Repository Boundaries

- `desktop/` contains the Deno shell and checked-in image assets.
- `scripts/` contains TypeScript orchestration, configuration, and packaging code.
- `src/` contains the runner UI.
- `injections/` contains TypeScript services and static assets bundled into the payload.
- `config/` contains shipped defaults and development overrides.
- `.tmp/`, `dist/`, and `release/` are generated and ignored.

Target runtimes are not tracked under `vendor/`. During payload creation, files
from `.tmp/build-tools/` are mapped to the `vendor/` paths expected by the
packaged launcher.

Editable files under `scripts/` and `injections/` are development inputs only.
The packaged runtime keeps the same entrypoint paths for configuration
compatibility, but those files are minified bundles containing their required
dependencies. No loose runtime `node_modules/` directory is included.
