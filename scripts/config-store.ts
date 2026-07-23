import fs from "node:fs";
import path from "node:path";
import {
  type ConfigSnapshot,
  type JsonObject,
  type RunnerConfig,
  errorMessage,
  isJsonObject
} from "./node-types.js";

export const CONFIG_DIR = "config";
export const DEFAULT_CONFIG_FILE = "defaults.json";
export const USER_CONFIG_FILE = "user-overrides.json";
export const BUNDLED_CONFIG_DIR_ENV = "PACKAGE_RUNNER_BUNDLED_CONFIG_DIR";
export const USER_CONFIG_DIR_ENV = "PACKAGE_RUNNER_USER_CONFIG_DIR";

export interface ConfigStore {
  readonly bundledConfigDir: string;
  readonly writableConfigDir: string;
  readonly defaultConfigPath: string;
  readonly userConfigPath: string;
  readConfig(): ConfigSnapshot;
  writeUserOverrides(nextOverrides: JsonObject): ConfigSnapshot;
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  if (!isJsonObject(base) || !isJsonObject(override)) {
    return override ?? base;
  }

  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isJsonObject(value) && isJsonObject(base[key])) {
      merged[key] = deepMerge(base[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function readJsonFile<T extends JsonObject>(filePath: string, fallbackValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(content);
    validateConfigShape(parsed);
    return parsed as T;
  } catch (error) {
    throw new Error(`Failed to read config file ${filePath}: ${errorMessage(error)}`);
  }
}

function validateConfigShape(config: unknown): asserts config is JsonObject {
  if (!isJsonObject(config)) {
    throw new Error("Config must be a JSON object.");
  }
}

function validateEffectiveConfig(config: JsonObject): asserts config is JsonObject & RunnerConfig {
  const candidate = config as unknown as Partial<RunnerConfig>;

  if (
    !candidate.interfaces ||
    typeof candidate.interfaces.host !== "string" ||
    !candidate.ports ||
    typeof candidate.ports.runner !== "number" ||
    typeof candidate.ports.frontendPackage !== "number" ||
    typeof candidate.ports.mqttTcp !== "number" ||
    typeof candidate.ports.mqttWs !== "number" ||
    !candidate.paths ||
    typeof candidate.paths.frontendExecutable !== "string" ||
    typeof candidate.paths.frontendEntry !== "string" ||
    typeof candidate.paths.frontendWorkingDirectory !== "string" ||
    typeof candidate.paths.backendExecutable !== "string" ||
    typeof candidate.paths.backendEntry !== "string" ||
    typeof candidate.paths.backendWorkingDirectory !== "string" ||
    typeof candidate.paths.mqttExecutable !== "string" ||
    typeof candidate.paths.mqttEntry !== "string" ||
    typeof candidate.paths.mqttWorkingDirectory !== "string" ||
    !candidate.mqtt ||
    typeof candidate.mqtt.testTopic !== "string"
  ) {
    throw new Error("Effective config is missing required runner settings.");
  }
}

export function createConfigStore(projectRoot: string): ConfigStore {
  const bundledConfigDir = path.resolve(
    process.env[BUNDLED_CONFIG_DIR_ENV] ?? path.join(projectRoot, CONFIG_DIR)
  );
  const writableConfigDir = path.resolve(
    process.env[USER_CONFIG_DIR_ENV] ?? bundledConfigDir
  );
  const bundledDefaultConfigPath = path.join(bundledConfigDir, DEFAULT_CONFIG_FILE);
  const defaultConfigPath = path.join(writableConfigDir, DEFAULT_CONFIG_FILE);
  const userConfigPath = path.join(writableConfigDir, USER_CONFIG_FILE);

  function ensureConfigFiles(): void {
    if (!fs.existsSync(writableConfigDir)) {
      fs.mkdirSync(writableConfigDir, { recursive: true });
    }

    if (!fs.existsSync(bundledDefaultConfigPath)) {
      throw new Error(`Missing default config file at ${bundledDefaultConfigPath}.`);
    }

    const bundledDefaults = fs.readFileSync(bundledDefaultConfigPath, "utf8");
    const currentDefaults = fs.existsSync(defaultConfigPath)
      ? fs.readFileSync(defaultConfigPath, "utf8")
      : null;

    if (currentDefaults !== bundledDefaults) {
      fs.writeFileSync(defaultConfigPath, bundledDefaults, "utf8");
    }

    if (!fs.existsSync(userConfigPath)) {
      fs.writeFileSync(userConfigPath, "{}\n", "utf8");
    }
  }

  function readConfig(): ConfigSnapshot {
    ensureConfigFiles();

    const defaults = readJsonFile(defaultConfigPath, {});
    const userOverrides = readJsonFile(userConfigPath, {});
    const effective = deepMerge(defaults, userOverrides);
    validateEffectiveConfig(effective);

    return {
      defaults,
      userOverrides,
      effective
    };
  }

  function writeUserOverrides(nextOverrides: JsonObject): ConfigSnapshot {
    ensureConfigFiles();
    validateConfigShape(nextOverrides);

    fs.writeFileSync(
      userConfigPath,
      `${JSON.stringify(nextOverrides, null, 2)}\n`,
      "utf8"
    );

    return readConfig();
  }

  return {
    bundledConfigDir,
    writableConfigDir,
    defaultConfigPath,
    userConfigPath,
    readConfig,
    writeUserOverrides
  };
}
