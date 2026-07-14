import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseRoot = path.join(projectRoot, "release");

const stalePaths = [
  path.join(releaseRoot, "PackageRunner-data"),
  path.join(releaseRoot, "payload-manifest.json")
];

for (const stalePath of stalePaths) {
  fs.rmSync(stalePath, { recursive: true, force: true });
}

fs.mkdirSync(releaseRoot, { recursive: true });
