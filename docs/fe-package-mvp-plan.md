# MVP Requirements for the FE-Led Local Package

## Summary
Define the MVP as a frontend-owned local package whose only goal is proving the end-to-end runtime model on Windows:

- one FE launcher/package the user starts
- local static server hosts a minimal React app
- bundled MQTT sub-package is started locally
- backend process is started locally
- browser opens automatically
- FE confirms it can connect to MQTT and display basic status

For MVP, keep behavior intentionally narrow. The purpose is to validate packaging, startup orchestration, and local connectivity, not product logic.

## MVP Scope

### Included
- React app with a single Hello World page
- FE package serves the app locally
- FE package starts bundled MQTT package
- FE package starts backend process
- FE opens in the browser automatically
- FE attempts MQTT connection over localhost WebSockets
- FE displays connection state for:
  - FE server running
  - MQTT reachable
  - mock BE running

### Excluded
- Real backend integration
- Real schema/data processing
- Production UI/UX
- Authentication/security beyond localhost-only binding
- Installer polish beyond a runnable Windows package
- Cross-platform packaging in MVP

## Key Changes

### FE package
- Build a small Windows-launchable FE package that contains:
  - React production build
  - local static server
  - launcher/orchestrator
  - config for local ports and process paths
- Launcher startup order:
  1. start FE static server
  2. start MQTT sub-package
  3. start backend process
  4. verify readiness
  5. open browser to local FE URL

### Web app behavior
- Render a simple Hello World page.
- Add a small status panel on the page with:
  - FE loaded
  - MQTT connecting / connected / failed
  - mock BE expected / detected
- On successful MQTT connection, optionally subscribe to one test topic and show the last received test message.

### MQTT sub-package
- Bundle MQTT as a separate sub-package inside the FE package.
- Expose a localhost WebSocket endpoint for the browser.
- Use one fixed test topic for MVP, for example `mvp/test`.
- Keep config minimal and hardcoded where possible to reduce moving parts.

### Mocked BE
- Replace the real backend with a tiny mock process.
- Mock process only needs to prove startup and publish a simple test message to MQTT on an interval or once on startup.
- No schema support in MVP; payload can be a trivial JSON or plain string.

## Public Interfaces / Behavior
- FE URL: `http://127.0.0.1:<fe-port>/`
- MQTT URL: `ws://127.0.0.1:<mqtt-ws-port>/<path>`
- Test MQTT topic: one fixed topic for MVP
- Mock BE contract:
  - runnable locally by the FE launcher
  - publishes one known test message
  - exits cleanly when the launcher stops it, if process supervision is implemented in MVP

## Test Plan
- Launch FE package on a clean Windows machine and verify browser opens automatically.
- Confirm Hello World page loads from the local FE server.
- Confirm FE reports successful MQTT WebSocket connection.
- Confirm mock BE starts and publishes a test message.
- Confirm FE receives and displays the test message.
- Confirm meaningful error states if MQTT or mock BE fails to start.
- Confirm all listeners are localhost-only.

## Assumptions
- MVP target is Windows only.
- FE package remains the single user-facing entrypoint.
- MQTT stays bundled as a separate sub-package internally.
- Mocked BE is acceptable as a lightweight local publisher process rather than a real `.exe` from the backend team for MVP.
- Default MVP priority is proving startup/orchestration, not matching the final production packaging exactly.
