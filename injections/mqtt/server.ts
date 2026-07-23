import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import { createBroker } from "aedes";
import websocketStream from "websocket-stream";

const mqttPort = Number(process.env.MQTT_TCP_PORT ?? "18883");
const wsPort = Number(process.env.MQTT_WS_PORT ?? "19001");
const host = process.env.MQTT_HOST ?? "127.0.0.1";

const broker = createBroker();
const wsServer = http.createServer();
const handleWebSocketStream = (stream: Duplex, request?: IncomingMessage): void => {
  broker.handle(stream, request);
};
const socketServer = websocketStream.createServer(
  { server: wsServer },
  handleWebSocketStream as unknown as () => void
);
const tcpServer = net.createServer(broker.handle);

await new Promise((resolve, reject) => {
  tcpServer.once("error", reject);
  tcpServer.listen(mqttPort, host, () => resolve(undefined));
});

await new Promise((resolve, reject) => {
  wsServer.once("error", reject);
  wsServer.listen(wsPort, host, () => resolve(undefined));
});

console.log(`MQTT package ready on mqtt://${host}:${mqttPort} and ws://${host}:${wsPort}`);

async function shutdown(): Promise<void> {
  socketServer.close();
  await Promise.all([
    new Promise((resolve) => wsServer.close(resolve)),
    new Promise((resolve) => tcpServer.close(resolve)),
    new Promise((resolve) => broker.close(() => resolve(undefined)))
  ]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
