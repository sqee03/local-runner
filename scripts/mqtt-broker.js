import http from "node:http";
import net from "node:net";
import aedes from "aedes";
import websocketStream from "websocket-stream";

export async function startBroker({ mqttPort = 1883, wsPort = 9001 } = {}) {
  const broker = aedes();

  const wsServer = http.createServer();
  const socketServer = websocketStream.createServer({ server: wsServer }, broker.handle);
  const tcpServer = net.createServer(broker.handle);

  await new Promise((resolve, reject) => {
    tcpServer.once("error", reject);
    tcpServer.listen(mqttPort, "127.0.0.1", resolve);
  });

  await new Promise((resolve, reject) => {
    wsServer.once("error", reject);
    wsServer.listen(wsPort, "127.0.0.1", resolve);
  });

  return {
    broker,
    async stop() {
      socketServer.close();
      await Promise.all([
        new Promise((resolve) => wsServer.close(resolve)),
        new Promise((resolve) => tcpServer.close(resolve)),
        new Promise((resolve) => broker.close(resolve))
      ]);
    }
  };
}
