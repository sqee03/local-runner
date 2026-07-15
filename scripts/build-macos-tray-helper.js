import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const sourcePath = path.join(projectRoot, "desktop", "macos-tray-helper.swift");
const outputDir = path.join(projectRoot, "desktop", "bin");
const outputPath = path.join(outputDir, "runnerTrayHelper");
const moduleCacheDir = path.join(projectRoot, ".tmp", "swift-module-cache");

function ensureXcrun() {
  const result = spawnSync("xcrun", ["--version"], {
    stdio: "ignore"
  });

  if (result.error && result.error.code === "ENOENT") {
    throw new Error("xcrun is required to build the macOS tray helper.");
  }

  if (result.status !== 0) {
    throw new Error("xcrun is installed but failed to run.");
  }
}

function buildHelper() {
  if (process.platform !== "darwin") {
    throw new Error("The macOS tray helper can only be built on macOS.");
  }

  ensureXcrun();

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(moduleCacheDir, { recursive: true });

  const result = spawnSync(
    "xcrun",
    ["--sdk", "macosx", "swiftc", "-module-cache-path", moduleCacheDir, "-O", sourcePath, "-o", outputPath],
    {
      stdio: "inherit"
    }
  );

  if (result.status !== 0) {
    throw new Error("Failed to build the macOS tray helper.");
  }

  fs.chmodSync(outputPath, 0o755);
  console.log(`Built macOS tray helper at ${outputPath}`);
}

try {
  buildHelper();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
