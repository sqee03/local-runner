# Standalone Windows Package Runner

## Summary
Turn the current runner into a self-contained Windows bundle that ships:

- the runner UI build
- the injected `fe`, `be`, and `mqtt` packages
- an embedded Node runtime
- one launcher executable that starts the runner with no prior Node/npm install

Recommended v1 shape:

- browser-based UX stays as-is
- package as a portable folder first, with an optional installer later
- runner remains the orchestrator; injected packages remain separate sub-packages inside the bundle

## Key Changes

### Packaging model
- Build the React runner UI into static assets as today.
- Bundle the whole app into a distributable folder such as:
  - `PackageRunner/PackageRunner.exe`
  - `PackageRunner/runtime/node/`
  - `PackageRunner/app/dist/`
  - `PackageRunner/app/injections/fe`
  - `PackageRunner/app/injections/be`
  - `PackageRunner/app/injections/mqtt`
  - `PackageRunner/app/config/defaults.json`
  - `PackageRunner/app/config/user-overrides.json`
- Do not depend on system Node, npm, or globally installed tooling on the target machine.

### Launcher
- Add a thin Windows launcher executable whose only job is to start embedded Node against the runner entry script.
- The launcher should:
  - resolve paths relative to its own folder
  - start the runner server
  - optionally open the runner URL in the default browser
  - exit cleanly when the runner process exits
- Keep config and package-relative paths rooted to the bundle directory, not the original repo structure.

### Runtime path/config hardening
- Replace repo-relative assumptions with bundle-relative path resolution.
- Keep `defaults.json` inside the app package as the shipped baseline.
- Keep `user-overrides.json` writable beside the defaults or in a dedicated writable subfolder inside the portable bundle.
- Ensure the config schema explicitly covers:
  - runner UI port
  - FE package port
  - MQTT TCP/WebSocket ports
  - executable paths and working directories for FE/BE/MQTT
  - `autoStart`
  - `autoOpenFrontend`
- For the packaged app, default executable paths should target the bundled sub-packages, not development paths.

### Windows-specific behavior
- Make the launcher and runner paths safe for machines where the app is extracted under arbitrary directories.
- Treat browser auto-open as:
  - reliable on explicit `Start`
  - best-effort on `autoStart`
- Accept that full automatic FE tab opening on app launch is still browser-policy-dependent unless the product later moves to a desktop shell.

### Build/release pipeline
- Add a release script that produces one Windows artifact from a clean repo:
  1. build runner UI
  2. copy injected packages and config into a staging folder
  3. copy a Windows Node runtime into the staging folder
  4. generate the launcher
  5. zip the result and optionally create an installer
- Keep portable-folder output as the primary artifact for v1; installer can be a second artifact later without changing the runtime architecture.

## Public Interfaces / Behavior
- User launches `PackageRunner.exe`
- Runner UI opens at local host/port from config
- `Start` launches FE, BE, and MQTT bundled packages
- FE opens in the browser on its configured port when allowed by runtime settings/browser policy
- `Stop` shuts down all package processes and closes the FE window when it was opened by the runner session
- Config remains JSON-based and user-editable without rebuilding the app

## Test Plan
- Fresh Windows machine with no Node/npm installed: portable bundle launches successfully.
- Runner starts from an extracted folder with spaces in the path.
- `Start` launches FE/BE/MQTT using bundled runtimes only.
- `Stop` terminates all child processes and leaves no listening ports behind.
- Config overrides persist across relaunches and still resolve bundled package paths correctly.
- `autoStart=false` keeps the app idle until user clicks `Start`.
- `autoStart=true` starts runtime automatically on launch.
- `autoOpenFrontend=true` opens FE on manual `Start`; on launch it is treated as best-effort and degrades to URL/copy flow if blocked.
- FE, BE, and MQTT all work offline on a machine with no internet access.

## Assumptions
- v1 should stay browser-based, not move to Electron/Tauri yet.
- “Portable app” means no required installer for the first release.
- Bundling an embedded Node runtime is acceptable and preferred over compiling every package into native binaries.
- FE/BE/MQTT should remain separate injected packages internally, even though they ship together in one distributable app.
