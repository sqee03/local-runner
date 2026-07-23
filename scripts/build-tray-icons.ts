import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { encodePng, renderTrayIcon } from "./icon-renderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const assetsDir = path.join(projectRoot, "desktop", "assets");
const outputSize = 22;

function main() {
  fs.mkdirSync(assetsDir, { recursive: true });

  const lightIcon = encodePng(outputSize, outputSize, renderTrayIcon(outputSize, [18, 18, 18]));
  const darkIcon = encodePng(
    outputSize,
    outputSize,
    renderTrayIcon(outputSize, [255, 255, 255])
  );

  fs.writeFileSync(path.join(assetsDir, "tray-icon.png"), lightIcon);
  fs.writeFileSync(path.join(assetsDir, "tray-icon-dark.png"), darkIcon);

  console.log("Updated tray icons.");
}

main();
