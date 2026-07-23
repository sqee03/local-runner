import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { errorMessage } from "./node-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const simulatorDir = path.join(projectRoot, "release", "windows", "simulator");
const simulatorPath = path.join(simulatorDir, "simulator.exe");
const stagingRoot = path.join(projectRoot, ".tmp", "windows-icon-backend");
const stagingDir = path.join(stagingRoot, "cef", "build", "Release");
const excludedRootFiles = new Set([
  ".deno-desktop-app",
  ".downloaded",
  "AppIcon.ico",
  "simulator.dll",
  "simulator.exe"
]);

function main(): void {
  if (!fs.existsSync(simulatorPath)) {
    throw new Error(`Missing finalized Windows simulator executable at ${simulatorPath}`);
  }

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const entry of fs.readdirSync(simulatorDir, { withFileTypes: true })) {
    if (excludedRootFiles.has(entry.name)) {
      continue;
    }

    fs.cpSync(path.join(simulatorDir, entry.name), path.join(stagingDir, entry.name), {
      recursive: true
    });
  }

  // Deno's internal development-backend lookup uses the build host's suffix,
  // even when cross-compiling. Provide both names so macOS and Windows hosts
  // resolve the same icon-bearing Windows launcher.
  fs.copyFileSync(simulatorPath, path.join(stagingDir, "laufey"));
  fs.copyFileSync(simulatorPath, path.join(stagingDir, "laufey.exe"));
  console.log(`Staged icon-bearing Windows backend at ${stagingRoot}`);
}

try {
  main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
