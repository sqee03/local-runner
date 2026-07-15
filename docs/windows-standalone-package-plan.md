# Standalone Windows Package Runner

## Summary
Turn the current runner into a self-contained Windows binary that ships:

- the runner UI build
- the injected `fe`, `be`, and `mqtt` packages
- an embedded Node runtime
- one launcher executable that starts the runner with no prior Node/npm install

Recommended v1 shape:

- browser-based UX stays as-is
- distribute one `.exe` file first, with an optional installer later
- runner remains the orchestrator; injected packages remain separate sub-packages inside the bundle

## Key Changes

### Packaging model
- Build the React runner UI into static assets as today.
- Use a Deno-compiled wrapper executable as the outer package.
- Embed the whole app payload into that executable:
  - bundled `node.exe`
  - runner `dist/`
  - `injections/fe`
  - `injections/be`
  - `injections/mqtt`
  - runner `scripts/`
  - runtime `node_modules/`
  - shipped `config/defaults.json`
- Do not depend on system Node, npm, or globally installed tooling on the target machine.
- Use Deno self-extraction so the embedded files become real files on disk at runtime.

### Launcher
- Add a thin Deno-based launcher executable whose only job is to start embedded Node against the runner entry script.
- The launcher should:
  - resolve embedded app paths from the extracted runtime directory
  - start the runner server
  - optionally open the runner URL in the default browser
  - exit cleanly when the runner process exits
- Keep config and package-relative paths rooted to extracted bundle paths, not the original repo structure.

### Runtime path/config hardening
- Replace repo-relative assumptions with extracted-bundle-relative path resolution.
- Keep `defaults.json` embedded inside the app package as the shipped baseline.
- Copy `defaults.json` into a stable writable data directory on launch so the file is visible to the user.
- Keep `user-overrides.json` writable in that stable data directory rather than inside the extracted hash folder.
- Ensure the config schema explicitly covers:
  - runner UI port
  - FE package port
  - MQTT TCP/WebSocket ports
  - executable paths and working directories for FE/BE/MQTT
  - `autoStart`
  - `autoOpenFrontend`
- For the packaged app, default executable paths should target the bundled sub-packages, not development paths.

### Windows-specific behavior
- Make the launcher and runner paths safe for machines where the executable is placed under arbitrary directories.
- Prefer a sibling `PackageRunner-data/` folder for user config; fall back to `%LOCALAPPDATA%` if the executable folder is not writable.
- Treat browser auto-open as:
  - reliable on explicit `Start`
  - best-effort on `autoStart`
- Accept that full automatic FE tab opening on app launch is still browser-policy-dependent unless the product later moves to a desktop shell.

### Build/release pipeline
- Add a release script that produces one Windows artifact from a clean repo:
  1. build runner UI
  2. compile a Deno launcher for `x86_64-pc-windows-msvc`
  3. embed injected packages, config, scripts, dependencies, and Windows `node.exe`
  4. output `PackageRunner.exe`
- Keep the single-file output as the primary artifact for v1; installer can be a second artifact later without changing the runtime architecture.

## Public Interfaces / Behavior
- User launches `PackageRunner.exe`
- Runner UI opens at local host/port from config
- `Start` launches FE, BE, and MQTT bundled packages
- FE opens in the browser on its configured port when allowed by runtime settings/browser policy
- `Stop` shuts down all package processes and closes the FE window when it was opened by the runner session
- Config remains JSON-based and user-editable without rebuilding the app

## Test Plan
- Fresh Windows machine with no Node/npm installed: single executable launches successfully.
- Runner starts from an executable path with spaces in the folder name.
- `Start` launches FE/BE/MQTT using bundled runtimes only.
- `Stop` terminates all child processes and leaves no listening ports behind.
- Config overrides persist across relaunches and across updated executable rebuilds.
- `autoStart=false` keeps the app idle until user clicks `Start`.
- `autoStart=true` starts runtime automatically on launch.
- `autoOpenFrontend=true` opens FE on manual `Start`; on launch it is treated as best-effort and degrades to URL/copy flow if blocked.
- FE, BE, and MQTT all work offline on a machine with no internet access.

## Assumptions
- v1 should stay browser-based, not move to Electron/Tauri yet.
- “Portable app” means one redistributable executable with no required installer for the first release.
- Bundling an embedded Node runtime is acceptable and preferred over compiling every package into native binaries.
- FE/BE/MQTT should remain separate injected packages internally, even though they ship together in one distributable app.
