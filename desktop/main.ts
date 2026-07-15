import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type PayloadFile = {
  path: string;
  mode: number;
  base64: string;
};

type PayloadManifest = {
  version: number;
  target: string;
  hash: string;
  files: PayloadFile[];
};

type EffectiveConfig = {
  interfaces?: {
    host?: string;
  };
  ports?: {
    runner?: number;
    frontendPackage?: number;
    mqttTcp?: number;
    mqttWs?: number;
  };
};

type LaunchUrls = {
  host: string;
  runnerPort: number;
  frontendPort: number;
  runnerUrl: string;
  frontendAppUrl: string;
};

type PortOverrides = {
  runner: number;
  frontendPackage: number;
  mqttTcp: number;
  mqttWs: number;
};

type DesktopView = "simulator" | "config";

type BrowserWindowOptions = {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  resizable?: boolean;
  alwaysOnTop?: boolean;
  frameless?: boolean;
  noActivate?: boolean;
  transparentTitlebar?: boolean;
};

type DesktopMenuEntry =
  | "separator"
  | {
      item: {
        label: string;
        id: string;
        enabled: boolean;
        accelerator?: string;
      };
    };

type DesktopBrowserWindow = EventTarget & {
  close(): void;
  focus(): void;
  hide(): void;
  isClosed(): boolean;
  isVisible(): boolean;
  navigate(url: string): void;
  reload(): void;
  setTitle(title: string): void;
  show(): void;
  getSize(): [number, number];
  setSize(width: number, height: number): void;
  getPosition(): [number, number];
  setPosition(x: number, y: number): void;
  openDevtools(options?: { deno?: boolean; renderer?: boolean }): void;
  readonly windowId: number;
};

type DesktopTray = EventTarget & {
  destroy(): void;
  setIcon(bytes: Uint8Array): void;
  setIconDark(bytes: Uint8Array | null): void;
  setTooltip(value: string | null): void;
  setMenu(entries: DesktopMenuEntry[] | null): void;
};

type DesktopDeno = typeof Deno & {
  BrowserWindow?: new (options?: BrowserWindowOptions) => DesktopBrowserWindow;
  Tray?: new () => DesktopTray;
};

type LaunchContext = {
  runnerUrl: string;
  frontendAppUrl: string;
  child: Deno.ChildProcess | null;
  attachedToExistingRunner: boolean;
};

type RuntimeStatus = {
  isRunning?: boolean;
  isTransitioning?: boolean;
};

const desktopDeno = Deno as DesktopDeno;
const appName = "runner";
const launchMode = Deno.args.includes("--runner") ? "runner" : "app";
const executableDir = path.dirname(Deno.execPath());
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPayloadPath = path.join(moduleDir, "..", ".tmp", "payload-manifest.json");
const desktopWindowDefaults = {
  width: 1440,
  height: 920
};
let activeDesktopWindow: DesktopBrowserWindow | null = null;
let activeDesktopTray: DesktopTray | null = null;

