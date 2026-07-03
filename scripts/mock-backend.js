import mqtt from "mqtt";

const MQTT_TCP_URL = process.env.MQTT_TCP_URL ?? "mqtt://127.0.0.1:18883";
const TEST_TOPIC = process.env.MQTT_TEST_TOPIC ?? "mvp/test";

const client = mqtt.connect(MQTT_TCP_URL, {
  reconnectPeriod: 1000,
  connectTimeout: 4000
});

function publishHeartbeat() {
  const payload = JSON.stringify({
    source: "mock-backend",
    text: "Hello from the mocked backend",
    timestamp: new Date().toISOString()
  });

  client.publish(TEST_TOPIC, payload, { qos: 0 }, (error) => {
    if (error) {
      console.error("Failed to publish mock backend message:", error.message);
    } else {
      console.log("Published test message on", TEST_TOPIC);
    }
  });
}

client.on("connect", () => {
  console.log("Mock backend connected to broker.");
  publishHeartbeat();
  setInterval(publishHeartbeat, 5000);
});

client.on("error", (error) => {
  console.error("Mock backend MQTT error:", error.message);
});
