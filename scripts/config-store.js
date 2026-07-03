import fs from "node:fs";
import path from "node:path";

export const CONFIG_DIR = "config";
export const DEFAULT_CONFIG_FILE = "defaults.json";
export const USER_CONFIG_FILE = "user-overrides.json";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return override ?? base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isObject(value) && isObject(base[key])) {
      merged[key] = deepMerge(base[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read config file ${filePath}: ${error.message}`);
  }
}

function validateConfigShape(config) {
  if (!isObject(config)) {
    throw new Error("Config must be a JSON object.");
  }
}

export function createConfigStore(projectRoot) {
  const configDir = path.join(projectRoot, CONFIG_DIR);
  const defaultConfigPath = path.join(configDir, DEFAULT_CONFIG_FILE);
  const userConfigPath = path.join(configDir, USER_CONFIG_FILE);

  function ensureConfigFiles() {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(defaultConfigPath)) {
      throw new Error(`Missing default config file at ${defaultConfigPath}.`);
    }

    if (!fs.existsSync(userConfigPath)) {
      fs.writeFileSync(userConfigPath, "{}\n", "utf8");
    }
  }

  function readConfig() {
    ensureConfigFiles();

    const defaults = readJsonFile(defaultConfigPath, {});
    const userOverrides = readJsonFile(userConfigPath, {});

    validateConfigShape(defaults);
    validateConfigShape(userOverrides);

    return {
      defaults,
      userOverrides,
      effective: deepMerge(defaults, userOverrides)
    };
  }

  function writeUserOverrides(nextOverrides) {
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
    defaultConfigPath,
    userConfigPath,
    readConfig,
    writeUserOverrides
  };
}
