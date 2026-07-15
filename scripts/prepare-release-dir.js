import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release");
const tempRoot = path.join(projectRoot, ".tmp");
const target = process.argv[2];

const releaseTargets = {
  windows: path.join(releaseRoot, "windows"),
  "mac-arm64": path.join(releaseRoot, "mac")
};

const legacyReleaseArtifacts = [
  path.join(releaseRoot, "runner"),
  path.join(releaseRoot, "runner.exe"),
  path.join(releaseRoot, "runner.dll"),
  path.join(releaseRoot, "runner.app"),
  path.join(releaseRoot, "windows-x64"),
  path.join(releaseRoot, "macos-arm64"),
  path.join(releaseRoot, ".DS_Store")
];

if (!target || !releaseTargets[target]) {
  throw new Error(`Unknown release target: ${target ?? "<missing>"}`);
}

for (const artifactPath of legacyReleaseArtifacts) {
  fs.rmSync(artifactPath, { recursive: true, force: true });
}

fs.rmSync(releaseTargets[target], { recursive: true, force: true });
fs.rmSync(path.join(tempRoot, "runtime-node_modules"), { recursive: true, force: true });
fs.rmSync(path.join(tempRoot, "payload-manifest.json"), { recursive: true, force: true });

fs.mkdirSync(releaseRoot, { recursive: true });
fs.mkdirSync(releaseTargets[target], { recursive: true });
fs.mkdirSync(tempRoot, { recursive: true });
