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

const appName = "PackageRunner";
const launchMode = Deno.args.includes("--runner") ? "runner" : "app";
const executableDir = path.dirname(Deno.execPath());
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPayloadPath = path.join(moduleDir, "..", "release", "payload-manifest.json");

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

async function readCurrentTTY() {
  try {
    const result = await new Deno.Command("tty", {
      stdout: "piped",
      stderr: "null"
    }).output();

    if (!result.success) {
      return null;
    }

    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return null;
  }
}

async function maybeLaunchTrayHelper(
  projectRoot: string,
  urls: { runnerUrl: string; frontendAppUrl: string }
) {
  if (launchMode !== "app" || Deno.build.os !== "darwin") {
    return;
  }

  const helperPath = path.join(projectRoot, "desktop", "bin", "PackageRunnerTrayHelper");
  if (!fs.existsSync(helperPath)) {
    console.warn(`Tray helper is missing at ${helperPath}. Continuing without menu bar icon.`);
    return;
  }

  const terminalProgram = Deno.env.get("TERM_PROGRAM");
  const terminalTTY = await readCurrentTTY();
  const shellPID = Deno.ppid;

  const args = [
    "--app-url",
    urls.frontendAppUrl,
    "--runner-url",
    urls.runnerUrl,
    "--launcher-pid",
    String(Deno.pid)
  ];

  if (shellPID > 1) {
    args.push("--shell-pid", String(shellPID));
  }

  if (terminalProgram) {
    args.push("--terminal-program", terminalProgram);
  }

  if (terminalTTY) {
    args.push("--terminal-tty", terminalTTY);
  }

  new Deno.Command(helperPath, {
    args,
    stdout: "null",
    stderr: "null"
  }).spawn();
}

async function main() {
  const payload = loadPayloadManifest();
  const userDataDir = resolveUserDataDir();
  const payloadRoot = path.join(userDataDir, "runtime", payload.hash);

  extractPayload(payloadRoot, payload);

  const projectRoot = payloadRoot;
  const nodeExecutable = resolveNodeRuntimePath(projectRoot);
  const runnerEntry = path.join(projectRoot, "scripts", "mvp-orchestrator.js");
  const configPaths = ensurePersistentConfig(projectRoot, userDataDir);
  const effectiveConfig = loadEffectiveConfig(configPaths);
  const configuredUrls = resolveUrls(effectiveConfig);

  if (!fs.existsSync(nodeExecutable)) {
    throw new Error(`Bundled Node runtime is missing at ${nodeExecutable}`);
  }

  if (!fs.existsSync(runnerEntry)) {
    throw new Error(`Runner entry is missing at ${runnerEntry}`);
  }

  const existingRunnerIsReachable = await canReachUrl(`${configuredUrls.runnerUrl}/api/runtime`);
  if (existingRunnerIsReachable) {
    if (launchMode === "runner") {
      openBrowser(configuredUrls.runnerUrl);
      return;
    }

    try {
      const runtimeState = await fetchJson(`${configuredUrls.runnerUrl}/api/runtime`) as {
        isRunning?: boolean;
      };

      if (!runtimeState.isRunning) {
        await fetchJson(`${configuredUrls.runnerUrl}/api/runtime/start`, {
          method: "POST"
        });
      }
    } catch {
      // If the API probe fails, fall back to opening the frontend URL anyway.
    }

    await waitForUrl(configuredUrls.frontendAppUrl).catch(() => false);
    openBrowser(configuredUrls.frontendAppUrl);
    return;
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
      PACKAGE_RUNNER_PORT_OVERRIDE: String(portOverrides.runner),
      PACKAGE_RUNNER_FRONTEND_PORT_OVERRIDE: String(portOverrides.frontendPackage),
      PACKAGE_RUNNER_MQTT_TCP_PORT_OVERRIDE: String(portOverrides.mqttTcp),
      PACKAGE_RUNNER_MQTT_WS_PORT_OVERRIDE: String(portOverrides.mqttWs)
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  }).spawn();

  await maybeLaunchTrayHelper(projectRoot, launchUrls);

  const forwardSignal = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore if the child already exited.
    }
  };

  Deno.addSignalListener("SIGINT", forwardSignal);
  Deno.addSignalListener("SIGTERM", forwardSignal);

  const status = await child.status;
  Deno.exit(status.code);
}

main().catch((error) => {
  console.error(error.message);
  Deno.exit(1);
});
