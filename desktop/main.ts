import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type PayloadFile = {
  path: string;
  mode: number;
  base64: string;
};

type PayloadManifest = {
  version: number;
  target: string;
  hash: string;
  files: PayloadFile[];
};

const appName = "PackageRunner";
const executableDir = path.dirname(Deno.execPath());
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPayloadPath = path.join(moduleDir, "..", "release", "payload-manifest.json");

function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function canWriteToDirectory(directoryPath: string) {
  try {
    ensureDirectory(directoryPath);
    const probePath = path.join(directoryPath, ".write-test");
    fs.writeFileSync(probePath, "ok\n", "utf8");
    fs.rmSync(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function resolveUserDataDir() {
  const portableDir = path.join(executableDir, `${appName}-data`);
  if (canWriteToDirectory(portableDir)) {
    return portableDir;
  }

  const localAppData = Deno.env.get("LOCALAPPDATA");
  if (localAppData) {
    const fallbackDir = path.join(localAppData, appName);
    if (canWriteToDirectory(fallbackDir)) {
      return fallbackDir;
    }
  }

  const homeDir = Deno.env.get("HOME");
  if (Deno.build.os === "darwin" && homeDir) {
    const macAppSupportDir = path.join(homeDir, "Library", "Application Support", appName);
    if (canWriteToDirectory(macAppSupportDir)) {
      return macAppSupportDir;
    }
  }

  return path.join(Deno.cwd(), `${appName}-data`);
}

function loadPayloadManifest(): PayloadManifest {
  if (!fs.existsSync(bundledPayloadPath)) {
    throw new Error(`Bundled payload manifest is missing at ${bundledPayloadPath}`);
  }

  return JSON.parse(fs.readFileSync(bundledPayloadPath, "utf8"));
}

function extractPayload(payloadRoot: string, payload: PayloadManifest) {
  const markerPath = path.join(payloadRoot, ".payload-hash");
  const currentMarker = fs.existsSync(markerPath)
    ? fs.readFileSync(markerPath, "utf8").trim()
    : null;

  if (currentMarker === payload.hash) {
    return;
  }

  fs.rmSync(payloadRoot, { recursive: true, force: true });
  ensureDirectory(payloadRoot);

  for (const file of payload.files) {
    const outputPath = path.join(payloadRoot, ...file.path.split("/"));
    ensureDirectory(path.dirname(outputPath));
    fs.writeFileSync(outputPath, Buffer.from(file.base64, "base64"));

    if (Deno.build.os !== "windows") {
      fs.chmodSync(outputPath, file.mode);
    }
  }

  fs.writeFileSync(markerPath, `${payload.hash}\n`, "utf8");
}

function resolveNodeRuntimePath(projectRoot: string) {
  if (Deno.build.os === "windows") {
    return path.join(projectRoot, "vendor", "windows-node-x64", "node.exe");
  }

  if (Deno.build.os === "darwin") {
    return path.join(projectRoot, "vendor", "macos-arm64-node", "bin", "node");
  }

  throw new Error(`Unsupported packaged runtime platform: ${Deno.build.os}`);
}

function ensurePersistentConfig(projectRoot: string, userDataDir: string) {
  const bundledConfigDir = path.join(projectRoot, "config");
  const configDir = path.join(userDataDir, "config");
  const bundledDefaultsPath = path.join(bundledConfigDir, "defaults.json");
  const persistentDefaultsPath = path.join(configDir, "defaults.json");
  const overridesPath = path.join(configDir, "user-overrides.json");

  ensureDirectory(configDir);

  if (!fs.existsSync(bundledDefaultsPath)) {
    throw new Error(`Bundled defaults.json is missing at ${bundledDefaultsPath}`);
  }

  const bundledDefaults = fs.readFileSync(bundledDefaultsPath, "utf8");
  const persistentDefaults = fs.existsSync(persistentDefaultsPath)
    ? fs.readFileSync(persistentDefaultsPath, "utf8")
    : null;

  if (persistentDefaults !== bundledDefaults) {
    fs.writeFileSync(persistentDefaultsPath, bundledDefaults, "utf8");
  }

  if (!fs.existsSync(overridesPath)) {
    fs.writeFileSync(overridesPath, "{}\n", "utf8");
  }

  return {
    bundledConfigDir,
    userConfigDir: configDir
  };
}

async function main() {
  const payload = loadPayloadManifest();
  const userDataDir = resolveUserDataDir();
  const payloadRoot = path.join(userDataDir, "runtime", payload.hash);

  extractPayload(payloadRoot, payload);

  const projectRoot = payloadRoot;
  const nodeExecutable = resolveNodeRuntimePath(projectRoot);
  const runnerEntry = path.join(projectRoot, "scripts", "mvp-orchestrator.js");
  const configPaths = ensurePersistentConfig(projectRoot, userDataDir);

  if (!fs.existsSync(nodeExecutable)) {
    throw new Error(`Bundled Node runtime is missing at ${nodeExecutable}`);
  }

  if (!fs.existsSync(runnerEntry)) {
    throw new Error(`Runner entry is missing at ${runnerEntry}`);
  }

  const child = new Deno.Command(nodeExecutable, {
    args: [runnerEntry],
    cwd: projectRoot,
    env: {
      ...Deno.env.toObject(),
      PACKAGE_RUNNER_BUNDLED_CONFIG_DIR: configPaths.bundledConfigDir,
      PACKAGE_RUNNER_USER_CONFIG_DIR: configPaths.userConfigDir
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  }).spawn();

  const forwardSignal = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore if the child already exited.
    }
  };

  Deno.addSignalListener("SIGINT", forwardSignal);
  Deno.addSignalListener("SIGTERM", forwardSignal);

  const status = await child.status;
  Deno.exit(status.code);
}

main().catch((error) => {
  console.error(error.message);
  Deno.exit(1);
});
