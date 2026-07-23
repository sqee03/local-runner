import type { ConfigSnapshot, JsonObject, RunnerConfig } from "./node-types.js";

export function createRunnerConfig(
  overrides: {
    readonly interfaces?: Partial<RunnerConfig["interfaces"]>;
    readonly ports?: Partial<RunnerConfig["ports"]>;
    readonly paths?: Partial<RunnerConfig["paths"]>;
    readonly mqtt?: Partial<RunnerConfig["mqtt"]>;
  } = {}
): RunnerConfig {
  return {
    interfaces: {
      host: "127.0.0.1",
      ...overrides.interfaces
    },
    ports: {
      runner: 4173,
      frontendPackage: 4300,
      mqttTcp: 18883,
      mqttWs: 19001,
      ...overrides.ports
    },
    paths: {
      frontendExecutable: "node",
      frontendEntry: "./injections/fe/server.js",
      frontendWorkingDirectory: ".",
      backendExecutable: "node",
      backendEntry: "./injections/be/server.js",
      backendWorkingDirectory: ".",
      mqttExecutable: "node",
      mqttEntry: "./injections/mqtt/server.js",
      mqttWorkingDirectory: ".",
      ...overrides.paths
    },
    mqtt: {
      testTopic: "mvp/test",
      ...overrides.mqtt
    }
  };
}

export function createConfigSnapshot(
  overrides: Parameters<typeof createRunnerConfig>[0] = {}
): ConfigSnapshot {
  const effective = createRunnerConfig(overrides);
  return {
    defaults: effective as unknown as JsonObject,
    userOverrides: {},
    effective
  };
}
