import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const runtimeRoot = path.resolve(__dirname, "..");

const runtimeAssets = [
  ["injections/fe/index.html", "injections/fe/index.html"],
  ["injections/fe/styles.css", "injections/fe/styles.css"]
] as const;

for (const [sourcePath, targetPath] of runtimeAssets) {
  const targetAbsolutePath = path.join(runtimeRoot, targetPath);
  fs.mkdirSync(path.dirname(targetAbsolutePath), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, sourcePath), targetAbsolutePath);
}

console.log(`Copied runtime assets to ${runtimeRoot}`);
