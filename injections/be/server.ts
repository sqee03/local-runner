import mqtt from "mqtt";

const MQTT_TCP_URL = process.env.MQTT_TCP_URL ?? "mqtt://127.0.0.1:18883";
const TEST_TOPIC = process.env.MQTT_TEST_TOPIC ?? "mvp/test";

const client = mqtt.connect(MQTT_TCP_URL, {
  reconnectPeriod: 1000,
  connectTimeout: 4000
});
let heartbeatTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

function publishHeartbeat(): void {
  if (isShuttingDown) {
    return;
  }

  const payload = JSON.stringify({
    source: "backend-package",
    text: "Hello from the injected backend package",
    timestamp: new Date().toISOString()
  });

  client.publish(TEST_TOPIC, payload, { qos: 0 }, (error) => {
    if (error) {
      console.error("Failed to publish backend package message:", error.message);
    } else {
      console.log("Published backend package message on", TEST_TOPIC);
    }
  });
}

client.on("connect", () => {
  console.log("Backend package connected to MQTT.");
  publishHeartbeat();
  heartbeatTimer = setInterval(publishHeartbeat, 5000);
});

client.on("error", (error) => {
  if (isShuttingDown) {
    return;
  }

  console.error("Backend package MQTT error:", error.message);
});

async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  client.end(true, () => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
