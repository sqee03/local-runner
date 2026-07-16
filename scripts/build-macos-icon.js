import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const assetsDir = path.join(projectRoot, "desktop", "assets");
const sourcePngPath = path.join(assetsDir, "app-icon.png");
const outputIcnsPath = path.join(assetsDir, "app-icon.icns");
const iconsetPath = path.join(projectRoot, ".tmp", "app-icon.iconset");

const iconEntries = [
  ["icp4", "icon_16x16.png", 16],
  ["icp5", "icon_32x32.png", 32],
  ["icp6", "icon_64x64.png", 64],
  ["ic07", "icon_128x128.png", 128],
  ["ic08", "icon_256x256.png", 256],
  ["ic09", "icon_512x512.png", 512],
  ["ic10", "icon_1024x1024.png", 1024]
];

function ensureCommand(commandName) {
  const result = spawnSync(commandName, ["--help"], {
    stdio: "ignore"
  });

  if (result.error && result.error.code === "ENOENT") {
    throw new Error(`Required command "${commandName}" is not available on PATH.`);
  }
}

function resizePng(outputPath, size) {
  const result = spawnSync(
    "sips",
    ["-z", String(size), String(size), sourcePngPath, "--out", outputPath],
    {
      stdio: "ignore"
    }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to create ${path.basename(outputPath)} from ${sourcePngPath}.`);
  }
}

function main() {
  if (!fs.existsSync(sourcePngPath)) {
    throw new Error(`Missing macOS app icon source at ${sourcePngPath}`);
  }

  ensureCommand("sips");
  fs.rmSync(iconsetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
  fs.mkdirSync(iconsetPath, { recursive: true });

  const iconChunks = [];
  for (const [type, fileName, size] of iconEntries) {
    resizePng(path.join(iconsetPath, fileName), size);
    const png = fs.readFileSync(path.join(iconsetPath, fileName));
    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    iconChunks.push(chunk);
  }

  const payload = Buffer.concat(iconChunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(header.length + payload.length, 4);
  fs.writeFileSync(outputIcnsPath, Buffer.concat([header, payload]));

  fs.rmSync(iconsetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });

  console.log(`Wrote macOS icon to ${outputIcnsPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
