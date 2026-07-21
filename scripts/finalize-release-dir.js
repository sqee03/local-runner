import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

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
