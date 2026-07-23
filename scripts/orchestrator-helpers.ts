import path from "node:path";
import type {
  ClientConfigSnapshot,
  ClientRuntimeState,
  ConfigSnapshot,
  PackageRuntimeConfig,
  RuntimeState
} from "./node-types.js";

export interface ConfigFilePaths {
  readonly defaultConfig: string;
  readonly userConfig: string;
}

export interface RuntimePortOverrides {
  readonly runner?: number;
  readonly frontendPackage?: number;
  readonly mqttTcp?: number;
  readonly mqttWs?: number;
}

export interface PackageRuntimeConfigOptions {
  readonly projectRoot: string;
  readonly runtimeRoot: string;
  readonly nodeExecutable: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly entryExists: (absolutePath: string) => boolean;
}

export interface StaticAssetPathOptions {
  readonly distDir: string;
  readonly rawPath: string;
  readonly exists: (absolutePath: string) => boolean;
  readonly isDirectory: (absolutePath: string) => boolean;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function contentTypeFor(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function normalizeConfigForClient(
  configSnapshot: ConfigSnapshot,
  filePaths: ConfigFilePaths
): ClientConfigSnapshot {
  return {
    defaults: configSnapshot.defaults,
    userOverrides: configSnapshot.userOverrides,
    effective: configSnapshot.effective,
    filePaths
  };
}

export function normalizeRuntimeForClient(runtimeState: RuntimeState): ClientRuntimeState {
  return {
    isRunning: runtimeState.isRunning,
    isTransitioning: runtimeState.isTransitioning,
    lastError: runtimeState.lastError,
    currentConfig: runtimeState.currentConfig,
    packageStatus: runtimeState.packageStatus
  };
}

export function applyRuntimePortOverrides(
  configSnapshot: ConfigSnapshot,
  overrides: RuntimePortOverrides
): ConfigSnapshot {
  return {
    ...configSnapshot,
    effective: {
      ...configSnapshot.effective,
      ports: {
        ...configSnapshot.effective.ports,
        runner: isFiniteNumber(overrides.runner)
          ? overrides.runner
          : configSnapshot.effective.ports.runner,
        frontendPackage: isFiniteNumber(overrides.frontendPackage)
          ? overrides.frontendPackage
          : configSnapshot.effective.ports.frontendPackage,
        mqttTcp: isFiniteNumber(overrides.mqttTcp)
          ? overrides.mqttTcp
          : configSnapshot.effective.ports.mqttTcp,
        mqttWs: isFiniteNumber(overrides.mqttWs)
          ? overrides.mqttWs
          : configSnapshot.effective.ports.mqttWs
      }
    }
  };
}

export function buildPackageRuntimeConfig(
  configSnapshot: ConfigSnapshot,
  options: PackageRuntimeConfigOptions
): PackageRuntimeConfig {
  const effective = configSnapshot.effective;
  const host = effective.interfaces.host;
  const ports = effective.ports;
  const resolveRuntimeEntry = (entryPath: string): string => {
    const projectEntryPath = path.resolve(options.projectRoot, entryPath);
    if (options.entryExists(projectEntryPath)) {
      return projectEntryPath;
    }

    return path.resolve(options.runtimeRoot, entryPath);
  };

  return {
    host,
    ports,
    mqttTopic: effective.mqtt.testTopic,
    packageDefinitions: {
      mqtt: {
        executable:
          effective.paths.mqttExecutable === "node"
            ? options.nodeExecutable
            : effective.paths.mqttExecutable,
        entry: resolveRuntimeEntry(effective.paths.mqttEntry),
        cwd: path.resolve(options.projectRoot, effective.paths.mqttWorkingDirectory),
        env: {
          ...options.environment,
          MQTT_HOST: host,
          MQTT_TCP_PORT: String(ports.mqttTcp),
          MQTT_WS_PORT: String(ports.mqttWs)
        }
      },
      be: {
        executable:
          effective.paths.backendExecutable === "node"
            ? options.nodeExecutable
            : effective.paths.backendExecutable,
        entry: resolveRuntimeEntry(effective.paths.backendEntry),
        cwd: path.resolve(options.projectRoot, effective.paths.backendWorkingDirectory),
        env: {
          ...options.environment,
          MQTT_TCP_URL: `mqtt://${host}:${ports.mqttTcp}`,
          MQTT_TEST_TOPIC: effective.mqtt.testTopic
        }
      },
      fe: {
        executable:
          effective.paths.frontendExecutable === "node"
            ? options.nodeExecutable
            : effective.paths.frontendExecutable,
        entry: resolveRuntimeEntry(effective.paths.frontendEntry),
        cwd: path.resolve(options.projectRoot, effective.paths.frontendWorkingDirectory),
        env: {
          ...options.environment,
          FE_HOST: host,
          FE_PORT: String(ports.frontendPackage),
          MQTT_WS_PORT: String(ports.mqttWs),
          MQTT_TEST_TOPIC: effective.mqtt.testTopic
        }
      }
    }
  };
}

export function resolveStaticAssetPath(options: StaticAssetPathOptions): string {
  const fallbackPath = path.join(options.distDir, "index.html");
  const requestPath = options.rawPath === "/" ? "/index.html" : options.rawPath;
  const normalized = path.normalize(requestPath).replace(/^[/\\]+/, "");
  const filePath = path.resolve(options.distDir, normalized);
  const distRoot = path.resolve(options.distDir);

  if (
    filePath !== distRoot &&
    !filePath.startsWith(`${distRoot}${path.sep}`)
  ) {
    return fallbackPath;
  }

  if (!options.exists(filePath) || options.isDirectory(filePath)) {
    return fallbackPath;
  }

  return filePath;
}
