import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConfigStore } from "./config-store.js";
import { startBroker } from "./mqtt-broker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const configStore = createConfigStore(projectRoot);

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

    const requestPath = rawPath === "/" ? "/index.html" : rawPath;
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(distDir, safePath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, "index.html");
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Failed to load frontend assets.");
        return;
      }

      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(data);
    });
  });
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

async function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error("Missing dist folder. Run the build first.");
  }

  const configSnapshot = configStore.readConfig();
  const host = configSnapshot.effective.interfaces.host;
  const fePort = configSnapshot.effective.ports.frontend;
  const mqttTcpPort = configSnapshot.effective.ports.mqttTcp;
  const mqttWsPort = configSnapshot.effective.ports.mqttWs;
  const backendExecutable = configSnapshot.effective.paths.backendExecutable;
  const backendEntry = path.resolve(
    projectRoot,
    configSnapshot.effective.paths.backendEntry
  );
  const backendWorkingDirectory = path.resolve(
    projectRoot,
    configSnapshot.effective.paths.backendWorkingDirectory
  );
  const mqttTopic = configSnapshot.effective.mqtt.testTopic;

  const brokerRuntime = await startBroker({
    mqttPort: mqttTcpPort,
    wsPort: mqttWsPort
  });

  const staticServer = createStaticServer();
  await new Promise((resolve, reject) => {
    staticServer.once("error", reject);
    staticServer.listen(fePort, host, resolve);
  });

  const backendCommand =
    backendExecutable === "node" ? process.execPath : backendExecutable;

  const backendProcess = spawn(backendCommand, [backendEntry], {
    cwd: backendWorkingDirectory,
    stdio: "inherit",
    env: {
      ...process.env,
      MQTT_TCP_URL: `mqtt://${host}:${mqttTcpPort}`,
      MQTT_TEST_TOPIC: mqttTopic
    }
  });

  backendProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Backend exited unexpectedly with code ${code}.`);
    }
  });

  const shutdown = async () => {
    backendProcess.kill();
    await Promise.all([
      new Promise((resolve) => staticServer.close(resolve)),
      brokerRuntime.stop()
    ]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const frontendUrl = `http://${host}:${fePort}`;
  console.log(`Frontend ready at ${frontendUrl}`);
  console.log(`MQTT WebSocket ready at ws://${host}:${mqttWsPort}`);
  console.log(`Config defaults: ${configStore.defaultConfigPath}`);
  console.log(`Config overrides: ${configStore.userConfigPath}`);
  openBrowser(frontendUrl);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
