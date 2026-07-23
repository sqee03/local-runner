import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { type ChildProcess, spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable, Writable } from "node:stream";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { createConfigStore } from "./config-store.js";
import {
  type ClientConfigSnapshot,
  type ClientRuntimeState,
  type ConfigSnapshot,
  type JsonObject,
  type PackageDefinition,
  type PackageName,
  type PackageStatus,
  type RuntimeState,
  errorMessage,
  isJsonObject
} from "./node-types.js";
import {
  applyRuntimePortOverrides as applyRuntimePortOverridesWithOptions,
  buildPackageRuntimeConfig as buildPackageRuntimeConfigWithOptions,
  contentTypeFor,
  normalizeConfigForClient as normalizeConfigSnapshotForClient,
  normalizeRuntimeForClient as normalizeRuntimeStateForClient,
  resolveStaticAssetPath
} from "./orchestrator-helpers.js";
import { resolveProjectRoot } from "./runtime-paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeRoot = path.resolve(__dirname, "..");
const projectRoot = resolveProjectRoot(__dirname);
const distDir = path.join(projectRoot, "dist");
const logDir = process.env.PACKAGE_RUNNER_LOG_DIR
  ? path.resolve(process.env.PACKAGE_RUNNER_LOG_DIR)
  : path.join(projectRoot, "logs");
const orchestratorLogPath = path.join(logDir, "orchestrator.log");
const configStore = createConfigStore(projectRoot);
const launchMode = process.env.PACKAGE_RUNNER_LAUNCH_MODE ?? "runner-ui";
const shellMode = process.env.PACKAGE_RUNNER_SHELL_MODE ?? "browser";
const runnerPortOverride = Number.parseInt(
  process.env.PACKAGE_RUNNER_PORT_OVERRIDE ?? "",
  10
);
interface PackagePortOverrides {
  readonly frontendPackage: number;
  readonly mqttTcp: number;
  readonly mqttWs: number;
}

const packagePortOverrides: PackagePortOverrides = {
  frontendPackage: Number.parseInt(process.env.PACKAGE_RUNNER_FRONTEND_PORT_OVERRIDE ?? "", 10),
  mqttTcp: Number.parseInt(process.env.PACKAGE_RUNNER_MQTT_TCP_PORT_OVERRIDE ?? "", 10),
  mqttWs: Number.parseInt(process.env.PACKAGE_RUNNER_MQTT_WS_PORT_OVERRIDE ?? "", 10)
};

const nativeConsole = {
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

type LogLevel = "error" | "info" | "stderr" | "stdout" | "warn";
type RuntimePorts = {
  runner: number;
  frontendPackage: number;
  mqttTcp: number;
  mqttWs: number;
};

interface Logger {
  info(...values: ReadonlyArray<unknown>): void;
  warn(...values: ReadonlyArray<unknown>): void;
  error(...values: ReadonlyArray<unknown>): void;
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  return typeof value === "string" ? value : inspect(value, { depth: 5, breakLength: Infinity });
}

function appendLogLine(
  filePath: string,
  level: LogLevel,
  values: ReadonlyArray<unknown>
): void {
  const message = values.map(formatLogValue).join(" ");

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(
      filePath,
      `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`,
      "utf8"
    );
  } catch (error) {
    nativeConsole.error(`Failed to write log file ${filePath}: ${errorMessage(error)}`);
  }
}

const logger: Logger = {
  info(...values) {
    appendLogLine(orchestratorLogPath, "info", values);
    nativeConsole.info(...values);
  },
  warn(...values) {
    appendLogLine(orchestratorLogPath, "warn", values);
    nativeConsole.warn(...values);
  },
  error(...values) {
    appendLogLine(orchestratorLogPath, "error", values);
    nativeConsole.error(...values);
  }
};

function attachPackageOutput(packageName: PackageName, childProcess: ChildProcess): void {
  const logPath = path.join(logDir, `${packageName}.log`);

  appendLogLine(logPath, "info", [`Process started (pid=${childProcess.pid}).`]);

  const forwardStream = (stream: Readable | null, level: LogLevel, terminalStream: Writable) => {
    if (!stream) {
      return;
    }

    let pending = "";

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      if (shellMode !== "desktop") {
        terminalStream.write(chunk);
      }

      const lines = `${pending}${chunk}`.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        appendLogLine(logPath, level, [line]);
      }
    });
    stream.on("end", () => {
      if (pending) {
        appendLogLine(logPath, level, [pending]);
      }
    });
  };

  forwardStream(childProcess.stdout, "stdout", process.stdout);
  forwardStream(childProcess.stderr, "stderr", process.stderr);
}

