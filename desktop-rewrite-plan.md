# Desktop Rewrite Plan

## Goal

Move the packaged end-user experience away from terminal windows and browser tabs into a single Deno-powered desktop app window, while keeping the existing FE, BE, and MQTT runtime orchestration.

## Target UX

- Launching the packaged app starts the local runtime automatically.
- The main app window opens focused on the Simulator experience.
- The Simulator is shown inside the app window instead of a browser tab.
- Config opens in the same main window when triggered from the tray menu.
- A tray icon remains available for quick actions:
  - `Open Simulator`
  - `Open config`
  - `Quit`
- `Quit` stops child processes cleanly and exits the desktop app.

## Technical Direction

### 1. Keep Deno

Use `deno desktop` as the packaged shell instead of the older `deno compile` terminal launcher flow.

### 2. Keep the Existing Runtime

Retain the current Node-based orchestration for:

- injected frontend package
- backend stub
- MQTT broker
- config persistence

This avoids rewriting the service layer while changing the shell experience.

### 3. Introduce a Desktop Shell Layer

The Deno desktop entrypoint should:

- extract the packaged payload
- start the Node orchestrator in background mode
- wait for the runner service to become reachable
- adopt the initial `Deno.BrowserWindow`
- navigate that window to desktop-specific UI routes
- create a native tray with open/config/quit actions
- stop the runtime and exit cleanly on app quit

### 4. Add Desktop-Specific UI Routes

Extend the React runner UI with desktop-focused routes:

- `/desktop/simulator`
- `/desktop/config`

The Simulator route should embed the frontend package in the app window. The Config route should reuse the current config editor but within the desktop navigation shell.

### 5. Preserve Local Developer Flow

`npm run runner` should remain usable during development. The desktop packaging flow should be additive, not a replacement for the browser-based dev workflow.

## Implementation Steps

1. Add this plan to the repo.
2. Refactor the Deno launcher into a Deno desktop entrypoint.
3. Add tray management and graceful shutdown.
4. Update the React app to support desktop routes and embedded Simulator mode.
5. Disable packaged browser auto-open when desktop mode is active.
6. Update packaging scripts and documentation.
7. Verify build, type-check, and packaged startup behavior.

## Risks

- `deno desktop` is newer than the existing packaging flow, so API compatibility and packaging output need validation.
- The frontend will be embedded from its own local HTTP server, so cross-origin iframe constraints need to be respected.
- Runtime shutdown must remain explicit because background child processes can keep the desktop app alive.
