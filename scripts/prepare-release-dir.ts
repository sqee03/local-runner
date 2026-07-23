import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import type { ReleaseTarget } from "./node-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const releaseRoot = path.join(projectRoot, "release");
const tempRoot = path.join(projectRoot, ".tmp");
const target = process.argv[2];

const releaseTargets: Record<ReleaseTarget, string> = {
  windows: path.join(releaseRoot, "windows"),
  "mac-arm64": path.join(releaseRoot, "mac")
};

const legacyReleaseArtifacts = [
  path.join(releaseRoot, "runner"),
  path.join(releaseRoot, "runner.exe"),
  path.join(releaseRoot, "runner.dll"),
  path.join(releaseRoot, "runner.app"),
  path.join(releaseRoot, "simulator"),
  path.join(releaseRoot, "simulator.exe"),
  path.join(releaseRoot, "simulator.dll"),
  path.join(releaseRoot, "simulator.app"),
  path.join(releaseRoot, "windows-x64"),
  path.join(releaseRoot, "macos-arm64"),
  path.join(releaseRoot, ".DS_Store")
];

function isReleaseTarget(value: string | undefined): value is ReleaseTarget {
  return value === "windows" || value === "mac-arm64";
}

if (!isReleaseTarget(target)) {
  throw new Error(`Unknown release target: ${target ?? "<missing>"}`);
}

function removePath(targetPath: string): void {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

for (const artifactPath of legacyReleaseArtifacts) {
  removePath(artifactPath);
}

removePath(releaseTargets[target]);
removePath(path.join(tempRoot, "packaged-runtime"));
removePath(path.join(tempRoot, "runtime-node_modules"));
removePath(path.join(tempRoot, "payload-manifest.json"));
removePath(path.join(tempRoot, "windows-icon-backend"));

fs.mkdirSync(releaseRoot, { recursive: true });
fs.mkdirSync(releaseTargets[target], { recursive: true });
fs.mkdirSync(tempRoot, { recursive: true });