const runtimeState: RuntimeState = {
  isRunning: false,
  isTransitioning: false,
  lastError: null,
  currentConfig: null,
  packageStatus: {
    fe: "stopped",
    be: "stopped",
    mqtt: "stopped"
  },
  packageProcesses: {
    fe: null,
    be: null,
    mqtt: null
  }
};

function applyRuntimePortOverrides(configSnapshot: ConfigSnapshot): ConfigSnapshot {
  return applyRuntimePortOverridesWithOptions(configSnapshot, {
    runner: runnerPortOverride,
    frontendPackage: packagePortOverrides.frontendPackage,
    mqttTcp: packagePortOverrides.mqttTcp,
    mqttWs: packagePortOverrides.mqttWs
  });
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk: Buffer | string) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeConfigForClient(configSnapshot: ConfigSnapshot): ClientConfigSnapshot {
  return normalizeConfigSnapshotForClient(configSnapshot, {
      defaultConfig: configStore.defaultConfigPath,
      userConfig: configStore.userConfigPath
  });
}

function normalizeRuntimeForClient(): ClientRuntimeState {
  return normalizeRuntimeStateForClient(runtimeState);
}

function openBrowser(url: string): void {
  if (process.env.NO_OPEN_BROWSER === "1") {
    return;
  }

  const platform = process.platform;
  let childProcess: ChildProcess;

  try {
    if (platform === "win32") {
      childProcess = spawn("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
        windowsHide: true
      });
    } else if (platform === "darwin") {
      childProcess = spawn("open", [url], { stdio: "ignore", detached: true });
    } else {
      childProcess = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    }

    childProcess.on("error", (error) => {
      logger.error(`Failed to open browser for ${url}: ${error.message}`);
    });
    childProcess.unref();
  } catch (error) {
    logger.error(`Failed to open browser for ${url}: ${errorMessage(error)}`);
  }
}

function waitForHttpReady(url: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(undefined);
      });

      request.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(attempt, 250);
      });
    }

    attempt();
  });
}

function canBindPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(host: string, preferredPort: number): Promise<number> {
  if (await canBindPort(host, preferredPort)) {
    return preferredPort;
  }

  for (let candidate = preferredPort + 1; candidate < preferredPort + 25; candidate += 1) {
    if (await canBindPort(host, candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Port ${preferredPort} is unavailable and no fallback port was found nearby.`
  );
}

async function resolveRuntimePorts(
  configSnapshot: ConfigSnapshot
): Promise<ConfigSnapshot["effective"]["ports"]> {
  const host = configSnapshot.effective.interfaces.host;
  const configuredPorts = configSnapshot.effective.ports;

  const ports: RuntimePorts = {
    ...configuredPorts,
    runner: Number.isFinite(runnerPortOverride) ? runnerPortOverride : configuredPorts.runner,
    frontendPackage: Number.isFinite(packagePortOverrides.frontendPackage)
      ? packagePortOverrides.frontendPackage
      : configuredPorts.frontendPackage,
    mqttTcp: Number.isFinite(packagePortOverrides.mqttTcp)
      ? packagePortOverrides.mqttTcp
      : configuredPorts.mqttTcp,
    mqttWs: Number.isFinite(packagePortOverrides.mqttWs)
      ? packagePortOverrides.mqttWs
      : configuredPorts.mqttWs
  };

  const portMappings: ReadonlyArray<readonly [keyof typeof ports, string]> = [
    ["frontendPackage", "frontend package"],
    ["mqttTcp", "MQTT TCP"],
    ["mqttWs", "MQTT WebSocket"]
  ];

  for (const [key, label] of portMappings) {
    const preferredPort = ports[key];
    const resolvedPort = await findAvailablePort(host, preferredPort);

    if (resolvedPort !== preferredPort) {
      logger.warn(`${label} port ${preferredPort} is busy. Falling back to ${resolvedPort}.`);
      ports[key] = resolvedPort;
    }
  }

  return ports;
}

function buildPackageRuntimeConfig(configSnapshot: ConfigSnapshot) {
  return buildPackageRuntimeConfigWithOptions(configSnapshot, {
    projectRoot,
    runtimeRoot,
    nodeExecutable: process.execPath,
    environment: process.env,
    entryExists: fs.existsSync
  });
}

function attachPackageExitHandler(packageName: PackageName, childProcess: ChildProcess): void {
  childProcess.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    appendLogLine(path.join(logDir, `${packageName}.log`), "info", [
      `Process exited (code=${code ?? "none"}, signal=${signal ?? "none"}).`
    ]);
    runtimeState.packageProcesses[packageName] = null;
    runtimeState.packageStatus[packageName] = "stopped";

    if (runtimeState.isTransitioning) {
      return;
    }

    if (runtimeState.isRunning) {
      runtimeState.lastError = `${packageName.toUpperCase()} package exited unexpectedly with code ${code ?? "unknown"}.`;
      runtimeState.isRunning = false;
      logger.error(runtimeState.lastError);
    }
  });

  childProcess.on("error", (error: Error) => {
    runtimeState.packageProcesses[packageName] = null;
    runtimeState.packageStatus[packageName] = "stopped";
    runtimeState.lastError = `${packageName.toUpperCase()} package failed to start: ${error.message}`;
    runtimeState.isRunning = false;
    runtimeState.isTransitioning = false;
    appendLogLine(path.join(logDir, `${packageName}.log`), "error", [runtimeState.lastError]);
    logger.error(runtimeState.lastError);
  });
}

function spawnPackage(packageName: PackageName, definition: PackageDefinition): ChildProcess {
  runtimeState.packageStatus[packageName] = "starting";
  const childProcess = spawn(definition.executable, [definition.entry], {
    cwd: definition.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: definition.env,
    windowsHide: shellMode === "desktop"
  });

  runtimeState.packageProcesses[packageName] = childProcess;
  attachPackageOutput(packageName, childProcess);
  attachPackageExitHandler(packageName, childProcess);
  runtimeState.packageStatus[packageName] = "running";
  return childProcess;
}

function waitForChildExit(childProcess: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve(true);
      return;
    }

    const handleExit = () => {
      clearTimeout(timeoutId);
      resolve(true);
    };

    const timeoutId = setTimeout(() => {
      childProcess.off("exit", handleExit);
      resolve(false);
    }, timeoutMs);

    childProcess.once("exit", handleExit);
  });
}

function terminateChildProcess(childProcess: ChildProcess): void {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      childProcess.kill(signal);
      return;
    } catch {
      // Ignore unsupported signals and continue to the next option.
    }
  }
}

async function stopProcess(packageName: PackageName): Promise<void> {
  const childProcess = runtimeState.packageProcesses[packageName];
  if (!childProcess) {
    runtimeState.packageStatus[packageName] = "stopped";
    return;
  }

  runtimeState.packageProcesses[packageName] = null;
  runtimeState.packageStatus[packageName] = "stopping";
  terminateChildProcess(childProcess);

  const exitedGracefully = await waitForChildExit(childProcess, 1500);
  if (!exitedGracefully) {
    terminateChildProcess(childProcess);
    await waitForChildExit(childProcess, 3000);
  }

  runtimeState.packageStatus[packageName] = "stopped";
}

async function startRuntime(): Promise<ClientRuntimeState> {
  if (runtimeState.isRunning) {
    return normalizeRuntimeForClient();
  }

  logger.info("Starting FE, BE, and MQTT packages.");
  runtimeState.isTransitioning = true;
  runtimeState.lastError = null;

  const configSnapshot = applyRuntimePortOverrides(configStore.readConfig());
  const packageConfig = buildPackageRuntimeConfig(configSnapshot);

  try {
    spawnPackage("mqtt", packageConfig.packageDefinitions.mqtt);
    spawnPackage("be", packageConfig.packageDefinitions.be);
    spawnPackage("fe", packageConfig.packageDefinitions.fe);

    runtimeState.currentConfig = {
      ...configSnapshot.effective,
      frontendAppUrl: `http://${packageConfig.host}:${packageConfig.ports.frontendPackage}`
    };
    runtimeState.isRunning = true;
    logger.info("FE, BE, and MQTT packages are running.");
  } catch (error) {
    runtimeState.lastError = errorMessage(error);
    logger.error(`Package startup failed: ${errorMessage(error)}`);
    await Promise.all((["fe", "be", "mqtt"] as const).map((name) => stopProcess(name).catch(() => {})));
    throw error;
  } finally {
    runtimeState.isTransitioning = false;
  }

  return normalizeRuntimeForClient();
}

async function stopRuntime(): Promise<ClientRuntimeState> {
  if (!runtimeState.isRunning && !runtimeState.isTransitioning) {
    runtimeState.lastError = null;
    return normalizeRuntimeForClient();
  }

  runtimeState.isTransitioning = true;
  logger.info("Stopping FE, BE, and MQTT packages.");
  runtimeState.lastError = null;
  runtimeState.isRunning = false;

  for (const packageName of ["fe", "be", "mqtt"] as const) {
    await stopProcess(packageName).catch(() => {});
  }

  runtimeState.isTransitioning = false;
  logger.info("FE, BE, and MQTT packages stopped.");
  return normalizeRuntimeForClient();
}

function createStaticServer(): http.Server {
  return http.createServer((req, res) => {
    const rawPath = req.url?.split("?")[0] ?? "/";

    if (rawPath === "/api/config" && req.method === "GET") {
      try {
        sendJson(res, 200, normalizeConfigForClient(configStore.readConfig()));
      } catch (error) {
        sendJson(res, 500, { error: errorMessage(error) });
      }
      return;
    }

    if (rawPath === "/api/config" && req.method === "POST") {
      parseJsonBody(req)
        .then((body) => {
          const requestBody = isJsonObject(body) ? body : {};
          const nextOverrides = requestBody.userOverrides;
          const nextConfig = configStore.writeUserOverrides(
            isJsonObject(nextOverrides) ? nextOverrides : requestBody
          );
          sendJson(res, 200, normalizeConfigForClient(nextConfig));
        })
        .catch((error) => {
          sendJson(res, 400, { error: errorMessage(error) });
        });
      return;
    }

    if (rawPath === "/api/runtime" && req.method === "GET") {
      sendJson(res, 200, normalizeRuntimeForClient());
      return;
    }

    if (rawPath === "/api/runtime/start" && req.method === "POST") {
      startRuntime()
        .then((payload) => sendJson(res, 200, payload))
        .catch((error: unknown) => sendJson(res, 500, { error: errorMessage(error) }));
      return;
    }

    if (rawPath === "/api/runtime/stop" && req.method === "POST") {
      stopRuntime()
        .then((payload) => sendJson(res, 200, payload))
        .catch((error: unknown) => sendJson(res, 500, { error: errorMessage(error) }));
      return;
    }

    const filePath = resolveStaticAssetPath({
      distDir,
      rawPath,
      exists: fs.existsSync,
      isDirectory: (absolutePath) => fs.statSync(absolutePath).isDirectory()
    });

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Failed to load simulator assets.");
        return;
      }

      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(data);
    });
  });
}

