import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = __dirname;
const host = process.env.FE_HOST ?? "127.0.0.1";
const port = Number(process.env.FE_PORT ?? "4300");
const mqttWsPort = Number(process.env.MQTT_WS_PORT ?? "19001");
const testTopic = process.env.MQTT_TEST_TOPIC ?? "mvp/test";

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const rawPath = req.url?.split("?")[0] ?? "/";

  if (rawPath === "/runtime-config.json") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        host,
        ports: {
          mqttWs: mqttWsPort
        },
        mqtt: {
          testTopic
        }
      })
    );
    return;
  }

  const requestPath = rawPath === "/" ? "/index.html" : rawPath;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(packageRoot, safePath);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Injected FE asset not found.");
      return;
    }

    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Injected FE package ready at http://${host}:${port}`);
});

server.on("error", (error) => {
  console.error(`Injected FE package failed to start on http://${host}:${port}: ${error.message}`);
  process.exit(1);
});
