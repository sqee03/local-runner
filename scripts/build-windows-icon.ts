import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "./runtime-paths.js";
import { encodePng, renderAppIcon } from "./icon-renderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = resolveProjectRoot(__dirname);
const assetsDir = path.join(projectRoot, "desktop", "assets");
const pngPath = path.join(assetsDir, "app-icon.png");
const icoPath = path.join(assetsDir, "app-icon.ico");
const iconSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

interface IconImage {
  readonly size: number;
  readonly png: Buffer;
}

function buildIco(images: ReadonlyArray<IconImage>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries: Buffer[] = [];
  let imageOffset = 6 + images.length * 16;

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    const encodedSize = size === 256 ? 0 : size;

    entry.writeUInt8(encodedSize, 0);
    entry.writeUInt8(encodedSize, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    entries.push(entry);
    imageOffset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

function main(): void {
  fs.mkdirSync(assetsDir, { recursive: true });

  const sourcePng = encodePng(512, 512, renderAppIcon(512));
  const iconImages = iconSizes.map((size) => ({
    size,
    png: encodePng(size, size, renderAppIcon(size))
  }));

  fs.writeFileSync(pngPath, sourcePng);
  fs.writeFileSync(icoPath, buildIco(iconImages));
  console.log(`Wrote ${iconImages.length}-size Windows icon to ${icoPath}`);
}

main();