async function main(): Promise<void> {
  logger.info(`Orchestrator process started (pid=${process.pid}).`);

  if (!fs.existsSync(distDir)) {
    throw new Error("Missing dist folder. Run the build first.");
  }

  const configSnapshot = configStore.readConfig();
  const host = configSnapshot.effective.interfaces.host;
  const runtimeConfigSnapshot = applyRuntimePortOverrides(configSnapshot);
  const runnerPort = runtimeConfigSnapshot.effective.ports.runner;

  const staticServer = createStaticServer();
  await new Promise((resolve, reject) => {
    staticServer.once("error", reject);
    staticServer.listen(runnerPort, host, () => resolve(undefined));
  });

  const shutdown = async () => {
    logger.info("Orchestrator shutdown begin.");
    await stopRuntime().catch(() => {});
    await new Promise<void>((resolve) => staticServer.close(() => resolve()));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const runnerUrl = `http://${host}:${runnerPort}`;
  logger.info(`Simulator ready at ${runnerUrl}`);
  logger.info(`Config defaults: ${configStore.defaultConfigPath}`);
  logger.info(`Config overrides: ${configStore.userConfigPath}`);
  logger.info(`Logs: ${logDir}`);

  if (launchMode === "app") {
    logger.info("App launch mode enabled. Starting FE, BE, and MQTT packages.");

    try {
      const runtimePayload = await startRuntime();
      const frontendAppUrl = runtimePayload.currentConfig?.frontendAppUrl;

      if (frontendAppUrl && shellMode !== "desktop") {
        await waitForHttpReady(frontendAppUrl).catch(() => {});
        openBrowser(frontendAppUrl);
      }
    } catch (error) {
      runtimeState.lastError = errorMessage(error);
      logger.error(`Automatic app launch failed: ${errorMessage(error)}`);
      if (shellMode !== "desktop") {
        openBrowser(runnerUrl);
      }
    }

    return;
  }

  if (shellMode !== "desktop") {
    openBrowser(runnerUrl);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    logger.error(error);
    process.exit(1);
  });
}
