import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface RuntimeConfig {
  readonly host: string;
  readonly ports: {
    readonly mqttWs: number;
  };
  readonly mqtt: {
    readonly testTopic: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = __dirname;
const host = process.env.FE_HOST ?? "127.0.0.1";
const port = readPort(process.env.FE_PORT, 4300);
const mqttWsPort = readPort(process.env.MQTT_WS_PORT, 19001);
const testTopic = process.env.MQTT_TEST_TOPIC ?? "mvp/test";

function readPort(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function runtimeConfig(): RuntimeConfig {
  return {
    host,
    ports: {
      mqttWs: mqttWsPort
    },
    mqtt: {
      testTopic
    }
  };
}

function sendRuntimeConfig(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(runtimeConfig()));
}

function sendStaticFile(res: ServerResponse, filePath: string): void {
  fs.readFile(filePath, (error: NodeJS.ErrnoException | null, data: Buffer) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Injected FE asset not found.");
      return;
    }

    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  });
}

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  const rawPath = req.url?.split("?")[0] ?? "/";

  if (rawPath === "/runtime-config.json") {
    sendRuntimeConfig(res);
    return;
  }

  const requestPath = rawPath === "/" ? "/index.html" : rawPath;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(packageRoot, safePath);

  sendStaticFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`Injected FE package ready at http://${host}:${port}`);
});

server.on("error", (error) => {
  console.error(`Injected FE package failed to start on http://${host}:${port}: ${error.message}`);
  process.exit(1);
});
