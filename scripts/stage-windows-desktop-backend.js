import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runnerDir = path.join(projectRoot, "release", "windows", "runner");
const runnerPath = path.join(runnerDir, "runner.exe");
const stagingRoot = path.join(projectRoot, ".tmp", "windows-icon-backend");
const stagingDir = path.join(stagingRoot, "cef", "build", "Release");
const excludedRootFiles = new Set([
  ".deno-desktop-app",
  ".downloaded",
  "AppIcon.ico",
  "runner.dll",
  "runner.exe"
]);

function main() {
  if (!fs.existsSync(runnerPath)) {
    throw new Error(`Missing finalized Windows runner executable at ${runnerPath}`);
  }

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const entry of fs.readdirSync(runnerDir, { withFileTypes: true })) {
    if (excludedRootFiles.has(entry.name)) {
      continue;
    }

    fs.cpSync(path.join(runnerDir, entry.name), path.join(stagingDir, entry.name), {
      recursive: true
    });
  }

  // Deno's internal development-backend lookup uses the build host's suffix,
  // even when cross-compiling. Provide both names so macOS and Windows hosts
  // resolve the same icon-bearing Windows launcher.
  fs.copyFileSync(runnerPath, path.join(stagingDir, "laufey"));
  fs.copyFileSync(runnerPath, path.join(stagingDir, "laufey.exe"));
  console.log(`Staged icon-bearing Windows backend at ${stagingRoot}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
