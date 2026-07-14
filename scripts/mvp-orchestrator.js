import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConfigStore } from "./config-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const configStore = createConfigStore(projectRoot);
const launchMode = process.env.PACKAGE_RUNNER_LAUNCH_MODE ?? "runner-ui";
const shellMode = process.env.PACKAGE_RUNNER_SHELL_MODE ?? "browser";
const runnerPortOverride = Number.parseInt(
  process.env.PACKAGE_RUNNER_PORT_OVERRIDE ?? "",
  10
);
const packagePortOverrides = {
  frontendPackage: Number.parseInt(process.env.PACKAGE_RUNNER_FRONTEND_PORT_OVERRIDE ?? "", 10),
  mqttTcp: Number.parseInt(process.env.PACKAGE_RUNNER_MQTT_TCP_PORT_OVERRIDE ?? "", 10),
  mqttWs: Number.parseInt(process.env.PACKAGE_RUNNER_MQTT_WS_PORT_OVERRIDE ?? "", 10)
};

const runtimeState = {
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

function applyRuntimePortOverrides(configSnapshot) {
  return {
    ...configSnapshot,
    effective: {
      ...configSnapshot.effective,
      ports: {
        ...configSnapshot.effective.ports,
        runner: Number.isFinite(runnerPortOverride)
          ? runnerPortOverride
          : configSnapshot.effective.ports.runner,
        frontendPackage: Number.isFinite(packagePortOverrides.frontendPackage)
          ? packagePortOverrides.frontendPackage
          : configSnapshot.effective.ports.frontendPackage,
        mqttTcp: Number.isFinite(packagePortOverrides.mqttTcp)
          ? packagePortOverrides.mqttTcp
          : configSnapshot.effective.ports.mqttTcp,
        mqttWs: Number.isFinite(packagePortOverrides.mqttWs)
          ? packagePortOverrides.mqttWs
          : configSnapshot.effective.ports.mqttWs
      }
    }
  };
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeConfigForClient(configSnapshot) {
  return {
    defaults: configSnapshot.defaults,
    userOverrides: configSnapshot.userOverrides,
    effective: configSnapshot.effective,
    filePaths: {
      defaultConfig: configStore.defaultConfigPath,
      userConfig: configStore.userConfigPath
    }
  };
}

function normalizeRuntimeForClient() {
  return {
    isRunning: runtimeState.isRunning,
    isTransitioning: runtimeState.isTransitioning,
    lastError: runtimeState.lastError,
    currentConfig: runtimeState.currentConfig,
    packageStatus: runtimeState.packageStatus
  };
}

function openBrowser(url) {
  if (process.env.NO_OPEN_BROWSER === "1") {
    return;
  }

  const platform = process.platform;

  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true
    }).unref();
    return;
  }

  if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }

  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function waitForHttpReady(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function attempt() {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
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

function canBindPort(host, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
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

async function findAvailablePort(host, preferredPort) {
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

async function resolveRuntimePorts(configSnapshot) {
  const host = configSnapshot.effective.interfaces.host;
  const configuredPorts = configSnapshot.effective.ports;

  const ports = {
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

  const portMappings = [
    ["frontendPackage", "frontend package"],
    ["mqttTcp", "MQTT TCP"],
    ["mqttWs", "MQTT WebSocket"]
  ];

  for (const [key, label] of portMappings) {
    const preferredPort = ports[key];
    const resolvedPort = await findAvailablePort(host, preferredPort);

    if (resolvedPort !== preferredPort) {
      console.warn(`${label} port ${preferredPort} is busy. Falling back to ${resolvedPort}.`);
      ports[key] = resolvedPort;
    }
  }

  return ports;
}

function buildPackageRuntimeConfig(configSnapshot) {
  const effective = configSnapshot.effective;
  const host = effective.interfaces.host;
  const ports = effective.ports;

  return {
    host,
    ports,
    mqttTopic: effective.mqtt.testTopic,
    packageDefinitions: {
      mqtt: {
        executable:
          effective.paths.mqttExecutable === "node"
            ? process.execPath
            : effective.paths.mqttExecutable,
        entry: path.resolve(projectRoot, effective.paths.mqttEntry),
        cwd: path.resolve(projectRoot, effective.paths.mqttWorkingDirectory),
        env: {
          ...process.env,
          MQTT_HOST: host,
          MQTT_TCP_PORT: String(ports.mqttTcp),
          MQTT_WS_PORT: String(ports.mqttWs)
        }
      },
      be: {
        executable:
          effective.paths.backendExecutable === "node"
            ? process.execPath
            : effective.paths.backendExecutable,
        entry: path.resolve(projectRoot, effective.paths.backendEntry),
        cwd: path.resolve(projectRoot, effective.paths.backendWorkingDirectory),
        env: {
          ...process.env,
          MQTT_TCP_URL: `mqtt://${host}:${ports.mqttTcp}`,
          MQTT_TEST_TOPIC: effective.mqtt.testTopic
        }
      },
      fe: {
        executable:
          effective.paths.frontendExecutable === "node"
            ? process.execPath
            : effective.paths.frontendExecutable,
        entry: path.resolve(projectRoot, effective.paths.frontendEntry),
        cwd: path.resolve(projectRoot, effective.paths.frontendWorkingDirectory),
        env: {
          ...process.env,
          FE_HOST: host,
          FE_PORT: String(ports.frontendPackage),
          MQTT_WS_PORT: String(ports.mqttWs),
          MQTT_TEST_TOPIC: effective.mqtt.testTopic
        }
      }
    }
  };
}

function attachPackageExitHandler(packageName, childProcess) {
  childProcess.on("exit", (code) => {
    runtimeState.packageProcesses[packageName] = null;
    runtimeState.packageStatus[packageName] = "stopped";

    if (runtimeState.isTransitioning) {
      return;
    }

    if (runtimeState.isRunning) {
      runtimeState.lastError = `${packageName.toUpperCase()} package exited unexpectedly with code ${code ?? "unknown"}.`;
      runtimeState.isRunning = false;
      console.error(runtimeState.lastError);
    }
  });
}

function spawnPackage(packageName, definition) {
  runtimeState.packageStatus[packageName] = "starting";
  const childProcess = spawn(definition.executable, [definition.entry], {
    cwd: definition.cwd,
    stdio: "inherit",
    env: definition.env
  });

  runtimeState.packageProcesses[packageName] = childProcess;
  attachPackageExitHandler(packageName, childProcess);
  runtimeState.packageStatus[packageName] = "running";
  return childProcess;
}

async function stopProcess(packageName) {
  const childProcess = runtimeState.packageProcesses[packageName];
  if (!childProcess) {
    runtimeState.packageStatus[packageName] = "stopped";
    return;
  }

  runtimeState.packageProcesses[packageName] = null;
  runtimeState.packageStatus[packageName] = "stopping";
  childProcess.kill();
  await new Promise((resolve) => childProcess.once("exit", resolve));
  runtimeState.packageStatus[packageName] = "stopped";
}

async function startRuntime() {
  if (runtimeState.isRunning) {
    return normalizeRuntimeForClient();
  }

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
  } catch (error) {
    runtimeState.lastError = error.message;
    await Promise.all(["fe", "be", "mqtt"].map((name) => stopProcess(name).catch(() => {})));
    throw error;
  } finally {
    runtimeState.isTransitioning = false;
  }

  return normalizeRuntimeForClient();
}

async function stopRuntime() {
  if (!runtimeState.isRunning && !runtimeState.isTransitioning) {
    runtimeState.lastError = null;
    return normalizeRuntimeForClient();
  }

  runtimeState.isTransitioning = true;
  runtimeState.lastError = null;
  runtimeState.isRunning = false;

  for (const packageName of ["fe", "be", "mqtt"]) {
    await stopProcess(packageName).catch(() => {});
  }

  runtimeState.isTransitioning = false;
  return normalizeRuntimeForClient();
}

function createStaticServer() {
  return http.createServer((req, res) => {
    const rawPath = req.url?.split("?")[0] ?? "/";

    if (rawPath === "/api/config" && req.method === "GET") {
      try {
        sendJson(res, 200, normalizeConfigForClient(configStore.readConfig()));
      } catch (error) {
        sendJson(res, 500, { error: error.message });
      }
      return;
    }

    if (rawPath === "/api/config" && req.method === "POST") {
      parseJsonBody(req)
        .then((body) => {
          const nextOverrides = body.userOverrides ?? body;
          const nextConfig = configStore.writeUserOverrides(nextOverrides);
          sendJson(res, 200, normalizeConfigForClient(nextConfig));
        })
        .catch((error) => {
          sendJson(res, 400, { error: error.message });
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
        .catch((error) => sendJson(res, 500, { error: error.message }));
      return;
    }

    if (rawPath === "/api/runtime/stop" && req.method === "POST") {
      stopRuntime()
        .then((payload) => sendJson(res, 200, payload))
        .catch((error) => sendJson(res, 500, { error: error.message }));
      return;
    }

    const requestPath = rawPath === "/" ? "/index.html" : rawPath;
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(distDir, safePath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, "index.html");
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Failed to load runner assets.");
        return;
      }

      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(data);
    });
  });
}

async function main() {
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
    staticServer.listen(runnerPort, host, resolve);
  });

  const shutdown = async () => {
    await stopRuntime().catch(() => {});
    await new Promise((resolve) => staticServer.close(resolve));
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const runnerUrl = `http://${host}:${runnerPort}`;
  console.log(`Runner ready at ${runnerUrl}`);
  console.log(`Config defaults: ${configStore.defaultConfigPath}`);
  console.log(`Config overrides: ${configStore.userConfigPath}`);

  if (launchMode === "app") {
    console.log("App launch mode enabled. Starting FE, BE, and MQTT packages.");

    try {
      const runtimePayload = await startRuntime();
      const frontendAppUrl = runtimePayload.currentConfig?.frontendAppUrl;

      if (frontendAppUrl && shellMode !== "desktop") {
        await waitForHttpReady(frontendAppUrl).catch(() => {});
        openBrowser(frontendAppUrl);
      }
    } catch (error) {
      runtimeState.lastError = error.message;
      console.error(`Automatic app launch failed: ${error.message}`);
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

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
