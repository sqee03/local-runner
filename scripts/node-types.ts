import type { ChildProcess } from "node:child_process";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export interface RunnerConfig {
  readonly interfaces: {
    readonly host: string;
  };
  readonly ports: {
    readonly runner: number;
    readonly frontendPackage: number;
    readonly mqttTcp: number;
    readonly mqttWs: number;
  };
  readonly paths: {
    readonly frontendExecutable: string;
    readonly frontendEntry: string;
    readonly frontendWorkingDirectory: string;
    readonly backendExecutable: string;
    readonly backendEntry: string;
    readonly backendWorkingDirectory: string;
    readonly mqttExecutable: string;
    readonly mqttEntry: string;
    readonly mqttWorkingDirectory: string;
  };
  readonly mqtt: {
    readonly testTopic: string;
  };
}

export type RunnerClientConfig = RunnerConfig & {
  readonly frontendAppUrl?: string;
};

export interface ConfigSnapshot {
  readonly defaults: JsonObject;
  readonly userOverrides: JsonObject;
  readonly effective: RunnerConfig;
}

export interface ClientConfigSnapshot extends ConfigSnapshot {
  readonly filePaths: {
    readonly defaultConfig: string;
    readonly userConfig: string;
  };
}

export type PackageName = "be" | "fe" | "mqtt";
export type PackageStatus = "running" | "starting" | "stopped" | "stopping";

export interface PackageDefinition {
  readonly executable: string;
  readonly entry: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface PackageRuntimeConfig {
  readonly host: string;
  readonly ports: RunnerConfig["ports"];
  readonly mqttTopic: string;
  readonly packageDefinitions: Record<PackageName, PackageDefinition>;
}

export interface RuntimeState {
  isRunning: boolean;
  isTransitioning: boolean;
  lastError: string | null;
  currentConfig: RunnerClientConfig | null;
  packageStatus: Record<PackageName, PackageStatus>;
  packageProcesses: Record<PackageName, ChildProcess | null>;
}

export interface ClientRuntimeState {
  readonly isRunning: boolean;
  readonly isTransitioning: boolean;
  readonly lastError: string | null;
  readonly currentConfig: RunnerClientConfig | null;
  readonly packageStatus: Record<PackageName, PackageStatus>;
}

export type ReleaseTarget = "mac-arm64" | "windows";

export function isReleaseTarget(value: string | undefined): value is ReleaseTarget {
  return value === "windows" || value === "mac-arm64";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
