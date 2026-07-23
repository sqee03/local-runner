import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const removeWindowsBundle = process.argv.includes("--remove-windows-bundle");

fs.rmSync(path.join(projectRoot, ".tmp", "payload-manifest.json"), {
  recursive: true,
  force: true
});

fs.rmSync(path.join(projectRoot, ".tmp", "packaged-runtime"), {
  recursive: true,
  force: true
});

fs.rmSync(path.join(projectRoot, ".tmp", "runtime-node_modules"), {
  recursive: true,
  force: true
});

fs.rmSync(path.join(projectRoot, ".tmp", "windows-icon-backend"), {
  recursive: true,
  force: true
});

if (removeWindowsBundle) {
  fs.rmSync(path.join(projectRoot, "release", "windows", "simulator"), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