function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function canWriteToDirectory(directoryPath: string) {
  try {
    ensureDirectory(directoryPath);
    const probePath = path.join(directoryPath, ".write-test");
    fs.writeFileSync(probePath, "ok\n", "utf8");
    fs.rmSync(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function resolveUserDataDir() {
  const portableDir = path.join(executableDir, `${appName}-data`);
  if (canWriteToDirectory(portableDir)) {
    return portableDir;
  }

  const localAppData = Deno.env.get("LOCALAPPDATA");
  if (localAppData) {
    const fallbackDir = path.join(localAppData, appName);
    if (canWriteToDirectory(fallbackDir)) {
      return fallbackDir;
    }
  }

  const homeDir = Deno.env.get("HOME");
  if (Deno.build.os === "darwin" && homeDir) {
    const macAppSupportDir = path.join(homeDir, "Library", "Application Support", appName);
    if (canWriteToDirectory(macAppSupportDir)) {
      return macAppSupportDir;
    }
  }

  return path.join(Deno.cwd(), `${appName}-data`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) {
    return override ?? base;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in base ? deepMerge((base as Record<string, unknown>)[key], value) : value;
  }

  return merged;
}

function readJsonFile(filePath: string, fallbackValue: unknown) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function loadPayloadManifest(): PayloadManifest {
  if (!fs.existsSync(bundledPayloadPath)) {
    throw new Error(`Bundled payload manifest is missing at ${bundledPayloadPath}`);
  }

  return JSON.parse(fs.readFileSync(bundledPayloadPath, "utf8"));
}

function extractPayload(payloadRoot: string, payload: PayloadManifest) {
  const markerPath = path.join(payloadRoot, ".payload-hash");
  const currentMarker = fs.existsSync(markerPath)
    ? fs.readFileSync(markerPath, "utf8").trim()
    : null;

  if (currentMarker === payload.hash) {
    return;
  }

  fs.rmSync(payloadRoot, { recursive: true, force: true });
  ensureDirectory(payloadRoot);

  for (const file of payload.files) {
    const outputPath = path.join(payloadRoot, ...file.path.split("/"));
    ensureDirectory(path.dirname(outputPath));
    fs.writeFileSync(outputPath, Buffer.from(file.base64, "base64"));

    if (Deno.build.os !== "windows") {
      fs.chmodSync(outputPath, file.mode);
    }
  }

  fs.writeFileSync(markerPath, `${payload.hash}\n`, "utf8");
}

function resolveNodeRuntimePath(projectRoot: string) {
  if (Deno.build.os === "windows") {
    return path.join(projectRoot, "vendor", "windows-node-x64", "node.exe");
  }

  if (Deno.build.os === "darwin") {
    return path.join(projectRoot, "vendor", "macos-arm64-node", "bin", "node");
  }

  throw new Error(`Unsupported packaged runtime platform: ${Deno.build.os}`);
}

function ensurePersistentConfig(projectRoot: string, userDataDir: string) {
  const bundledConfigDir = path.join(projectRoot, "config");
  const configDir = path.join(userDataDir, "config");
  const bundledDefaultsPath = path.join(bundledConfigDir, "defaults.json");
  const persistentDefaultsPath = path.join(configDir, "defaults.json");
  const overridesPath = path.join(configDir, "user-overrides.json");

  ensureDirectory(configDir);

  if (!fs.existsSync(bundledDefaultsPath)) {
    throw new Error(`Bundled defaults.json is missing at ${bundledDefaultsPath}`);
  }

  const bundledDefaults = fs.readFileSync(bundledDefaultsPath, "utf8");
  const persistentDefaults = fs.existsSync(persistentDefaultsPath)
    ? fs.readFileSync(persistentDefaultsPath, "utf8")
    : null;

  if (persistentDefaults !== bundledDefaults) {
    fs.writeFileSync(persistentDefaultsPath, bundledDefaults, "utf8");
  }

  if (!fs.existsSync(overridesPath)) {
    fs.writeFileSync(overridesPath, "{}\n", "utf8");
  }

  return {
    bundledConfigDir,
    userConfigDir: configDir,
    defaultsPath: persistentDefaultsPath,
    overridesPath
  };
}

function loadEffectiveConfig(configPaths: { defaultsPath: string; overridesPath: string }) {
  const defaults = readJsonFile(configPaths.defaultsPath, {}) as EffectiveConfig;
  const overrides = readJsonFile(configPaths.overridesPath, {}) as EffectiveConfig;
  return deepMerge(defaults, overrides) as EffectiveConfig;
}

function resolveUrls(config: EffectiveConfig, runnerPortOverride?: number): LaunchUrls {
  const host = config.interfaces?.host ?? "127.0.0.1";
  const runnerPort = runnerPortOverride ?? config.ports?.runner ?? 4173;
  const frontendPort = config.ports?.frontendPackage ?? 4300;

  return {
    host,
    runnerPort,
    frontendPort,
    runnerUrl: `http://${host}:${runnerPort}`,
    frontendAppUrl: `http://${host}:${frontendPort}`
  };
}

async function canReachUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForUrl(url: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await canReachUrl(url)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.json();
}

function canBindPort(host: string, port: number) {
  try {
    const listener = Deno.listen({
      hostname: host,
      port,
      transport: "tcp"
    });
    listener.close();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      return false;
    }

    throw error;
  }
}

function findAvailableRunnerPort(host: string, preferredPort: number) {
  if (canBindPort(host, preferredPort)) {
    return preferredPort;
  }

  for (let candidate = preferredPort + 1; candidate < preferredPort + 25; candidate += 1) {
    if (canBindPort(host, candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Runner port ${preferredPort} is unavailable and no fallback port was found nearby.`
  );
}

function resolvePortOverrides(config: EffectiveConfig): PortOverrides {
  const host = config.interfaces?.host ?? "127.0.0.1";
  const runner = config.ports?.runner ?? 4173;
  const frontendPackage = config.ports?.frontendPackage ?? 4300;
  const mqttTcp = config.ports?.mqttTcp ?? 18883;
  const mqttWs = config.ports?.mqttWs ?? 19001;

  return {
    runner: findAvailableRunnerPort(host, runner),
    frontendPackage: findAvailableRunnerPort(host, frontendPackage),
    mqttTcp: findAvailableRunnerPort(host, mqttTcp),
    mqttWs: findAvailableRunnerPort(host, mqttWs)
  };
}

function openBrowser(url: string) {
  if (Deno.build.os === "windows") {
    new Deno.Command("cmd", {
      args: ["/c", "start", "", url],
      stdout: "null",
      stderr: "null"
    }).spawn();
    return;
  }

  if (Deno.build.os === "darwin") {
    new Deno.Command("open", {
      args: [url],
      stdout: "null",
      stderr: "null"
    }).spawn();
    return;
  }

  new Deno.Command("xdg-open", {
    args: [url],
    stdout: "null",
    stderr: "null"
  }).spawn();
}

function supportsDesktopShell() {
  return (
    typeof desktopDeno.BrowserWindow === "function" &&
    typeof desktopDeno.Tray === "function"
  );
}

function createBootstrapServer() {
  return Deno.serve(() =>
    new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${appName}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(circle at top, rgba(255, 206, 117, 0.32), transparent 30%),
          linear-gradient(160deg, #08121b 0%, #112538 52%, #0d1d2b 100%);
        color: #f5f4ef;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      .card {
        width: min(560px, calc(100vw - 48px));
        padding: 32px;
        border-radius: 28px;
        background: rgba(6, 12, 18, 0.74);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      }
      .eyebrow {
        margin: 0 0 10px;
        color: #f4b164;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        font-size: 0.78rem;
      }
      h1 {
        margin: 0;
        font-size: clamp(2rem, 6vw, 3.6rem);
      }
      p {
        margin: 16px 0 0;
        color: #d6dee6;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <section class="card">
      <p class="eyebrow">Desktop launch</p>
      <h1>Preparing runner</h1>
      <p>Starting the local runtime and loading the app window.</p>
    </section>
  </body>
</html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      }
    )
  );
}

function resolveDesktopUrl(runnerUrl: string, view: DesktopView) {
  return `${runnerUrl}${view === "config" ? "/desktop/config" : "/desktop/simulator"}`;
}

function resolveWindowTitle(view: DesktopView) {
  return view === "config" ? `${appName} - Config` : `${appName} - Simulator`;
}

function createMainWindow() {
  if (!desktopDeno.BrowserWindow) {
    return null;
  }

  activeDesktopWindow = new desktopDeno.BrowserWindow({
    title: resolveWindowTitle(launchMode === "runner" ? "config" : "simulator"),
    width: desktopWindowDefaults.width,
    height: desktopWindowDefaults.height
  });

  return activeDesktopWindow;
}

function createTrayIconPaths(projectRoot: string) {
  const assetsDir = path.join(projectRoot, "desktop", "assets");
  return {
    light: path.join(assetsDir, "tray-icon.png"),
    dark: path.join(assetsDir, "tray-icon-dark.png")
  };
}

async function ensureRuntimeStarted(runnerUrl: string) {
  if (launchMode !== "app") {
    return;
  }

  const runtimeState = await fetchJson(`${runnerUrl}/api/runtime`) as {
    isRunning?: boolean;
  };

  if (!runtimeState.isRunning) {
    await fetchJson(`${runnerUrl}/api/runtime/start`, {
      method: "POST"
    });
  }
}

async function readRuntimeStatus(runnerUrl: string): Promise<RuntimeStatus> {
  try {
    return await fetchJson(`${runnerUrl}/api/runtime`) as RuntimeStatus;
  } catch {
    return {
      isRunning: false,
      isTransitioning: false
    };
  }
}

async function launchOrAttachRunner(
  nodeExecutable: string,
  runnerEntry: string,
  projectRoot: string,
  configPaths: {
    bundledConfigDir: string;
    userConfigDir: string;
    defaultsPath: string;
    overridesPath: string;
  },
  effectiveConfig: EffectiveConfig,
  shellMode: "desktop" | "browser"
): Promise<LaunchContext> {
  const configuredUrls = resolveUrls(effectiveConfig);
  const existingRunnerIsReachable = await canReachUrl(`${configuredUrls.runnerUrl}/api/runtime`);

  if (existingRunnerIsReachable) {
    await ensureRuntimeStarted(configuredUrls.runnerUrl).catch(() => {});
    return {
      runnerUrl: configuredUrls.runnerUrl,
      frontendAppUrl: configuredUrls.frontendAppUrl,
      child: null,
      attachedToExistingRunner: true
    };
  }

  const portOverrides = resolvePortOverrides(effectiveConfig);
  const launchUrls = resolveUrls(effectiveConfig, portOverrides.runner);

  if (portOverrides.runner !== configuredUrls.runnerPort) {
    console.warn(
      `Runner port ${configuredUrls.runnerPort} is busy. Falling back to ${portOverrides.runner}.`
    );
  }

  const child = new Deno.Command(nodeExecutable, {
    args: [runnerEntry],
    cwd: projectRoot,
    env: {
      ...Deno.env.toObject(),
      PACKAGE_RUNNER_BUNDLED_CONFIG_DIR: configPaths.bundledConfigDir,
      PACKAGE_RUNNER_USER_CONFIG_DIR: configPaths.userConfigDir,
      PACKAGE_RUNNER_LAUNCH_MODE: launchMode,
      PACKAGE_RUNNER_SHELL_MODE: shellMode,
      PACKAGE_RUNNER_PORT_OVERRIDE: String(portOverrides.runner),
      PACKAGE_RUNNER_FRONTEND_PORT_OVERRIDE: String(portOverrides.frontendPackage),
      PACKAGE_RUNNER_MQTT_TCP_PORT_OVERRIDE: String(portOverrides.mqttTcp),
      PACKAGE_RUNNER_MQTT_WS_PORT_OVERRIDE: String(portOverrides.mqttWs)
    },
    stdin: shellMode === "desktop" ? "null" : "inherit",
    stdout: shellMode === "desktop" ? "null" : "inherit",
    stderr: shellMode === "desktop" ? "null" : "inherit"
  }).spawn();

  return {
    runnerUrl: launchUrls.runnerUrl,
    frontendAppUrl: launchUrls.frontendAppUrl,
    child,
    attachedToExistingRunner: false
  };
}

async function setupDesktopShell(
  projectRoot: string,
  launchContext: LaunchContext,
  shutdown: (code?: number) => Promise<void>
) {
  const win = createMainWindow();
  if (!win || !desktopDeno.Tray) {
    return;
  }

  let allowClose = false;
  let currentView: DesktopView = launchMode === "runner" ? "config" : "simulator";

  const showView = (view: DesktopView) => {
    currentView = view;
    win.setTitle(resolveWindowTitle(view));
    win.navigate(resolveDesktopUrl(launchContext.runnerUrl, view));
    win.show();
    win.focus();
  };

  win.addEventListener("close", (event) => {
    if (allowClose) {
      return;
    }

    event.preventDefault();
    win.hide();
  });

  const tray = new desktopDeno.Tray();
  activeDesktopTray = tray;
  const iconPaths = createTrayIconPaths(projectRoot);
  let trayRefreshTimer: ReturnType<typeof globalThis.setInterval> | null = null;

  if (fs.existsSync(iconPaths.light)) {
    tray.setIcon(await Deno.readFile(iconPaths.light));
  }

  if (fs.existsSync(iconPaths.dark)) {
    tray.setIconDark(await Deno.readFile(iconPaths.dark));
  }

  tray.setTooltip(appName);

  const updateTrayMenu = async () => {
    const runtimeStatus = await readRuntimeStatus(launchContext.runnerUrl);
    const servicesLabel = runtimeStatus.isRunning ? "Stop services" : "Start services";
    const servicesEnabled = !runtimeStatus.isTransitioning;

    tray.setMenu([
      { item: { label: "Open app", id: "simulator", enabled: true } },
      { item: { label: "Open config", id: "config", enabled: true } },
      "separator",
      { item: { label: servicesLabel, id: "toggle-services", enabled: servicesEnabled } },
      "separator",
      { item: { label: "Quit", id: "quit", enabled: true, accelerator: "CmdOrCtrl+Q" } }
    ]);
  };

  await updateTrayMenu();
  trayRefreshTimer = globalThis.setInterval(() => {
    updateTrayMenu().catch(() => {
      // Keep the last known menu if polling fails briefly.
    });
  }, 2000);

  tray.addEventListener("click", () => {
    win.show();
    win.focus();
  });

  tray.addEventListener("menuclick", (event) => {
    const menuEvent = event as CustomEvent<{ id?: string }>;

    switch (menuEvent.detail?.id) {
      case "simulator":
        showView("simulator");
        break;
      case "config":
        showView("config");
        break;
      case "toggle-services": {
        readRuntimeStatus(launchContext.runnerUrl)
          .then(async (runtimeStatus) => {
            const nextAction = runtimeStatus.isRunning ? "stop" : "start";
            await fetchJson(`${launchContext.runnerUrl}/api/runtime/${nextAction}`, {
              method: "POST"
            });
            await updateTrayMenu();
          })
          .catch((error) => {
            console.error(`Tray service toggle failed: ${error.message}`);
          });
        break;
      }
      case "quit":
        allowClose = true;
        if (trayRefreshTimer !== null) {
          clearInterval(trayRefreshTimer);
          trayRefreshTimer = null;
        }
        tray.destroy();
        activeDesktopTray = null;
        shutdown(0).catch(() => {
          Deno.exit(1);
        });
        break;
      default:
        break;
    }
  });

  await waitForUrl(`${launchContext.runnerUrl}/api/runtime`, 20000);
  showView(currentView);
}

async function main() {
  const payload = loadPayloadManifest();
  const userDataDir = resolveUserDataDir();
  const payloadRoot = path.join(userDataDir, "runtime", payload.hash);
  const shellMode: "desktop" | "browser" = supportsDesktopShell() ? "desktop" : "browser";

  extractPayload(payloadRoot, payload);

  const projectRoot = payloadRoot;
  const nodeExecutable = resolveNodeRuntimePath(projectRoot);
  const runnerEntry = path.join(projectRoot, "scripts", "mvp-orchestrator.js");
  const configPaths = ensurePersistentConfig(projectRoot, userDataDir);
  const effectiveConfig = loadEffectiveConfig(configPaths);

  if (!fs.existsSync(nodeExecutable)) {
    throw new Error(`Bundled Node runtime is missing at ${nodeExecutable}`);
  }

  if (!fs.existsSync(runnerEntry)) {
    throw new Error(`Runner entry is missing at ${runnerEntry}`);
  }

  const bootstrapServer = shellMode === "desktop" ? createBootstrapServer() : null;
  const launchContext = await launchOrAttachRunner(
    nodeExecutable,
    runnerEntry,
    projectRoot,
    configPaths,
    effectiveConfig,
    shellMode
  );

  let shuttingDown = false;

  const shutdown = async (code = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    if (launchContext.child) {
      try {
        launchContext.child.kill("SIGTERM");
      } catch {
        // Child may already be gone.
      }

      await launchContext.child.status.catch(() => null);
    }

    if (bootstrapServer) {
      await bootstrapServer.shutdown();
    }

    if (activeDesktopTray) {
      try {
        activeDesktopTray.destroy();
      } catch {
        // Ignore tray shutdown failures during app exit.
      }
      activeDesktopTray = null;
    }

    activeDesktopWindow = null;

    Deno.exit(code);
  };

  if (launchContext.child) {
    launchContext.child.status.then((status) => {
      if (!shuttingDown) {
        console.error(`runner runtime exited with code ${status.code}.`);
        shutdown(status.code).catch(() => {
          Deno.exit(status.code);
        });
      }
    });
  }

  if (shellMode === "desktop") {
    await setupDesktopShell(projectRoot, launchContext, shutdown);

    const forwardSignal = () => {
      shutdown(0).catch(() => {
        Deno.exit(1);
      });
    };

    Deno.addSignalListener("SIGINT", forwardSignal);
    Deno.addSignalListener("SIGTERM", forwardSignal);
    return;
  }

  const runtimeReady = await waitForUrl(`${launchContext.runnerUrl}/api/runtime`, 20000);
  if (!runtimeReady) {
    throw new Error(`Runner did not become ready at ${launchContext.runnerUrl}.`);
  }

  if (launchMode === "runner") {
    openBrowser(launchContext.runnerUrl);
  } else {
    await ensureRuntimeStarted(launchContext.runnerUrl).catch(() => {});
    await waitForUrl(launchContext.frontendAppUrl, 20000).catch(() => false);
    openBrowser(launchContext.frontendAppUrl);
  }

  if (!launchContext.child) {
    return;
  }

  const forwardSignal = () => {
    shutdown(0).catch(() => {
      Deno.exit(1);
    });
  };

  Deno.addSignalListener("SIGINT", forwardSignal);
  Deno.addSignalListener("SIGTERM", forwardSignal);
  const status = await launchContext.child.status;
  Deno.exit(status.code);
}

main().catch((error) => {
  console.error(error.message);
  Deno.exit(1);
});
