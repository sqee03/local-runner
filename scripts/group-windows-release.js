import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const windowsReleaseDir = path.join(projectRoot, "release", "windows");
const bundleDir = path.join(windowsReleaseDir, "runner");
const stagingDir = path.join(windowsReleaseDir, ".runner-app");
const appDir = path.join(bundleDir, "app");

if (!fs.existsSync(path.join(bundleDir, "runner.exe"))) {
  throw new Error(`Missing generated Windows desktop bundle at ${bundleDir}`);
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.renameSync(bundleDir, stagingDir);
fs.mkdirSync(bundleDir, { recursive: true });
fs.renameSync(stagingDir, appDir);

console.log(`Grouped Windows desktop runtime under ${appDir}`);
