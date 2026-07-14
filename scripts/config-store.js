import fs from "node:fs";
import path from "node:path";

export const CONFIG_DIR = "config";
export const DEFAULT_CONFIG_FILE = "defaults.json";
export const USER_CONFIG_FILE = "user-overrides.json";
export const BUNDLED_CONFIG_DIR_ENV = "PACKAGE_RUNNER_BUNDLED_CONFIG_DIR";
export const USER_CONFIG_DIR_ENV = "PACKAGE_RUNNER_USER_CONFIG_DIR";

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
  const bundledConfigDir = path.resolve(
    process.env[BUNDLED_CONFIG_DIR_ENV] ?? path.join(projectRoot, CONFIG_DIR)
  );
  const writableConfigDir = path.resolve(
    process.env[USER_CONFIG_DIR_ENV] ?? bundledConfigDir
  );
  const bundledDefaultConfigPath = path.join(bundledConfigDir, DEFAULT_CONFIG_FILE);
  const defaultConfigPath = path.join(writableConfigDir, DEFAULT_CONFIG_FILE);
  const userConfigPath = path.join(writableConfigDir, USER_CONFIG_FILE);

  function ensureConfigFiles() {
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
    bundledConfigDir,
    writableConfigDir,
    defaultConfigPath,
    userConfigPath,
    readConfig,
    writeUserOverrides
  };
}
