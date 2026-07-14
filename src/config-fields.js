export const configSections = [
  {
    title: "Interfaces",
    description: "Local host binding used by the desktop app services.",
    fields: [
      {
        path: "interfaces.host",
        label: "Service host interface",
        type: "text",
        placeholder: "127.0.0.1"
      }
    ]
  },
  {
    title: "Ports",
    description: "Ports used by the internal control service and bundled local services.",
    fields: [
      {
        path: "ports.runner",
        label: "Internal control service port",
        type: "number"
      },
      {
        path: "ports.frontendPackage",
        label: "Frontend app port",
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
    description: "Executable, entry, and working-directory paths for the local FE, BE, and MQTT services.",
    fields: [
      {
        path: "paths.frontendExecutable",
        label: "Frontend executable",
        type: "text",
        placeholder: "node"
      },
      {
        path: "paths.frontendEntry",
        label: "Frontend entry",
        type: "text",
        placeholder: "./injections/fe/server.js"
      },
      {
        path: "paths.frontendWorkingDirectory",
        label: "Frontend working directory",
        type: "text",
        placeholder: "."
      },
      {
        path: "paths.backendExecutable",
        label: "Backend executable",
        type: "text",
        placeholder: "node"
      },
      {
        path: "paths.backendEntry",
        label: "Backend entry",
        type: "text",
        placeholder: "./injections/be/server.js"
      },
      {
        path: "paths.backendWorkingDirectory",
        label: "Backend working directory",
        type: "text",
        placeholder: "."
      },
      {
        path: "paths.mqttExecutable",
        label: "MQTT executable",
        type: "text",
        placeholder: "node"
      },
      {
        path: "paths.mqttEntry",
        label: "MQTT entry",
        type: "text",
        placeholder: "./injections/mqtt/server.js"
      },
      {
        path: "paths.mqttWorkingDirectory",
        label: "MQTT working directory",
        type: "text",
        placeholder: "."
      }
    ]
  },
  {
    title: "MQTT",
    description: "Topic settings used by the bundled frontend and backend demo flow.",
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
