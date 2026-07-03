export const configSections = [
  {
    title: "Interfaces",
    description: "Hostnames or interfaces used by the local runner.",
    fields: [
      {
        path: "interfaces.host",
        label: "Host interface",
        type: "text",
        placeholder: "127.0.0.1"
      }
    ]
  },
  {
    title: "Ports",
    description: "Ports the runner uses for the frontend and MQTT services.",
    fields: [
      {
        path: "ports.frontend",
        label: "Frontend port",
        type: "number"
      },
      {
        path: "ports.mqttTcp",
        label: "MQTT TCP port",
        type: "number"
      },
      {
        path: "ports.mqttWs",
        label: "MQTT WebSocket port",
        type: "number"
      }
    ]
  },
  {
    title: "Process Paths",
    description: "Executable and file locations needed to run the backend process.",
    fields: [
      {
        path: "paths.backendExecutable",
        label: "Backend executable path",
        type: "text",
        placeholder: "node"
      },
      {
        path: "paths.backendEntry",
        label: "Backend entry path",
        type: "text",
        placeholder: "./scripts/mock-backend.js"
      },
      {
        path: "paths.backendWorkingDirectory",
        label: "Backend working directory",
        type: "text",
        placeholder: "."
      }
    ]
  },
  {
    title: "MQTT",
    description: "Topic-level settings used for the local FE-to-backend test.",
    fields: [
      {
        path: "mqtt.testTopic",
        label: "Test topic",
        type: "text",
        placeholder: "mvp/test"
      }
    ]
  }
];

export function getValueAtPath(object, path) {
  return path.split(".").reduce((current, segment) => current?.[segment], object);
}

export function setValueAtPath(object, path, value) {
  const segments = path.split(".");
  const next = structuredClone(object);
  let cursor = next;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    cursor[segment] = cursor[segment] ?? {};
    cursor = cursor[segment];
  }

  cursor[segments.at(-1)] = value;
  return next;
}

export function removeValueAtPath(object, path) {
  const segments = path.split(".");
  const next = structuredClone(object);

  function removeRecursively(target, index) {
    const segment = segments[index];
    if (!target || typeof target !== "object") {
      return;
    }

    if (index === segments.length - 1) {
      delete target[segment];
      return;
    }

    removeRecursively(target[segment], index + 1);

    if (
      target[segment] &&
      typeof target[segment] === "object" &&
      !Array.isArray(target[segment]) &&
      Object.keys(target[segment]).length === 0
    ) {
      delete target[segment];
    }
  }

  removeRecursively(next, 0);
  return next;
}
