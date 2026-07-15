import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourceAppPath = "/tmp/runner.app";
const destinationAppPath = path.join(projectRoot, "release", "mac", "runner.app");

function stripExtendedAttributes(targetPath) {
  const result = spawnSync("xattr", ["-cr", targetPath], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`Failed to strip extended attributes from ${targetPath}`);
  }
}

function main() {
  if (!fs.existsSync(sourceAppPath)) {
    throw new Error(`Missing packaged Mac app at ${sourceAppPath}`);
  }

  fs.mkdirSync(path.dirname(destinationAppPath), { recursive: true });
  fs.rmSync(destinationAppPath, { recursive: true, force: true });
  fs.cpSync(sourceAppPath, destinationAppPath, {
    recursive: true
  });
  stripExtendedAttributes(destinationAppPath);
  fs.rmSync(sourceAppPath, { recursive: true, force: true });
  console.log(`Copied Mac desktop app to ${destinationAppPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
