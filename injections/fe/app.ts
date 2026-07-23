interface RuntimeConfig {
  readonly host: string;
  readonly ports: {
    readonly mqttWs: number;
  };
  readonly mqtt: {
    readonly testTopic: string;
  };
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RuntimeConfig>;
  return (
    typeof candidate.host === "string" &&
    Boolean(candidate.ports) &&
    typeof candidate.ports?.mqttWs === "number" &&
    Boolean(candidate.mqtt) &&
    typeof candidate.mqtt?.testTopic === "string"
  );
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}.`);
  }

  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/runtime-config.json");
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`Runtime config request failed with HTTP ${response.status}.`);
  }

  if (!isRuntimeConfig(payload)) {
    throw new Error("Runtime config response has an unexpected shape.");
  }

  return payload;
}

async function boot(): Promise<void> {
  const config = await loadRuntimeConfig();
  const mqttStatus = requireElement("mqtt-status");
  const backendStatus = requireElement("backend-status");
  const messageBox = requireElement("message-box");

  mqttStatus.textContent = `available on ws://${config.host}:${config.ports.mqttWs}`;
  mqttStatus.className = "status-ok";
  backendStatus.textContent = "placeholder running";
  backendStatus.className = "status-ok";
  messageBox.textContent = JSON.stringify(config, null, 2);
}

boot().catch((error) => {
  const messageBox = document.getElementById("message-box");
  if (messageBox) {
    messageBox.textContent = errorMessage(error);
  }
});

export {};
