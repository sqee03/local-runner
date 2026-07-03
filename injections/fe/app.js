async function boot() {
  const response = await fetch("/runtime-config.json");
  const config = await response.json();

  const mqttStatus = document.getElementById("mqtt-status");
  const backendStatus = document.getElementById("backend-status");
  const messageBox = document.getElementById("message-box");
  mqttStatus.textContent = `available on ws://${config.host}:${config.ports.mqttWs}`;
  mqttStatus.className = "status-ok";
  backendStatus.textContent = "placeholder running";
  backendStatus.className = "status-ok";
  messageBox.textContent = JSON.stringify(config, null, 2);
}

boot().catch((error) => {
  const messageBox = document.getElementById("message-box");
  if (messageBox) {
    messageBox.textContent = error.message;
  }
});
