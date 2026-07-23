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
  executeJs(script: string): Promise<unknown>;
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

type AppVersionInfo = {
  version: string;
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
let logDirectoryPath: string | null = null;
let diagnosticLogPath: string | null = null;

function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeDiagnosticLog(message: string) {
  if (!diagnosticLogPath) {
    return;
  }

  try {
    fs.appendFileSync(diagnosticLogPath, `[${new Date().toISOString()}] ${message}
`, "utf8");
  } catch {
    // Ignore logging failures.
  }
}

function addExitSignalListeners(handler: () => void) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    try {
      Deno.addSignalListener(signal, handler);
    } catch {
      // Some desktop targets may not support every signal.
    }
  }
}

function terminateChildProcess(child: Deno.ChildProcess) {
  const signals: Array<"SIGTERM" | "SIGKILL"> = ["SIGTERM", "SIGKILL"];

  for (const signal of signals) {
    try {
      child.kill(signal);
      return;
    } catch {
      // Some targets, especially Windows, do not support every signal consistently.
    }
  }
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

function resolveWritableDirectory(candidateDirs: Array<string | null | undefined>) {
  for (const candidateDir of candidateDirs) {
    if (!candidateDir) {
      continue;
    }

    if (canWriteToDirectory(candidateDir)) {
      return candidateDir;
    }
  }

  return null;
}

function resolveUserDataDir() {
  const portableDir = path.join(executableDir, `${appName}-data`);
  const portableWritableDir = resolveWritableDirectory([portableDir]);
  if (portableWritableDir) {
    return portableWritableDir;
  }

  const localAppData = Deno.env.get("LOCALAPPDATA");
  const userProfile = Deno.env.get("USERPROFILE");
  const homeDir = Deno.env.get("HOME");
  const windowsFallbackDir = userProfile
    ? path.join(userProfile, "AppData", "Local", appName)
    : null;
  const genericHomeFallbackDir = homeDir ? path.join(homeDir, `.${appName}`) : null;

  const writableFallbackDir = resolveWritableDirectory([
    localAppData ? path.join(localAppData, appName) : null,
    windowsFallbackDir
  ]);
  if (writableFallbackDir) {
    return writableFallbackDir;
  }

  if (Deno.build.os === "darwin" && homeDir) {
    const macAppSupportDir = path.join(homeDir, "Library", "Application Support", appName);
    if (canWriteToDirectory(macAppSupportDir)) {
      return macAppSupportDir;
    }
  }

  const tempFallbackDir = resolveWritableDirectory([
    genericHomeFallbackDir,
    path.join(Deno.makeTempDirSync(), appName)
  ]);
  if (tempFallbackDir) {
    return tempFallbackDir;
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

function resolveNodeRuntimePath(projectRoot: string, shellMode: "desktop" | "browser") {
  if (Deno.build.os === "windows") {
    const hiddenRuntimePath = path.join(projectRoot, "vendor", "windows-node-x64", "nodew.exe");
    if (shellMode === "desktop" && fs.existsSync(hiddenRuntimePath)) {
      return hiddenRuntimePath;
    }

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

function openPath(targetPath: string, reveal = false) {
  try {
    if (Deno.build.os === "windows") {
      new Deno.Command("explorer", {
        args: reveal ? ["/select,", targetPath] : [targetPath],
        stdout: "null",
        stderr: "null"
      }).spawn();
      return;
    }

    if (Deno.build.os === "darwin") {
      new Deno.Command("open", {
        args: reveal ? ["-R", targetPath] : [targetPath],
        stdout: "null",
        stderr: "null"
      }).spawn();
      return;
    }

    new Deno.Command("xdg-open", {
      args: [reveal ? path.dirname(targetPath) : targetPath],
      stdout: "null",
      stderr: "null"
    }).spawn();
  } catch (error) {
    const message = `Path open failed for ${targetPath}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    writeDiagnosticLog(message);
  }
}

function openBrowser(url: string) {
  try {
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
  } catch (error) {
    const message = `Browser launch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    writeDiagnosticLog(message);
  }
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

function loadAppVersion(projectRoot: string) {
  const versionPath = path.join(projectRoot, "version.json");

  if (!fs.existsSync(versionPath)) {
    throw new Error(`App version file is missing at ${versionPath}`);
  }

  const versionInfo = JSON.parse(fs.readFileSync(versionPath, "utf8")) as AppVersionInfo;
  const version = versionInfo.version?.trim();

  if (!version) {
    throw new Error(`App version is missing in ${versionPath}`);
  }

  return version;
}

function resolveWindowTitle(view: DesktopView, appVersion: string) {
  const label = view === "config" ? "Config" : "Simulator";
  return `v${appVersion} - ${label}`;
}

async function centerWindowOnCurrentScreen(win: DesktopBrowserWindow) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const bounds = await win.executeJs(`(() => ({
        x: Number.isFinite(globalThis.screen?.availLeft) ? globalThis.screen.availLeft : 0,
        y: Number.isFinite(globalThis.screen?.availTop) ? globalThis.screen.availTop : 0,
        width: globalThis.screen?.availWidth,
        height: globalThis.screen?.availHeight
      }))()`);

      if (!bounds || typeof bounds !== "object") {
        throw new Error("Screen bounds are unavailable.");
      }

      const screenBounds = bounds as Record<string, unknown>;
      const screenX = Number(screenBounds.x);
      const screenY = Number(screenBounds.y);
      const screenWidth = Number(screenBounds.width);
      const screenHeight = Number(screenBounds.height);

      if (![screenX, screenY, screenWidth, screenHeight].every(Number.isFinite) ||
        screenWidth <= 0 || screenHeight <= 0) {
        throw new Error("Screen bounds are invalid.");
      }

      const [windowWidth, windowHeight] = win.getSize();
      const x = Math.round(screenX + Math.max(0, (screenWidth - windowWidth) / 2));
      const y = Math.round(screenY + Math.max(0, (screenHeight - windowHeight) / 2));
      win.setPosition(x, y);
      writeDiagnosticLog(`Centered desktop window at ${x},${y}.`);
      return;
    } catch {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }
  }

  writeDiagnosticLog("Could not center the desktop window because screen bounds were unavailable.");
}

function encodeWindowsWideString(value: string) {
  const encoded = new Uint16Array(value.length + 1);

  for (let index = 0; index < value.length; index += 1) {
    encoded[index] = value.charCodeAt(index);
  }

  return encoded;
}

async function applyWindowsWindowIcon(
  win: DesktopBrowserWindow,
  projectRoot: string,
  view: DesktopView,
  appVersion: string
) {
  if (Deno.build.os !== "windows") {
    return;
  }

  const iconPath = path.join(projectRoot, "desktop", "assets", "app-icon.ico");
  if (!fs.existsSync(iconPath)) {
    writeDiagnosticLog(`Window icon is missing at ${iconPath}.`);
    return;
  }

  const finalTitle = resolveWindowTitle(view, appVersion);
  const lookupTitle = `${finalTitle} [${Deno.pid}]`;
  win.setTitle(lookupTitle);

  const user32 = Deno.dlopen("user32.dll", {
    FindWindowW: {
      parameters: ["pointer", "pointer"],
      result: "pointer"
    },
    GetSystemMetrics: {
      parameters: ["i32"],
      result: "i32"
    },
    LoadImageW: {
      parameters: ["pointer", "pointer", "u32", "i32", "i32", "u32"],
      result: "pointer"
    },
    SendMessageW: {
      parameters: ["pointer", "u32", "usize", "pointer"],
      result: "isize"
    }
  } as const);

  try {
    const titleBytes = encodeWindowsWideString(lookupTitle);
    const titlePointer = Deno.UnsafePointer.of(titleBytes);
    let windowHandle: Deno.PointerValue = null;

    for (let attempt = 0; attempt < 20 && !windowHandle; attempt += 1) {
      windowHandle = user32.symbols.FindWindowW(null, titlePointer);
      if (!windowHandle) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 25));
      }
    }

    if (!windowHandle) {
      throw new Error("Could not resolve the native CEF window handle.");
    }

    const iconPathBytes = encodeWindowsWideString(iconPath);
    const iconPathPointer = Deno.UnsafePointer.of(iconPathBytes);
    const imageIcon = 1;
    const loadFromFile = 0x0010;
    const smallWidth = user32.symbols.GetSystemMetrics(49) || 16;
    const smallHeight = user32.symbols.GetSystemMetrics(50) || 16;
    const largeWidth = user32.symbols.GetSystemMetrics(11) || 32;
    const largeHeight = user32.symbols.GetSystemMetrics(12) || 32;
    const smallIcon = user32.symbols.LoadImageW(
      null,
      iconPathPointer,
      imageIcon,
      smallWidth,
      smallHeight,
      loadFromFile
    );
    const largeIcon = user32.symbols.LoadImageW(
      null,
      iconPathPointer,
      imageIcon,
      largeWidth,
      largeHeight,
      loadFromFile
    );

    if (!smallIcon || !largeIcon) {
      throw new Error("Windows could not load the application ICO.");
    }

    const setIconMessage = 0x0080;
    user32.symbols.SendMessageW(windowHandle, setIconMessage, 0n, smallIcon);
    user32.symbols.SendMessageW(windowHandle, setIconMessage, 1n, largeIcon);
    writeDiagnosticLog("Applied the application icon to the native Windows window.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeDiagnosticLog(`Failed to apply the native Windows window icon: ${message}`);
  } finally {
    win.setTitle(finalTitle);
    user32.close();
  }
}

function createMainWindow(appVersion: string) {
  if (!desktopDeno.BrowserWindow) {
    return null;
  }

  activeDesktopWindow = new desktopDeno.BrowserWindow({
    title: resolveWindowTitle(launchMode === "runner" ? "config" : "simulator", appVersion),
    width: desktopWindowDefaults.width,
    height: desktopWindowDefaults.height,
    transparentTitlebar: true
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
    const message =
      `Runner port ${configuredUrls.runnerPort} is busy. Falling back to ${portOverrides.runner}.`;
    console.warn(message);
    writeDiagnosticLog(message);
  }

  const child = new Deno.Command(nodeExecutable, {
    args: [runnerEntry],
    cwd: projectRoot,
    env: {
      ...Deno.env.toObject(),
      PACKAGE_RUNNER_BUNDLED_CONFIG_DIR: configPaths.bundledConfigDir,
      PACKAGE_RUNNER_USER_CONFIG_DIR: configPaths.userConfigDir,
      PACKAGE_RUNNER_LOG_DIR: logDirectoryPath ?? path.join(projectRoot, "logs"),
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
  shutdown: (code?: number) => Promise<void>,
  appVersion: string
) {
  const win = createMainWindow(appVersion);
  if (!win || !desktopDeno.Tray) {
    return;
  }

  let allowClose = false;
  let currentView: DesktopView = launchMode === "runner" ? "config" : "simulator";

  await applyWindowsWindowIcon(win, projectRoot, currentView, appVersion);

  const showView = (view: DesktopView) => {
    currentView = view;
    win.setTitle(resolveWindowTitle(view, appVersion));
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

  tray.setTooltip(`v${appVersion}`);

  const updateTrayMenu = async () => {
    const runtimeStatus = await readRuntimeStatus(launchContext.runnerUrl);
    const servicesLabel = runtimeStatus.isRunning ? "Stop services" : "Start services";
    const servicesEnabled = !runtimeStatus.isTransitioning;

    tray.setMenu([
      { item: { label: `Version v${appVersion}`, id: "version", enabled: false } },
      "separator",
      { item: { label: "Open app", id: "simulator", enabled: true } },
      { item: { label: "Open config", id: "config", enabled: true } },
      { item: { label: "Open logs", id: "logs", enabled: Boolean(logDirectoryPath) } },
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
      case "logs":
        if (logDirectoryPath) {
          openPath(logDirectoryPath);
        }
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
            const message = `Tray service toggle failed: ${error.message}`;
            console.error(message);
            writeDiagnosticLog(message);
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
  await centerWindowOnCurrentScreen(win);
}

async function main() {
  const payload = loadPayloadManifest();
  const userDataDir = resolveUserDataDir();
  logDirectoryPath = path.join(userDataDir, "logs");
  ensureDirectory(logDirectoryPath);
  diagnosticLogPath = path.join(logDirectoryPath, "launcher.log");
  writeDiagnosticLog("Desktop startup begin.");
  writeDiagnosticLog(`Logs directory: ${logDirectoryPath}.`);
  const payloadRoot = path.join(userDataDir, "runtime", payload.hash);
  const shellMode: "desktop" | "browser" = supportsDesktopShell() ? "desktop" : "browser";

  extractPayload(payloadRoot, payload);
  writeDiagnosticLog(`Payload extracted to ${payloadRoot}.`);

  const projectRoot = payloadRoot;
  const appVersion = loadAppVersion(projectRoot);
  const nodeExecutable = resolveNodeRuntimePath(projectRoot, shellMode);
  const runnerEntry = path.join(projectRoot, "scripts", "orchestrator.js");
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
  writeDiagnosticLog(`Runner launch context ready. attached=${launchContext.attachedToExistingRunner}`);

  let shuttingDown = false;

  const shutdown = async (code = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    writeDiagnosticLog(`Desktop shutdown begin (code=${code}).`);

    if (launchContext.child) {
      terminateChildProcess(launchContext.child);

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
        const message = `runner runtime exited with code ${status.code}.`;
        console.error(message);
        writeDiagnosticLog(message);
        shutdown(status.code).catch(() => {
          Deno.exit(status.code);
        });
      }
    });
  }

  if (shellMode === "desktop") {
    await setupDesktopShell(projectRoot, launchContext, shutdown, appVersion);
    writeDiagnosticLog("Desktop shell initialized.");

    const forwardSignal = () => {
      shutdown(0).catch(() => {
        Deno.exit(1);
      });
    };

    addExitSignalListeners(forwardSignal);
    await new Promise<void>(() => {});
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

  addExitSignalListeners(forwardSignal);
  const status = await launchContext.child.status;
  Deno.exit(status.code);
}

main().catch((error) => {
  console.error(error.message);
  writeDiagnosticLog(`Fatal startup error: ${error.message}`);
  Deno.exit(1);
});
